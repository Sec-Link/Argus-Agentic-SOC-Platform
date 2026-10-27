"""Model accounting and bounded diagnostics using actual provider requests."""

from decimal import Decimal, InvalidOperation
import json
from threading import local
from time import monotonic
from uuid import uuid4

from django.utils import timezone
from langchain_core.callbacks import BaseCallbackHandler

from .models import ModelUsage, PageChatConversation


PRICE_FIELDS = ("input_price_per_million", "output_price_per_million", "cached_input_price_per_million")
CONTEXT_FIELDS = (
    "actor_id", "actor_label", "request_id", "conversation_id", "model_profile_id",
    "profile_name", "model_name", "agent_name", "source", "currency", *PRICE_FIELDS,
)
REQUEST_FIELDS = frozenset({
    "model", "messages", "input", "instructions", "tools", "tool_choice", "temperature", "top_p",
    "max_tokens", "max_completion_tokens", "max_output_tokens", "stream", "stream_options",
    "parallel_tool_calls", "response_format", "frequency_penalty", "presence_penalty", "stop", "seed",
})


def request_permissions(payload, *, source=""):
    """Keep resource checks even if the corresponding diagnostic is truncated."""
    from .conversation_history import event_permissions

    permissions = {"tickets.view_eventticket"} if source.startswith("ticket_") else set()
    messages = payload.get("messages") or payload.get("input") or []
    if not isinstance(messages, list):
        return sorted(permissions)
    for message in messages:
        if not isinstance(message, dict):
            continue
        calls = message.get("tool_calls")
        calls = calls if isinstance(calls, list) else []
        if message.get("type") == "function_call":
            calls = [*calls, {"function": {"name": message.get("name"), "arguments": message.get("arguments")}}]
        if message.get("role") == "tool" and isinstance(message.get("name"), str) and message["name"]:
            permissions.update(event_permissions({"tool": message["name"]}))
        for call in calls:
            function = call.get("function") if isinstance(call, dict) else None
            if not isinstance(function, dict):
                continue
            name = function.get("name")
            if not isinstance(name, str):
                continue
            arguments = function.get("arguments")
            if isinstance(arguments, str):
                try:
                    arguments = json.loads(arguments)
                except (ValueError, RecursionError):
                    arguments = None
            permissions.update(event_permissions({"tool": name, "arguments": arguments}))
    return sorted(permissions)


def _public_request(payload):
    result = {key: value for key, value in payload.items() if key in REQUEST_FIELDS}
    if isinstance(result.get("messages"), list):
        result["messages"] = [
            {key: value for key, value in message.items() if key in {"role", "name", "content", "tool_calls", "tool_call_id"}}
            for message in result["messages"] if isinstance(message, dict)
        ]
    if isinstance(result.get("input"), list):
        result["input"] = [item for item in result["input"] if not isinstance(item, dict) or item.get("type") != "reasoning"]
    return result


def model_usage_context(user, *, source, overrides=None, request_id=None, conversation_id=None, agent_name=""):
    """Only server entry points construct attribution; request bodies cannot supply it."""
    context = dict((overrides or {}).get("_usage_context") or {})
    context.update(
        actor_id=user.pk, actor_label=user.get_username()[:150], source=source,
        request_id=request_id or str(uuid4()), conversation_id=conversation_id,
        agent_name=agent_name,
    )
    return context


def profile_usage_context(profile):
    return {
        "model_profile_id": profile.pk, "profile_name": profile.name, "model_name": profile.model,
        "currency": profile.currency, **{field: getattr(profile, field) for field in PRICE_FIELDS},
    }


def _count(value):
    return value if type(value) is int and 0 <= value <= 2**63 - 1 else None


