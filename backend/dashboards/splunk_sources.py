"""Read-only, bounded Splunk log-source statistics for explicitly selected indices."""
import hashlib
import math
import re
from datetime import datetime, timezone
from urllib.parse import urlsplit

from django.conf import settings
from rest_framework import serializers

from integrations.models import Integration
from integrations.serializers import validate_splunk_config
from integrations.splunk import SplunkError, read_results

MAX_SOURCES = 300
MAX_HOSTS = 5000
INDEX_NAME = r"^[A-Za-z0-9_.-]{1,64}$"
FIELD_NAME = r"^[A-Za-z_][A-Za-z0-9_.]{0,127}$"
HOST_ALIAS = "argus_coverage_host"
TIME_RANGES = {"24h": ("-24h", 1), "48h": ("-48h", 2), "7d": ("-7d", 7), "all": ("0", 0)}


class ScanTimeRangeSerializer(serializers.Serializer):
    time_range = serializers.ChoiceField(choices=list(TIME_RANGES), default="7d")


class ScanTargetSerializer(ScanTimeRangeSerializer):
    integration_id = serializers.UUIDField()
    indices = serializers.ListField(child=serializers.RegexField(INDEX_NAME), min_length=1, max_length=10)


def target_identity(config):
    """Relate separate reader/publisher integrations without returning connection origins."""
    origin = urlsplit(config.get("host", ""))
    try:
        port = origin.port or (443 if origin.scheme == "https" else 80)
    except ValueError:
        return None
    if not origin.hostname:
        return None
    return hashlib.sha256(f"{origin.scheme.lower()}://{origin.hostname.lower()}:{port}".encode()).hexdigest()


def scan_options():
    return [{"id": str(i.pk), "name": i.name, "index": i.config.get("index", "")}
            for i in Integration.objects.filter(type="splunk_search").order_by("name", "id")]


def validate_target(data):
    serializer = ScanTargetSerializer(data=data)
    serializer.is_valid(raise_exception=True)
    values = serializer.validated_data
    integration = Integration.objects.filter(pk=values["integration_id"], type="splunk_search").first()
    if not integration:
        raise serializers.ValidationError({"integration_id": "Select an existing Splunk alert collection integration."})
    return integration, list(dict.fromkeys(values["indices"])), values["time_range"]


def _search(config, query, time_range, limit, warnings=None):
    records = read_results(config, "/services/search/v2/jobs/export", data={
        "search": query, "earliest_time": TIME_RANGES[time_range][0], "latest_time": "now",
        "output_mode": "json", "preview": "false",
    }, limit=limit + 100)
    rows = []
    for record in records:
        if not isinstance(record, dict):
            raise SplunkError("Splunk returned invalid scan statistics.")
        messages = record.get("messages") or []
        if not isinstance(messages, list) or any(not isinstance(m, dict) for m in messages):
            raise SplunkError("Splunk returned invalid scan messages.")
        for message in messages:
            severity = str(message.get("type", "")).upper()
            if severity not in {"DEBUG", "INFO", "WARN", "ERROR", "FATAL"}:
                raise SplunkError("Splunk returned an unrecognized scan message.")
            if severity in {"ERROR", "FATAL"}:
                raise SplunkError("Splunk scan failed. Check index access, search permissions and search peers.")
            if severity == "WARN":
                text = message.get("text")
                digest = hashlib.sha256(text.encode()).hexdigest() if isinstance(text, str) and len(text) <= 4096 else None
                # Only exact messages reviewed by an operator may be nonfatal; unknown WARNs stay fail-closed.
                allowed = getattr(settings, "SPLUNK_COVERAGE_ALLOWED_WARNING_HASHES", ())
                if not isinstance(allowed, (list, tuple, set, frozenset)):
                    raise SplunkError("The server warning allowlist configuration is invalid.")
                if not digest or digest not in allowed:
                    raise SplunkError("Splunk scan has an unreviewed warning. Check search diagnostics before retrying.")
                if warnings is not None:
                    warnings.add("reviewed_search_warning")
        if record.get("preview") in (True, "true", "1", 1):
            continue
        if "result" in record:
            if not isinstance(record["result"], dict):
                raise SplunkError("Splunk returned invalid scan statistics.")
            rows.append(record["result"])
    if len(rows) > limit:
        raise SplunkError("Splunk scan exceeded the result limit.")
    return rows


