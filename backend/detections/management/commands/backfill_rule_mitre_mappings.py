from django.core.management.base import BaseCommand

from detections.services import backfill_rule_mitre_mappings


class Command(BaseCommand):
    help = "Rebuild MITRE ATT&CK mapping rows for every non-deleted detection rule from its tags / Kibana threat."

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS(f"Rebuilt ATT&CK mappings for {backfill_rule_mitre_mappings()} rules"))
