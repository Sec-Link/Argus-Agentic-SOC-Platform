import json
from threading import Event, Lock, get_ident
from typing import Any, Dict, List, Optional, Sequence

from django.conf import settings
from django.db import connections
from langchain.agents import create_agent
from langchain.agents.middleware import AgentMiddleware, ModelCallLimitMiddleware
from langchain.agents.middleware.model_call_limit import ModelCallLimitExceededError
from langchain_core.messages import ToolMessage
from langchain_core.tools import BaseTool, ToolException, tool
from langgraph.config import get_stream_writer

from ai_assistant.knowledge_base import ensure_index, format_search_results, get_categories, scan_knowledge_base, search_knowledge_base
from ai_assistant.mcp_tools import load_mcp_tools
from ai_assistant.model_client import chat_response, message_text, open_chat_model
from ai_assistant.skill_tools import SkillsMiddleware
from ai_assistant.monitoring import finish_mcp_execution, start_mcp_execution, update_mcp_stats

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


def _internal_tools() -> list[BaseTool]:
    @tool
    def list_knowledge_risk_types() -> str:
        """List available knowledge base risk types (categories)."""
        categories = get_categories()
        if not categories:
            scan_knowledge_base()
            categories = get_categories()
        return "\n".join(categories) or "No knowledge base categories found."

    @tool
    def search_knowledge(query: str, risk_type: str = "") -> str:
        """Search the knowledge base with semantic and keyword matching."""
        if not query.strip():
            raise ToolException("query is required")
        ensure_index()
        results = search_knowledge_base(query=query.strip(), risk_type=risk_type.strip())
        text, _ = format_search_results(results)
        return text

    search_knowledge.name = "search_knowledge_base"
    tools = [list_knowledge_risk_types, search_knowledge]
    for native_tool in tools:
        native_tool.metadata = {"source": "internal", "tool_name": native_tool.name, "endpoint": ""}
        native_tool.handle_tool_error = True
    return tools


def _external_tools(overrides: Optional[Dict[str, Any]] = None) -> list[BaseTool]:
    return load_mcp_tools(overrides=overrides)


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


class _ChatCompatibility(AgentMiddleware):
    """Translate framework events to the existing chat trace and tool audit."""

    def __init__(self, trace, *, cancel_event=None, tool_guard=None,
                 tool_result_transform=None, safe_tool_errors=False, model_call_guard=None, audit_source=None,
                 audit_context=None) -> None:
        self.trace = trace
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
        self.audit_context = audit_context or {}

    def wrap_model_call(self, request, handler):
        try:
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
        finally:
            if get_ident() != self.caller_thread:
                connections.close_all()


    def wrap_tool_call(self, request, handler):
        with self.tool_lock:
            return self._run_tool_call(request, handler)

    def _run_tool_call(self, request, handler):
        _check_cancelled(self.cancel_event)
        call = request.tool_call
        name = call["name"]
        meta = dict(request.tool.metadata or {}) if request.tool is not None else {}
        actual_name = meta.get("tool_name") or name
        endpoint = meta.get("endpoint") or ""
        source = meta.get("source", "internal")
        try:
            audit_arguments = self.tool_result_transform(call["args"]) if self.tool_result_transform else call["args"]
            exec_id = start_mcp_execution(
                actual_name, audit_arguments, source=self.audit_source or source, endpoint=endpoint,
                audit_context={**self.audit_context, "tool_source": source},
            )
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
                    if result.artifact is not None:
                        result.artifact = self.tool_result_transform(result.artifact)
            except ChatCancelled:
                finish_mcp_execution(exec_id, False, error="Chat cancelled")
                update_mcp_stats(actual_name, False)
                raise
            except Exception as exc:
                detail = str(exc) if not self.safe_tool_errors or guard_denial else "Check tool configuration or permissions."
                result = ToolMessage(content=f"Tool execution failed: {detail}", tool_call_id=call["id"], name=name, status="error")
            success = result.status != "error"
            content = str(result.content)
            if isinstance(result.content, (list, dict)):
                response_payload = result.content
            else:
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
    extra_tools: Optional[Sequence[BaseTool]] = None,
    tool_guard=None,
    tool_result_transform=None,
    safe_tool_errors=False,
    include_default_tools=True,
    model_call_guard=None,
    audit_source=None,
    audit_context=None,
) -> Dict[str, Any]:
    """Run a chat turn; streaming callbacks must also accept events from tool threads."""
    if not user_input:
        raise RuntimeError("message is required")

    history_messages = history_messages or []
    if audit_context:
        overrides = {**(overrides or {}), "_usage_context": {
            **((overrides or {}).get("_usage_context") or {}), **audit_context,
        }}
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
    if system_prompt_extra:
        system_prompt += "\n" + system_prompt_extra

    messages: List[Dict[str, Any]] = []
    for msg in history_messages:
        role = str(msg.get("role") or "").strip()
        content = msg.get("content")
        if role and content is not None:
            messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": user_input})

    agent_tools = list(extra_tools or [])
    skill_middleware = None
    if include_default_tools:
        agent_tools = [*_internal_tools(), *agent_tools]
        skill_middleware = SkillsMiddleware(
            allowed_skills=allowed_skills, recommended_skills=recommended_skills,
        )
        _check_cancelled(cancel_event)
        agent_tools.extend(_external_tools(overrides=overrides))
    _check_cancelled(cancel_event)
    registered_tools = agent_tools + (list(skill_middleware.tools) if skill_middleware else [])
    names = [native_tool.name for native_tool in registered_tools]
    if len(names) != len(set(names)):
        raise ValueError("Duplicate AI tool names are not allowed")

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
        trace, cancel_event=cancel_event, tool_guard=tool_guard,
        tool_result_transform=tool_result_transform, safe_tool_errors=safe_tool_errors,
        model_call_guard=model_call_guard, audit_source=audit_source,
        audit_context=(overrides or {}).get("_usage_context"),
    )
    middlewares = [ModelCallLimitMiddleware(run_limit=max_iterations, exit_behavior="error"), middleware]
    if skill_middleware is not None:
        middlewares.append(skill_middleware)

    if max_iterations > 0:
        with open_chat_model(overrides) as model:
            agent = create_agent(
                model=model,
                tools=agent_tools,
                system_prompt=system_prompt,
                middleware=middlewares,
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
