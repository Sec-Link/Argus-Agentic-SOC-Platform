from __future__ import annotations

import json
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

from django.db import transaction
from django.core.management.base import BaseCommand, CommandError

from detections.models import MitreAttackTactic, MitreAttackTechnique, MitreAttackTechniqueTactic


MITRE_ATTACK_ENTERPRISE_URL = (
    "https://github.com/mitre-attack/attack-stix-data/raw/refs/heads/master/"
    "enterprise-attack/enterprise-attack.json"
)


def _extract_external_id(obj: dict) -> str | None:
    for ref in obj.get("external_references", []):
        if ref.get("source_name") == "mitre-attack":
            external_id = str(ref.get("external_id") or "").strip()
            if external_id:
                return external_id
    return None


def _build_attack_dicts(bundle: dict) -> dict:
    version = "unknown"
    tactics: dict[str, dict] = {}
    techniques: dict[str, dict] = {}
    technique_tactics: dict[str, list[str]] = {}

    for obj in bundle.get("objects", []):
        if not isinstance(obj, dict):
            continue
        if obj.get("revoked") or obj.get("x_mitre_deprecated"):
            continue

        obj_type = obj.get("type")
        if obj_type == "x-mitre-collection":
            version = str(obj.get("x_mitre_version") or version)
            continue

        external_id = _extract_external_id(obj)
        if not external_id:
            continue

        if obj_type == "x-mitre-tactic":
            shortname = str(obj.get("x_mitre_shortname") or "").strip()
            if shortname:
                tactics[external_id] = {
                    "name": str(obj.get("name") or shortname).strip(),
                    "shortname": shortname,
                    "reference_url": f"https://attack.mitre.org/tactics/{external_id}/",
                }
            continue

        if obj_type != "attack-pattern":
            continue

        name = str(obj.get("name") or "").strip()
        if name:
            techniques[external_id] = {
                "name": name,
                "reference_url": f"https://attack.mitre.org/techniques/{external_id.replace('.', '/')}/",
            }

        mapped_tactics = []
        for phase in obj.get("kill_chain_phases", []):
            if not isinstance(phase, dict):
                continue
            if phase.get("kill_chain_name") != "mitre-attack":
                continue
            phase_name = str(phase.get("phase_name") or "").strip()
            if phase_name and phase_name not in mapped_tactics:
                mapped_tactics.append(phase_name)
        technique_tactics[external_id] = mapped_tactics

    return {
        "mitre_attack_version": version,
        "mitre_attack_tactics": dict(sorted(tactics.items())),
        "mitre_attack_techniques": dict(sorted(techniques.items())),
        "mitre_attack_techniques_tactics_mapping": dict(sorted(technique_tactics.items())),
    }


class Command(BaseCommand):
    help = "Download MITRE ATT&CK enterprise JSON from GitHub and sync tactic/technique dictionaries into the database."

    def add_arguments(self, parser):
        parser.add_argument(
            "--url",
            default=MITRE_ATTACK_ENTERPRISE_URL,
            help="MITRE ATT&CK enterprise STIX JSON URL or local file path.",
        )
        parser.add_argument(
            "--bundle-output",
            default="detections/mitre_attack_stub.json",
            help="Where to save the downloaded raw bundle JSON.",
        )

    def handle(self, *args, **options):
        source = str(options.get("url") or "").strip()
        bundle_output_arg = str(options.get("bundle_output") or "").strip()
        if not source:
            raise CommandError("--url is required")

        base_dir = Path(__file__).resolve().parents[3]
        bundle_output_path = Path(bundle_output_arg)
        if not bundle_output_path.is_absolute():
            bundle_output_path = base_dir / bundle_output_path

        try:
            if source.startswith(("http://", "https://")):
                with urlopen(source, timeout=60) as response:
                    bundle = json.load(response)
            else:
                with Path(source).open("r", encoding="utf-8") as handle:
                    bundle = json.load(handle)
        except (URLError, OSError, json.JSONDecodeError) as exc:
            raise CommandError(f"Failed to load MITRE ATT&CK bundle: {exc}") from exc

        if not isinstance(bundle, dict) or not isinstance(bundle.get("objects"), list):
            raise CommandError("Invalid MITRE ATT&CK bundle: missing objects array")

        data = _build_attack_dicts(bundle)
        bundle_output_path.parent.mkdir(parents=True, exist_ok=True)

        bundle_output_path.write_text(
            json.dumps(bundle, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        with transaction.atomic():
            MitreAttackTechniqueTactic.objects.all().delete()
            MitreAttackTechnique.objects.all().delete()
            MitreAttackTactic.objects.all().delete()

            MitreAttackTactic.objects.bulk_create(
                [
                    MitreAttackTactic(
                        tactic_id=tactic_id,
                        name=row["name"],
                        shortname=row["shortname"],
                        reference_url=row["reference_url"],
                    )
                    for tactic_id, row in data["mitre_attack_tactics"].items()
                ],
                batch_size=1000,
            )
            MitreAttackTechnique.objects.bulk_create(
                [
                    MitreAttackTechnique(
                        technique_id=technique_id,
                        name=row["name"],
                        reference_url=row["reference_url"],
                    )
                    for technique_id, row in data["mitre_attack_techniques"].items()
                ],
                batch_size=1000,
            )

            tactics_by_shortname = {
                row.shortname: row
                for row in MitreAttackTactic.objects.all().only("id", "shortname")
            }
            techniques_by_id = {
                row.technique_id: row
                for row in MitreAttackTechnique.objects.all().only("id", "technique_id")
            }

            links = []
            for technique_id, tactic_shortnames in data["mitre_attack_techniques_tactics_mapping"].items():
                technique = techniques_by_id.get(technique_id)
                if technique is None:
                    continue
                for tactic_shortname in tactic_shortnames:
                    tactic = tactics_by_shortname.get(tactic_shortname)
                    if tactic is None:
                        continue
                    links.append(
                        MitreAttackTechniqueTactic(
                            technique=technique,
                            tactic=tactic,
                        )
                    )
            MitreAttackTechniqueTactic.objects.bulk_create(links, batch_size=1000)

        self.stdout.write(
            self.style.SUCCESS(
                "Synced MITRE ATT&CK dictionaries to database "
                f"(version={data['mitre_attack_version']}, "
                f"tactics={len(data['mitre_attack_tactics'])}, "
                f"techniques={len(data['mitre_attack_techniques'])}, "
                f"links={len(links)})"
            )
        )
        self.stdout.write(f"Bundle saved to {bundle_output_path}")
