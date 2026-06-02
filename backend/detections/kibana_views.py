
import uuid

import requests
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasDjangoPermissions
from .models import LocalDetectionRule, LocalDetectionRuleVersion


def _kibana_base() -> str:
    base = (getattr(settings, "KIBANA_BASE_URL", "") or "").rstrip("/")
    space = (getattr(settings, "KIBANA_SPACE", "default") or "default").strip()
    if not base:
        return ""
    if space and space != "default":
        return f"{base}/s/{space}"
    return base


def _headers() -> dict:
    h = {"kbn-xsrf": "true", "Content-Type": "application/json"}
    api_key = (getattr(settings, "KIBANA_API_KEY", "") or "").strip()
    if api_key:
        h["Authorization"] = f"ApiKey {api_key}"
    return h


def _auth():
    user = (getattr(settings, "KIBANA_USERNAME", "") or "").strip()
    pwd = getattr(settings, "KIBANA_PASSWORD", "") or ""
    if user:
        return (user, pwd)
    return None


def _proxy(method: str, path: str, params=None, payload=None):
    base = _kibana_base()
    if not base:
        return Response({"detail": "KIBANA_BASE_URL is not configured"}, status=500)
    url = f"{base}{path}"
    try:
        resp = requests.request(
            method=method,
            url=url,
            headers=_headers(),
            params=params,
            json=payload,
            auth=_auth(),
            timeout=45,
        )
    except requests.RequestException as exc:
        return Response({"detail": f"Kibana request failed: {exc}"}, status=502)
    try:
        data = resp.json()
    except Exception:
        data = {"raw": resp.text}
    return Response(data, status=resp.status_code)


def _user_name(request) -> str:
    user = getattr(request, "user", None)
    if not user or not getattr(user, "is_authenticated", False):
        return ""
    return str(getattr(user, "username", "") or getattr(user, "email", "") or getattr(user, "id", "") or "")


def _normalize_rule_payload(payload: dict, fallback_id: str | None = None) -> tuple[str, dict]:
    data = dict(payload or {})
    rid = str(data.get("id") or data.get("rule_id") or fallback_id or uuid.uuid4().hex).strip()
    if not rid:
        rid = uuid.uuid4().hex
    data["id"] = rid
    if not data.get("rule_id"):
        data["rule_id"] = rid
    data.setdefault("name", rid)
    data.setdefault("type", "query")
    data.setdefault("enabled", False)
    data.setdefault("severity", "low")
    data.setdefault("risk_score", 50)
    return rid, data


def _rule_to_response(rule: LocalDetectionRule) -> dict:
    payload = dict(rule.payload or {})
    payload["id"] = rule.rule_uuid
    payload.setdefault("rule_id", payload.get("rule_id") or rule.rule_uuid)
    payload["name"] = rule.name
    payload["type"] = rule.rule_type
    payload["enabled"] = bool(rule.enabled)
    payload["severity"] = rule.severity
    payload["risk_score"] = rule.risk_score
    payload["version"] = rule.version
    payload["updated_at"] = timezone.localtime(rule.updated_at).isoformat() if rule.updated_at else None
    payload["created_at"] = timezone.localtime(rule.created_at).isoformat() if rule.created_at else None
    return payload


def _append_version(rule: LocalDetectionRule, *, version: int, payload: dict, changed_by: str, change_type: str):
    LocalDetectionRuleVersion.objects.create(
        rule=rule,
        version=version,
        payload=payload,
        changed_by=changed_by,
        change_type=change_type,
    )


