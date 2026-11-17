"""Discover platform-scoped log sources and resolve their effective category."""
import fnmatch
import logging
from datetime import timedelta

from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

from .log_source_classifier import (
    UNCLASSIFIED,
    classify_source,
    is_internal_source,
    normalize_source_key,
)
from .models import LogSourceCategory, LogSourceMapping, LogSourceScan

logger = logging.getLogger(__name__)

INIT_LOCK_KEY = "dashboards:log_source_scan:init"
INIT_LOCK_SECONDS = 120
DEFAULT_WINDOW_DAYS = 7
MAX_INDEX_BUCKETS = 2000
MAX_SOURCES = 300


def source_matches(source, pattern):
    values = (source.get("index"), source.get("source_label", source["source_key"]))
    return any(value and fnmatch.fnmatchcase(value, pattern) for value in values)


def _es_client():
    # Imported lazily to avoid a module cycle with log_source_coverage.
    from .log_source_coverage import _es_client as build

    return build()


def _candidate_names(es):
    """Names of non-hidden indices plus data streams, so sources without recent data still show up."""
    names = set()
    try:
        for row in es.cat_indices():
            names.add(row["index"])
    except Exception:
        logger.warning("log source discovery: cat.indices failed", exc_info=True)
    try:
        for ds in es.data_streams():
            names.add(ds["name"])
    except Exception:
        # Not supported (ES < 7.9) or no permission; backing indices still surface via the search below.
        logger.debug("log source discovery: get_data_stream unavailable", exc_info=True)
    return names


def _hint_aggs():
    top = lambda field, size: {"terms": {"field": field, "size": size}}  # noqa: E731
    return {
        "modules": top("event.module", 3),
        "datasets": top("event.dataset", 3),
        "ds_dataset": top("data_stream.dataset", 1),
        "categories": top("event.category", 4),
    }


def _search_index_stats(es, since):
    base_aggs = {
        "last_seen": {"max": {"field": "@timestamp"}},
        "hosts": {"cardinality": {"field": "host.name"}},
    }
    for with_hints in (True, False):
        aggs = {**base_aggs, **(_hint_aggs() if with_hints else {})}
        body = {
            "size": 0,
            "query": {"range": {"@timestamp": {"gte": since.isoformat()}}},
            "aggs": {"idx": {"terms": {"field": "_index", "size": MAX_INDEX_BUCKETS}, "aggs": aggs}},
        }
        try:
            res = es.search(index="*", body=body, ignore_unavailable=True, allow_no_indices=True)
            return res.get("aggregations", {}).get("idx", {}).get("buckets", [])
        except Exception:
            # A hint field mapped as text rejects terms aggs; retry once without the hints.
            logger.warning("log source discovery: search failed (hints=%s)", with_hints, exc_info=True)
    return None


def _keys(agg):
    return [b["key"] for b in (agg or {}).get("buckets", [])]


