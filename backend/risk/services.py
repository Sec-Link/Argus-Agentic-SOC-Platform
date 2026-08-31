"""Risk scoring service — Entity-Centric Risk Alerting (RBA).

Scoring formula:
    final_score = rule.risk_score × severity_weight × asset_multiplier

Decay (applied every 6 h by the orchestrator task):
    profile.current_score *= DECAY_RATE  (0.85)
    floor: if score drops below SCORE_FLOOR (1.0), set to 0

Field config resolution order:
    1. RiskRuleConfig(rule_uuid=X, enabled=True)  → rule-level override
    2. GlobalRiskConfig (singleton)               → platform default
    3. neither exists                             → skip, no extraction
"""

import logging
from typing import Any

from django.db import IntegrityError, transaction
from django.db.models import F, Value
from django.db.models.functions import Greatest
from django.utils import timezone

from detections.models import LocalDetectionRule
from .models import GlobalRiskConfig, RiskEvent, RiskObjectProfile, RiskRuleConfig, RiskScoreEntry

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tuneable constants
# ---------------------------------------------------------------------------
DECAY_RATE: float = 0.85
SCORE_FLOOR: float = 1.0

SEVERITY_WEIGHT: dict[str, float] = {
    'critical': 2.0,
    'high': 1.5,
    'medium': 1.0,
    'low': 0.5,
}

ASSET_CRITICALITY_WEIGHT: dict[str, float] = {
    'critical': 2.0,
    'high': 1.5,
    'medium': 1.0,
    'low': 0.8,
}

# ECS fields shown as presets in the UI (field path → default type)
ECS_PRESET_FIELDS: list[dict] = [
    {'field': 'host.name',             'type': 'host'},
    {'field': 'host.id',               'type': 'host'},
    {'field': 'user.name',             'type': 'user'},
    {'field': 'user.id',               'type': 'user'},
    {'field': 'source.ip',             'type': 'ip'},
    {'field': 'source.port',           'type': 'other'},
    {'field': 'destination.ip',        'type': 'ip'},
    {'field': 'destination.port',      'type': 'other'},
    {'field': 'process.name',          'type': 'other'},
    {'field': 'process.pid',           'type': 'other'},
    {'field': 'process.command_line',  'type': 'other'},
    {'field': 'process.parent.name',   'type': 'other'},
    {'field': 'file.name',             'type': 'other'},
    {'field': 'file.hash.sha256',      'type': 'hash'},
]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _iter_roots(doc: dict):
    """Yield the doc roots to search, in priority order.

    ELK alert actions frequently wrap the real fields under a ``body`` object
    (see the Kibana action template), so we search both the top level and
    ``body``. This keeps extraction working whether the ingest pipeline
    flattens fields at the top level or nests them under ``body``.
    """
    if isinstance(doc, dict):
        yield doc
        body = doc.get('body')
        if isinstance(body, dict):
            yield body


def _lookup_one(root: dict, field: str) -> Any:
    """Resolve one field within a single root, trying both forms:

      1. a flat literal key           root["source_ip"] / root["source.ip"]
      2. a nested dot-notation walk    root["source"]["ip"]
    """
    if not isinstance(root, dict):
        return None
    # 1. flat literal key (covers renamed/underscored keys like "source_ip")
    if field in root and root[field] not in (None, ''):
        return root[field]
    # 2. nested dot-walk
    cur: Any = root
    for part in field.split('.'):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def _field_variants(field: str) -> list[str]:
    """Candidate key spellings for one ECS field, most-specific first.

    ELK alert actions commonly flatten + underscore ECS paths
    (``source.ip`` -> ``source_ip``, ``host.name`` -> ``host_name``), so we try
    the dotted form first, then the fully-underscored form, then the last
    segment underscored (``file.hash.sha256`` -> ``file_hash_sha256``).
    """
    variants = [field]
    under = field.replace('.', '_')
    if under != field:
        variants.append(under)
    return variants


def _get_nested(doc: dict, field: str) -> Any:
    """Resolve a field path across all roots (top level + ``body``), both
    flat/nested forms, and dot/underscore spelling variants. This makes
    extraction work with zero config against ELK actions that flatten ECS
    fields into underscored keys. Returns None if missing everywhere."""
    for root in _iter_roots(doc):
        for variant in _field_variants(field):
            val = _lookup_one(root, variant)
            if val not in (None, ''):
                return val
    return None


