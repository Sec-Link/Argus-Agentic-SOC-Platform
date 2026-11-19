from __future__ import annotations

from typing import Any, Dict, List

from rest_framework.exceptions import PermissionDenied

from accounts.audit import AuditService, request_ip, request_user_agent
from accounts.models import AuditLog
from accounts.services import is_user_readonly
from ai_assistant.models import SkillConfig
from ai_assistant.skill_library import list_skills, read_skill


def require_skill_permission(request, action):
    if (not request.user.is_active
            or request.method not in {"GET", "HEAD", "OPTIONS"} and is_user_readonly(request.user)
            or not request.user.has_perm(f"ai_assistant.{action}_skillconfig")):
        raise PermissionDenied("You do not have permission to manage this skill.")


def audit_skill_configuration(request, name, action, fields, *, success=True):
    AuditService.log_event(
        event_type=AuditLog.EventType.ACTIVITY,
        status=AuditLog.Status.SUCCESS if success else AuditLog.Status.FAILURE,
        action_type=AuditLog.ActionType.FEATURE_EXEC,
        user_email=getattr(request.user, "email", None), ip_address=request_ip(request),
        user_agent=request_user_agent(request), path=request.path, method=request.method,
        metadata={"resource": "skill", "name": name, "actor_id": request.user.pk,
                  "action": action, "changed_fields": sorted(fields)},
    )


def _normalize_skill_name(value: Any) -> str:
    return str(value or "").strip()


def normalize_skill_names(value: Any) -> List[str]:
    if not isinstance(value, list):
        return []
    names: List[str] = []
    for item in value:
        if isinstance(item, str):
            name = _normalize_skill_name(item)
        elif isinstance(item, dict):
            name = _normalize_skill_name(item.get("name") or item.get("route") or item.get("skill_name"))
        else:
            name = ""
        if name:
            names.append(name)
    seen = set()
    out: List[str] = []
    for n in names:
        if n in seen:
            continue
        seen.add(n)
        out.append(n)
    return out


def list_skill_catalog() -> List[Dict[str, Any]]:
    catalog: List[Dict[str, Any]] = []
    for name in list_skills():
        doc = read_skill(name)
        if doc:
            title = doc.name or name
            description = doc.description or ""
            path = doc.path or ""
        else:
            title = name
            description = ""
            path = ""
        catalog.append(
            {
                "name": name,
                "title": title,
                "description": description,
                "path": path,
            }
        )
    return catalog


def serialize_skill_config(row: SkillConfig) -> Dict[str, Any]:
    return {
        "name": row.name,
        "version": row.version,
        "route": row.route,
        "enabled": row.enabled,
        "description": row.description,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def list_skill_configs() -> List[Dict[str, Any]]:
    rows = SkillConfig.objects.all().order_by("name")
    return [serialize_skill_config(r) for r in rows]


def get_enabled_skill_configs() -> List[Dict[str, Any]]:
    rows = SkillConfig.objects.filter(enabled=True).order_by("name")
    payload: List[Dict[str, Any]] = []
    for r in rows:
        payload.append(
            {
                "name": r.name,
                "version": r.version,
                "route": r.route or r.name,
                "enabled": True,
            }
        )
    return payload


def get_enabled_skill_names() -> List[str]:
    rows = SkillConfig.objects.filter(enabled=True).order_by("name")
    return [r.name for r in rows]
