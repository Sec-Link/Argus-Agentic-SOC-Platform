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
from tickets.models import EventTicket


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

        return Response({
            "alerts": alert_qs.count(),
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
            mitre_nodes = [
                {"key": "mitre:recon", "label": "1 - Reconnaissance", "use_case": "uc:behavior", "weight": 26},
                {"key": "mitre:initial", "label": "2 - Initial Access", "use_case": "uc:behavior", "weight": 11},
                {"key": "mitre:execution", "label": "3 - Execution", "use_case": "uc:behavior", "weight": 4},
                {"key": "mitre:persistence", "label": "4 - Persistence", "use_case": "uc:behavior", "weight": 11},
                {"key": "mitre:privilege", "label": "5 - Privilege Escalation", "use_case": "uc:device", "weight": 8},
                {"key": "mitre:defense", "label": "6 - Defense Evasion", "use_case": "uc:device", "weight": 4},
                {"key": "mitre:credential", "label": "7 - Credential Access", "use_case": "uc:health", "weight": 13},
                {"key": "mitre:command", "label": "8 - Command & Control", "use_case": "uc:behavior", "weight": 9},
            ]
            use_case_nodes = [
                {"key": "uc:behavior", "label": "Behavior-Based Use Cases"},
                {"key": "uc:device", "label": "Device-Based Use Cases"},
                {"key": "uc:health", "label": "Health-Based Use Cases"},
            ]

            def labelize(value):
                """Convert enum/raw DB values into readable chart labels."""
                text = str(value or "").strip()
                if not text:
                    return ""
                return text.replace("_", " ").replace("-", " ").title()

            def node(name, stage, color):
                """Build a styled Sankey node while preserving the legacy `name` key."""
                return {
                    "name": name,
                    "stage": stage,
                    "itemStyle": {"color": color, "borderColor": "rgba(255,255,255,0.28)", "borderWidth": 1},
                }

            def link(source, target, value, stage, color):
                """Build a weighted Sankey link with frontend styling metadata."""
                return {
                    "source": source,
                    "target": target,
                    "value": max(int(value or 0), 1),
                    "stage": stage,
                    "lineStyle": {"color": color, "opacity": 0.26},
                }

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

            nodes_by_name = {}
            links = []

            for item in mitre_nodes:
                nodes_by_name[item["label"]] = node(item["label"], "MITRE ATT&CK Framework", "#f7efe2")
            for item in use_case_nodes:
                nodes_by_name[item["label"]] = node(item["label"], "Developed Use Cases", "#78b8a8")

            for item in mitre_nodes:
                uc_label = next((uc["label"] for uc in use_case_nodes if uc["key"] == item["use_case"]), "Behavior-Based Use Cases")
                links.append(link(item["label"], uc_label, item["weight"], "MITRE -> Use Cases", "#7fb6a8"))

            live_total = sum(category_counts.values())
            category_names = []
            for raw_key, count in category_counts.items():
                category_name = category_labels.get(raw_key, labelize(raw_key))
                if not category_name:
                    continue
                category_names.append((category_name, count))
                nodes_by_name[category_name] = node(category_name, "Alerts", "#4aa3ff")

            if category_names:
                use_case_cycle = [uc["label"] for uc in use_case_nodes]
                for idx, (category_name, count) in enumerate(category_names):
                    # Mock use-case stages are proportionally connected into live alert categories.
                    links.append(link(use_case_cycle[idx % len(use_case_cycle)], category_name, count, "Use Cases -> Alerts", "#78b8a8"))

            for row in category_result_rows:
                count = int(row.get("count") or 0)
                if count <= 0:
                    continue
                cat = category_labels.get(row.get("category_key") or "", labelize(row.get("category_key")))
                res = result_labels.get(row.get("result_key") or "", labelize(row.get("result_key")))
                if cat and res:
                    nodes_by_name[cat] = nodes_by_name.get(cat) or node(cat, "Alerts", "#4aa3ff")
                    nodes_by_name[res] = nodes_by_name.get(res) or node(res, "Resolution", "#f2a33b")
                    links.append(link(cat, res, count, "Alerts -> Resolution", "#f2a33b"))

            for row in result_priority_rows:
                count = int(row.get("count") or 0)
                if count <= 0:
                    continue
                res = result_labels.get(row.get("result_key") or "", labelize(row.get("result_key")))
                level = priority_labels.get(row.get("priority_key") or "", labelize(row.get("priority_key")))
                if res and level:
                    nodes_by_name[res] = nodes_by_name.get(res) or node(res, "Resolution", "#f2a33b")
                    nodes_by_name[level] = nodes_by_name.get(level) or node(level, "Event Level", "#ff6b5f")
                    links.append(link(res, level, count, "Resolution -> Event Level", "#ff6b5f"))

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
        except Exception as exc:
            # Keep dashboard rendering stable even when source data contains unexpected values.
            return Response({"nodes": [], "links": [], "error": str(exc)}, status=status.HTTP_200_OK)
