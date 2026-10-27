"""ai_assistant URLs — mounted at /api/v1/ai-assistant/.

Each endpoint is declared once with re_path(r'.../?$') so it serves both the
trailing-slash and bare forms. MCP endpoints live under the `mcp/` sub-prefix.
"""
from django.urls import re_path

from .agent_views import AgentConfigViewSet, agent_catalog
from .http_tool_views import HttpToolViewSet
from .conversation_views import ConversationViewSet
from .page_chat import page_chat
from .page_agent import page_chat_approval
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
    re_path(r'^conversations/?$', ConversationViewSet.as_view({'get': 'list', 'post': 'create'}), name='conversations'),
    re_path(r'^conversations/(?P<pk>[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})/?$', ConversationViewSet.as_view({'get': 'retrieve', 'patch': 'partial_update', 'delete': 'destroy'}), name='conversation_detail'),
    re_path(r'^agents/?$', AgentConfigViewSet.as_view({'get': 'list', 'post': 'create'}), name='agents'),
    re_path(r'^agents/catalog/?$', agent_catalog, name='agent_catalog'),
    re_path(r'^agents/(?P<name>[a-z][a-z0-9_]{0,47})/?$', AgentConfigViewSet.as_view({'get': 'retrieve', 'put': 'update', 'patch': 'partial_update', 'delete': 'destroy'}), name='agent_detail'),
    re_path(r'^http-tools/?$', HttpToolViewSet.as_view({'get': 'list', 'post': 'create'}), name='http_tools'),
    re_path(r'^http-tools/(?P<name>[a-z][a-z0-9_]{0,47})/?$', HttpToolViewSet.as_view({'get': 'retrieve', 'put': 'update', 'patch': 'partial_update', 'delete': 'destroy'}), name='http_tool_detail'),
    re_path(r'^test-connectivity/?$', test_connectivity, name='test_connectivity'),
    re_path(r'^chat/?$', ai_chat, name='chat'),
    re_path(r'^page-chat/?$', page_chat, name='page_chat'),
    re_path(r'^page-chat/approvals/(?P<execution_id>[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12})/?$', page_chat_approval, name='page_chat_approval'),
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
