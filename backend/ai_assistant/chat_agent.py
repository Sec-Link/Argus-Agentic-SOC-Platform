import json
import logging
import re
from dataclasses import dataclass
from functools import partial
from threading import Event, Lock, get_ident
from typing import Any, Callable, Dict, List, Optional, Tuple

from django.conf import settings
from django.db import connections
from langchain.agents import create_agent
from langchain.agents.middleware import AgentMiddleware, ModelCallLimitMiddleware
from langchain.agents.middleware.model_call_limit import ModelCallLimitExceededError
from langchain_core.messages import ToolMessage
from langchain_core.tools import StructuredTool, ToolException
from langgraph.config import get_stream_writer

from ai_assistant.knowledge_base import ensure_index, format_search_results, get_categories, scan_knowledge_base, search_knowledge_base
from ai_assistant.mcp_gateway import get_mcp_tools_catalog, invoke_mcp_tool_exact, invoke_mcp_tool_explicit
from ai_assistant.model_client import chat_response, message_text, open_chat_model
from ai_assistant.skill_library import list_skills, read_skill
from ai_assistant.monitoring import finish_mcp_execution, record_skill_call, start_mcp_execution, update_mcp_stats

logger = logging.getLogger(__name__)


@dataclass
class ToolExecutionResult:
    content: str
    is_error: bool = False


class ChatCancelled(RuntimeError):
    pass


def _check_cancelled(cancel_event: Optional[Event]) -> None:
    if cancel_event is not None and cancel_event.is_set():
        raise ChatCancelled("Chat cancelled")


class _EventTrace(list):
    def __init__(self, callback=None):
        super().__init__()
        self.callback = callback
        self.in_graph = False

    def append(self, event):
        super().append(event)
        if self.callback:
            # Waiting tools can fill the graph executor and starve its stream waiter.
            # Send tool lifecycle events directly, like the approval they precede.
            if self.in_graph and event.get("type") not in {"tool_call", "tool_result"}:
                get_stream_writer()(event)
            else:
                self.callback(event)

    def extend(self, events):
        for event in events:
            self.append(event)


class _AnswerStream:
    """Keep the explicit short summary marker out of answer token events."""

    marker = "AI thinking:"

    def __init__(self, callback, iteration):
        self.callback = callback
        self.iteration = iteration
        self.pending = ""
        self.summary = False

    def _emit(self, content):
        if content:
            self.callback({
                "type": "analysis_summary_delta" if self.summary else "answer_delta",
                "iteration": self.iteration, "content": content,
            })

    def feed(self, content):
        if self.summary:
            self._emit(content)
            return
        self.pending += content
        if self.marker in self.pending:
            answer, summary = self.pending.split(self.marker, 1)
            self._emit(answer)
            self.summary = True
            self.pending = ""
            self._emit(summary)
            return
        # Retain only a possible prefix when the marker crosses token boundaries.
        retained = next((n for n in range(len(self.marker) - 1, 0, -1)
                         if self.pending.endswith(self.marker[:n])), 0)
        self._emit(self.pending[:-retained] if retained else self.pending)
        self.pending = self.pending[-retained:] if retained else ""

    def finish(self):
        self._emit(self.pending)
        self.pending = ""


def _safe_tool_name(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]+", "_", name).strip("_")


