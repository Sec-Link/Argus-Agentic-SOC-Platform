import requests
from django.conf import settings
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasDjangoPermissions


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


class KibanaDetectionRulesView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {
        "GET": "integrations.view_integration",
        "POST": "integrations.change_integration",
    }

    def get(self, request):
        params = {}
        page = request.query_params.get("page")
        per_page = request.query_params.get("per_page")
        if page not in (None, ""):
            try:
                p = int(page)
                if p > 0:
                    params["page"] = str(p)
            except Exception:
                pass
        if per_page not in (None, ""):
            try:
                pp = int(per_page)
                if pp > 0:
                    params["per_page"] = str(pp)
            except Exception:
                pass
        for k in ("filter", "sort_field", "sort_order"):
            v = request.query_params.get(k)
            if v not in (None, ""):
                params[k] = v
        return _proxy("GET", "/api/detection_engine/rules/_find", params=params)

    def post(self, request):
        return _proxy("POST", "/api/detection_engine/rules", payload=request.data)


class KibanaDetectionRuleDetailView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {
        "GET": "integrations.view_integration",
        "PUT": "integrations.change_integration",
        "PATCH": "integrations.change_integration",
        "DELETE": "integrations.delete_integration",
    }

    def get(self, request, rule_id: str):
        return _proxy("GET", "/api/detection_engine/rules", params={"id": rule_id})

    def put(self, request, rule_id: str):
        payload = dict(request.data or {})
        payload["id"] = rule_id
        return _proxy("PUT", "/api/detection_engine/rules", payload=payload)

    def patch(self, request, rule_id: str):
        payload = dict(request.data or {})
        payload["id"] = rule_id
        return _proxy("PATCH", "/api/detection_engine/rules", payload=payload)

    def delete(self, request, rule_id: str):
        return _proxy("DELETE", "/api/detection_engine/rules", params={"id": rule_id})


class KibanaDetectionRulePreviewView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {"POST": "integrations.view_integration"}

    def post(self, request):
        # Kibana detection engine preview endpoint (version-dependent).
        # Common endpoint in security_solution:
        #   POST /api/detection_engine/rules/preview
        # Fallback:
        #   POST /api/detection_engine/rules/_preview
        payload = request.data or {}
        resp = _proxy("POST", "/api/detection_engine/rules/preview", payload=payload)
        if getattr(resp, "status_code", 500) == 404:
            return _proxy("POST", "/api/detection_engine/rules/_preview", payload=payload)
        return resp


class KibanaConnectorsView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {"GET": "integrations.view_integration"}

    def get(self, request):
        # Kibana connectors list
        # GET /api/actions/connectors
        return _proxy("GET", "/api/actions/connectors")
