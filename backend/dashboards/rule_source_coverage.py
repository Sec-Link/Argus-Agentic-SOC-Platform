"""Relate detection rules to log source categories to show how much of the rule set can actually fire."""
import fnmatch
import logging

from detections.models import LocalDetectionRule

from .log_source_classifier import UNCLASSIFIED, classify_source

logger = logging.getLogger(__name__)

# A pattern that spans more categories than this (e.g. "logs-*") says nothing about the log source.
BROAD_PATTERN_CATEGORIES = 2
# A pattern hitting more sources than this (e.g. "logs-*") is too generic to credit any single source.
BROAD_PATTERN_SOURCES = 8


def _as_patterns(value):
    if isinstance(value, str):
        value = [p for p in value.replace(",", " ").split() if p]
    if not isinstance(value, list):
        return []
    return [str(p).strip() for p in value if str(p).strip()]


def _rule_patterns(row):
    patterns = _as_patterns(row.get("payload__elastic_index_patterns"))
    meta = row.get("payload__kibana_metadata")
    if isinstance(meta, dict):
        patterns += _as_patterns(meta.get("index"))
    return list(dict.fromkeys(patterns))


def _logsource_text(row):
    meta = row.get("payload__list_meta")
    if isinstance(meta, dict):
        return " ".join(
            str(meta.get(k) or "") for k in ("product", "service", "category", "logsource")
        ).strip()
    return ""


def _categories_for_rule(row, sources, names_by_id):
    """Category ids a rule depends on: index patterns vs discovered sources first, then name heuristics."""
    ids = set()
    for pattern in _rule_patterns(row):
        hit = {
            s["effective_category_id"]
            for s in sources
            if s["effective_category_id"] is not None
            and (fnmatch.fnmatch(s["source_key"], pattern) or fnmatch.fnmatch(pattern, s["source_key"]))
        }
        if len(hit) > BROAD_PATTERN_CATEGORIES:
            continue
        ids |= hit
    if ids:
        return ids

    ids_by_name = {n.lower(): i for i, n in names_by_id.items()}
    texts = [*_rule_patterns(row), _logsource_text(row)]
    for text in texts:
        if not text:
            continue
        guess = classify_source(text.lower())["category"]
        if guess != UNCLASSIFIED and guess.lower() in ids_by_name:
            ids.add(ids_by_name[guess.lower()])
    return ids


def _sources_for_rule(row, source_keys):
    """Source keys a rule's index patterns point at (generic patterns are ignored)."""
    hit = set()
    for pattern in _rule_patterns(row):
        matched = {k for k in source_keys if fnmatch.fnmatch(k, pattern) or fnmatch.fnmatch(pattern, k)}
        if len(matched) <= BROAD_PATTERN_SOURCES:
            hit |= matched
    return hit


def compute_rule_coverage(category_results, sources):
    """`category_results` come from compute_log_source_coverage; `sources` from resolve_sources."""
    names_by_id = {c["id"]: c["name"] for c in category_results}
    active_by_id = {c["id"]: c["active"] for c in category_results}
    per_cat = {cid: {"enabled_rules": 0, "total_rules": 0} for cid in names_by_id}

    rows = LocalDetectionRule.objects.filter(is_deleted=False).values(
        "enabled", "payload__elastic_index_patterns", "payload__kibana_metadata", "payload__list_meta"
    )
    source_keys = [s["source_key"] for s in sources]
    per_source = {}
    total = enabled = with_data = blind = unmapped = 0
    for row in rows:
        total += 1
        for key in _sources_for_rule(row, source_keys):
            counts = per_source.setdefault(key, {"enabled_rules": 0, "total_rules": 0})
            counts["total_rules"] += 1
            if row["enabled"]:
                counts["enabled_rules"] += 1
        cats = _categories_for_rule(row, sources, names_by_id)
        for cid in cats:
            per_cat[cid]["total_rules"] += 1
            if row["enabled"]:
                per_cat[cid]["enabled_rules"] += 1
        if not row["enabled"]:
            continue
        enabled += 1
        if not cats:
            unmapped += 1
        elif any(active_by_id.get(cid) for cid in cats):
            with_data += 1
        else:
            blind += 1

    return {
        "total_rules": total,
        "enabled_rules": enabled,
        "enabled_percent": round(enabled / total * 100, 1) if total else None,
        "enabled_with_data": with_data,
        "enabled_without_data": blind,
        "enabled_unmapped": unmapped,
        "categories": per_cat,
        "sources": per_source,
    }