def _internal_tools(allowed_skills=None) -> Tuple[List[Dict[str, Any]], Dict[str, Callable[[Dict[str, Any]], ToolExecutionResult]]]:
    tools: List[Dict[str, Any]] = []
    handlers: Dict[str, Callable[[Dict[str, Any]], ToolExecutionResult]] = {}

    def register(name: str, description: str, schema: Dict[str, Any], handler: Callable[[Dict[str, Any]], ToolExecutionResult]) -> None:
        tools.append({
            "type": "function",
            "function": {
                "name": name,
                "description": description,
                "parameters": schema,
            },
        })
        handlers[name] = handler

    register(
        "list_skills",
        "List all available skills from the local skills library.",
        {"type": "object", "properties": {}, "required": []},
        lambda args: ToolExecutionResult("\n".join(
            name for name in list_skills() if allowed_skills is None or name in allowed_skills
        ) or "No skills found."),
    )

    def _read_skill(args: Dict[str, Any]) -> ToolExecutionResult:
        name = str(args.get("skill_name") or "").strip()
        if not name:
            return ToolExecutionResult("skill_name is required", is_error=True)
        if allowed_skills is not None and name not in allowed_skills:
            return ToolExecutionResult("Skill is not enabled", is_error=True)
        doc = read_skill(name)
        if not doc:
            record_skill_call(name, False)
            return ToolExecutionResult(f"Skill not found: {name}", is_error=True)
        record_skill_call(name, True)
        body = [f"## Skill: {doc.name}"]
        if doc.description:
            body.append(f"**Description**: {doc.description}")
        body.append(doc.content)
        body.append(f"*Path: {doc.path}*")
        return ToolExecutionResult("\n\n".join(body))

    register(
        "read_skill",
        "Read a specific skill document by name.",
        {
            "type": "object",
            "properties": {
                "skill_name": {"type": "string", "description": "Skill directory name"},
            },
            "required": ["skill_name"],
        },
        _read_skill,
    )

    def _list_risk_types(args: Dict[str, Any]) -> ToolExecutionResult:
        categories = get_categories()
        if not categories:
            scan_knowledge_base()
            categories = get_categories()
        if not categories:
            return ToolExecutionResult("No knowledge base categories found.")
        return ToolExecutionResult("\n".join(categories))

    register(
        "list_knowledge_risk_types",
        "List available knowledge base risk types (categories).",
        {"type": "object", "properties": {}, "required": []},
        _list_risk_types,
    )

    def _search_kb(args: Dict[str, Any]) -> ToolExecutionResult:
        query = str(args.get("query") or "").strip()
        if not query:
            return ToolExecutionResult("query is required", is_error=True)
        risk_type = str(args.get("risk_type") or "").strip()
        ensure_index()
        results = search_knowledge_base(query=query, risk_type=risk_type)
        expanded = results
        text, item_ids = format_search_results(expanded)
        return ToolExecutionResult(text)

    register(
        "search_knowledge_base",
        "Search the knowledge base with semantic + keyword matching.",
        {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "risk_type": {"type": "string", "description": "Optional category"},
            },
            "required": ["query"],
        },
        _search_kb,
    )

    return tools, handlers


def _external_tools(overrides: Optional[Dict[str, Any]] = None) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    catalog = get_mcp_tools_catalog(overrides=overrides)
    tools: List[Dict[str, Any]] = []
    mapping: Dict[str, Dict[str, Any]] = {}
    for idx, entry in enumerate(catalog):
        endpoint = str(entry.get("endpoint") or "")
        if not endpoint:
            continue
        for tool in entry.get("tools") or []:
            name = str(tool.get("name") or "").strip()
            if not name:
                continue
            safe_name = _safe_tool_name(name)
            openai_name = f"mcp__{idx}__{safe_name}"
            mapping[openai_name] = {
                "endpoint": endpoint, "tool_name": name,
                "annotations": tool.get("annotations") or {},
            }
            schema = tool.get("inputSchema") if isinstance(tool.get("inputSchema"), dict) else {}
            tools.append({
                "type": "function",
                "function": {
                    "name": openai_name,
                    "description": str(tool.get("description") or f"External MCP tool: {name}"),
                    "parameters": schema or {"type": "object", "properties": {}},
                },
            })
    return tools, mapping


def _tool_result_to_text(result: Any) -> str:
    if isinstance(result, str):
        return result
    try:
        return json.dumps(result, ensure_ascii=True)
    except Exception:
        return str(result)


def _execute_external_tool(tool_name: str, args: Dict[str, Any], mapping: Dict[str, Dict[str, str]], overrides: Optional[Dict[str, Any]]) -> ToolExecutionResult:
    meta = mapping.get(tool_name) or {}
    endpoint = meta.get("endpoint")
    actual_tool = meta.get("tool_name")
    if not endpoint or not actual_tool:
        return ToolExecutionResult(f"External tool mapping not found for {tool_name}", is_error=True)
    mcp = (overrides or {}).get("mcp") or {}
    invoke = invoke_mcp_tool_exact if mcp.get("exact_only") else invoke_mcp_tool_explicit
    payload = invoke(
        tool_name=actual_tool, arguments=args, target_mcp=endpoint,
        overrides=overrides, record_execution=False,
    )
    if payload is None:
        return ToolExecutionResult(f"External MCP tool call failed: {actual_tool}", is_error=True)
    return ToolExecutionResult(_tool_result_to_text(payload))