def _scan_es(days=DEFAULT_WINDOW_DAYS):
    """Scan the connected Elasticsearch for log sources (expensive; call sparingly)."""
    es, cfg = _es_client()
    if not es:
        return {"es_available": False, "reason": "Elasticsearch integration is not enabled.", "sources": []}

    since = timezone.now() - timedelta(days=days)
    buckets = _search_index_stats(es, since)
    if buckets is None:
        return {
            "es_available": False,
            "reason": "Could not read indices from Elasticsearch (check credentials and index permissions).",
            "sources": [],
        }

    alert_index = (getattr(cfg, "index", "") or "").strip()
    alert_key = normalize_source_key(alert_index) if alert_index else None

    sources = {}

    def entry(key):
        return sources.setdefault(
            key,
            {
                "source_key": key,
                "indices": set(),
                "docs": 0,
                "last_seen": None,
                "hosts_approx": 0,
                "modules": set(),
                "datasets": set(),
                "categories": set(),
            },
        )

    def skip(name, key):
        return is_internal_source(name) or (alert_key and key == alert_key)

    for name in _candidate_names(es):
        key = normalize_source_key(name)
        if not skip(name, key):
            entry(key)["indices"].add(name)

    for b in buckets:
        name = b["key"]
        key = normalize_source_key(name)
        if skip(name, key):
            continue
        e = entry(key)
        e["indices"].add(name)
        e["docs"] += b.get("doc_count", 0)
        seen = (b.get("last_seen") or {}).get("value_as_string")
        if seen and (e["last_seen"] is None or seen > e["last_seen"]):
            e["last_seen"] = seen
        e["hosts_approx"] = max(e["hosts_approx"], int((b.get("hosts") or {}).get("value") or 0))
        e["modules"].update(_keys(b.get("modules")))
        e["datasets"].update(_keys(b.get("datasets")) + _keys(b.get("ds_dataset")))
        e["categories"].update(_keys(b.get("categories")))

    ordered = sorted(sources.values(), key=lambda s: (-s["docs"], s["source_key"]))
    truncated = len(ordered) > MAX_SOURCES
    out = []
    for s in ordered[:MAX_SOURCES]:
        out.append(
            {
                "source_key": s["source_key"],
                "index_count": len(s["indices"]),
                "docs": s["docs"],
                "last_seen": s["last_seen"],
                "hosts_approx": s["hosts_approx"],
                "hints": {
                    "modules": sorted(s["modules"]),
                    "datasets": sorted(s["datasets"]),
                    "categories": sorted(s["categories"]),
                },
            }
        )
    result = {
        "es_available": True,
        "reason": None,
        "window_days": days,
        "truncated": truncated,
        "sources": out,
    }
    return result


def load_snapshot(platform="elk"):
    return LogSourceScan.objects.filter(platform=platform).first()


def run_scan(days=DEFAULT_WINDOW_DAYS, actor="", platform="elk", targets=None):
    """Persist a scan without replacing the previous good snapshot on failure."""
    if platform == "splunk":
        from integrations.splunk import SplunkError
        from .splunk_sources import scan

        try:
            result = scan(targets, LogSourceCategory.objects.filter(platform=platform))
            days = result["window_days"]
        except SplunkError as exc:
            return None, str(exc)
    else:
        result = _scan_es(days)
    if not result["es_available"]:
        return None, result.get("reason")
    if platform == "splunk" and not result.get("truncated"):
        previous = load_snapshot(platform)
        # Preserve known but now silent sources, only within the exact scanned origin/index scope.
        if previous and previous.targets.get("integration_id") == result["targets"]["integration_id"]:
            keys = {s["source_key"] for s in result["sources"]}
            for source in previous.payload:
                if (source["source_key"] not in keys and source.get("target_id") == result["target_id"]
                        and source.get("index") in result["targets"]["indices"]):
                    result["sources"].append({**source, "docs": 0, "last_seen": None, "hosts_approx": 0,
                                              "host_values": {f: [] for f in result["host_fields"]}})
            if len(result["sources"]) > MAX_SOURCES:
                result["sources"] = result["sources"][:MAX_SOURCES]
                result["truncated"] = True
    with transaction.atomic():
        snap = LogSourceScan.objects.create(
            platform=platform, targets=result.get("targets", {}),
            scanned_at=timezone.now(),
            window_days=days,
            truncated=result.get("truncated", False),
            payload=result["sources"],
            scanned_by=actor,
        )
        LogSourceScan.objects.filter(platform=platform).exclude(pk=snap.pk).delete()
    return snap, None


def ensure_snapshot(allow_scan=True, platform="elk"):
    """Return (snapshot, error). Scans automatically only when none exists yet (first initialization).

    `allow_scan=False` never touches ES: with no stored scan it returns (None, reason).
    """
    snap = load_snapshot(platform)
    if snap is not None:
        return snap, None
    if not allow_scan or platform == "splunk":
        return None, "No log source scan has been run yet."
    es, _cfg = _es_client()
    if not es:
        return None, "Elasticsearch integration is not enabled."
    # cache.add is atomic, so concurrent first visits trigger a single scan.
    if not cache.add(INIT_LOCK_KEY, 1, INIT_LOCK_SECONDS):
        return load_snapshot(), None
    try:
        return run_scan(actor="auto-init")
    finally:
        cache.delete(INIT_LOCK_KEY)


