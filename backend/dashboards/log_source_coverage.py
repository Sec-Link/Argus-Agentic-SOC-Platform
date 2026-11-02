"""Compute log source coverage per category from Elasticsearch, falling back to persisted alerts."""
import fnmatch
import logging
from datetime import timedelta

from django.utils import timezone

from alerts.models import Alert
from cmdb.models import Asset

from .es_http import EsHttp
from .log_source_discovery import DEFAULT_WINDOW_DAYS, resolve_sources
from .rule_source_coverage import compute_rule_coverage
from .models import LogSourceCategory

logger = logging.getLogger(__name__)

HOST_AGG_SIZE = 10000


def _es_client():
    """Return (client, cfg) when ES is configured and enabled, else (None, None)."""
    try:
        from alerts.services import _get_global_es_config

        cfg = _get_global_es_config()
        if not cfg or not cfg.enabled or not cfg.hosts_list():
            return None, None
        return EsHttp(cfg), cfg
    except Exception:
        logger.exception("log source coverage: could not build ES client")
        return None, None


def _es_category_stats(es, category, patterns, since):
    """Return last_seen / observed hosts for the given index patterns, or None on failure."""
    body = {
        "size": 0,
        "query": {"range": {"@timestamp": {"gte": since.isoformat()}}},
        "aggs": {"last_seen": {"max": {"field": "@timestamp"}}},
    }
    if category.host_field:
        body["aggs"]["hosts"] = {"terms": {"field": category.host_field, "size": HOST_AGG_SIZE}}
    try:
        res = es.search(
            index=",".join(patterns),
            body=body,
            ignore_unavailable=True,
            allow_no_indices=True,
        )
    except Exception:
        logger.warning("log source coverage: ES query failed for %s", category.name, exc_info=True)
        return None
    aggs = res.get("aggregations", {})
    total = (res.get("hits", {}).get("total") or {})
    total = total.get("value", 0) if isinstance(total, dict) else int(total or 0)
    last_seen = aggs.get("last_seen", {}).get("value_as_string")
    hosts = {str(b["key"]).lower() for b in aggs.get("hosts", {}).get("buckets", [])}
    return {"events": total, "last_seen": last_seen if total else None, "hosts": hosts}


def _alert_category_stats(patterns, since):
    """Fallback: infer activity from alert source_index values matching the category patterns."""
    indices = (
        Alert.objects.filter(timestamp__gte=since)
        .exclude(source_index__isnull=True)
        .values_list("source_index", flat=True)
        .distinct()
    )
    matched = [i for i in indices if any(fnmatch.fnmatch(i, p) for p in patterns)]
    if not matched:
        return {"events": 0, "last_seen": None, "hosts": set()}
    last = (
        Alert.objects.filter(source_index__in=matched, timestamp__gte=since)
        .order_by("-timestamp")
        .values_list("timestamp", flat=True)
        .first()
    )
    return {"events": len(matched), "last_seen": last.isoformat() if last else None, "hosts": set()}