def _parse_tool_arguments(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return {"raw": raw}
    return {}


def _preload_chat_skills(
    user_input: str, recommended_skills: List[str], overrides: Optional[Dict[str, Any]] = None,
    *, trace=None, allowed_skills=None, cancel_event=None, tool_guard=None,
    tool_result_transform=None, safe_tool_errors=False, audit_source=None,
) -> Tuple[List[str], List[str], List[Dict[str, Any]]]:
    trace = trace if trace is not None else []
    if not recommended_skills:
        return [], [], trace
    names = [str(name).strip() for name in recommended_skills if str(name).strip()
             and (allowed_skills is None or str(name).strip() in allowed_skills)]
    if not names:
        return [], [], trace
    _check_cancelled(cancel_event)
    list_exec_id = start_mcp_execution("list_skills", {}, source=audit_source or "internal")
    list_call_id = f"preload-list-{list_exec_id}"
    try:
        trace.extend([
            {"type": "model_call", "iteration": 0, "purpose": "skill_selection"},
            {"type": "tool_calls_detected", "iteration": 0, "count": 1},
            {"type": "tool_call", "iteration": 0, "tool": "list_skills", "source": "internal", "arguments": {}, "automatic": True, "execution_id": list_exec_id, "call_id": list_call_id},
        ])
        if tool_guard:
            tool_guard(name="list_skills", arguments={}, meta={}, execution_id=list_exec_id, call_id=list_call_id)
        _check_cancelled(cancel_event)
        catalog = list_skills()
        if allowed_skills is not None:
            catalog = [name for name in catalog if name in allowed_skills]
        list_success = True
        list_content = "\n".join(catalog)
    except ChatCancelled:
        finish_mcp_execution(list_exec_id, False, error="Chat cancelled")
        raise
    except Exception as exc:
        catalog = []
        list_success = False
        list_content = "Skill listing failed" if safe_tool_errors else f"Skill listing failed: {exc}"
    if tool_result_transform:
        list_content = tool_result_transform(list_content)
    finish_mcp_execution(list_exec_id, list_success, error="" if list_success else list_content)
    update_mcp_stats("list_skills", list_success)
    available = [name for name in names if name in catalog] if catalog else names
    trace.append({"type": "tool_result", "iteration": 0, "tool": "list_skills", "source": "internal", "success": list_success, "content": list_content, "automatic": True, "execution_id": list_exec_id, "call_id": list_call_id})
    router_prompt = ('You are a SOC skill router. Select only relevant skills from this list based on the user request. '
        'Return JSON only: {"skills":["exact skill name"]}. Return {"skills":[]} if none apply. Never invent names.\n'
        + 'Available skills: ' + json.dumps(available, ensure_ascii=False) + '\nUser request: ' + user_input)
    selected_names = []
    try:
        _check_cancelled(cancel_event)
        with open_chat_model(overrides) as model:
            text = message_text(model.invoke([
                {"role": "system", "content": router_prompt},
                {"role": "user", "content": user_input},
            ])).strip()
        _check_cancelled(cancel_event)
        match = re.search(r'\{.*\}', text, flags=re.DOTALL)
        payload = json.loads(match.group(0) if match else text)
        values = payload.get("skills") if isinstance(payload, dict) else []
        if isinstance(values, list):
            selected_names = [str(value).strip() for value in values if str(value).strip() in available]
    except ChatCancelled:
        raise
    except Exception:
        if safe_tool_errors:
            logger.warning("Chat skill preselection failed")
        else:
            logger.exception("Chat skill preselection failed")
    instructions = []
    for name in selected_names:
        _check_cancelled(cancel_event)
        arguments = {"skill_name": name}
        audit_arguments = tool_result_transform(arguments) if tool_result_transform else arguments
        read_exec_id = start_mcp_execution("read_skill", audit_arguments, source=audit_source or "internal")
        read_call_id = f"preload-read-{read_exec_id}"
        try:
            trace.append({"type": "tool_call", "iteration": 0, "tool": "read_skill", "source": "internal", "arguments": audit_arguments, "automatic": True, "execution_id": read_exec_id, "call_id": read_call_id})
            if tool_guard:
                tool_guard(name="read_skill", arguments={"skill_name": name}, meta={}, execution_id=read_exec_id, call_id=read_call_id)
            _check_cancelled(cancel_event)
            doc = read_skill(name)
        except ChatCancelled:
            finish_mcp_execution(read_exec_id, False, error="Chat cancelled")
            raise
        except Exception:
            finish_mcp_execution(read_exec_id, False, error="Skill could not be loaded")
            update_mcp_stats("read_skill", False)
            trace.append({"type": "tool_result", "iteration": 0, "tool": "read_skill", "source": "internal", "success": False, "content": "Skill could not be loaded", "automatic": True, "execution_id": read_exec_id, "call_id": read_call_id})
            continue
        if doc and doc.content:
            finish_mcp_execution(read_exec_id, True)
            update_mcp_stats("read_skill", True)
            record_skill_call(name, True)
            skill_content = tool_result_transform(doc.content) if tool_result_transform else doc.content
            instructions.append(f"SKILL: {doc.name}\n{skill_content[:12000]}")
            trace.append({"type": "tool_result", "iteration": 0, "tool": "read_skill", "source": "internal", "success": True, "content": skill_content[:2000], "automatic": True, "execution_id": read_exec_id, "call_id": read_call_id})
        else:
            finish_mcp_execution(read_exec_id, False, error=f"Skill not found: {name}")
            update_mcp_stats("read_skill", False)
            record_skill_call(name, False)
            trace.append({"type": "tool_result", "iteration": 0, "tool": "read_skill", "source": "internal", "success": False, "content": f"Skill not found: {name}", "automatic": True, "execution_id": read_exec_id, "call_id": read_call_id})
    return selected_names, instructions, trace

def _tool_function(handler: Callable[[Dict[str, Any]], ToolExecutionResult]) -> Callable[..., str]:
    def execute(**arguments: Any) -> str:
        result = handler(arguments)
        if result.is_error:
            raise ToolException(result.content)
        return result.content

    return execute


class _ChatCompatibility(AgentMiddleware):
    """Translate framework events to the existing chat trace and tool audit."""

    def __init__(self, trace, external_mapping, *, cancel_event=None, tool_guard=None,
                 tool_result_transform=None, safe_tool_errors=False, model_call_guard=None, audit_source=None) -> None:
        self.trace = trace
        self.external_mapping = external_mapping
        self.iteration = 0
        self.caller_thread = get_ident()
        self.cancel_event = cancel_event
        self.tool_guard = tool_guard
        self.last_message = None
        self.tool_lock = Lock()
        self.tool_result_transform = tool_result_transform
        self.safe_tool_errors = safe_tool_errors
        self.model_call_guard = model_call_guard
        self.audit_source = audit_source

    def wrap_model_call(self, request, handler):
        _check_cancelled(self.cancel_event)
        tool_choice = self.model_call_guard() if self.model_call_guard else None
        self.iteration += 1
        self.trace.extend([
            {"type": "iteration_start", "iteration": self.iteration},
            {"type": "model_call", "iteration": self.iteration},
        ])
        response = handler(request.override(tool_choice=tool_choice or ("auto" if request.tools else None)))
        _check_cancelled(self.cancel_event)
        message = response.result[0]
        self.last_message = message
        # Keep malformed tool arguments on the error-feedback path instead of
        # silently treating an invalid tool call as a final empty answer.
        if message.invalid_tool_calls:
            message.tool_calls.extend([
                {"name": call["name"], "args": _parse_tool_arguments(call["args"]),
                 "id": call["id"], "type": "tool_call"}
                for call in message.invalid_tool_calls
            ])
            message.invalid_tool_calls = []
        if message.tool_calls:
            self.trace.append({"type": "tool_calls_detected", "iteration": self.iteration, "count": len(message.tool_calls)})
        return response

    def wrap_tool_call(self, request, handler):
        with self.tool_lock:
            return self._run_tool_call(request, handler)

    def _run_tool_call(self, request, handler):
        _check_cancelled(self.cancel_event)
        call = request.tool_call
        name = call["name"]
        meta = self.external_mapping.get(name) or {}
        actual_name = meta.get("tool_name") or name
        endpoint = meta.get("endpoint") or ""
        source = meta.get("source", "external") if meta else "internal"
        try:
            audit_arguments = self.tool_result_transform(call["args"]) if self.tool_result_transform else call["args"]
            exec_id = start_mcp_execution(actual_name, audit_arguments, source=self.audit_source or source, endpoint=endpoint)
            guard_denial = False
            try:
                self.trace.append({
                    "type": "tool_call", "iteration": self.iteration, "tool": actual_name,
                    "source": source, "endpoint": endpoint, "arguments": audit_arguments,
                    "execution_id": exec_id, "call_id": call["id"],
                })
                if self.tool_guard:
                    try:
                        self.tool_guard(name=actual_name, arguments=call["args"], meta=meta,
                                        execution_id=exec_id, call_id=call["id"])
                    except PermissionError:
                        guard_denial = True
                        raise
                _check_cancelled(self.cancel_event)
                if request.tool is None:
                    result = ToolMessage(content=f"Unknown tool: {name}", tool_call_id=call["id"], name=name, status="error")
                else:
                    result = handler(request)
                if self.tool_result_transform:
                    result.content = self.tool_result_transform(result.content)
            except ChatCancelled:
                finish_mcp_execution(exec_id, False, error="Chat cancelled")
                update_mcp_stats(actual_name, False)
                raise
            except Exception as exc:
                detail = str(exc) if not self.safe_tool_errors or guard_denial else "Check tool configuration or permissions."
                result = ToolMessage(content=f"Tool execution failed: {detail}", tool_call_id=call["id"], name=name, status="error")
            success = result.status != "error"
            content = str(result.content)
            try:
                response_payload = json.loads(content)
            except (TypeError, ValueError):
                response_payload = {"content": content}
            finish_mcp_execution(exec_id, success, error="" if success else content, response_payload=response_payload)
            update_mcp_stats(actual_name, success)
            self.trace.append({
                "type": "tool_result", "iteration": self.iteration, "tool": actual_name,
                "success": success, "content": content, "execution_id": exec_id,
                "call_id": call["id"], "source": source,
            })
            return result
        finally:
            # Even synchronous LangGraph tools run in worker threads. Django's
            # request cleanup only closes the request thread's connections.
            if get_ident() != self.caller_thread:
                connections.close_all()


def run_chat_agent(
    user_input: str,
    history_messages: Optional[List[Dict[str, Any]]] = None,
    overrides: Optional[Dict[str, Any]] = None,
    recommended_skills: Optional[List[str]] = None,
    *,
    event_callback=None,
    cancel_event=None,
    system_prompt_extra="",
    allowed_skills=None,
    extra_tools=None,
    extra_tool_metadata=None,
    tool_guard=None,
    tool_result_transform=None,
    safe_tool_errors=False,
    include_default_tools=True,
    model_call_guard=None,
    audit_source=None,
) -> Dict[str, Any]:
    """Run a chat turn; streaming callbacks must also accept events from tool threads."""
    if not user_input:
        raise RuntimeError("message is required")

    history_messages = history_messages or []
    recommended_skills = recommended_skills or []
    if allowed_skills is not None:
        allowed_skills = set(allowed_skills)
        recommended_skills = [name for name in recommended_skills if name in allowed_skills]
    _check_cancelled(cancel_event)

    system_prompt = (
        "You are a SOC analyst assistant. If tool calls are required, choose the most appropriate tool. "
        "If you do not need a tool, reply directly. "
        "When responding to the user, include a short analysis summary in a second paragraph starting with "
        "\"AI thinking:\" (max 80 words). This is a concise explanation of evidence and conclusions, "
        "not private internal reasoning."
    )
    trace = _EventTrace(event_callback)
    preloaded_names, preloaded_instructions, _ = _preload_chat_skills(
        user_input, recommended_skills, overrides=overrides, trace=trace,
        allowed_skills=allowed_skills, cancel_event=cancel_event, tool_guard=tool_guard,
        tool_result_transform=tool_result_transform, safe_tool_errors=safe_tool_errors,
        audit_source=audit_source,
    )
    if recommended_skills:
        skills_hint = ", ".join([f"`{s}`" for s in recommended_skills])
        system_prompt += f"\nAvailable skills: {skills_hint}. You may still call read_skill for additional details."
    if preloaded_instructions:
        system_prompt += "\nSelected skill instructions (apply only when supported by evidence):\n" + "\n\n".join(preloaded_instructions)
    if system_prompt_extra:
        system_prompt += "\n" + system_prompt_extra

    messages: List[Dict[str, Any]] = []
    for msg in history_messages:
        role = str(msg.get("role") or "").strip()
        content = msg.get("content")
        if role and content is not None:
            messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": user_input})

    internal_tools, internal_handlers = ([], {})
    if include_default_tools:
        internal_tools, internal_handlers = _internal_tools(allowed_skills=allowed_skills) if allowed_skills is not None else _internal_tools()
    if extra_tools:
        internal_tools = [*internal_tools, *extra_tools[0]]
        internal_handlers = {**internal_handlers, **extra_tools[1]}
    _check_cancelled(cancel_event)
    external_tools, external_mapping = _external_tools(overrides=overrides) if include_default_tools else ([], {})
    external_mapping = {**external_mapping, **(extra_tool_metadata or {})}
    _check_cancelled(cancel_event)
    if preloaded_names and allowed_skills is None:
        internal_tools = [
            tool for tool in internal_tools
            if ((tool.get("function") or {}).get("name") != "read_skill")
        ]
    tools = internal_tools + external_tools

    max_iter_value = None
    if isinstance(overrides, dict):
        max_iter_value = overrides.get("max_iterations")
    if max_iter_value in (None, ""):
        max_iter_value = getattr(settings, "AI_CHAT_MAX_ITERATIONS", 6)
    try:
        max_iterations = int(max_iter_value or 6)
    except Exception:
        max_iterations = 6

    middleware = _ChatCompatibility(
        trace, external_mapping, cancel_event=cancel_event, tool_guard=tool_guard,
        tool_result_transform=tool_result_transform, safe_tool_errors=safe_tool_errors,
        model_call_guard=model_call_guard, audit_source=audit_source,
    )
    agent_tools = []
    for schema in tools:
        definition = schema["function"]
        name = definition["name"]
        handler = internal_handlers.get(name)
        if handler is None:
            handler = partial(_execute_external_tool, name, mapping=external_mapping, overrides=overrides)
        agent_tools.append(StructuredTool(
            name=name,
            description=definition["description"],
            args_schema=definition["parameters"],
            func=_tool_function(handler),
            handle_tool_error=True,
        ))

    if max_iterations > 0:
        with open_chat_model(overrides) as model:
            agent = create_agent(
                model=model,
                tools=agent_tools,
                system_prompt=system_prompt,
                middleware=[
                    ModelCallLimitMiddleware(run_limit=max_iterations, exit_behavior="error"),
                    middleware,
                ],
            )
            try:
                # Graph steps include middleware and tools; the middleware above
                # enforces the actual model-call budget independently.
                # Tool/approval callbacks bypass the graph's stream waiter, so a
                # batch waiting on the serial tool lock cannot hide an approval.
                config = {"max_concurrency": 2 if event_callback else 1,
                          "recursion_limit": max_iterations * 5 + 10}
                if event_callback:
                    answer_stream = None
                    stream = agent.stream({"messages": messages}, config=config,
                                          stream_mode=["messages", "custom", "updates"])
                    trace.in_graph = True
                    try:
                        for mode, payload in stream:
                            _check_cancelled(cancel_event)
                            if mode == "custom":
                                if payload.get("type") == "model_call":
                                    if answer_stream:
                                        answer_stream.finish()
                                    answer_stream = _AnswerStream(event_callback, payload["iteration"])
                                event_callback(payload)
                            elif mode == "messages" and answer_stream:
                                chunk, metadata = payload
                                if metadata.get("langgraph_node") == "model":
                                    answer_stream.feed(message_text(chunk))
                            elif mode == "updates" and "model" in payload and answer_stream:
                                answer_stream.finish()
                        if answer_stream:
                            answer_stream.finish()
                    finally:
                        try:
                            stream.close()
                        finally:
                            trace.in_graph = False
                    message = middleware.last_message
                else:
                    state = agent.invoke({"messages": messages}, config=config)
                    message = state["messages"][-1]
                _check_cancelled(cancel_event)
            except ModelCallLimitExceededError:
                pass
            else:
                content = message_text(message)
                summary = ""
                if "AI thinking:" in content:
                    content, summary = [part.strip() for part in content.split("AI thinking:", 1)]
                if not content.strip():
                    content = summary or "AI analysis completed, but no user-facing response was returned."
                trace.append({"type": "assistant_response", "iteration": middleware.iteration, "content": content})
                if summary:
                    trace.append({"type": "analysis_summary", "iteration": middleware.iteration, "content": summary})
                return {"response": content, "raw": chat_response(message), "trace": trace}

    trace.append({"type": "max_iterations", "iteration": middleware.iteration})
    return {"response": "Reached max iterations without final response.", "trace": trace}