def _coerce_list(value: Any) -> list[str]:
    """Normalise a field value into a list of non-empty strings."""
    if value is None:
        return []
    # A genuine multi-value field (e.g. a list of IPs/IOCs) keeps each element;
    # a plain string is treated as ONE value — never split on commas, or free
    # text like a command line gets shredded into fragments.
    if isinstance(value, list):
        return [str(v).strip() for v in value if isinstance(v, (str, int, float)) and str(v).strip()]
    text = str(value).strip()
    return [text] if text else []


def _build_alias_map(aliases: list) -> dict[str, str]:
    """Convert alias list to {ecs_field: source_field} lookup dict."""
    result: dict[str, str] = {}
    for a in (aliases or []):
        if isinstance(a, dict) and a.get('ecs') and a.get('source'):
            result[str(a['ecs'])] = str(a['source'])
    return result


def _resolve_field_config(rule_uuid: str) -> tuple[list[dict] | None, dict[str, str]]:
    """Return (field_configs, alias_map) for this rule.

    Resolution order:
      1. RiskRuleConfig (rule-level, enabled=True)
         - if it has risk_object_fields → use those + merge its aliases over global aliases
         - if it only has aliases but no fields → use global fields + rule aliases
      2. GlobalRiskConfig (singleton)
      3. Neither → (None, {})
    """
    # Query without the enabled filter so we can distinguish "no rule config"
    # (fall back to global) from "config exists but explicitly disabled"
    # (skip entirely — never fall back to global).
    rule_cfg = RiskRuleConfig.objects.filter(rule_uuid=rule_uuid).first()

    if rule_cfg is not None and not rule_cfg.enabled:
        return None, {}

    global_cfg = GlobalRiskConfig.objects.order_by('id').first()

    # Build alias map: global first, then rule overrides
    global_aliases = _build_alias_map(global_cfg.field_aliases if global_cfg else [])
    rule_aliases = _build_alias_map(rule_cfg.field_aliases if rule_cfg else [])
    merged_aliases = {**global_aliases, **rule_aliases}

    # Determine field list
    if rule_cfg and rule_cfg.risk_object_fields:
        return rule_cfg.risk_object_fields, merged_aliases

    # Only fall back to global when the rule has no config of its own.
    if global_cfg and global_cfg.risk_object_fields:
        return global_cfg.risk_object_fields, merged_aliases

    return None, merged_aliases


def _asset_multiplier(risk_object: str, risk_object_type: str) -> float:
    try:
        from cmdb.models import Asset  # type: ignore
        asset = (
            Asset.objects.filter(ip_address=risk_object).first() if risk_object_type == 'ip'
            else Asset.objects.filter(hostname=risk_object).first() if risk_object_type == 'host'
            else None
        )
        if asset and hasattr(asset, 'criticality') and asset.criticality:
            return ASSET_CRITICALITY_WEIGHT.get(asset.criticality.lower(), 1.0)
    except Exception:
        pass
    return 1.0


def _compute_score(rule: LocalDetectionRule, severity: str, risk_object: str, risk_object_type: str) -> float:
    base = float(rule.risk_score or 50)
    sev_weight = SEVERITY_WEIGHT.get((severity or 'low').lower(), 0.5)
    asset_mult = _asset_multiplier(risk_object, risk_object_type)
    return round(base * sev_weight * asset_mult, 2)


def _extract_risk_objects(alert_doc: dict, field_configs: list[dict],
                          alias_map: dict[str, str] | None = None) -> list[dict]:
    """Extract risk object values from an alert doc given field configs and aliases.

    For each configured ECS field:
      1. Try the ECS path directly (e.g. source.ip)
      2. If not found AND alias_map has an entry for it, try the mapped source field
         (e.g. src_ip → source.ip alias means we read alert_doc["src_ip"])

    Returns a list of dicts:
      [{"field": "source.ip", "type": "ip", "value": "1.2.3.4", "source_field": "src_ip"}, ...]
    source_field is only set when the value came from an alias.
    """
    alias_map = alias_map or {}
    results = []
    for field_cfg in field_configs:
        field_name: str = field_cfg.get('field', '') if isinstance(field_cfg, dict) else str(field_cfg)
        field_type: str = field_cfg.get('type', 'other') if isinstance(field_cfg, dict) else 'other'
        if not field_name:
            continue

        raw = _get_nested(alert_doc, field_name)
        source_field_used: str | None = None

        if raw is None and field_name in alias_map:
            mapped = alias_map[field_name]
            raw = _get_nested(alert_doc, mapped)
            if raw is not None:
                source_field_used = mapped

        for val in _coerce_list(raw):
            entry: dict = {'field': field_name, 'type': field_type, 'value': val}
            if source_field_used:
                entry['source_field'] = source_field_used
            results.append(entry)
    return results


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

