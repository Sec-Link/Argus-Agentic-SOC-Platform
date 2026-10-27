"""Saved MCP catalog and approval-policy management, separate from execution."""

import json
import re

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.audit import AuditService, request_ip, request_user_agent
from accounts.models import AuditLog
from accounts.services import is_user_readonly
from .mcp_tools import discover_mcp_tools
from .models import ExternalMCPServer


def require_mcp_permission(request, action):
    if (request.method not in {"GET", "HEAD", "OPTIONS"} and is_user_readonly(request.user)
            or not request.user.has_perm(f"ai_assistant.{action}_externalmcpserver")):
        raise PermissionDenied("You do not have permission to manage this MCP configuration.")


def audit_mcp_configuration(request, server, action, previous_policies=None):
    current = server.tool_approvals
    previous = previous_policies if previous_policies is not None else ({} if action == "create" else current)
    changes = {name: current.get(name) is not False for name in sorted(previous.keys() | current.keys())
               if (previous.get(name) is not False) != (current.get(name) is not False)}
    AuditService.log_event(
        event_type=AuditLog.EventType.ACTIVITY, status=AuditLog.Status.SUCCESS,
        action_type=AuditLog.ActionType.FEATURE_EXEC,
        user_email=getattr(request.user, "email", None), ip_address=request_ip(request),
        user_agent=request_user_agent(request), path=request.path, method=request.method,
        metadata={"resource": "external_mcp_server", "id": server.pk, "name": server.name,
                  "actor_id": request.user.pk, "action": action, "enabled": server.enabled,
                  "approval_exceptions": sum(value is False for value in current.values()),
                  "approval_policy_changes": changes},
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def external_mcp_tools(request, name):
    require_mcp_permission(request, "view")
    server = ExternalMCPServer.objects.filter(name=name).first()
    if not server:
        return Response({"error": "MCP server not found."}, status=status.HTTP_404_NOT_FOUND)
    try:
        catalog = discover_mcp_tools({"base_url": server.endpoint, "token": server.token, "timeout_seconds": 8})
        if len(catalog) > 200:
            raise ValueError("MCP catalog exceeds 200 tools.")
        tools, names = [], set()
        for tool in catalog:
            if (not tool.name.strip() or len(tool.name) > 200 or tool.name in names
                    or re.search(r"[\x00-\x1f\x7f]", tool.name)):
                raise ValueError("MCP catalog contains invalid or duplicate tool names.")
            names.add(tool.name)
            schema = tool.input_schema
            if len(json.dumps(schema, ensure_ascii=False).encode("utf-8")) > 16 * 1024:
                raise ValueError("MCP tool schema exceeds the size limit.")
            tools.append({"name": tool.name, "description": (tool.description or "")[:2000],
                          "input_schema": schema, "requires_approval": server.tool_approvals.get(tool.name) is not False})
    except (ValueError, TypeError):
        return Response({"error": "MCP tool discovery failed. Check the saved server configuration and catalog limits."},
                        status=status.HTTP_502_BAD_GATEWAY)
    return Response({"tools": tools, "tool_approvals": server.tool_approvals,
                     "updated_at": server.updated_at.isoformat()}, headers={"Cache-Control": "private, no-store"})
