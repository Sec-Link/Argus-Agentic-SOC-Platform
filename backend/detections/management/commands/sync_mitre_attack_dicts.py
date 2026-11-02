from __future__ import annotations

import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from detections.mitre_catalog import (
    MITRE_ATTACK_ENTERPRISE_URL,
    CatalogError,
    build_attack_dicts,
    fetch_bundle_from_url,
    replace_catalog,
    validate_bundle,
)
from detections.services import backfill_rule_mitre_mappings


class Command(BaseCommand):
    help = "Download MITRE ATT&CK enterprise JSON from GitHub and sync tactic/technique dictionaries into the database."

    def add_arguments(self, parser):
        parser.add_argument(
            "--url",
            default=MITRE_ATTACK_ENTERPRISE_URL,
            help="MITRE ATT&CK enterprise STIX JSON https URL or local file path.",
        )
        parser.add_argument(
            "--bundle-output",
            default="detections/mitre_attack_stub.json",
            help="Where to save the downloaded raw bundle JSON.",
        )
        parser.add_argument(
            "--skip-backfill",
            action="store_true",
            help="Do not rebuild detection rule ATT&CK mappings after syncing the catalog.",
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
                bundle = fetch_bundle_from_url(source)
            else:
                with Path(source).open("r", encoding="utf-8") as handle:
                    bundle = validate_bundle(json.load(handle))
            summary = replace_catalog(build_attack_dicts(bundle))
        except (CatalogError, OSError, json.JSONDecodeError) as exc:
            raise CommandError(f"Failed to sync MITRE ATT&CK bundle: {exc}") from exc

        bundle_output_path.parent.mkdir(parents=True, exist_ok=True)
        bundle_output_path.write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8")

        self.stdout.write(
            self.style.SUCCESS(
                "Synced MITRE ATT&CK dictionaries to database "
                f"(version={summary['version']}, tactics={summary['tactics']}, "
                f"techniques={summary['techniques']}, links={summary['links']})"
            )
        )
        self.stdout.write(f"Bundle saved to {bundle_output_path}")
        if not options.get("skip_backfill"):
            self.stdout.write(f"Rebuilt ATT&CK mappings for {backfill_rule_mitre_mappings()} rules")