def provider_token_counts(usage, *, responses_api=False):
    """Preserve absent wire fields before LangChain supplies numeric defaults."""
    input_field, output_field, details_field = (
        ("input_tokens", "output_tokens", "input_tokens_details") if responses_api
        else ("prompt_tokens", "completion_tokens", "prompt_tokens_details")
    )
    details = usage.get(details_field)
    return {
        "input_tokens": _count(usage.get(input_field)), "output_tokens": _count(usage.get(output_field)),
        "total_tokens": _count(usage.get("total_tokens")),
        "cached_input_tokens": _count(details.get("cached_tokens")) if isinstance(details, dict) else None,
    }


def token_counts(response, *, require_reported=False):
    """Absent provider usage stays unknown, including on interrupted streams."""
    result = dict.fromkeys(("input_tokens", "output_tokens", "cached_input_tokens", "total_tokens"))
    generations = getattr(response, "generations", None) or []
    message = getattr(generations[0][0], "message", None) if generations and generations[0] else None
    metadata = getattr(message, "response_metadata", {}) or {}
    reported = metadata.get("_argus_usage")
    if reported is None and isinstance(metadata.get("metadata"), dict):
        reported = metadata["metadata"].get("_argus_usage")
    if isinstance(reported, dict):
        return {key: _count(reported.get(key)) for key in result}
    if require_reported:
        return result
    usage = getattr(message, "usage_metadata", None)
    if not isinstance(usage, dict):
        return result
    for field in ("input_tokens", "output_tokens", "total_tokens"):
        result[field] = _count(usage.get(field))
    details = usage.get("input_token_details")
    if isinstance(details, dict):
        result["cached_input_tokens"] = _count(details.get("cache_read"))
    if (result["cached_input_tokens"] is not None and result["input_tokens"] is not None
            and result["cached_input_tokens"] > result["input_tokens"]):
        result["cached_input_tokens"] = None
    return result


def estimate_cost(counts, rates):
    """Unknown cache split/rates must not be represented as a zero-cost call."""
    incoming, outgoing, cached = (counts.get(key) for key in ("input_tokens", "output_tokens", "cached_input_tokens"))
    if incoming is None or outgoing is None:
        return None
    if cached is not None and cached > incoming:
        return None
    try:
        input_rate, output_rate, cache_rate = (
            Decimal(str(rates[field])) if rates.get(field) is not None else None for field in PRICE_FIELDS
        )
        if input_rate is None or output_rate is None:
            return None
        if cached is None:
            # Without a cache discount configuration the estimate treats all input
            # at the input rate; an explicitly different cache rate needs its count.
            if cache_rate is not None and cache_rate != input_rate:
                return None
            cached = 0
        if cached and cache_rate is None:
            return None
        value = ((incoming - cached) * input_rate + outgoing * output_rate + cached * (cache_rate or Decimal(0))) / Decimal(1_000_000)
        if not value.is_finite() or value < 0 or value >= Decimal(10)**12:
            return None
        return value.quantize(Decimal("0.000000000001"))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _error_code(error):
    # LangChain calls the error callback before the adapter sanitizes SDK errors.
    from openai import APIConnectionError, APIStatusError, APITimeoutError
    from .model_client import ModelCallError, _http_error_code

    if isinstance(error, APIStatusError):
        return _http_error_code(error.status_code, body=error.body, url=str(error.request.url))
    if isinstance(error, APITimeoutError):
        return "model_timeout"
    if isinstance(error, APIConnectionError):
        return "model_connection_error"
    if isinstance(error, ModelCallError):
        # Only fixed classifications enter monitoring; exception prose never does.
        from .chat_errors import safe_chat_error
        return safe_chat_error(error)["code"]
    return "model_error"


def _public_provider_error(error):
    """Only explicit provider error fields, never SDK prose or echoed input/ctx."""
    from openai import APIStatusError

    if not isinstance(error, APIStatusError) or not isinstance(error.body, dict):
        return None
    body = error.body.get("error", error.body)
    if not isinstance(body, dict):
        return None
    public = {key: value for key, value in body.items()
              if key in {"type", "code", "message"} and isinstance(value, (str, int)) and not isinstance(value, bool)}
    return public or None


