import uuid
from urllib.parse import urlparse

import requests
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from integrations.models import Integration

from .models import LocalDetectionRule
from .sigma import build_kibana_threat_from_tags
from .services import append_rule_version, summarize_payload_changes, user_name_from_request


def kibana_integration() -> Integration | None:
    qs = Integration.objects.filter(type="elasticsearch").order_by("-updated_at", "-created_at")
    for item in qs:
        cfg = item.config or {}
        if cfg.get("host"):
            return item
    return None


def kibana_connection_config() -> dict:
    cfg = {}
    integration = kibana_integration()
    if integration and isinstance(integration.config, dict):
        cfg = dict(integration.config)
    return cfg


def derive_kibana_base_url(cfg: dict) -> str:
    host = str(cfg.get("host") or "").strip()
    if not host:
        return ""
    try:
        parsed = urlparse(host)
        if not parsed.scheme or not parsed.hostname:
            return ""
        scheme = parsed.scheme
        hostname = parsed.hostname
        port = parsed.port or 9200
        kibana_port = 5601 if port == 9200 else port
        return f"{scheme}://{hostname}:{kibana_port}"
    except Exception:
        return ""


def kibana_base() -> str:
    cfg = kibana_connection_config()
    base = str(cfg.get("kibana_base_url") or derive_kibana_base_url(cfg) or getattr(settings, "KIBANA_BASE_URL", "") or "").rstrip("/")
    space = str(cfg.get("kibana_space") or getattr(settings, "KIBANA_SPACE", "default") or "default").strip()
    if not base:
        return ""
    if space and space != "default":
        return f"{base}/s/{space}"
    return base


def kibana_headers() -> dict:
    headers = {"kbn-xsrf": "true", "Content-Type": "application/json"}
    cfg = kibana_connection_config()
    api_key = str(cfg.get("api_key") or getattr(settings, "KIBANA_API_KEY", "") or "").strip()
    if api_key:
        headers["Authorization"] = f"ApiKey {api_key}"
    return headers


def kibana_auth():
    cfg = kibana_connection_config()
    user = str(cfg.get("username") or getattr(settings, "KIBANA_USERNAME", "") or "").strip()
    password = cfg.get("password") or getattr(settings, "KIBANA_PASSWORD", "") or ""
    if user:
        return (user, password)
    return None


def kibana_proxy(method: str, path: str, params=None, payload=None) -> tuple[int, dict]:
    base = kibana_base()
    if not base:
        return 500, {"detail": "KIBANA_BASE_URL is not configured"}

    try:
        response = requests.request(
            method=method,
            url=f"{base}{path}",
            headers=kibana_headers(),
            params=params,
            json=payload,
            auth=kibana_auth(),
            timeout=45,
        )
    except requests.RequestException as exc:
        return 502, {"detail": f"Kibana request failed: {exc}"}

    try:
        data = response.json()
    except Exception:
        data = {"raw": response.text}
    return response.status_code, data


def normalize_rule_payload(payload: dict, fallback_id: str | None = None) -> tuple[str, dict]:
    data = dict(payload or {})
    rule_id = str(data.get("id") or data.get("rule_id") or fallback_id or uuid.uuid4().hex).strip()
    if not rule_id:
        rule_id = uuid.uuid4().hex
    data["id"] = rule_id
    if not data.get("rule_id"):
        data["rule_id"] = rule_id
    data.setdefault("name", rule_id)
    data.setdefault("type", "query")
    data.setdefault("enabled", False)
    data.setdefault("severity", "low")
    data.setdefault("risk_score", 50)
    return rule_id, data


def serialize_published_rule(rule: LocalDetectionRule) -> dict:
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


def is_kibana_rule_payload(payload: dict) -> bool:
    language = str(payload.get("language") or "").strip().lower()
    rule_type = str(payload.get("type") or "").strip().lower()
    if rule_type == "esql" and language == "esql":
        return True
    if rule_type == "query" and language in {"lucene", "kuery", "kql"}:
        return True
    return False


def rule_lookup_params(payload: dict) -> dict:
    rule_id = str(payload.get("rule_id") or "").strip()
    rule_object_id = str(payload.get("id") or "").strip()
    if rule_id:
        return {"rule_id": rule_id}
    if rule_object_id:
        return {"id": rule_object_id}
    return {}


def sanitize_kibana_rule_payload(payload: dict) -> dict:
    data = dict(payload or {})
    rule_id = str(data.get("rule_id") or "").strip()
    rule_object_id = str(data.get("id") or "").strip()
    if rule_id and rule_object_id:
        data.pop("id", None)
    threat = data.get("mitre_attack") if isinstance(data.get("mitre_attack"), list) else []
    if not threat:
        tags = data.get("tags") if isinstance(data.get("tags"), list) else []
        threat = build_kibana_threat_from_tags(tags)
    if threat:
        data["threat"] = threat
    return data


def push_rule_to_kibana(method: str, payload: dict) -> tuple[int, dict]:
    return kibana_proxy(method, "/api/detection_engine/rules", payload=sanitize_kibana_rule_payload(payload))


def apply_kibana_response_to_payload(payload: dict, remote: dict) -> dict:
    next_payload = dict(payload or {})
    if isinstance(remote, dict):
        remote_id = str(remote.get("id") or "").strip()
        remote_rule_id = str(remote.get("rule_id") or "").strip()
        if remote_id:
            next_payload["id"] = remote_id
        if remote_rule_id:
            next_payload["rule_id"] = remote_rule_id
    return next_payload