def compute_log_source_coverage(days=DEFAULT_WINDOW_DAYS):
    es, _cfg = _es_client()
    categories = list(LogSourceCategory.objects.filter(enabled=True))

    # Stored scan (plus manual overrides). Visiting the page never re-scans ES.
    resolved = resolve_sources()
    initialized = resolved["initialized"]
    days = resolved["window_days"]
    since = timezone.now() - timedelta(days=days)
    sources_by_cat = {}
    unclassified = ignored = 0
    for src in resolved["sources"]:
        if src["ignored"]:
            ignored += 1
        elif src["effective_category_id"] is None:
            unclassified += 1
        else:
            sources_by_cat.setdefault(src["effective_category_id"], []).append(src)

    results = []
    for cat in categories:
        cat_sources = list(sources_by_cat.get(cat.id, []))
        # Hand-entered extra patterns also pull in matching scanned sources.
        assigned = {s["source_key"] for s in cat_sources}
        for src in resolved["sources"]:
            if (
                not src["ignored"]
                and src["source_key"] not in assigned
                and any(fnmatch.fnmatch(src["source_key"], p) for p in cat.matchers)
            ):
                cat_sources.append(src)
        patterns = list(dict.fromkeys([*cat.matchers, *(s["source_key"] for s in cat_sources)]))
        seen = [s["last_seen"] for s in cat_sources if s["last_seen"]]
        entry = {
            "id": cat.id,
            "name": cat.name,
            # Once scanned every enabled category counts (no sources = a real gap); before that only
            # categories with hand-entered patterns can be evaluated (via alert source_index).
            "configured": bool(patterns) or initialized,
            "source_count": len(cat_sources),
            "sources": [
                {"source_key": s["source_key"], "docs": s["docs"], "last_seen": s["last_seen"], "origin": s["origin"]}
                for s in cat_sources
            ],
            "active": False,
            "last_seen": None,
            "expected_assets": None,
            "observed_assets": None,
            "asset_coverage_percent": None,
            "data_source": None,
        }
        if initialized:
            entry["data_source"] = "elasticsearch"
            entry["last_seen"] = max(seen) if seen else None
            entry["active"] = bool(seen)
        elif patterns:
            stats = _alert_category_stats(patterns, since)
            entry["data_source"] = "alerts"
            entry["active"] = bool(stats["last_seen"])
            entry["last_seen"] = stats["last_seen"]

        # Host-level coverage needs live host names, so only categories linked to CMDB assets query ES.
        if es and initialized and cat.asset_types and patterns:
            stats = _es_category_stats(es, cat, patterns, since)
            if stats is not None:
                hostnames = {
                    h.lower()
                    for h in Asset.objects.filter(asset_type__in=cat.asset_types)
                    .exclude(hostname="")
                    .values_list("hostname", flat=True)
                }
                entry["expected_assets"] = len(hostnames)
                entry["observed_assets"] = len(hostnames & stats["hosts"])
                if hostnames:
                    entry["asset_coverage_percent"] = round(entry["observed_assets"] / len(hostnames) * 100, 1)
        results.append(entry)

    try:
        rules = compute_rule_coverage(results, resolved["sources"])
    except Exception:
        logger.exception("log source coverage: rule coverage failed")
        rules = None
    for entry in results:
        counts = (rules or {}).get("categories", {}).get(entry["id"], {})
        entry["enabled_rules"] = counts.get("enabled_rules", 0)
        entry["total_rules"] = counts.get("total_rules", 0)
    per_source = (rules or {}).get("sources", {})
    if rules:
        rules.pop("categories")
        rules.pop("sources")

    def with_rules(item):
        counts = per_source.get(item["source_key"], {})
        return {**item, "enabled_rules": counts.get("enabled_rules", 0), "total_rules": counts.get("total_rules", 0)}

    for entry in results:
        entry["sources"] = [with_rules(s) for s in entry["sources"]]

    def brief(src):
        return with_rules({
            "source_key": src["source_key"],
            "docs": src["docs"],
            "last_seen": src["last_seen"],
            "auto_category": src["auto_category"],
            "auto_confidence": src["auto_confidence"],
            "auto_reason": src["auto_reason"],
        })

    configured = [r for r in results if r["configured"]]
    active = [r for r in configured if r["active"]]
    return {
        "rules": rules,
        "unclassified": [brief(s) for s in resolved["sources"] if not s["ignored"] and s["effective_category_id"] is None][:100],
        "ignored": [brief(s) for s in resolved["sources"] if s["ignored"]][:100],
        "window_days": days,
        "initialized": initialized,
        "es_available": initialized,
        "es_reason": resolved.get("reason"),
        "scanned_at": resolved["scanned_at"],
        "scan_age_seconds": resolved["scan_age_seconds"],
        "total_categories": len(results),
        "configured_categories": len(configured),
        "active_categories": len(active),
        "unconfigured_categories": len(results) - len(configured),
        "unclassified_sources": unclassified,
        "ignored_sources": ignored,
        "coverage_percent": round(len(active) / len(configured) * 100, 1) if configured else None,
        "categories": results,
    }


def preview_matchers(matchers, days=7):
    """Return the ES indices hit by `matchers` with their document counts over the last `days` days."""
    es, _cfg = _es_client()
    if not es:
        return {"es_available": False, "indices": []}
    since = timezone.now() - timedelta(days=days)
    body = {
        "size": 0,
        "query": {"range": {"@timestamp": {"gte": since.isoformat()}}},
        "aggs": {"indices": {"terms": {"field": "_index", "size": 100}}},
    }
    try:
        res = es.search(index=",".join(matchers), body=body, ignore_unavailable=True, allow_no_indices=True)
    except Exception:
        logger.warning("log source preview: ES query failed", exc_info=True)
        return {"es_available": False, "indices": []}
    buckets = res.get("aggregations", {}).get("indices", {}).get("buckets", [])
    return {
        "es_available": True,
        "window_days": days,
        "indices": [{"index": b["key"], "docs": b["doc_count"]} for b in buckets],
    }