class ModelUsageRecorder(BaseCallbackHandler):
    """A callback per opened model, with a separate record for every provider call."""

    raise_error = True
    run_inline = True

    def __init__(self, context, *, require_reported=False, secrets=()):
        self.context = {key: value for key, value in context.items() if key in CONTEXT_FIELDS}
        self.started = {}
        self.permissions = {}
        self.require_reported = require_reported
        self.secrets = tuple(secret for secret in secrets if isinstance(secret, str) and secret)
        self.active = local()

    def _conversation_permissions(self):
        conversation_id = self.context.get("conversation_id")
        if not conversation_id:
            return set()
        required = PageChatConversation.objects.filter(pk=conversation_id).values_list("required_permissions", flat=True).first()
        return {permission for permission in required if isinstance(permission, str)} if isinstance(required, list) else set()

    def on_chat_model_start(self, serialized, messages, *, run_id, **kwargs):
        from .call_details import unavailable

        # This runs after authorization guards and before the actual model request.
        permissions = self._conversation_permissions() | set(request_permissions({}, source=self.context.get("source", "")))
        ModelUsage.objects.create(
            id=run_id, **self.context, request_detail=unavailable("not_executed"), response_detail=unavailable("pending"),
            detail_permissions=sorted(permissions),
        )
        self.started[run_id] = monotonic()
        self.permissions[run_id] = permissions
        self.active.run_id = run_id

    def record_request(self, payload):
        from .call_details import snapshot

        run_id = getattr(self.active, "run_id", None)
        if run_id not in self.started or not isinstance(payload, dict):
            return
        permissions = self.permissions[run_id] | self._conversation_permissions() | set(
            request_permissions(payload, source=self.context.get("source", ""))
        )
        ModelUsage.objects.filter(pk=run_id, status="running").update(
            request_detail=snapshot(_public_request(payload), secrets=self.secrets),
            detail_permissions=sorted(permissions),
        )
        self.permissions[run_id] = permissions

    def _finish(self, run_id, *, response=None, error=None):
        from .call_details import snapshot, unavailable
        from .model_client import chat_response

        started = self.started.pop(run_id, None)
        if started is None:
            return
        permissions = self.permissions.pop(run_id, set()) | self._conversation_permissions()
        counts = token_counts(response, require_reported=self.require_reported)
        generations = getattr(response, "generations", None) or []
        message = getattr(generations[0][0], "message", None) if generations and generations[0] else None
        public_payload = None
        if message is not None:
            public_response = chat_response(message)
            public_message = public_response["choices"][0]["message"]
            permissions.update(request_permissions({"messages": [public_message]}))
            # The SDK supplies an empty synthetic AIMessage on transport errors.
            # That placeholder is not an actual returned model response.
            if error is None or public_message.get("content") or public_message.get("tool_calls") or any(
                value is not None for value in counts.values()
            ):
                public_payload = {**public_response, "usage": counts, "partial": error is not None}
        provider_error = _public_provider_error(error)
        if provider_error:
            public_payload = {**(public_payload or {}), "error": provider_error}
        response_detail = snapshot(public_payload, secrets=self.secrets) if public_payload is not None else unavailable("unavailable")
        ModelUsage.objects.filter(pk=run_id, status="running").update(
            status="failed" if error else "success", end_time=timezone.now(),
            duration_ms=min(2**31 - 1, max(0, round((monotonic() - started) * 1000))),
            error_code=_error_code(error) if error else "", **counts,
            estimated_cost=estimate_cost(counts, self.context),
            response_detail=response_detail,
            detail_permissions=sorted(permissions),
        )
        if getattr(self.active, "run_id", None) == run_id:
            del self.active.run_id

    def on_llm_end(self, response, *, run_id, **kwargs):
        self._finish(run_id, response=response)

    def on_llm_error(self, error, *, run_id, response=None, **kwargs):
        self._finish(run_id, response=response, error=error)