def scan(target, categories):
    integration, indices, time_range = validate_target(target)
    config = validate_splunk_config(integration.config)
    fields = sorted({c.host_field for c in categories if c.asset_types and c.host_field})
    if len(fields) > 5 or any(not re.fullmatch(FIELD_NAME, f) for f in fields):
        raise serializers.ValidationError({"host_field": "Use at most five distinct literal host fields for a Splunk scan."})
    where = "(" + " OR ".join(f'index="{index}"' for index in indices) + ")"
    query = ("| tstats count AS docs max(_time) AS last_seen dc(host) AS hosts_approx "
             f"WHERE {where} BY index sourcetype | sort 0 - docs | head {MAX_SOURCES + 1}")
    warnings = set()
    rows = _search(config, query, time_range, MAX_SOURCES + 1, warnings)
    truncated = len(rows) > MAX_SOURCES
    evidence = {}
    incomplete = set()
    for field in fields:
        # Custom search-time fields need search/stats; the indexed host field uses tsidx statistics.
        if field == "host":
            query = f"| tstats count WHERE {where} BY index sourcetype host | rename host AS {HOST_ALIAS}"
        else:
            query = f"search {where} | eval {HOST_ALIAS}='{field}' | stats count BY index sourcetype {HOST_ALIAS}"
        try:
            hosts = _search(config, f"{query} | head {MAX_HOSTS + 1}", time_range, MAX_HOSTS + 1, warnings)
        except SplunkError:
            incomplete.add(field)
            continue
        if len(hosts) > MAX_HOSTS:
            incomplete.add(field)
            continue
        for host in hosts:
            value = host.get(HOST_ALIAS)
            index, sourcetype = host.get("index"), host.get("sourcetype")
            if (index not in indices or not isinstance(sourcetype, str) or not 0 < len(sourcetype) <= 256
                    or not isinstance(value, str) or not value.strip() or len(value) > 255):
                incomplete.add(field)
                break
            evidence.setdefault((index, sourcetype, field), set()).add(value.lower())
    sources = []
    try:
        for row in rows[:MAX_SOURCES]:
            index, sourcetype = row["index"], row["sourcetype"]
            if index not in indices or not isinstance(sourcetype, str) or not 0 < len(sourcetype) <= 256:
                raise ValueError
            docs, hosts = int(row["docs"]), int(row["hosts_approx"])
            stamp = float(row["last_seen"])
            if docs < 0 or hosts < 0 or not math.isfinite(stamp):
                raise ValueError
            identity = hashlib.sha256(f"{index}\0{sourcetype}".encode()).hexdigest()[:32]
            sources.append({
                "source_key": f"sp:{integration.pk}:{identity}",
                "source_label": f"{index}/{sourcetype}", "index": index, "sourcetype": sourcetype,
                "target_id": target_identity(config), "index_count": 1, "docs": docs,
                "last_seen": datetime.fromtimestamp(stamp, timezone.utc).isoformat(), "hosts_approx": hosts,
                "host_values": {f: sorted(evidence.get((index, sourcetype, f), set()))
                                for f in fields if f not in incomplete and (docs == 0 or (index, sourcetype, f) in evidence)},
                "hints": {"modules": [], "datasets": [sourcetype], "categories": []},
            })
    except (KeyError, TypeError, ValueError, OverflowError, OSError) as exc:
        raise SplunkError("Splunk returned invalid scan statistics.") from exc
    if incomplete or any(s["docs"] > 0 and any(f not in s["host_values"] for f in fields) for s in sources):
        warnings.add("host_statistics_unavailable")
    return {"es_available": True, "sources": sources, "truncated": truncated,
            "warnings": sorted(warnings),
            "window_days": TIME_RANGES[time_range][1],
            "host_fields": [f for f in fields if f not in incomplete],
            "target_id": target_identity(config),
            "targets": {"integration_id": str(integration.pk), "indices": indices, "time_range": time_range}}
