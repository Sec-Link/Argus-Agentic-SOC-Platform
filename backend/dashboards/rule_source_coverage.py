"""Relate detection rules to log source categories to show how much of the rule set can actually fire."""
import fnmatch
import logging

from detections.models import SplunkRulePublication

from .log_source_classifier import UNCLASSIFIED, classify_source
from .source_scope import dashboard_rules

logger = logging.getLogger(__name__)

# A pattern that spans more categories than this (e.g. "logs-*") says nothing about the log source.
BROAD_PATTERN_CATEGORIES = 2
# A pattern hitting more sources than this (e.g. "logs-*") is too generic to credit any single source.
BROAD_PATTERN_SOURCES = 8
# Cap on rule rows returned for the drill-down view.
RULE_ITEMS_LIMIT = 1000


def _as_patterns(value):
    if isinstance(value, str):
        value = [p for p in value.replace(",", " ").split() if p]
    if not isinstance(value, list):
        return []
    return [str(p).strip() for p in value if str(p).strip()]


def _rule_patterns(row):
    if 'source_patterns' in row:
        return _as_patterns(row['source_patterns'])
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
    if 'matched_sources' in row:
        return row['matched_sources']
    hit = set()
    for pattern in _rule_patterns(row):
        matched = {k for k in source_keys if fnmatch.fnmatch(k, pattern) or fnmatch.fnmatch(pattern, k)}
        if len(matched) <= BROAD_PATTERN_SOURCES:
            hit |= matched
    return hit


def compute_rule_coverage(category_results, sources, platform=None):
    """`category_results` come from compute_log_source_coverage; `sources` from resolve_sources."""
    names_by_id = {c["id"]: c["name"] for c in category_results}
    active_by_id = {c["id"]: c["active"] for c in category_results}
    per_cat = {cid: {"enabled_rules": 0, "total_rules": 0} for cid in names_by_id}

    rows = dashboard_rules(platform).values(
        "rule_uuid", "name", "enabled", "payload__elastic_index_patterns", "payload__kibana_metadata", "payload__list_meta"
    )
    if platform == 'elk':
        enabled_ids = set(dashboard_rules(platform, enabled_only=True).values_list('rule_uuid', flat=True))
        rows = [{**row, 'enabled': row['rule_uuid'] in enabled_ids} for row in rows]
    if platform == 'splunk':
        from .splunk_sources import target_identity

        enabled_ids = set(dashboard_rules(platform, enabled_only=True).values_list('rule_uuid', flat=True))
        targets = {}
        for publication in SplunkRulePublication.objects.filter(
            published_version__isnull=False, integration__type='splunk_rule_publisher',
        ).select_related('integration', 'rule'):
            config = publication.published_config
            if not isinstance(config, dict):
                continue
            identity = target_identity(publication.integration.config)
            matched = {s['source_key'] for s in sources if not s.get('ignored')
                       and identity and s.get('target_id') == identity and s.get('index') == config.get('index')
                       and (not config.get('sourcetype') or s.get('sourcetype') == config['sourcetype'])}
            all_keys, enabled_keys = targets.setdefault(publication.rule.rule_uuid, (set(), set()))
            all_keys.update(matched)
            if publication.enabled and publication.status == 'synced':
                enabled_keys.update(matched)
        rows = [{**row, 'enabled': row['rule_uuid'] in enabled_ids, 'source_patterns': [],
                 'matched_sources': targets.get(row['rule_uuid'], (set(), set()))[0],
                 'enabled_sources': targets.get(row['rule_uuid'], (set(), set()))[1]} for row in rows]
    source_keys = [s["source_key"] for s in sources]
    per_source = {}
    total = enabled = with_data = blind = unmapped = 0
    items = []
    for row in rows:
        total += 1
        for key in _sources_for_rule(row, source_keys):
            counts = per_source.setdefault(key, {"enabled_rules": 0, "total_rules": 0})
            counts["total_rules"] += 1
            if row["enabled"] and (platform != 'splunk' or key in row['enabled_sources']):
                counts["enabled_rules"] += 1
        if platform == 'splunk':
            keys = row['enabled_sources'] if row['enabled'] else row['matched_sources']
            cats = {c['id'] for c in category_results if any(s['source_key'] in keys for s in c['sources'])}
        else:
            cats = _categories_for_rule(row, sources, names_by_id)
        for cid in cats:
            per_cat[cid]["total_rules"] += 1
            if row["enabled"]:
                per_cat[cid]["enabled_rules"] += 1
        state = "disabled"
        if row["enabled"]:
            enabled += 1
            if not cats:
                unmapped += 1
                state = "unknown"
            elif (any(s['docs'] > 0 and s['source_key'] in row['enabled_sources']
                      for c in category_results for s in c['sources'])
                  if platform == 'splunk' else any(active_by_id.get(cid) for cid in cats)):
                with_data += 1
                state = "with_data"
            else:
                blind += 1
                state = "without_data"
        if len(items) < RULE_ITEMS_LIMIT:
            items.append({
                "id": row["rule_uuid"],
                "name": row["name"],
                "enabled": bool(row["enabled"]),
                "state": state,
                "categories": sorted(names_by_id[cid] for cid in cats if cid in names_by_id),
                "sources": sorted(_sources_for_rule(row, source_keys)),
            })

    return {
        "total_rules": total,
        "enabled_rules": enabled,
        "enabled_percent": round(enabled / total * 100, 1) if total else None,
        "enabled_with_data": with_data,
        "enabled_without_data": blind,
        "enabled_unmapped": unmapped,
        "categories": per_cat,
        "sources": per_source,
        # Drill-down list for the dashboard (capped); state: with_data | without_data | unknown | disabled.
        "items": items,
    }
