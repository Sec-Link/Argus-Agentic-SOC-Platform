"""MITRE ATT&CK coverage: techniques covered by enabled rules / all known techniques."""
from detections.models import (
    LocalDetectionRule,
    LocalDetectionRuleMitreAttack,
    MitreAttackTactic,
    MitreAttackTechnique,
    MitreAttackTechniqueTactic,
)
from detections.sigma import ATTACK_TACTIC_MAP


def compute_attack_coverage():
    enabled_rule_ids = set(
        LocalDetectionRule.objects.filter(enabled=True, is_deleted=False)
        .values_list("rule_uuid", flat=True)
    )
    # Parent technique id (T1059.001 -> T1059) so sub-techniques count toward their parent.
    rules_by_technique: dict[str, set] = {}
    mapped_names: dict[str, str] = {}
    mapped_tactics: dict[str, set] = {}
    for row in LocalDetectionRuleMitreAttack.objects.filter(rule_id__in=enabled_rule_ids).values(
        "rule_id", "tactic_id", "technique_id", "technique_name"
    ):
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