@transaction.atomic
def process_alert_for_risk(alert_doc: dict) -> list[RiskEvent]:
    """Extract risk objects from an alert, write back to Alert.risk_objects,
    and update RiskEvent / RiskObjectProfile tables.

    Parameters
    ----------
    alert_doc:
        Raw alert dict (as ingested from ES). Must contain ``rule_id`` and
        ``alert_id``. The ``_alert_pk`` key, if present, is used to locate the
        Alert row for the risk_objects write-back — the orchestrator injects it.

    Returns
    -------
    List of RiskEvent records created.
    """
    rule_uuid = str(alert_doc.get('rule_id') or '').strip()
    alert_id = str(alert_doc.get('alert_id') or '').strip()
    severity = str(alert_doc.get('severity') or 'low').strip().lower()

    if not rule_uuid or not alert_id:
        return []

    field_configs, alias_map = _resolve_field_config(rule_uuid)
    if not field_configs:
        return []

    extracted = _extract_risk_objects(alert_doc, field_configs, alias_map)
    if not extracted:
        return []

    # Write risk_objects back to the Alert row (insert + update both).
    try:
        from alerts.models import Alert
        Alert.objects.filter(alert_id=alert_id).update(risk_objects=extracted)
    except Exception as exc:
        logger.warning('RBA: failed to write risk_objects to alert %s: %s', alert_id, exc)

    # Fast path only — real idempotency is enforced by the DB unique constraint
    # on (alert_id, profile), checked per-event below.
    if RiskEvent.objects.filter(alert_id=alert_id).exists():
        return []

    try:
        rule = LocalDetectionRule.objects.get(rule_uuid=rule_uuid, is_deleted=False)
    except LocalDetectionRule.DoesNotExist:
        logger.warning('RBA: rule %s not found; skipping score', rule_uuid)
        return []

    created_events: list[RiskEvent] = []

    for item in extracted:
        obj_value = item['value']
        field_type = item['type']

        score = _compute_score(rule, severity, obj_value, field_type)

        profile, _ = RiskObjectProfile.objects.get_or_create(
            risk_object=obj_value,
            risk_object_type=field_type,
            defaults={'current_score': 0.0},
        )

        # Idempotent insert: the unique (alert_id, profile) constraint rejects a
        # duplicate created by a concurrent worker; a savepoint keeps the outer
        # transaction alive so we can skip that event and continue.
        try:
            with transaction.atomic():
                event = RiskEvent.objects.create(
                    profile=profile,
                    alert_id=alert_id,
                    rule_uuid=rule_uuid,
                    rule_name=rule.name,
                    severity=severity,
                    score_contribution=score,
                    raw_alert=alert_doc,
                )
        except IntegrityError:
            continue

        # Row-level lock + atomic F()/Greatest update — no read-modify-write race,
        # so concurrent events cannot lose an increment.
        RiskObjectProfile.objects.select_for_update().filter(pk=profile.pk).update(
            current_score=F('current_score') + score,
            peak_score_24h=Greatest('peak_score_24h', F('current_score') + Value(score)),
            total_events=F('total_events') + 1,
            last_seen=timezone.now(),
        )
        profile.refresh_from_db(fields=['current_score'])

        created_events.append(event)

        RiskScoreEntry.objects.create(
            profile=profile,
            entry_type='alert',
            delta=score,
            score_after=round(profile.current_score, 2),
            note=f'alert_id={alert_id} rule={rule_uuid}',
        )

    return created_events


def get_ecs_preset_fields() -> list[dict]:
    """Return the preset ECS field list for UI population."""
    return ECS_PRESET_FIELDS


def apply_score_decay() -> dict:
    """Decay all active entity risk scores (called by orchestrator every 6 h)."""
    profiles = RiskObjectProfile.objects.filter(current_score__gt=0)
    decayed = 0
    zeroed = 0

    for profile in profiles:
        old_score = profile.current_score
        new_score = round(old_score * DECAY_RATE, 2)
        if new_score < SCORE_FLOOR:
            new_score = 0.0
            zeroed += 1
        profile.current_score = new_score
        profile.save(update_fields=['current_score', 'updated_at'])
        RiskScoreEntry.objects.create(
            profile=profile,
            entry_type='decay',
            delta=round(new_score - old_score, 2),
            score_after=new_score,
            note=f'decay_rate={DECAY_RATE}',
        )
        decayed += 1

    logger.info('RBA decay run: profiles=%d zeroed=%d', decayed, zeroed)
    return {'decayed': decayed, 'zeroed': zeroed}


