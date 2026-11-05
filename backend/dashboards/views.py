import logging
import re
from datetime import datetime, time

from django.db import transaction
from django.db.models import Count
from django.db.models.functions import Lower, Trim
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.response import Response

from alerts.models import Alert
from detections.mitre_catalog import (
    MITRE_ATTACK_ENTERPRISE_URL,
    CatalogError,
    build_attack_dicts,
    catalog_status,
    fetch_bundle_from_url,
    replace_catalog,
)
from detections.models import (
    LocalDetectionRule,
    LocalDetectionRuleMitreAttack,
    MitreAttackTactic,
    MitreAttackTechnique,
    MitreAttackTechniqueTactic,
)
from detections.services import backfill_rule_mitre_mappings
from detections.sigma import ATTACK_TACTIC_MAP
from tickets.models import EventTicket

from .attack_coverage import compute_attack_coverage
from .event_flow import build_event_flow, load_categories
from .icon_upload import MAX_UPLOAD_BYTES, IconError, sanitize_icon
from .log_source_coverage import compute_log_source_coverage, preview_matchers
from .log_source_discovery import resolve_sources
from .models import LogSourceCategory, LogSourceMapping
from .serializers import LogSourceCategorySerializer

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
    admin_actions = ("attack_catalog", "attack_catalog_sync")

    def get_permissions(self):
        # Routes are wired with explicit as_view() mappings, so per-action permissions live here.
        if self.action in self.admin_actions:
            return [IsAdminUser()]
        return super().get_permissions()

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

    @action(detail=False, methods=["get"], url_path="event-flow")
    def event_flow(self, request):
        """Events per log source category (from the stored scan) flowing into alerts and tickets."""
        params = request.query_params
        created_from = self._parse_dt(params.get("created_from") or params.get("start_time"))
        created_to = self._parse_dt(params.get("created_to") or params.get("end_time"), end_of_day=True)

        alert_qs = Alert.objects.all()
        ticket_qs = EventTicket.objects.filter(is_deleted=False)
        if created_from:
            alert_qs = alert_qs.filter(timestamp__gte=created_from)
            ticket_qs = ticket_qs.filter(created_time__gte=created_from)
        if created_to:
            alert_qs = alert_qs.filter(timestamp__lte=created_to)
            ticket_qs = ticket_qs.filter(created_time__lte=created_to)

        open_qs = ticket_qs.exclude(status__in=["resolved", "closed"])
        incidents = ticket_qs.filter(event_result="true_positive").count()  # confirmed true positives
        return Response(
            build_event_flow(
                resolve_sources(),
                load_categories(),
                alerts=alert_qs.count(),
                open_tickets=open_qs.count(),
                incidents=incidents,
            )
        )

    @action(detail=False, methods=["get"], url_path="funnel-stats")
    def funnel_stats(self, request):
        """Alerts -> Detections -> Tickets -> True positives -> Incidents with step conversion rates."""
        data = self.conversion_stats(request).data
        stages = [
            ("alerts", "Alerts"),
            ("detection_rules", "Detections"),
            ("tickets", "Tickets"),
            ("true_positive", "True Positives"),
            ("incidents", "Incidents"),
        ]
        out = []
        prev = None
        top = int(data.get("alerts") or 0)
        for key, label in stages:
            count = int(data.get(key) or 0)
            out.append({
                "key": key,
                "label": label,
                "count": count,
                "rate_from_previous": round(count / prev * 100, 1) if prev else None,
                "rate_from_top": round(count / top * 100, 1) if top else None,
            })
            prev = count
        return Response({"stages": out})

    @action(detail=False, methods=["get"], url_path="attack-coverage")
    def attack_coverage(self, request):
        """MITRE ATT&CK coverage: techniques covered by enabled rules / all known techniques."""
        try:
            return Response(compute_attack_coverage())
        except Exception:
            logger.exception("attack_coverage failed")
            return Response({"detail": "Internal server error"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=["get"], url_path="attack-catalog")
    def attack_catalog(self, request):
        """Status of the MITRE ATT&CK reference catalog (admin only)."""
        return Response({**catalog_status(), "default_url": MITRE_ATTACK_ENTERPRISE_URL})

    @action(detail=False, methods=["post"], url_path="attack-catalog/sync")
    def attack_catalog_sync(self, request):
        """Replace the ATT&CK catalog from a STIX bundle URL, then rebuild every rule's mappings."""
        url = str(request.data.get("url") or "").strip() or MITRE_ATTACK_ENTERPRISE_URL
        try:
            summary = replace_catalog(build_attack_dicts(fetch_bundle_from_url(url)))
        except CatalogError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            logger.exception("attack_catalog_sync failed")
            return Response({"detail": "Internal server error"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        summary["rules_rebuilt"] = backfill_rule_mitre_mappings()
        return Response(summary)

    @action(detail=False, methods=["get"], url_path="log-source-coverage")
    def log_source_coverage(self, request):
        """Coverage of expected log source categories, based on data seen in the last N days."""
        try:
            days = min(max(int(request.query_params.get("days", 7)), 1), 90)
        except (TypeError, ValueError):
            days = 7
        try:
            return Response(compute_log_source_coverage(days=days))
        except Exception:
            logger.exception("log_source_coverage failed")
            return Response({"detail": "Internal server error"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

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
                    "value": int(value or 0),
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

            params = request.query_params
            created_from = self._parse_dt(params.get("created_from") or params.get("start_time"))
            created_to = self._parse_dt(params.get("created_to") or params.get("end_time"), end_of_day=True)
            ticket_qs = EventTicket.objects.filter(is_deleted=False)
            if created_from:
                ticket_qs = ticket_qs.filter(created_time__gte=created_from)
            if created_to:
                ticket_qs = ticket_qs.filter(created_time__lte=created_to)

            base_qs = (
                ticket_qs
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
            # Prefer the normalized MITRE mapping table; fall back to raw Sigma tags
            # for rules that have not been synced into it yet.
            tactic_id_to_slug = {v["id"]: slug for slug, v in ATTACK_TACTIC_MAP.items()}
            rule_tactics: dict[str, set] = {}
            if all_rule_ids:
                for row in (
                    LocalDetectionRuleMitreAttack.objects.filter(rule_id__in=all_rule_ids)
                    .values("rule_id", "tactic_id")
                    .distinct()
                ):
                    slug = tactic_id_to_slug.get(str(row["tactic_id"]).upper())
                    if slug:
                        rule_tactics.setdefault(row["rule_id"], set()).add(slug)
                for rule in LocalDetectionRule.objects.filter(
                    rule_uuid__in=all_rule_ids, is_deleted=False
                ).values("rule_uuid", "payload"):
                    if rule["rule_uuid"] in rule_tactics:
                        continue
                    tags = (rule["payload"] or {}).get("tags") or []
                    slugs = _tactic_tags_from_sigma([str(t).strip() for t in tags if str(t).strip()])
                    if slugs:
                        rule_tactics[rule["rule_uuid"]] = set(slugs)

            # Build tactic_slug → count and (tactic_slug, use_case) → count and
            # (use_case, category_name) → count from per-ticket rule tags.
            tactic_counts: dict[str, int] = {}
            usecase_category_counts: dict[tuple, int] = {}
            for tn, rule_ids in ticket_to_rule_ids.items():
                cat_key = ticket_to_category.get(tn, "")
                cat_name = category_labels.get(cat_key, labelize(cat_key)) if cat_key else ""
                seen_tactics: set = set()
                for rid in rule_ids:
                    seen_tactics.update(rule_tactics.get(rid, set()))
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


class LogSourceCategoryViewSet(viewsets.ModelViewSet):
    """Read for any authenticated user; only admins can change which categories are expected."""

    queryset = LogSourceCategory.objects.all()
    serializer_class = LogSourceCategorySerializer

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [IsAuthenticated()]
        return [IsAdminUser()]

    @action(detail=True, methods=["post", "delete"], url_path="icon", parser_classes=[MultiPartParser])
    def icon(self, request, pk=None):
        """Admin only. POST a PNG/JPEG/WebP (re-encoded server side) or DELETE to fall back to the default icon."""
        category = self.get_object()
        if request.method == "POST":
            # Refuse oversized bodies before the multipart parser spools them to disk.
            try:
                declared = int(request.META.get("CONTENT_LENGTH") or 0)
            except ValueError:
                declared = 0
            if declared > 2 * MAX_UPLOAD_BYTES:
                return Response({"detail": "Icon is too large (max 256 KB)."}, status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
        if request.method == "DELETE":
            category.icon_png = None
        else:
            try:
                category.icon_png = sanitize_icon(request.FILES.get("file"))
            except IconError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        category.save(update_fields=["icon_png", "updated_at"])
        return Response(LogSourceCategorySerializer(category).data)

    @action(detail=False, methods=["post"], url_path="preview")
    def preview(self, request):
        """Show which ES indices a matcher list hits and how much data they received recently."""
        matchers = request.data.get("matchers")
        if not isinstance(matchers, list) or not all(isinstance(m, str) and m.strip() for m in matchers):
            return Response({"detail": "matchers must be a list of non-empty strings."}, status=status.HTTP_400_BAD_REQUEST)
        return Response(preview_matchers([m.strip() for m in matchers]))

    @action(detail=False, methods=["get"], url_path="options")
    def options(self, request):
        """Existing CMDB asset types, offered as choices for the category's asset type mapping."""
        from cmdb.models import Asset

        asset_types = (
            Asset.objects.exclude(asset_type="")
            .values_list("asset_type", flat=True)
            .distinct()
            .order_by("asset_type")
        )
        return Response({"asset_types": list(asset_types)})

    @action(detail=False, methods=["get"], url_path="discover")
    def discover(self, request):
        """Stored log source scan with auto classification and manual overrides (never re-scans)."""
        try:
            return Response(resolve_sources())
        except Exception:
            logger.exception("log source discovery failed")
            return Response({"detail": "Internal server error"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=["post"], url_path="discover/rescan")
    def rescan(self, request):
        """Scan Elasticsearch again and store the result (admin only via get_permissions)."""
        try:
            return Response(resolve_sources(rescan_actor=getattr(request.user, "username", "") or "admin"))
        except Exception:
            logger.exception("log source rescan failed")
            return Response({"detail": "Internal server error"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=["post"], url_path="mappings")
    def mappings(self, request):
        """Bulk upsert manual decisions: [{source_key, category_id?, ignored?}]."""
        items = request.data.get("mappings")
        if not isinstance(items, list) or not items or len(items) > 500:
            return Response({"detail": "mappings must be a non-empty list (max 500)."}, status=status.HTTP_400_BAD_REQUEST)
        category_ids = {c.id for c in LogSourceCategory.objects.all()}
        cleaned = []
        for item in items:
            key = item.get("source_key") if isinstance(item, dict) else None
            if not isinstance(key, str) or not key.strip() or len(key) > 255:
                return Response({"detail": "Each mapping needs a source_key."}, status=status.HTTP_400_BAD_REQUEST)
            ignored = bool(item.get("ignored"))
            category_id = item.get("category_id")
            if ignored:
                category_id = None
            elif category_id is None:
                pass  # explicitly unassigned: keeps the source out of every category
            elif category_id not in category_ids:
                return Response({"detail": f"Unknown category for {key}."}, status=status.HTTP_400_BAD_REQUEST)
            cleaned.append((key.strip(), category_id, ignored))
        actor = getattr(request.user, "username", "") or ""
        with transaction.atomic():
            for key, category_id, ignored in cleaned:
                LogSourceMapping.objects.update_or_create(
                    source_key=key,
                    defaults={"category_id": category_id, "ignored": ignored, "updated_by": actor},
                )
        return Response({"updated": len(cleaned)})

    @action(detail=False, methods=["post"], url_path="mappings/reset")
    def reset_mappings(self, request):
        """Drop manual decisions so the sources fall back to automatic classification."""
        keys = request.data.get("source_keys")
        if not isinstance(keys, list) or not all(isinstance(k, str) for k in keys):
            return Response({"detail": "source_keys must be a list of strings."}, status=status.HTTP_400_BAD_REQUEST)
        deleted, _ = LogSourceMapping.objects.filter(source_key__in=keys).delete()
        return Response({"reset": deleted})