def resolve_sources(rescan_actor=None, allow_scan=True, platform="elk", targets=None, include_host_values=False):
    """Snapshot + auto classification + manual mappings, with the effective category per source.

    Reads the stored scan; a scan only runs when `rescan_actor` is given (explicit re-scan) or when
    no snapshot exists yet (first initialization). `allow_scan=False` disables both.
    """
    if rescan_actor is not None and allow_scan:
        snap, error = run_scan(actor=rescan_actor, platform=platform, targets=targets)
        if snap is None:
            snap = load_snapshot(platform)  # keep showing the previous good scan
    else:
        snap, error = ensure_snapshot(allow_scan=allow_scan, platform=platform)
    discovered = {
        "sources": snap.payload if snap else [],
        "truncated": snap.truncated if snap else False,
    }
    now = timezone.now()
    categories = list(LogSourceCategory.objects.filter(platform=platform))
    by_name = {c.name.lower(): c for c in categories}
    mappings = {m.source_key: m for m in LogSourceMapping.objects.filter(platform=platform)}

    sources = []
    seen_keys = set()
    for s in discovered["sources"]:
        seen_keys.add(s["source_key"])
        auto = classify_source(
            s.get("source_label", s["source_key"]),
            modules=s["hints"]["modules"],
            datasets=s["hints"]["datasets"],
            categories=s["hints"]["categories"],
        )
        auto_cat = by_name.get(auto["category"].lower()) if auto["category"] != UNCLASSIFIED else None
        row = _resolved_row(s, auto, auto_cat, mappings.get(s["source_key"]))
        if platform == "splunk" and row["manual"] is None:
            matched = next((c for c in categories if c.enabled and any(source_matches(s, p) for p in c.matchers)), None)
            if matched:
                row["effective_category_id"] = matched.pk
        sources.append(row)

    # Manual mappings whose source vanished from ES still count (and stay visible so they can be reset).
    for key, m in mappings.items():
        if key in seen_keys:
            continue
        stub = {
            "source_key": key, "index_count": 0, "docs": 0, "last_seen": None, "hosts_approx": 0,
            "hints": {"modules": [], "datasets": [], "categories": []},
        }
        if platform == "splunk":
            stub["source_label"] = m.note or key
        auto = {"category": UNCLASSIFIED, "confidence": "none", "reason": "source not found in latest scan"}
        sources.append(_resolved_row(stub, auto, None, m))

    if not include_host_values:
        for source in sources:
            source.pop("host_values", None)
    return {
        "initialized": snap is not None,
        # Initialization is true once a scan succeeded; `reason` explains the latest failed attempt.
        "es_available": snap is not None,
        "reason": error,
        "window_days": snap.window_days if snap else DEFAULT_WINDOW_DAYS,
        **({"time_range": snap.targets.get("time_range", "7d") if snap else "7d"} if platform == "splunk" else {}),
        "truncated": discovered["truncated"],
        "scanned_at": snap.scanned_at.isoformat() if snap else None,
        "scanned_by": snap.scanned_by if snap else None,
        "scan_age_seconds": int((now - snap.scanned_at).total_seconds()) if snap else None,
        "sources": sources,
        "targets": snap.targets if snap else {},
    }


def _resolved_row(s, auto, auto_cat, mapping):
    row = {
        "source_key": s["source_key"],
        "index_count": s["index_count"],
        "docs": s["docs"],
        "last_seen": s["last_seen"],
        "hosts_approx": s["hosts_approx"],
        "auto_category": auto["category"],
        "auto_category_id": auto_cat.id if auto_cat else None,
        "auto_confidence": auto["confidence"],
        "auto_reason": auto["reason"],
        "manual": None,
    }
    for field in ("source_label", "index", "sourcetype", "target_id", "host_values"):
        if field in s:
            row[field] = s[field]
    if mapping:
        row["manual"] = {"category_id": mapping.category_id, "ignored": mapping.ignored}
        row["ignored"] = mapping.ignored
        row["effective_category_id"] = None if mapping.ignored else mapping.category_id
        row["origin"] = "manual"
    else:
        row["ignored"] = False
        row["effective_category_id"] = row["auto_category_id"]
        row["origin"] = "auto"
    return row