# ---------------------------------------------------------------------------
# Dashboard aggregations (funnel / sankey / top entities)
# ---------------------------------------------------------------------------

# Risk tier thresholds on RiskObjectProfile.current_score. Ordered high→low.
RISK_TIERS: list[tuple[str, float]] = [
    ('critical', 100.0),
    ('high', 50.0),
    ('medium', 20.0),
    ('low', 0.01),
]


def _tier_for_score(score: float) -> str:
    for name, threshold in RISK_TIERS:
        if score >= threshold:
            return name
    return 'none'


def get_risk_funnel() -> dict:
    """Entity-risk exposure funnel — each stage is a strict subset of the one
    above it, so the shape always narrows:

        Total entities  →  Scored (>0)  →  Medium+  →  High+  →  Critical
    """
    from django.db.models import Count, Q

    agg = RiskObjectProfile.objects.aggregate(
        total=Count('id'),
        scored=Count('id', filter=Q(current_score__gte=RISK_TIERS[3][1])),
        medium=Count('id', filter=Q(current_score__gte=RISK_TIERS[2][1])),
        high=Count('id', filter=Q(current_score__gte=RISK_TIERS[1][1])),
        critical=Count('id', filter=Q(current_score__gte=RISK_TIERS[0][1])),
    )
    return {
        'stages': [
            {'stage': 'Tracked Entities', 'value': agg['total'] or 0},
            {'stage': 'Scored (>0)', 'value': agg['scored'] or 0},
            {'stage': 'Medium+', 'value': agg['medium'] or 0},
            {'stage': 'High+', 'value': agg['high'] or 0},
            {'stage': 'Critical', 'value': agg['critical'] or 0},
        ],
    }


def get_risk_sankey(limit: int = 12) -> dict:
    """Sankey flow of risk contribution:

        risk_object_type  →  detection rule  →  top risk entities

    Values are summed RiskEvent.score_contribution. Node names are namespaced
    with a prefix so identical labels in different columns never collide.
    Returns { nodes: [{name}], links: [{source, target, value}] }.
    """
    from django.db.models import Sum

    # Column 1→2: entity type → rule
    type_rule = (
        RiskEvent.objects.values('profile__risk_object_type', 'rule_name')
        .annotate(v=Sum('score_contribution'))
        .order_by('-v')[:limit]
    )
    # Column 2→3: rule → entity (top scoring entities)
    rule_entity = (
        RiskEvent.objects.values('rule_name', 'profile__risk_object')
        .annotate(v=Sum('score_contribution'))
        .order_by('-v')[:limit]
    )

    node_set: set[str] = set()
    links: list[dict] = []

    def _node(prefix: str, label: str) -> str:
        name = f'{prefix}:{label or "unknown"}'
        node_set.add(name)
        return name

    for row in type_rule:
        s = _node('type', row['profile__risk_object_type'])
        t = _node('rule', row['rule_name'])
        links.append({'source': s, 'target': t, 'value': round(row['v'] or 0, 2)})

    for row in rule_entity:
        s = _node('rule', row['rule_name'])
        t = _node('entity', row['profile__risk_object'])
        links.append({'source': s, 'target': t, 'value': round(row['v'] or 0, 2)})

    # echarts sankey rejects zero-value links; drop them.
    links = [ln for ln in links if ln['value'] > 0]
    return {
        'nodes': [{'name': n} for n in sorted(node_set)],
        'links': links,
    }


def get_top_risk_entities(limit: int = 10) -> list[dict]:
    """Top entities by current risk score, for a leaderboard widget."""
    rows = (
        RiskObjectProfile.objects.filter(current_score__gt=0)
        .order_by('-current_score')[:limit]
    )
    return [
        {
            'id': r.id,
            'risk_object': r.risk_object,
            'risk_object_type': r.risk_object_type,
            'current_score': round(r.current_score, 2),
            'tier': _tier_for_score(r.current_score),
            'total_events': r.total_events,
            'last_seen': r.last_seen.isoformat().replace('+00:00', 'Z') if r.last_seen else None,
        }
        for r in rows
    ]
