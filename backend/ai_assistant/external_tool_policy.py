"""Saved MCP connections scoped to the initiating user."""

from django.contrib.auth import get_user_model

from .models import ExternalMCPServer
from .tool_access import allowed_tools, require_tool_access


def saved_mcp_config(user, *, enabled=True, approval_supported=False):
    servers = [{
        "id": row.pk, "endpoint": row.endpoint, "title": row.title, "token": row.token,
        "config_version": row.updated_at.isoformat(),
    } for row in allowed_tools(ExternalMCPServer.objects.all(), user).order_by("name")] if enabled else []
    return {
        "enabled": bool(servers), "exact_only": True, "force_internal": False,
        "base_url": servers[0]["endpoint"] if servers else "", "servers": servers,
        "actor_id": user.pk, "approval_supported": approval_supported,
        "allow_internal": bool(enabled),
    }


def check_saved_mcp(config, tool_name=None):
    """Recheck the bound identity before discovery and each credential-bearing call."""
    if "actor_id" not in config:
        return None  # Trusted background/management callers enforce their own policy.
    row = ExternalMCPServer.objects.filter(pk=config.get("server_id"), enabled=True).first()
    if (not row or row.endpoint != config.get("base_url")
            or row.updated_at.isoformat() != config.get("config_version")):
        raise PermissionError("The MCP server configuration changed. Start a new message.")
    user = get_user_model().objects.filter(pk=config["actor_id"]).first()
    require_tool_access(user, row)
    if tool_name and not config.get("approval_supported") and row.tool_approvals.get(tool_name) is not False:
        raise PermissionError("This tool requires approval. Use the page assistant to approve the call.")
    return row
