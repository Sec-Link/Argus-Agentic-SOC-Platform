from django.db import transaction
from django.db.models import Avg, Count
from django.db.models.functions import Lower, Trim
from datetime import datetime, time, timedelta
from django.utils import timezone
from django.utils.dateparse import parse_datetime, parse_date
from rest_framework import status, viewsets
import json
from copy import deepcopy
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import EventTicket, TicketSLA, TicketWorkLog, EventTicketAttachment, TicketHandleLog
from .serializers import (
    EventTicketSerializer,
    EventTicketListSerializer,
    TicketSLASerializer,
    TicketWorkLogSerializer,
    EventTicketAttachmentSerializer,
    TicketHandleLogSerializer,
)


from ai_assistant.assistant import AIAssistantError, generate_ai_assistant_output
from ai_assistant.models import ExternalMCPServer, TicketAIChatMessage
from ai_assistant.skill_config import get_enabled_skill_configs
from ai_assistant.serializers import AIAssistantRequestSerializer


class EventTicketViewSet(viewsets.ModelViewSet):
    """API ViewSet for managing EventTicket model."""

    permission_classes = [IsAuthenticated]
    lookup_field = "ticket_number"

    @staticmethod
    def _parse_dt(value, end_of_day=False):
        if not value:
            return None
        dt = parse_datetime(value)
        if dt is None:
            d = parse_date(value)
            if d:
                dt = datetime.combine(d, time.max if end_of_day else time.min)
        if dt is None:
            return None
        if timezone.is_naive(dt):
            dt = timezone.make_aware(dt, timezone.get_current_timezone())
        return dt

    def get_queryset(self):
        qs = EventTicket.objects.select_related("sla", "assigned_user").filter(
            is_deleted=False
        )
        params = getattr(self.request, "query_params", {})
        created_from = self._parse_dt(params.get("created_from"))
        created_to = self._parse_dt(params.get("created_to"), end_of_day=True)

        if created_from:
            qs = qs.filter(created_time__gte=created_from)
        if created_to:
            qs = qs.filter(created_time__lte=created_to)

        if not created_from and not created_to:
            range_key = params.get("range")
            if range_key:
                now = timezone.now()
                start = None
                if range_key == "today":
                    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
                elif range_key == "24h":
                    start = now - timedelta(hours=24)
                elif range_key == "7d":
                    start = now - timedelta(days=7)
                elif range_key == "30d":
                    start = now - timedelta(days=30)
                if start:
                    qs = qs.filter(created_time__gte=start, created_time__lte=now)
        return qs

    def get_serializer_class(self):
        if self.action == "list":
            return EventTicketListSerializer
        return EventTicketSerializer

    def perform_create(self, serializer):
        instance = serializer.save()
        TicketSLA.objects.get_or_create(ticket=instance)
        labels = getattr(instance, "labels", [])
        labels = labels if isinstance(labels, list) else []
        if labels:
            added = ", ".join(self._format_label_item(item) for item in labels)
            TicketHandleLog.objects.create(
                ticket=instance,
                handler=self.request.user,
                action_taken=f"Labels updated. Added: {added}",
            )

    def perform_update(self, serializer):
        before_labels = deepcopy(getattr(serializer.instance, "labels", []) or [])
        instance = serializer.save()

        # Only record handle logs for requests that actually touched labels.
        if "labels" not in serializer.validated_data:
            return

        after_labels = getattr(instance, "labels", []) or []
        changes = self._build_labels_change_message(before_labels, after_labels)
        if not changes:
            return

        TicketHandleLog.objects.create(
            ticket=instance,
            handler=self.request.user,
            action_taken=f"Labels updated. {changes}",
        )

    @staticmethod
    def _format_label_item(item):
        name = str(item.get("label_name", "")).strip() if isinstance(item, dict) else ""
        raw_value = item.get("label_value", "") if isinstance(item, dict) else ""
        value = "" if raw_value is None else str(raw_value).strip()
        return f"{name}:{value}"

    def _build_labels_change_message(self, before_labels, after_labels):
        def as_pair_set(labels):
            pairs = set()
            for raw in labels:
                if not isinstance(raw, dict):
                    continue
                name = str(raw.get("label_name", "")).strip()
                raw_value = raw.get("label_value", "")
                value = "" if raw_value is None else str(raw_value).strip()
                if not name:
                    continue
                pairs.add((name, value))
            return pairs

        before_set = as_pair_set(before_labels)
        after_set = as_pair_set(after_labels)

        added = sorted(after_set - before_set)
        removed = sorted(before_set - after_set)

        parts = []
        if added:
            parts.append("Added: " + ", ".join(f"{k}:{v}" for k, v in added))
        if removed:
            parts.append("Removed: " + ", ".join(f"{k}:{v}" for k, v in removed))

        return " | ".join(parts)

    @action(detail=True, methods=["post"])
    def update_status(self, request, ticket_number=None):
        ticket = self.get_object()
        new_status = request.data.get("status")
        notes = request.data.get("notes", "")

        valid_statuses = [choice[0] for choice in EventTicket.STATUS_CHOICES]
        if new_status not in valid_statuses:
            return Response(
                {
                    "error": f"Invalid status. Must be one of: {', '.join(valid_statuses)}",
                    "valid_statuses": valid_statuses,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        old_status = ticket.status
        ticket.status = new_status
        ticket.save()

        if notes:
            TicketWorkLog.objects.create(
                ticket=ticket,
                log_entry=f"Status changed from '{old_status}' to '{new_status}': {notes}",
                created_by=request.user,
            )
        else:
            TicketWorkLog.objects.create(
                ticket=ticket,
                log_entry=f"Status changed from '{old_status}' to '{new_status}'",
                created_by=request.user,
            )

        serializer = self.get_serializer(ticket)
        return Response(serializer.data)

    @action(detail=False, methods=["post"], url_path="batch-update")
    def batch_update(self, request):
        """Update lifecycle state for multiple incident tickets in one request.

        Frontend payload contract:
            {
              "ticket_ids": ["SEC2026052500001", "SEC2026052500002"],
              "status": "Closed"
            }

        The database stores status values in lowercase (`closed`), but the UI and
        product copy often use title case (`Closed`). Normalize here so callers
        do not need to know the internal enum representation.
        """
        ticket_ids = request.data.get("ticket_ids") or []
        requested_status = request.data.get("status")
        notes = request.data.get("notes", "Batch status update")

        if not isinstance(ticket_ids, list) or not ticket_ids:
            return Response(
                {"error": "ticket_ids must be a non-empty array."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Deduplicate while preserving order; this prevents duplicate work-log
        # rows if the client accidentally submits the same selected row twice.
        normalized_ids = []
        seen = set()
        for raw_id in ticket_ids:
            ticket_id = str(raw_id or "").strip()
            if ticket_id and ticket_id not in seen:
                seen.add(ticket_id)
                normalized_ids.append(ticket_id)

        normalized_status = str(requested_status or "").strip().lower()
        valid_statuses = [choice[0] for choice in EventTicket.STATUS_CHOICES]
        if normalized_status not in valid_statuses:
            return Response(
                {
                    "error": f"Invalid status. Must be one of: {', '.join(valid_statuses)}",
                    "valid_statuses": valid_statuses,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Lock selected rows during the batch mutation so concurrent operators
        # cannot race status transitions for the same incidents.
        with transaction.atomic():
            tickets = list(
                EventTicket.objects.select_for_update().filter(
                    ticket_number__in=normalized_ids,
                    is_deleted=False,
                )
            )
            found_ids = {ticket.ticket_number for ticket in tickets}
            missing_ids = [ticket_id for ticket_id in normalized_ids if ticket_id not in found_ids]

            updated_ids = []
            for ticket in tickets:
                old_status = ticket.status
                if old_status == normalized_status:
                    continue
                ticket.status = normalized_status
                # Use model save instead of a raw bulk update so existing ticket
                # lifecycle signals still populate closed/resolved timestamps.
                ticket.save()
                TicketWorkLog.objects.create(
                    ticket=ticket,
                    log_entry=f"Status changed from '{old_status}' to '{normalized_status}': {notes}",
                    created_by=request.user,
                )
                updated_ids.append(ticket.ticket_number)

        return Response(
            {
                "updated": len(updated_ids),
                "requested": len(normalized_ids),
                "updated_ticket_ids": updated_ids,
                "missing_ticket_ids": missing_ids,
                "status": normalized_status,
            }
        )

    @action(detail=False, methods=["post"], url_path="batch-delete")
    def batch_delete(self, request):
        """Soft-delete multiple incident tickets after validating the selection.

        Payload contract:
            { "ticket_ids": ["SEC2026052500001", "SEC2026052500002"] }

        This intentionally performs a soft delete (`is_deleted=True`) rather
        than physically deleting rows. Incident tickets are audit artifacts, so
        retaining the database records is safer for forensics and compliance.
        """
        ticket_ids = request.data.get("ticket_ids") or []
        if not isinstance(ticket_ids, list) or not ticket_ids:
            return Response(
                {"error": "ticket_ids must be a non-empty array."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        normalized_ids = []
        seen = set()
        for raw_id in ticket_ids:
            ticket_id = str(raw_id or "").strip()
            if ticket_id and ticket_id not in seen:
                seen.add(ticket_id)
                normalized_ids.append(ticket_id)

        with transaction.atomic():
            tickets = list(
                EventTicket.objects.select_for_update().filter(
                    ticket_number__in=normalized_ids,
                    is_deleted=False,
                )
            )
            found_ids = {ticket.ticket_number for ticket in tickets}
            missing_ids = [ticket_id for ticket_id in normalized_ids if ticket_id not in found_ids]
            deleted_ids = []
            for ticket in tickets:
                ticket.is_deleted = True
                ticket.save(update_fields=["is_deleted", "updated_time"])
                TicketWorkLog.objects.create(
                    ticket=ticket,
                    log_entry="Ticket soft-deleted by batch action.",
                    created_by=request.user,
                )
                deleted_ids.append(ticket.ticket_number)

        return Response(
            {
                "deleted": len(deleted_ids),
                "requested": len(normalized_ids),
                "deleted_ticket_ids": deleted_ids,
                "missing_ticket_ids": missing_ids,
            }
        )

    @action(detail=True, methods=["post"])
    def resolve(self, request, ticket_number=None):
        ticket = self.get_object()
        event_category = request.data.get("event_category")
        event_result = request.data.get("event_result")
        notes = request.data.get("notes", "")

        if event_category:
            valid_categories = [choice[0] for choice in EventTicket.EVENT_CATEGORY_CHOICES]
            if event_category not in valid_categories:
                return Response(
                    {
                        "error": f"Invalid event_category. Must be one of: {', '.join(valid_categories)}",
                        "valid_categories": valid_categories,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        if event_result:
            valid_results = [choice[0] for choice in EventTicket.EVENT_RESULT_CHOICES]
            if event_result not in valid_results:
                return Response(
                    {
                        "error": f"Invalid event_result. Must be one of: {', '.join(valid_results)}",
                        "valid_results": valid_results,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        old_status = ticket.status

        if event_category:
            ticket.event_category = event_category
        if event_result:
            ticket.event_result = event_result

        ticket.status = "resolved"
        ticket.save()

        log_parts = [f"Status changed from '{old_status}' to 'resolved'"]
        if event_category:
            category_display = dict(EventTicket.EVENT_CATEGORY_CHOICES).get(
                event_category, event_category
            )
            log_parts.append(f"Event Category: {category_display}")
        if event_result:
            result_display = dict(EventTicket.EVENT_RESULT_CHOICES).get(
                event_result, event_result
            )
            log_parts.append(f"Event Result: {result_display}")
        if notes:
            log_parts.append(f"Notes: {notes}")

        TicketWorkLog.objects.create(
            ticket=ticket,
            log_entry="\n".join(log_parts),
            created_by=request.user,
        )

        serializer = self.get_serializer(ticket)
        return Response(serializer.data)

    @action(detail=False, methods=["get"])
    def field_choices(self, request):
        return Response(
            {
                "status_choices": [
                    {"value": choice[0], "label": choice[1]}
                    for choice in EventTicket.STATUS_CHOICES
                ],
                "priority_choices": [
                    {"value": choice[0], "label": choice[1]}
                    for choice in EventTicket.PRIORITY_CHOICES
                ],
                "event_category_choices": [
                    {"value": choice[0], "label": choice[1]}
                    for choice in EventTicket.EVENT_CATEGORY_CHOICES
                ],
                "event_result_choices": [
                    {"value": choice[0], "label": choice[1]}
                    for choice in EventTicket.EVENT_RESULT_CHOICES
                ],
            }
        )

    def sla_metrics(self, request, ticket_number=None):
        ticket = self.get_object()
        try:
            sla = ticket.sla
            sla_serializer = TicketSLASerializer(sla)
        except TicketSLA.DoesNotExist:
            sla_serializer = None

        return Response(
            {
                "ticket_number": ticket.ticket_number,
                "title": ticket.title,
                "status": ticket.status,
                "created_time": ticket.created_time,
                "event_response_time": ticket.event_response_time,
                "event_analysis_time": ticket.event_analysis_time,
                "event_containment_time": ticket.event_containment_time,
                "ticket_resolved_time": ticket.ticket_resolved_time,
                "sla": sla_serializer.data if sla_serializer else None,
            }
        )

    @action(detail=True, methods=["get"])
    def timeline(self, request, ticket_number=None):
        ticket = self.get_object()
        work_logs = ticket.ticketworklog_set.all().order_by("created_at")
        serializer = TicketWorkLogSerializer(work_logs, many=True)

        return Response(
            {
                "ticket_number": ticket.ticket_number,
                "status_timeline": [
                    {
                        "status": ticket.status,
                        "created": ticket.created_time,
                        "acknowledged": ticket.event_response_time,
                        "triaged": ticket.event_analysis_time,
                        "contained": ticket.event_containment_time,
                        "resolved": ticket.ticket_resolved_time,
                    },
                ],
                "work_logs": serializer.data,
            }
        )

    @action(detail=True, methods=["post"])
    def add_worklog(self, request, ticket_number=None):
        ticket = self.get_object()
        log_entry = request.data.get("log_entry", "")

        if not log_entry:
            return Response(
                {"error": "log_entry is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        work_log = TicketWorkLog.objects.create(
            ticket=ticket,
            log_entry=log_entry,
            created_by=request.user,
        )

        serializer = TicketWorkLogSerializer(work_log)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def worklogs(self, request, ticket_number=None):
        ticket = self.get_object()
        work_logs = ticket.ticketworklog_set.all().order_by("-created_at")
        serializer = TicketWorkLogSerializer(work_logs, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["post"])
    def add_attachment(self, request, ticket_number=None):
        ticket = self.get_object()

        if "file_path" not in request.FILES:
            return Response(
                {"error": "file_path is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        file_obj = request.FILES["file_path"]
        file_name = request.data.get("file_name", file_obj.name)

        attachment = EventTicketAttachment.objects.create(
            ticket=ticket,
            file_name=file_name,
            file_path=file_obj,
            uploaded_user=request.user,
        )

        serializer = EventTicketAttachmentSerializer(attachment)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def attachments(self, request, ticket_number=None):
        ticket = self.get_object()
        attachments = ticket.eventticketattachment_set.all().order_by("-uploaded_time")
        serializer = EventTicketAttachmentSerializer(attachments, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["post"])
    def add_handlelog(self, request, ticket_number=None):
        ticket = self.get_object()
        action_taken = request.data.get("action_taken", "")

        if not action_taken:
            return Response(
                {"error": "action_taken is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        handle_log = TicketHandleLog.objects.create(
            ticket=ticket,
            handler=request.user,
            action_taken=action_taken,
        )

        serializer = TicketHandleLogSerializer(handle_log)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def handlelogs(self, request, ticket_number=None):
        ticket = self.get_object()
        handle_logs = ticket.tickethandlelog_set.all().order_by("-handled_at")
        serializer = TicketHandleLogSerializer(handle_logs, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["post"])
    def ai_assistant(self, request, ticket_number=None):
        ticket = self.get_object()
        serializer = AIAssistantRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            if data.get("enabled") is False:
                return Response({"error": "AI assistant is disabled"}, status=status.HTTP_400_BAD_REQUEST)
            overrides = {
                "api_key": data.get("api_key"),
                "model": data.get("model"),
                "base_url": data.get("base_url"),
                "timeout_seconds": data.get("timeout_seconds"),
                "mcp": {
                    "enabled": data.get("mcp_enabled"),
                    "base_url": data.get("mcp_base_url"),
                    "servers": data.get("mcp_servers"),
                    "token": data.get("mcp_token"),
                    "timeout_seconds": data.get("mcp_timeout_seconds"),
                    "ticket_context_path": data.get("mcp_ticket_context_path"),
                    "ticket_search_path": data.get("mcp_ticket_search_path"),
                    "cmdb_lookup_path": data.get("mcp_cmdb_lookup_path"),
                    "observables_extract_path": data.get("mcp_observables_extract_path"),
                },
                "skills": data.get("skills") or [],
            }
            if not overrides.get("skills"):
                overrides["skills"] = get_enabled_skill_configs()
            mcp_overrides = overrides.get("mcp") if isinstance(overrides.get("mcp"), dict) else None
            if isinstance(mcp_overrides, dict):
                if mcp_overrides.get("enabled") is not False:
                    mcp_overrides["enabled"] = True
                    # Always prefer built-in MCP endpoint for ticket assistant.
                    mcp_overrides["base_url"] = request.build_absolute_uri("/api/v1/ai-assistant/mcp").rstrip("/")
                    mcp_overrides["force_internal"] = True
                if not mcp_overrides.get("token"):
                    auth_header = request.META.get("HTTP_AUTHORIZATION")
                    if isinstance(auth_header, str) and auth_header.strip():
                        # Prefer forwarding the original Authorization header verbatim.
                        mcp_overrides["token"] = auth_header.strip()
                if not mcp_overrides.get("token"):
                    auth_obj = getattr(request, "auth", None)
                    token_key = getattr(auth_obj, "key", None) if auth_obj is not None else None
                    if isinstance(token_key, str) and token_key:
                        mcp_overrides["token"] = f"Token {token_key}"
                if not mcp_overrides.get("servers"):
                    servers = ExternalMCPServer.objects.filter(enabled=True).order_by("name")
                    mcp_overrides["servers"] = [
                        {
                            "endpoint": s.endpoint,
                            "title": s.title,
                            "token": s.token,
                        }
                        for s in servers
                    ]
                if mcp_overrides.get("enabled") is None and mcp_overrides.get("servers"):
                    mcp_overrides["enabled"] = True
            result = generate_ai_assistant_output(
                ticket=ticket,
                alert_json=data.get("alert_json"),
                trigger_rule=data.get("trigger_rule", ""),
                related_logs=data.get("related_logs", []),
                user_prompt=data.get("prompt") or None,
                overrides=overrides,
            )
            try:
                assistant = result.get("assistant") if isinstance(result, dict) else None
                if assistant:
                    completed = assistant.get("completed_tasks") if isinstance(assistant, dict) else None
                    next_tasks = assistant.get("next_tasks") if isinstance(assistant, dict) else None
                    completed_text = ""
                    if isinstance(completed, list) and completed:
                        completed_text = "\n".join([
                            f"- {t.get('title')}: {t.get('detail')}".strip() if isinstance(t, dict) else f"- {str(t)}"
                            for t in completed
                        ])
                    next_text = ""
                    if isinstance(next_tasks, list) and next_tasks:
                        next_text = "\n".join([
                            f"- {t.get('title')}: {t.get('detail')}".strip() if isinstance(t, dict) else f"- {str(t)}"
                            for t in next_tasks
                        ])
                    log_lines = ["AI Assistant Result"]
                    header = assistant.get("header") if isinstance(assistant, dict) else None
                    if isinstance(header, dict):
                        try:
                            log_lines.append(f"AI Header JSON: {json.dumps(header, ensure_ascii=True)}")
                        except Exception:
                            pass
                    if isinstance(assistant.get("alert_explanation"), str):
                        log_lines.append(f"Alert Explanation: {assistant.get('alert_explanation')}")
                    risk = assistant.get("risk_level_recommendation") if isinstance(assistant, dict) else None
                    if isinstance(risk, dict):
                        level = risk.get("level")
                        rationale = risk.get("rationale")
                        if level or rationale:
                            log_lines.append(f"Risk Level: {level or ''} {('- ' + rationale) if rationale else ''}".strip())
                    if completed_text:
                        log_lines.append("AI Tasks:")
                        log_lines.append(completed_text)
                    if next_text:
                        log_lines.append("Next Tasks:")
                        log_lines.append(next_text)
                    observables_payload = result.get("observables") if isinstance(result, dict) else None
                    if isinstance(observables_payload, dict):
                        try:
                            log_lines.append(f"AI Observables JSON: {json.dumps(observables_payload, ensure_ascii=True)}")
                        except Exception:
                            pass
                    TicketWorkLog.objects.create(
                        ticket=ticket,
                        log_entry="\n".join([l for l in log_lines if l]),
                        created_by=request.user,
                    )
            except Exception:
                # Do not block API response on logging failure
                pass
            return Response(result)
        except AIAssistantError as exc:
            return Response(
                {"error": str(exc)},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

    @action(detail=True, methods=["get"])
    def ai_chat_history(self, request, ticket_number=None):
        ticket = self.get_object()
        limit_raw = request.query_params.get("limit", 200)
        before_raw = request.query_params.get("before")
        try:
            limit = int(limit_raw)
        except Exception:
            limit = 200
        limit = max(1, min(limit, 500))
        before_dt = None
        if before_raw:
            before_dt = parse_datetime(before_raw)
            if before_dt is None:
                try:
                    before_dt = datetime.fromisoformat(str(before_raw))
                except Exception:
                    before_dt = None
            if before_dt and timezone.is_naive(before_dt):
                before_dt = timezone.make_aware(before_dt, timezone.get_current_timezone())

        rows = TicketAIChatMessage.objects.filter(ticket=ticket)
        if before_dt:
            rows = rows.filter(created_at__lt=before_dt)
        rows = rows.order_by("-created_at")
        rows = rows[:limit]
        rows = list(rows)
        rows_display = list(reversed(rows))
        next_before = None
        if rows:
            oldest = rows[-1]
            next_before = oldest.created_at.isoformat()
        payload = [
            {
                "id": str(row.id),
                "role": row.role,
                "content": self._fix_mojibake(row.content),
                "trace": self._fix_mojibake_in_obj(row.trace) if isinstance(row.trace, list) else [],
                "created_at": row.created_at.isoformat(),
                "created_by": getattr(row.created_by, "username", None),
            }
            for row in rows_display
        ]
        return Response({"messages": payload, "next_before": next_before})

    @action(detail=True, methods=["delete"])
    def ai_chat_clear(self, request, ticket_number=None):
        ticket = self.get_object()
        TicketAIChatMessage.objects.filter(ticket=ticket).delete()
        return Response({"message": "cleared"})

    @staticmethod
    def _fix_mojibake(value: str) -> str:
        text = str(value or "")
        if not text:
            return text
        if not any(ch in text for ch in ("Ã", "Â", "â", "å", "ä", "æ", "ç", "è", "é", "ê", "ë", "ì", "í", "î", "ï", "ð", "ñ", "ò", "ó", "ô", "ö", "õ", "ø", "ù", "ú", "û", "ü", "ý", "ÿ")):
            return text
        replacements = {
            "â": "’",
            "â": "‘",
            "â": "“",
            "â": "”",
            "â": "–",
            "â": "—",
            "â¦": "…",
            "Â ": " ",
            "Â": "",
        }
        if any(k in text for k in replacements):
            patched = text
            for bad, good in replacements.items():
                patched = patched.replace(bad, good)
            text = patched
        try:
            repaired = text.encode("latin1", errors="strict").decode("utf-8", errors="strict")
        except Exception:
            return text
        if any("\u4e00" <= c <= "\u9fff" for c in repaired):
            return repaired
        return text

    @classmethod
    def _fix_mojibake_in_obj(cls, value):
        if isinstance(value, str):
            return cls._fix_mojibake(value)
        if isinstance(value, list):
            return [cls._fix_mojibake_in_obj(v) for v in value]
        if isinstance(value, dict):
            return {k: cls._fix_mojibake_in_obj(v) for k, v in value.items()}
        return value

    @action(detail=True, methods=["post"])
    def ai_mention(self, request, ticket_number=None):
        ticket = self.get_object()
        serializer = AIAssistantRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            if data.get("enabled") is False:
                return Response({"error": "AI assistant is disabled"}, status=status.HTTP_400_BAD_REQUEST)
            overrides = {
                "api_key": data.get("api_key"),
                "model": data.get("model"),
                "base_url": data.get("base_url"),
                "timeout_seconds": data.get("timeout_seconds"),
                "mcp": {
                    "enabled": data.get("mcp_enabled"),
                    "base_url": data.get("mcp_base_url"),
                    "servers": data.get("mcp_servers"),
                    "token": data.get("mcp_token"),
                    "timeout_seconds": data.get("mcp_timeout_seconds"),
                    "ticket_context_path": data.get("mcp_ticket_context_path"),
                    "ticket_search_path": data.get("mcp_ticket_search_path"),
                    "cmdb_lookup_path": data.get("mcp_cmdb_lookup_path"),
                    "observables_extract_path": data.get("mcp_observables_extract_path"),
                },
                "skills": data.get("skills") or [],
            }
            mcp_overrides = overrides.get("mcp") if isinstance(overrides.get("mcp"), dict) else None
            if isinstance(mcp_overrides, dict):
                if mcp_overrides.get("enabled") and not mcp_overrides.get("base_url"):
                    mcp_overrides["base_url"] = request.build_absolute_uri("/api/v1/ai-assistant/mcp").rstrip("/")
                if not mcp_overrides.get("token"):
                    auth_header = request.META.get("HTTP_AUTHORIZATION")
                    if isinstance(auth_header, str) and auth_header.strip():
                        mcp_overrides["token"] = auth_header.strip()
                if not mcp_overrides.get("token"):
                    auth_obj = getattr(request, "auth", None)
                    token_key = getattr(auth_obj, "key", None) if auth_obj is not None else None
                    if isinstance(token_key, str) and token_key:
                        mcp_overrides["token"] = f"Token {token_key}"
            result = generate_ai_assistant_output(
                ticket=ticket,
                alert_json=data.get("alert_json"),
                trigger_rule=data.get("trigger_rule", ""),
                related_logs=data.get("related_logs", []),
                user_prompt=data.get("prompt") or None,
                overrides=overrides,
            )
            return Response(result)
        except AIAssistantError as exc:
            return Response(
                {"error": str(exc)},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

    # GET /api/v1/tickets/conversion-stats/
    # - Returns funnel counts: alerts, tickets, events, incidents.
    # - Filters: Supports 'created_from' and 'created_to'.
    @action(detail=False, methods=["get"], url_path="conversion-stats")
    def conversion_stats(self, request):
        """Funnel data: Alerts → Tickets → TP+TP-B → Security Events → Incidents."""
        from alerts.models import Alert

        params = request.query_params
        created_from = self._parse_dt(params.get("created_from") or params.get("start_time"))
        created_to = self._parse_dt(params.get("created_to") or params.get("end_time"), end_of_day=True)

        # No time parameters means all-time. This mirrors the dashboard default.
        alert_qs = Alert.objects.all()
        if created_from:
            alert_qs = alert_qs.filter(timestamp__gte=created_from)
        if created_to:
            alert_qs = alert_qs.filter(timestamp__lte=created_to)
        alerts_count = alert_qs.count()

        qs = EventTicket.objects.filter(is_deleted=False)
        if created_from:
            qs = qs.filter(created_time__gte=created_from)
        if created_to:
            qs = qs.filter(created_time__lte=created_to)
        total_tickets = qs.count()
        tp_tpb_count = qs.filter(
            event_result__in=["true_positive", "true_positive_benign"]
        ).count()
        security_events_count = qs.filter(event_result="true_positive").count()
        incidents_count = qs.filter(
            event_result="true_positive",
            priority__in=["critical", "high"],
        ).count()

        return Response(
            {
                "alerts": alerts_count,
                "tickets": total_tickets,
                "true_positive": tp_tpb_count,
                "security_events": security_events_count,
                "incidents": incidents_count,
            }
        )

    # GET /api/v1/tickets/sankey-stats/
    # - Returns a five-stage Sankey pipeline while preserving nodes/links schema.
    @action(detail=False, methods=["get"], url_path="sankey-stats")
    def sankey_stats(self, request):
        """Sankey data: MITRE → Use Cases → Alerts → Resolution → Event Level."""
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
                """Convert stored enum/raw values into a readable Sankey label."""
                text = str(value or "").strip()
                if not text:
                    return ""
                return text.replace("_", " ").replace("-", " ").title()

            def node(name, stage, color):
                """Build a styled node while keeping the legacy `name` property."""
                return {
                    "name": name,
                    "stage": stage,
                    "itemStyle": {"color": color, "borderColor": "rgba(255,255,255,0.28)", "borderWidth": 1},
                }

            def link(source, target, value, stage, color):
                """Build a weighted link with metadata for frontend gradients/tooltips."""
                return {
                    "source": source,
                    "target": target,
                    "value": max(int(value or 0), 1),
                    "stage": stage,
                    "lineStyle": {"color": color, "opacity": 0.26},
                }

            base_qs = (
                self.get_queryset()
                # Trim/lowercase values before grouping so blank and case-noisy rows cannot crash or fragment the graph.
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
                links.append(link(item["label"], uc_label, item["weight"], "MITRE → Use Cases", "#7fb6a8"))

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
                    links.append(link(use_case_cycle[idx % len(use_case_cycle)], category_name, count, "Use Cases → Alerts", "#78b8a8"))

            for row in category_result_rows:
                count = int(row.get("count") or 0)
                if count <= 0:
                    continue
                cat = category_labels.get(row.get("category_key") or "", labelize(row.get("category_key")))
                res = result_labels.get(row.get("result_key") or "", labelize(row.get("result_key")))
                if cat and res:
                    nodes_by_name[cat] = nodes_by_name.get(cat) or node(cat, "Alerts", "#4aa3ff")
                    nodes_by_name[res] = nodes_by_name.get(res) or node(res, "Resolution", "#f2a33b")
                    links.append(link(cat, res, count, "Alerts → Resolution", "#f2a33b"))

            for row in result_priority_rows:
                count = int(row.get("count") or 0)
                if count <= 0:
                    continue
                res_key = row.get("result_key") or ""
                res = result_labels.get(res_key, labelize(res_key))
                level = priority_labels.get(row.get("priority_key") or "", labelize(row.get("priority_key")))
                if res and level:
                    nodes_by_name[res] = nodes_by_name.get(res) or node(res, "Resolution", "#f2a33b")
                    nodes_by_name[level] = nodes_by_name.get(level) or node(level, "Event Level", "#ff6b5f")
                    links.append(link(res, level, count, "Resolution → Event Level", "#ff6b5f"))

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
            # The dashboard should render an empty Sankey instead of failing the whole tab on dirty data.
            return Response({"nodes": [], "links": [], "error": str(exc)}, status=status.HTTP_200_OK)


class TicketSLAViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only API ViewSet for TicketSLA metrics."""

    serializer_class = TicketSLASerializer
    permission_classes = [IsAuthenticated]
    lookup_field = "ticket__ticket_number"
    lookup_url_kwarg = "ticket_number"

    def get_queryset(self):
        return TicketSLA.objects.select_related("ticket").filter(
            ticket__is_deleted=False
        )

    @action(detail=False, methods=["get"])
    def summary(self, request):
        slas = self.get_queryset()
        resolved_slas = slas.filter(ticket__status="resolved")

        return Response(
            {
                "total_tickets": slas.count(),
                "avg_mtta_seconds": slas.aggregate(Avg("mtta_seconds"))["mtta_seconds__avg"],
                "avg_mtti_seconds": slas.aggregate(Avg("mtti_seconds"))["mtti_seconds__avg"],
                "avg_mttc_seconds": slas.aggregate(Avg("mttc_seconds"))["mttc_seconds__avg"],
                "avg_mttr_seconds": slas.aggregate(Avg("mttr_seconds"))["mttr_seconds__avg"],
                "resolved_count": resolved_slas.count(),
                "avg_mttr_resolved": resolved_slas.aggregate(Avg("mttr_seconds"))["mttr_seconds__avg"],
            }
        )