class KibanaDetectionRulesView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {
        "GET": "integrations.view_integration",
        "POST": "integrations.change_integration",
    }

    def get(self, request):
        qs = LocalDetectionRule.objects.filter(is_deleted=False)
        text = str(request.query_params.get("filter") or "").strip()
        if text:
            qs = qs.filter(
                Q(name__icontains=text)
                | Q(rule_uuid__icontains=text)
                | Q(rule_type__icontains=text)
                | Q(severity__icontains=text)
            )

        sort_field = str(request.query_params.get("sort_field") or "updated_at")
        sort_order = str(request.query_params.get("sort_order") or "desc").lower()
        sortable = {
            "name": "name",
            "enabled": "enabled",
            "severity": "severity",
            "risk_score": "risk_score",
            "updated_at": "updated_at",
            "author": "updated_by",
        }
        order_field = sortable.get(sort_field, "updated_at")
        if sort_order == "asc":
            qs = qs.order_by(order_field, "id")
        else:
            qs = qs.order_by(f"-{order_field}", "-id")

        try:
            page = max(int(request.query_params.get("page", "1")), 1)
        except Exception:
            page = 1
        try:
            per_page = max(min(int(request.query_params.get("per_page", "20")), 10000), 1)
        except Exception:
            per_page = 20

        total = qs.count()
        start = (page - 1) * per_page
        rows = qs[start : start + per_page]
        return Response({"data": [_rule_to_response(r) for r in rows], "total": total, "page": page, "per_page": per_page})

    def post(self, request):
        rid, payload = _normalize_rule_payload(request.data or {})
        actor = _user_name(request)

        # Elastic publish path: actually push to Kibana Detection Engine first.
        if str(payload.get("language") or "").strip().lower() == "kuery":
            # Keep a stable rule_id so republish can update same Kibana rule.
            payload.setdefault("rule_id", rid)
            payload.setdefault("name", str(payload.get("name") or rid))
            kibana_resp = _proxy("POST", "/api/detection_engine/rules", payload=payload)
            status_code = int(getattr(kibana_resp, "status_code", 500) or 500)
            if status_code >= 400:
                return kibana_resp

            # Prefer Kibana returned id/rule_id if present.
            remote = getattr(kibana_resp, "data", {}) or {}
            if isinstance(remote, dict):
                remote_id = str(remote.get("id") or "").strip()
                remote_rule_id = str(remote.get("rule_id") or "").strip()
                if remote_id:
                    rid = remote_id
                    payload["id"] = remote_id
                if remote_rule_id:
                    payload["rule_id"] = remote_rule_id

        with transaction.atomic():
            if LocalDetectionRule.objects.filter(rule_uuid=rid, is_deleted=False).exists():
                return Response({"detail": f"Rule already exists: {rid}"}, status=409)
            rule = LocalDetectionRule.objects.create(
                rule_uuid=rid,
                name=str(payload.get("name") or rid),
                enabled=bool(payload.get("enabled", False)),
                rule_type=str(payload.get("type") or "query"),
                severity=str(payload.get("severity") or "low"),
                risk_score=int(payload.get("risk_score") or 50),
                version=1,
                payload=payload,
                created_by=actor,
                updated_by=actor,
            )
            _append_version(rule, version=1, payload=payload, changed_by=actor, change_type="create")
        return Response(_rule_to_response(rule), status=201)