def create_published_rule(payload: dict, actor: str) -> tuple[int, dict]:
    rule_uuid, normalized = normalize_rule_payload(payload)
    if is_kibana_rule_payload(normalized):
        normalized.setdefault("rule_id", rule_uuid)
        normalized.setdefault("name", str(normalized.get("name") or rule_uuid))
        status_code, remote = push_rule_to_kibana("POST", normalized)
        if status_code >= 400:
            return status_code, remote
        if isinstance(remote, dict):
            normalized = apply_kibana_response_to_payload(normalized, remote)
            rule_uuid = str(normalized.get("id") or rule_uuid)

    with transaction.atomic():
        if LocalDetectionRule.objects.filter(rule_uuid=rule_uuid, is_deleted=False).exists():
            return 409, {"detail": f"Rule already exists: {rule_uuid}"}
        rule = LocalDetectionRule.objects.create(
            rule_uuid=rule_uuid,
            name=str(normalized.get("name") or rule_uuid),
            enabled=bool(normalized.get("enabled", False)),
            rule_type=str(normalized.get("type") or "query"),
            severity=str(normalized.get("severity") or "low"),
            risk_score=int(normalized.get("risk_score") or 50),
            version=1,
            payload=normalized,
            created_by=actor,
            updated_by=actor,
        )
        append_rule_version(
            rule,
            version=1,
            payload=normalized,
            changed_by=actor,
            change_type="create",
            change_summary=[{"field": "rule", "label": "Rule", "type": "created", "message": "Created published rule"}],
        )
    return 201, serialize_published_rule(rule)


def update_published_rule(rule: LocalDetectionRule, payload: dict, actor: str, partial: bool = False) -> tuple[int, dict]:
    base_payload = dict(rule.payload or {})
    merged = {**base_payload, **dict(payload or {})} if partial else dict(payload or {})
    rule_uuid, normalized = normalize_rule_payload(merged, fallback_id=rule.rule_uuid)
    if rule_uuid != rule.rule_uuid:
        return 400, {"detail": "Rule id in payload does not match URL"}

    if is_kibana_rule_payload(normalized):
        status_code, remote = push_rule_to_kibana("PUT", normalized)
        if status_code >= 400:
            return status_code, remote
        normalized = apply_kibana_response_to_payload(normalized, remote)

    with transaction.atomic():
        previous_payload = dict(rule.payload or {})
        rule.version += 1
        rule.payload = normalized
        rule.name = str(normalized.get("name") or rule.rule_uuid)
        rule.enabled = bool(normalized.get("enabled", False))
        rule.rule_type = str(normalized.get("type") or "query")
        rule.severity = str(normalized.get("severity") or "low")
        rule.risk_score = int(normalized.get("risk_score") or 50)
        rule.updated_by = actor
        rule.save()
        append_rule_version(
            rule,
            version=rule.version,
            payload=normalized,
            changed_by=actor,
            change_type="update",
            change_summary=summarize_payload_changes(previous_payload, normalized),
        )
    return 200, serialize_published_rule(rule)


def delete_published_rule(rule: LocalDetectionRule, actor: str) -> tuple[int, dict]:
    payload = dict(rule.payload or {})
    if is_kibana_rule_payload(payload):
        params = rule_lookup_params(payload)
        if not params:
            return 400, {"detail": "Kibana rule identifier is missing"}
        status_code, remote = kibana_proxy("DELETE", "/api/detection_engine/rules", params=params)
        if status_code >= 400:
            return status_code, remote

    with transaction.atomic():
        rule.is_deleted = True
        rule.version += 1
        rule.updated_by = actor
        rule.save(update_fields=["is_deleted", "version", "updated_by", "updated_at"])
        append_rule_version(
            rule,
            version=rule.version,
            payload=dict(rule.payload or {}),
            changed_by=actor,
            change_type="delete",
            change_summary=[{"field": "rule", "label": "Rule", "type": "deleted", "message": "Deleted published rule"}],
        )
    return 200, {"deleted": True, "id": rule.rule_uuid}


def rollback_published_rule(rule: LocalDetectionRule, target_version: int, actor: str) -> tuple[int, dict]:
    snapshot = rule.versions.filter(version=target_version).first()
    if not snapshot:
        return 404, {"detail": f"Version {target_version} not found"}

    rule_uuid, payload = normalize_rule_payload(dict(snapshot.payload or {}), fallback_id=rule.rule_uuid)
    if rule_uuid != rule.rule_uuid:
        return 409, {"detail": "Version payload id mismatch"}

    if is_kibana_rule_payload(payload):
        status_code, remote = push_rule_to_kibana("PUT", payload)
        if status_code >= 400:
            return status_code, remote
        payload = apply_kibana_response_to_payload(payload, remote)

    with transaction.atomic():
        previous_payload = dict(rule.payload or {})
        rule.version += 1
        rule.payload = payload
        rule.name = str(payload.get("name") or rule.rule_uuid)
        rule.enabled = bool(payload.get("enabled", False))
        rule.rule_type = str(payload.get("type") or "query")
        rule.severity = str(payload.get("severity") or "low")
        rule.risk_score = int(payload.get("risk_score") or 50)
        rule.updated_by = actor
        rule.save()
        append_rule_version(
            rule,
            version=rule.version,
            payload=payload,
            changed_by=actor,
            change_type="rollback",
            change_summary=summarize_payload_changes(previous_payload, payload),
        )
    return 200, {"rolled_back_from": target_version, **serialize_published_rule(rule)}
