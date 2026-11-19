"""MITRE ATT&CK coverage: techniques covered by enabled rules / all known techniques."""
import hashlib
import re

from django.db.models import Exists, OuterRef

from detections.models import (
    LocalDetectionRuleMitreAttack,
    LocalDetectionRuleVersion,
    MitreAttackTactic,
    MitreAttackTechnique,
    MitreAttackTechniqueTactic,
    SplunkRulePublication,
)
from detections.sigma import ATTACK_TACTIC_MAP, extract_rule_meta
from .source_scope import dashboard_rules


def _splunk_attack_rows(enabled_rule_ids):
    publication_qs = SplunkRulePublication.objects.filter(
        rule__rule_uuid__in=enabled_rule_ids, published_version__isnull=False, enabled=True, status='synced',
        integration__type='splunk_rule_publisher',
    )
    publications = list(publication_qs.select_related('rule'))
    if not publications:
        return []
    matching_publication = publication_qs.filter(rule_id=OuterRef('rule_id'), published_version=OuterRef('version'))
    versions = {
        (row.rule_id, row.version): row.payload
        for row in LocalDetectionRuleVersion.objects.filter(
            rule_id__in={pub.rule_id for pub in publications},
        ).filter(Exists(matching_publication)).only('rule_id', 'version', 'payload')
    }
    technique_tactics = {}
    for technique, tactic in MitreAttackTechniqueTactic.objects.values_list('technique__technique_id', 'tactic__tactic_id'):
        technique_tactics.setdefault(technique, set()).add(tactic)
    current_ids = set()
    historical = []
    for pub in publications:
        source = str(pub.rule.payload.get('yaml') or '')
        current_hash = hashlib.sha256(source.encode()).hexdigest()
        if pub.published_source_hash == current_hash or (not pub.published_source_hash and pub.published_version == pub.rule.version):
            current_ids.add(pub.rule.rule_uuid)
            continue
        payload = versions.get((pub.rule_id, pub.published_version)) or {}
        source = str(payload.get('yaml') or '')
        if not source or hashlib.sha256(source.encode()).hexdigest() != pub.published_source_hash:
            continue
        tags = {tag.lower() for tag in extract_rule_meta(source)['tags']}
        explicit_tactics = {info['id'] for slug, info in ATTACK_TACTIC_MAP.items()
                            if f'attack.{slug.replace("-", "_")}' in tags or f'attack.{slug}' in tags}
        for tag in tags:
            if not re.fullmatch(r'attack\.t\d{4}(\.\d{3})?', tag):
                continue
            technique = tag[7:].upper()
            tactics = technique_tactics.get(technique) or technique_tactics.get(technique.split('.')[0]) or explicit_tactics
            for tactic in tactics or {''}:
                historical.append({'rule_id': pub.rule.rule_uuid, 'tactic_id': tactic,
                                   'technique_id': technique, 'technique_name': ''})
    current = LocalDetectionRuleMitreAttack.objects.filter(rule_id__in=current_ids).values(
        'rule_id', 'tactic_id', 'technique_id', 'technique_name',
    )
    return [*current, *historical]


def compute_attack_coverage(platform=None):
    enabled_rule_ids = set(
        dashboard_rules(platform, enabled_only=True)
        .values_list("rule_uuid", flat=True)
    )
    # Parent technique id (T1059.001 -> T1059) so sub-techniques count toward their parent.
    rules_by_technique: dict[str, set] = {}
    mapped_names: dict[str, str] = {}
    mapped_tactics: dict[str, set] = {}
    mapping_rows = LocalDetectionRuleMitreAttack.objects.filter(rule_id__in=enabled_rule_ids).values(
        "rule_id", "tactic_id", "technique_id", "technique_name"
    ) if platform != 'splunk' else _splunk_attack_rows(enabled_rule_ids)
    for row in mapping_rows:
        tid = str(row["technique_id"]).upper().split(".")[0]
        rules_by_technique.setdefault(tid, set()).add(row["rule_id"])
        mapped_tactics.setdefault(tid, set()).add(str(row["tactic_id"]).upper())
        if "." not in str(row["technique_id"]) and row["technique_name"]:
            mapped_names.setdefault(tid, row["technique_name"])

    catalog_tactics = {
        t.tactic_id: t.id for t in MitreAttackTactic.objects.all().only("id", "tactic_id")
    }
    catalog_loaded = MitreAttackTechnique.objects.exists()
    # tactic_id -> [(technique_id, name)] for parent techniques only.
    catalog_by_tactic: dict[str, list] = {}
    if catalog_loaded:
        for link in MitreAttackTechniqueTactic.objects.exclude(
            technique__technique_id__contains="."
        ).values_list("tactic__tactic_id", "technique__technique_id", "technique__name"):
            catalog_by_tactic.setdefault(link[0], []).append((link[1], link[2]))

    total_techniques = (
        MitreAttackTechnique.objects.exclude(technique_id__contains=".").count()
    )
    covered = len(rules_by_technique)

    tactics = []
    for slug, info in ATTACK_TACTIC_MAP.items():
        if catalog_loaded and info["id"] in catalog_by_tactic:
            members = sorted(catalog_by_tactic[info["id"]])
        else:
            # No catalog: fall back to the techniques seen in rule mappings for this tactic.
            members = sorted(
                (tid, mapped_names.get(tid, ""))
                for tid, tactic_ids in mapped_tactics.items()
                if info["id"] in tactic_ids
            )
        techniques = [
            {
                "technique_id": tid,
                "name": name,
                "rule_count": len(rules_by_technique.get(tid, ())),
            }
            for tid, name in members
        ]
        tactics.append({
            "tactic_id": info["id"],
            "name": info["name"],
            "slug": slug,
            "covered_techniques": sum(1 for t in techniques if t["rule_count"] > 0),
            "total_techniques": len(techniques) if catalog_loaded else None,
            "techniques": techniques,
        })
    return {
        "catalog_loaded": catalog_loaded,
        "covered_techniques": covered,
        # None means the technique reference table is not populated, so no ratio can be computed.
        "total_techniques": total_techniques or None,
        "coverage_percent": round(covered / total_techniques * 100, 1) if total_techniques else None,
        "enabled_rules": len(enabled_rule_ids),
        "tactics": tactics,
    }
