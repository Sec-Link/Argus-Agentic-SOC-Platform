import json
from urllib.parse import quote

import requests
from django.conf import settings
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasDjangoPermissions


def _ea_base() -> str:
    return getattr(settings, "ELASTALERT2_SERVER_BASE_URL", "http://localhost:3030").rstrip("/")


def _proxy(method: str, path: str, payload=None):
    url = f"{_ea_base()}{path}"
    try:
        timeout = 30
        if method == "GET":
            resp = requests.get(url, timeout=timeout)
        elif method == "POST":
            resp = requests.post(url, json=payload or {}, timeout=timeout)
        elif method == "DELETE":
            resp = requests.delete(url, timeout=timeout)
        else:
            return Response({"detail": f"Unsupported method: {method}"}, status=405)
    except requests.RequestException as exc:
        return Response({"detail": f"ElastAlert2 server unavailable: {exc}"}, status=502)

    content_type = (resp.headers.get("Content-Type") or "").lower()
    if "application/json" in content_type:
        try:
            body = resp.json()
        except Exception:
            body = {"detail": resp.text}
    else:
        text = resp.text
        try:
            body = json.loads(text)
        except Exception:
            body = {"raw": text}
    return Response(body, status=resp.status_code)


class DetectionRulesView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {"GET": "integrations.view_integration"}

    def get(self, request):
        return _proxy("GET", "/rules")


class DetectionRuleDetailView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {
        "GET": "integrations.view_integration",
        "POST": "integrations.change_integration",
        "DELETE": "integrations.delete_integration",
    }

    def get(self, request, rule_id: str):
        return _proxy("GET", f"/rules/{quote(rule_id, safe='')}")

    def post(self, request, rule_id: str):
        yaml_text = request.data.get("yaml")
        if not isinstance(yaml_text, str) or not yaml_text.strip():
            return Response({"detail": "Field 'yaml' is required."}, status=400)
        return _proxy("POST", f"/rules/{quote(rule_id, safe='')}", {"yaml": yaml_text})

    def delete(self, request, rule_id: str):
        return _proxy("DELETE", f"/rules/{quote(rule_id, safe='')}")


class DetectionRuleTestView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {"POST": "integrations.change_integration"}

    def post(self, request):
        rule = request.data.get("rule")
        options = request.data.get("options")
        if not isinstance(rule, str) or not rule.strip():
            return Response({"detail": "Field 'rule' is required."}, status=400)
        payload = {"rule": rule}
        if isinstance(options, dict):
            payload["options"] = options
        return _proxy("POST", "/test", payload)
