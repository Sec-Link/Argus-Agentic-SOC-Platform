from django.db.models import Q
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasDjangoPermissions
from .kibana_service import (
    create_published_rule,
    delete_published_rule,
    kibana_proxy,
    serialize_published_rule,
    update_published_rule,
    rollback_published_rule,
)
from .models import LocalDetectionRule
from .serializers import KibanaPublishedRuleListQuerySerializer, KibanaRollbackSerializer
from .services import user_name_from_request


class KibanaDetectionRulesView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {
        "GET": "integrations.view_integration",
        "POST": "integrations.change_integration",
    }

    def get(self, request):
        serializer = KibanaPublishedRuleListQuerySerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        qs = LocalDetectionRule.objects.filter(is_deleted=False)
        text = str(data.get("filter") or "").strip()
        if text:
            qs = qs.filter(
                Q(name__icontains=text)
                | Q(rule_uuid__icontains=text)
                | Q(rule_type__icontains=text)
                | Q(severity__icontains=text)
            )

        sortable = {
            "name": "name",
            "enabled": "enabled",
            "severity": "severity",
            "risk_score": "risk_score",
            "updated_at": "updated_at",
            "author": "updated_by",
        }
        order_field = sortable.get(str(data.get("sort_field") or "updated_at"), "updated_at")
        if data.get("sort_order") == "asc":
            qs = qs.order_by(order_field, "id")
        else:
            qs = qs.order_by(f"-{order_field}", "-id")

        page = int(data.get("page") or 1)
        per_page = int(data.get("per_page") or 20)
        total = qs.count()
        start = (page - 1) * per_page
        rows = qs[start : start + per_page]
        return Response({"data": [serialize_published_rule(row) for row in rows], "total": total, "page": page, "per_page": per_page})

    def post(self, request):
        status_code, body = create_published_rule(request.data or {}, user_name_from_request(request))
        return Response(body, status=status_code)


class KibanaDetectionRuleDetailView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {
        "GET": "integrations.view_integration",
        "PUT": "integrations.change_integration",
        "PATCH": "integrations.change_integration",
        "DELETE": "integrations.delete_integration",
    }

    def _get_rule(self, rule_id: str) -> LocalDetectionRule | None:
        return (
            LocalDetectionRule.objects.filter(rule_uuid=rule_id, is_deleted=False).first()
            or LocalDetectionRule.objects.filter(payload__rule_id=rule_id, is_deleted=False).order_by("-updated_at", "-id").first()
        )

    def get(self, request, rule_id: str):
        rule = self._get_rule(rule_id)
        if not rule:
            return Response({"detail": "Rule not found"}, status=404)
        return Response(serialize_published_rule(rule))

    def put(self, request, rule_id: str):
        rule = self._get_rule(rule_id)
        if not rule:
            return Response({"detail": "Rule not found"}, status=404)
        status_code, body = update_published_rule(rule, request.data or {}, user_name_from_request(request), partial=False)
        return Response(body, status=status_code)

    def patch(self, request, rule_id: str):
        rule = self._get_rule(rule_id)
        if not rule:
            return Response({"detail": "Rule not found"}, status=404)
        status_code, body = update_published_rule(rule, request.data or {}, user_name_from_request(request), partial=True)
        return Response(body, status=status_code)

    def delete(self, request, rule_id: str):
        rule = self._get_rule(rule_id)
        if not rule:
            return Response({"detail": "Rule not found"}, status=404)
        status_code, body = delete_published_rule(rule, user_name_from_request(request))
        return Response(body, status=status_code)


class KibanaDetectionRuleVersionsView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {
        "GET": "integrations.view_integration",
        "POST": "integrations.change_integration",
    }

    def get(self, request, rule_id: str):
        rule = LocalDetectionRule.objects.filter(rule_uuid=rule_id).first()
        if not rule:
            return Response({"detail": "Rule not found"}, status=404)
        rows = rule.versions.order_by("-version")[:200]
        data = [
            {
                "version": row.version,
                "change_type": row.change_type,
                "changed_by": row.changed_by,
                "created_at": timezone.localtime(row.created_at).isoformat() if row.created_at else None,
                "change_summary": row.change_summary if isinstance(row.change_summary, list) else [],
                "payload": row.payload,
            }
            for row in rows
        ]
        return Response({"id": rule_id, "current_version": rule.version, "data": data})

    def post(self, request, rule_id: str):
        serializer = KibanaRollbackSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        rule = LocalDetectionRule.objects.filter(rule_uuid=rule_id, is_deleted=False).first()
        if not rule:
            return Response({"detail": "Rule not found"}, status=404)
        status_code, body = rollback_published_rule(rule, serializer.validated_data["version"], user_name_from_request(request))
        return Response(body, status=status_code)


class KibanaDetectionRulePreviewView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {"POST": "integrations.view_integration"}

    def post(self, request):
        status_code, body = kibana_proxy("POST", "/api/detection_engine/rules/preview", payload=request.data or {})
        if status_code == 404:
            status_code, body = kibana_proxy("POST", "/api/detection_engine/rules/_preview", payload=request.data or {})
        return Response(body, status=status_code)


class KibanaConnectorsView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {"GET": "integrations.view_integration"}

    def get(self, request):
        status_code, body = kibana_proxy("GET", "/api/actions/connectors")
        return Response(body, status=status_code)