class KibanaDetectionRuleDetailView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {
        "GET": "integrations.view_integration",
        "PUT": "integrations.change_integration",
        "PATCH": "integrations.change_integration",
        "DELETE": "integrations.delete_integration",
    }

    def _get_rule(self, rule_id: str) -> LocalDetectionRule | None:
        return LocalDetectionRule.objects.filter(rule_uuid=rule_id, is_deleted=False).first()

    def get(self, request, rule_id: str):
        rule = self._get_rule(rule_id)
        if not rule:
            return Response({"detail": "Rule not found"}, status=404)
        return Response(_rule_to_response(rule))

    def put(self, request, rule_id: str):
        return self._update(request, rule_id)

    def patch(self, request, rule_id: str):
        return self._update(request, rule_id, partial=True)

    def _update(self, request, rule_id: str, partial: bool = False):
        rule = self._get_rule(rule_id)
        if not rule:
            return Response({"detail": "Rule not found"}, status=404)

        base_payload = dict(rule.payload or {})
        incoming = dict(request.data or {})
        if partial:
            merged = {**base_payload, **incoming}
        else:
            merged = incoming
        rid, payload = _normalize_rule_payload(merged, fallback_id=rule_id)
        if rid != rule_id:
            return Response({"detail": "Rule id in payload does not match URL"}, status=400)

        actor = _user_name(request)
        with transaction.atomic():
            rule.version += 1
            rule.payload = payload
            rule.name = str(payload.get("name") or rule.rule_uuid)
            rule.enabled = bool(payload.get("enabled", False))
            rule.rule_type = str(payload.get("type") or "query")
            rule.severity = str(payload.get("severity") or "low")
            rule.risk_score = int(payload.get("risk_score") or 50)
            rule.updated_by = actor
            rule.save()
            _append_version(rule, version=rule.version, payload=payload, changed_by=actor, change_type="update")
        return Response(_rule_to_response(rule))

    def delete(self, request, rule_id: str):
        rule = self._get_rule(rule_id)
        if not rule:
            return Response({"detail": "Rule not found"}, status=404)
        actor = _user_name(request)
        with transaction.atomic():
            rule.is_deleted = True
            rule.version += 1
            rule.updated_by = actor
            rule.save(update_fields=["is_deleted", "version", "updated_by", "updated_at"])
            _append_version(rule, version=rule.version, payload=dict(rule.payload or {}), changed_by=actor, change_type="delete")
        return Response({"deleted": True, "id": rule_id})


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
                "version": r.version,
                "change_type": r.change_type,
                "changed_by": r.changed_by,
                "created_at": timezone.localtime(r.created_at).isoformat() if r.created_at else None,
                "payload": r.payload,
            }
            for r in rows
        ]
        return Response({"id": rule_id, "current_version": rule.version, "data": data})

    def post(self, request, rule_id: str):
        target_version_raw = request.data.get("version")
        try:
            target_version = int(target_version_raw)
        except Exception:
            return Response({"detail": "Field 'version' is required and must be an integer"}, status=400)

        rule = LocalDetectionRule.objects.filter(rule_uuid=rule_id, is_deleted=False).first()
        if not rule:
            return Response({"detail": "Rule not found"}, status=404)

        snapshot = rule.versions.filter(version=target_version).first()
        if not snapshot:
            return Response({"detail": f"Version {target_version} not found"}, status=404)

        payload = dict(snapshot.payload or {})
        rid, payload = _normalize_rule_payload(payload, fallback_id=rule_id)
        if rid != rule_id:
            return Response({"detail": "Version payload id mismatch"}, status=409)

        actor = _user_name(request)
        with transaction.atomic():
            rule.version += 1
            rule.payload = payload
            rule.name = str(payload.get("name") or rule.rule_uuid)
            rule.enabled = bool(payload.get("enabled", False))
            rule.rule_type = str(payload.get("type") or "query")
            rule.severity = str(payload.get("severity") or "low")
            rule.risk_score = int(payload.get("risk_score") or 50)
            rule.updated_by = actor
            rule.save()
            _append_version(rule, version=rule.version, payload=payload, changed_by=actor, change_type="rollback")

        return Response({"rolled_back_from": target_version, **_rule_to_response(rule)})


class KibanaDetectionRulePreviewView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {"POST": "integrations.view_integration"}

    def post(self, request):
        payload = request.data or {}
        resp = _proxy("POST", "/api/detection_engine/rules/preview", payload=payload)
        if getattr(resp, "status_code", 500) == 404:
            return _proxy("POST", "/api/detection_engine/rules/_preview", payload=payload)
        return resp


class KibanaConnectorsView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {"GET": "integrations.view_integration"}

    def get(self, request):
        return _proxy("GET", "/api/actions/connectors")
