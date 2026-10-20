"""LangChain MCP tools with Argus endpoint and execution boundaries."""

import asyncio
import json
import logging
import re
from typing import Any
from urllib.parse import urlsplit

import httpx2
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport
from langchain.mcp import as_langchain_tool
from langchain_core.messages import ToolMessage
from langchain_core.tools import BaseTool
from mcp.types import Tool


class _SafeMCPDiagnostic(logging.Filter):
    def filter(self, record):
        # SDK validation tracebacks and server log messages can contain tool data.
        record.msg = "MCP client diagnostic; inspect the tool execution status."
        record.args = ()
        record.exc_info = record.exc_text = record.stack_info = None
        return True


for _logger_name in (
    "mcp.client.streamable_http", "mcp.client.session", "mcp.shared.jsonrpc_dispatcher",
    "fastmcp.client.mixins.tools", "fastmcp.client.from_server",
):
    logging.getLogger(_logger_name).addFilter(_SafeMCPDiagnostic())


def _http_client(**options):
    # The MCP SDK follows same-origin redirects itself using max_redirects.
    options.update(follow_redirects=False, max_redirects=0)
    return httpx2.AsyncClient(**options)


def _timeout(config):
    return max(1, min(float(config.get("timeout_seconds") or 8), 120))


def _client(config):
    endpoint = str(config.get("base_url") or "")
    parsed = urlsplit(endpoint)
    if (
        parsed.scheme not in {"http", "https"} or not parsed.hostname
        or parsed.username or parsed.password or parsed.fragment
    ):
        raise ValueError("MCP endpoint is invalid.")
    token = str(config.get("token") or "").strip()
    headers = {}
    if token:
        headers["Authorization"] = token if token.lower().startswith(("bearer ", "token ")) else f"Bearer {token}"
    return Client(
        StreamableHttpTransport(endpoint, headers=headers, httpx_client_factory=_http_client),
        name="Argus", mode="legacy", timeout=_timeout(config), init_timeout=_timeout(config),
        # Approval authorizes one invocation, not an input-required replay loop.
        input_required_max_rounds=0,
    )


async def _discover(config):
    async with asyncio.timeout(_timeout(config)), _client(config) as client:
        tools, cursor, seen = [], None, set()
        for _ in range(20):
            page = await client.list_tools_mcp(cursor=cursor, cache_mode="bypass")
            tools.extend(page.tools)
            cursor = page.next_cursor
            if cursor is None:
                return tools
            if cursor in seen:
                raise ValueError("MCP tool discovery failed: the server returned a repeated pagination cursor.")
            seen.add(cursor)
        raise ValueError("MCP tool discovery failed: the catalog exceeded the 20-page limit.")


def discover_mcp_tools(config) -> list[Tool]:
    try:
        return asyncio.run(_discover(config))
    except ValueError as exc:
        if str(exc).startswith("MCP tool discovery failed:"):
            raise
        raise ValueError("MCP tool discovery failed. Check the configured MCP server.") from None
    except Exception:
        raise ValueError("MCP tool discovery failed. Check the configured MCP server.") from None


def _include_structured_content(content, artifact):
    structured = artifact.get("structured_content") if isinstance(artifact, dict) else None
    if structured is None:
        return content
    # LangChain artifacts are not sent to the model; preserve this MCP evidence.
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text":
            try:
                if json.loads(block["text"]) == structured:
                    return content
            except (ValueError, TypeError, KeyError):
                pass
    return [*content, {"type": "text", "text": json.dumps(structured, ensure_ascii=False)}]


def make_mcp_tool(remote: Tool, config: dict[str, Any], *, name: str | None = None) -> BaseTool:
    """Adapt a discovered tool; each invocation owns a fresh client and loop."""
    config = dict(config)

    async def make_native():
        return await as_langchain_tool(remote, _client(config))

    native = asyncio.run(make_native())

    async def execute(**arguments):
        async with asyncio.timeout(_timeout(config)):
            tool = await make_native()
            content, artifact = await tool.coroutine(**arguments)
            return _include_structured_content(content, artifact), artifact

    def execute_sync(**arguments):
        return asyncio.run(execute(**arguments))

    annotations = remote.annotations.model_dump(by_alias=True, exclude_none=True) if remote.annotations else {}
    title = str(config.get("server_title") or "")
    return native.model_copy(update={
        "name": name or remote.name,
        "description": f"Server: {title}\n{native.description}" if title else native.description,
        "func": execute_sync,
        "coroutine": execute,
        "metadata": {
            "source": "external", "endpoint": config["base_url"], "tool_name": remote.name,
            "title": title, "annotations": annotations,
        },
    })


def load_mcp_tools(overrides=None) -> list[BaseTool]:
    # Imported here so the legacy gateway can also reuse this native transport.
    from ai_assistant.mcp_gateway import _candidate_configs, _enabled, _is_mcp_jsonrpc_endpoint, _resolve_config

    config = _resolve_config(overrides)
    if not _enabled(config):
        return []
    tools, names = [], set()
    configs = [cfg for cfg in _candidate_configs(config)
               if config.get("exact_only") or _is_mcp_jsonrpc_endpoint(cfg)]
    for index, cfg in enumerate(configs):
        for remote in discover_mcp_tools(cfg):
            safe_name = re.sub(r"[^a-zA-Z0-9_-]+", "_", remote.name).strip("_")
            name = f"mcp__{index}__{safe_name}"
            if not safe_name or name in names:
                raise ValueError("MCP tool discovery returned duplicate or invalid tool names.")
            names.add(name)
            tools.append(make_mcp_tool(remote, cfg, name=name))
    return tools


def call_mcp_tool(config, tool_name: str, arguments: dict) -> ToolMessage:
    """Compatibility entry point; callers must authorize the exact invocation."""
    tool = make_mcp_tool(Tool(name=tool_name, inputSchema={"type": "object"}), config)
    return tool.invoke({"type": "tool_call", "id": "mcp-compatibility-call", "name": tool.name, "args": arguments})


def mcp_result(message: ToolMessage) -> dict[str, Any]:
    result = {"content": message.content, "isError": message.status == "error"}
    if isinstance(message.artifact, dict) and message.artifact.get("structured_content") is not None:
        result["structuredContent"] = message.artifact["structured_content"]
    return result
