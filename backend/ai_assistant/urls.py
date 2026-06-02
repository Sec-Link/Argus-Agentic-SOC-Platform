"""ai_assistant URLs — mounted at /api/v1/ai-assistant/.

Each endpoint is declared once with re_path(r'.../?$') so it serves both the
trailing-slash and bare forms. MCP endpoints live under the `mcp/` sub-prefix.
"""
from django.urls import re_path

from .mcp_protocol_views import mcp_rpc, mcp_tools_manifest
from .mcp_views import (
    mcp_cmdb_asset_lookup,
    mcp_observables_extract,
    mcp_ticket_context,
    mcp_ticket_search_similar_cases,
)
from .views import (
    ai_chat,
    external_mcp_detail,
    external_mcp_servers,
    external_mcp_start,
    external_mcp_stop,
    mcp_monitor,
    mcp_registry_servers,
    skill_catalog,
    skill_config_detail,
    skill_configs,
    skill_content_detail,
    skill_monitor,
    test_connectivity,
)

app_name = 'ai_assistant'

urlpatterns = [
    # AI assistant endpoints
    re_path(r'^test-connectivity/?$', test_connectivity, name='test_connectivity'),
    re_path(r'^chat/?$', ai_chat, name='chat'),
    re_path(r'^mcp-monitor/?$', mcp_monitor, name='mcp_monitor'),
    re_path(r'^mcp-registry/servers/?$', mcp_registry_servers, name='mcp_registry_servers'),
    re_path(r'^skill-monitor/?$', skill_monitor, name='skill_monitor'),
    re_path(r'^skills/catalog/?$', skill_catalog, name='skill_catalog'),
    re_path(r'^skills/config/?$', skill_configs, name='skill_configs'),
    re_path(r'^skills/config/(?P<name>[^/]+)/?$', skill_config_detail, name='skill_config_detail'),
    re_path(r'^skills/content/(?P<name>[^/]+)/?$', skill_content_detail, name='skill_content_detail'),
    re_path(r'^external-mcp/?$', external_mcp_servers, name='external_mcp_servers'),
    re_path(r'^external-mcp/(?P<name>[^/]+)/?$', external_mcp_detail, name='external_mcp_detail'),
    re_path(r'^external-mcp/(?P<name>[^/]+)/start/?$', external_mcp_start, name='external_mcp_start'),
    re_path(r'^external-mcp/(?P<name>[^/]+)/stop/?$', external_mcp_stop, name='external_mcp_stop'),
    # MCP JSON-RPC endpoints — /api/v1/ai-assistant/mcp/...
    re_path(r'^mcp/?$', mcp_rpc, name='mcp_rpc'),
    re_path(r'^mcp/tools/?$', mcp_tools_manifest, name='mcp_tools_manifest'),
    re_path(r'^mcp/ticket-context/(?P<ticket_number>[^/]+)/?$', mcp_ticket_context, name='mcp_ticket_context'),
    re_path(r'^mcp/ticket-search/similar-cases/?$', mcp_ticket_search_similar_cases, name='mcp_ticket_search_similar_cases'),
    re_path(r'^mcp/cmdb/asset-lookup/?$', mcp_cmdb_asset_lookup, name='mcp_cmdb_asset_lookup'),
    re_path(r'^mcp/observables/extract/?$', mcp_observables_extract, name='mcp_observables_extract'),
]
