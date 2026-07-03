import logging
import re
from datetime import datetime, time

from django.db.models import Count
from django.db.models.functions import Lower, Trim
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from alerts.models import Alert
from detections.models import LocalDetectionRule
from detections.sigma import ATTACK_TACTIC_MAP
from tickets.models import EventTicket

# Maps each MITRE ATT&CK tactic slug to one of the three use-case buckets shown
# in the Sankey chart's second column.
TACTIC_TO_USE_CASE = {
    "reconnaissance": "Behavior-Based Use Cases",
    "resource-development": "Behavior-Based Use Cases",
    "initial-access": "Behavior-Based Use Cases",
    "execution": "Behavior-Based Use Cases",
    "persistence": "Behavior-Based Use Cases",
    "lateral-movement": "Behavior-Based Use Cases",
    "collection": "Behavior-Based Use Cases",
    "exfiltration": "Behavior-Based Use Cases",
    "command-and-control": "Behavior-Based Use Cases",
    "privilege-escalation": "Device-Based Use Cases",
    "defense-evasion": "Device-Based Use Cases",
    "discovery": "Device-Based Use Cases",
    "credential-access": "Health-Based Use Cases",
    "impact": "Health-Based Use Cases",
}

logger = logging.getLogger(__name__)


class DashboardViewSet(viewsets.ViewSet):
    # The deprecated dashboard editor CRUD has been retired; only live chart stats remain here.
    permission_classes = [IsAuthenticated]

    @staticmethod
    def _parse_dt(value, end_of_day=False):
        """Parse dashboard time filters shared by chart endpoints."""
        if not value:
            return None
        dt = parse_datetime(value)
        if dt is None:
            parsed_date = parse_date(value)
            if parsed_date:
                dt = datetime.combine(parsed_date, time.max if end_of_day else time.min)
        if dt is None:
            return None
        if timezone.is_naive(dt):
            dt = timezone.make_aware(dt, timezone.get_current_timezone())
        return dt

    @action(detail=False, methods=["get"], url_path="conversion-stats")
    def conversion_stats(self, request):
        """Return dashboard funnel metrics without coupling chart APIs to tickets."""
        params = request.query_params
        created_from = self._parse_dt(params.get("created_from") or params.get("start_time"))
        created_to = self._parse_dt(params.get("created_to") or params.get("end_time"), end_of_day=True)

        alert_qs = Alert.objects.all()
        if created_from:
            alert_qs = alert_qs.filter(timestamp__gte=created_from)
        if created_to:
            alert_qs = alert_qs.filter(timestamp__lte=created_to)

        ticket_qs = EventTicket.objects.filter(is_deleted=False)
        if created_from:
            ticket_qs = ticket_qs.filter(created_time__gte=created_from)
        if created_to:
            ticket_qs = ticket_qs.filter(created_time__lte=created_to)

        detection_rules_count = (
            alert_qs.exclude(rule_id__isnull=True)
            .exclude(rule_id="")
            .values("rule_id")
            .distinct()
            .count()
        )
        return Response({
            "alerts": alert_qs.count(),
            "detection_rules": detection_rules_count,
            "tickets": ticket_qs.count(),
            "true_positive": ticket_qs.filter(
                event_result__in=["true_positive", "true_positive_benign"]
            ).count(),
            "security_events": ticket_qs.filter(event_result="true_positive").count(),
            "incidents": ticket_qs.filter(
                event_result="true_positive",
                priority__in=["critical", "high"],
            ).count(),
        })

    @action(detail=False, methods=["get"], url_path="sankey-stats")
    def sankey_stats(self, request):
        """Return dashboard Sankey data: MITRE -> Use Cases -> Alerts -> Resolution -> Event Level."""
        try:
            category_labels = dict(EventTicket.EVENT_CATEGORY_CHOICES)
            result_labels = {
                "true_positive": "True Positive",
                "false_positive": "False Positive",
                "true_positive_benign": "TP - Benign",
                "duplicate": "Duplicate",
                "pending": "Pending",
            }
            priority_labels = {
                "critical": "P1 - Critical",
                "high": "P2 - High",
                "medium": "P3 - Medium",
                "low": "P4 - Low",
            }
            def labelize(value):
                """Convert enum/raw DB values into readable chart labels."""
                text = str(value or "").strip()
                if not text:
                    return ""
                return text.replace("_", " ").replace("-", " ").title()

            def node(name, stage):
                return {"name": name, "stage": stage}

            def link(source, target, value, stage):
                return {
                    "source": source,
                    "target": target,
                    "value": max(int(value or 0), 1),
                    "stage": stage,
                }

            def _tactic_tags_from_sigma(tags):
                """Return MITRE tactic slugs from a list of Sigma attack.* tags."""
                result = []
                for tag in tags:
                    t = str(tag).strip().lower()
                    if not t.startswith("attack."):
                        continue
                    suffix = t[7:]
                    if re.fullmatch(r"t\d{4}(\.\d{3})?", suffix):
                        continue
                    if suffix in ATTACK_TACTIC_MAP:
                        result.append(suffix)
                return result

            base_qs = (
                EventTicket.objects.filter(is_deleted=False)
                # Normalize noisy values before grouping to avoid fragmented Sankey nodes.
                .annotate(
                    category_key=Lower(Trim("event_category")),
                    result_key=Lower(Trim("event_result")),
                    priority_key=Lower(Trim("priority")),
                )
                .exclude(category_key="")
                .filter(category_key__isnull=False)
            )
            category_result_rows = (
                base_qs.exclude(result_key="")
                .filter(result_key__isnull=False)
                .values("category_key", "result_key")
                .annotate(count=Count("ticket_number"))
                .order_by("category_key", "result_key")
            )
            result_priority_rows = (
                base_qs.exclude(result_key="")
                .exclude(priority_key="")
                .filter(result_key__isnull=False, priority_key__isnull=False)
                .values("result_key", "priority_key")
                .annotate(count=Count("ticket_number"))
                .order_by("result_key", "priority_key")
            )

            category_counts = {}
            for row in category_result_rows:
                category_counts[row["category_key"]] = category_counts.get(row["category_key"], 0) + int(row["count"] or 0)

            # --- Build live MITRE + Use Case nodes from ticket → alert → detection rule tags ---
            # Fetch ticket_number + category for all qualifying tickets.
            ticket_cat_qs = list(base_qs.values("ticket_number", "category_key").distinct())
            ticket_numbers = [r["ticket_number"] for r in ticket_cat_qs if r.get("ticket_number")]
            ticket_to_category = {r["ticket_number"]: r["category_key"] for r in ticket_cat_qs if r.get("ticket_number")}

            # Map each ticket to the detection rules fired against it via linked alerts.
            ticket_to_rule_ids: dict[str, set] = {}
            if ticket_numbers:
                for alert_row in (
                    Alert.objects.filter(ticket_number__in=ticket_numbers)
                    .exclude(rule_id__isnull=True)
                    .exclude(rule_id="")
                    .values("ticket_number", "rule_id")
                    .distinct()
                ):
                    ticket_to_rule_ids.setdefault(alert_row["ticket_number"], set()).add(alert_row["rule_id"])

            all_rule_ids = {rid for rids in ticket_to_rule_ids.values() for rid in rids}
            rule_tag_map: dict[str, list] = {}
            if all_rule_ids:
                for rule in LocalDetectionRule.objects.filter(
                    rule_uuid__in=all_rule_ids, is_deleted=False
                ).values("rule_uuid", "payload"):
                    payload = rule["payload"] or {}
                    tags = payload.get("tags") or []
                    rule_tag_map[rule["rule_uuid"]] = [str(t).strip() for t in tags if str(t).strip()]

            # Build tactic_slug → count and (tactic_slug, use_case) → count and
            # (use_case, category_name) → count from per-ticket rule tags.
            tactic_counts: dict[str, int] = {}
            usecase_category_counts: dict[tuple, int] = {}
            for tn, rule_ids in ticket_to_rule_ids.items():
                cat_key = ticket_to_category.get(tn, "")
                cat_name = category_labels.get(cat_key, labelize(cat_key)) if cat_key else ""
                seen_tactics: set = set()
                for rid in rule_ids:
                    for tactic_slug in _tactic_tags_from_sigma(rule_tag_map.get(rid, [])):
                        seen_tactics.add(tactic_slug)
                for tactic_slug in seen_tactics:
                    tactic_counts[tactic_slug] = tactic_counts.get(tactic_slug, 0) + 1
                    use_case = TACTIC_TO_USE_CASE.get(tactic_slug, "Behavior-Based Use Cases")
                    if cat_name:
                        k = (use_case, cat_name)
                        usecase_category_counts[k] = usecase_category_counts.get(k, 0) + 1

            have_live_tactic_data = bool(tactic_counts)

            nodes_by_name = {}
            links = []

            if have_live_tactic_data:
                # Populate MITRE and Use Case nodes/links from real detection rule tags.
                for tactic_slug, count in tactic_counts.items():
                    tactic_info = ATTACK_TACTIC_MAP[tactic_slug]
                    tactic_label = tactic_info["name"]
                    use_case = TACTIC_TO_USE_CASE.get(tactic_slug, "Behavior-Based Use Cases")
                    nodes_by_name[tactic_label] = node(tactic_label, "MITRE ATT&CK Framework")
                    nodes_by_name[use_case] = node(use_case, "Developed Use Cases")
                    links.append(link(tactic_label, use_case, count, "MITRE -> Use Cases"))

                for (use_case, cat_name), count in usecase_category_counts.items():
                    nodes_by_name[use_case] = nodes_by_name.get(use_case) or node(use_case, "Developed Use Cases")
                    nodes_by_name[cat_name] = node(cat_name, "Alerts")
                    links.append(link(use_case, cat_name, count, "Use Cases -> Alerts"))
            else:
                # Fallback: static MITRE structure when no rule-tag data is available yet.
                static_mitre = [
                    ("Reconnaissance", "Behavior-Based Use Cases", 26),
                    ("Initial Access", "Behavior-Based Use Cases", 11),
                    ("Execution", "Behavior-Based Use Cases", 4),
                    ("Persistence", "Behavior-Based Use Cases", 11),
                    ("Privilege Escalation", "Device-Based Use Cases", 8),
                    ("Defense Evasion", "Device-Based Use Cases", 4),
                    ("Credential Access", "Health-Based Use Cases", 13),
                    ("Command and Control", "Behavior-Based Use Cases", 9),
                ]
                use_case_labels = {"Behavior-Based Use Cases", "Device-Based Use Cases", "Health-Based Use Cases"}
                for tactic_label, uc_label, weight in static_mitre:
                    nodes_by_name[tactic_label] = node(tactic_label, "MITRE ATT&CK Framework")
                    nodes_by_name[uc_label] = node(uc_label, "Developed Use Cases")
                    links.append(link(tactic_label, uc_label, weight, "MITRE -> Use Cases"))

                live_total_fallback = sum(category_counts.values())
                category_names_list = []
                for raw_key, count in category_counts.items():
                    category_name = category_labels.get(raw_key, labelize(raw_key))
                    if category_name:
                        category_names_list.append((category_name, count))
                        nodes_by_name[category_name] = node(category_name, "Alerts")

                if category_names_list:
                    uc_cycle = list(use_case_labels)
                    for idx, (category_name, count) in enumerate(category_names_list):
                        links.append(link(uc_cycle[idx % len(uc_cycle)], category_name, count, "Use Cases -> Alerts"))

            for row in category_result_rows:
                count = int(row.get("count") or 0)
                if count <= 0:
                    continue
                cat = category_labels.get(row.get("category_key") or "", labelize(row.get("category_key")))
                res = result_labels.get(row.get("result_key") or "", labelize(row.get("result_key")))
                if cat and res:
                    nodes_by_name[cat] = nodes_by_name.get(cat) or node(cat, "Alerts")
                    nodes_by_name[res] = nodes_by_name.get(res) or node(res, "Resolution")
                    links.append(link(cat, res, count, "Alerts -> Resolution"))

            for row in result_priority_rows:
                count = int(row.get("count") or 0)
                if count <= 0:
                    continue
                res = result_labels.get(row.get("result_key") or "", labelize(row.get("result_key")))
                level = priority_labels.get(row.get("priority_key") or "", labelize(row.get("priority_key")))
                if res and level:
                    nodes_by_name[res] = nodes_by_name.get(res) or node(res, "Resolution")
                    nodes_by_name[level] = nodes_by_name.get(level) or node(level, "Event Level")
                    links.append(link(res, level, count, "Resolution -> Event Level"))

            live_total = sum(category_counts.values())
            stages = [
                "MITRE ATT&CK Framework",
                "Developed Use Cases",
                "Alerts",
                "Resolution",
                "Event Level",
            ]
            return Response({
                "nodes": list(nodes_by_name.values()),
                "links": links if live_total > 0 else [],
                "stages": stages,
                "summary": {"tickets": live_total},
            })
        except Exception:
            logger.exception("sankey_stats failed")
            return Response({"detail": "Internal server error"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
