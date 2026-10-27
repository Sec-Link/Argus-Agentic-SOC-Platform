"""Allowlisted public diagnostics, without exception text or provider payloads."""

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from rest_framework.exceptions import PermissionDenied as ApiPermissionDenied

from .model_client import ModelCallError, model_request_summary_text
from .model_validation import validation_hint


_MESSAGES = {
    "model_timeout": "The model request timed out. Check the model service and network connection before retrying.",
    "model_connection_error": "The connection to the model service failed. Check the model endpoint, network and proxy settings.",
    "model_dns_error": "The model hostname could not be resolved. Check DNS and proxy settings.",
    "model_tls_error": "The secure connection to the model service failed. Check certificates and proxy settings.",
    "model_auth_error": "The model service rejected authentication or access. Check the API key and model permissions.",
    "model_rate_limited": "The model service limited this request. Check the account quota or try again later.",
    "model_upstream_error": "The model service returned a server error. Try again later.",
    "model_bad_request": "The model service rejected the request. Check the model and API compatibility settings.",
    "model_content_rejected": "MiniMax rejected the input through its content safety checks (1026). If this is unexpected, contact MiniMax support for review.",
    "model_not_found": "The model or API endpoint was not found. Check the model name and base URL.",
    "model_http_error": "The model service returned an HTTP error. Check the AI Assistant configuration.",
    "model_key_missing": "No model API key is configured. Add one in the AI Assistant settings.",
    "model_profile_unavailable": "The selected model was disabled, removed, or changed. Refresh the model list and select an available model before sending again.",
    "model_ca_invalid": "The model certificate bundle configuration is invalid. Check the backend CA bundle settings.",
    "model_response_invalid": "The model service returned an invalid or incomplete response. Check API compatibility.",
    "model_error": "The model request failed. Check the AI Assistant configuration.",
    "conversation_limit": "Conversation history reached the storage limit. Saved information is retained; start a new conversation.",
    "conversation_save_failed": "Conversation history could not be saved. Refresh the history before continuing.",
    "iteration_limit": "The agent reached its configured model round limit before completing the task. Review Execution limits or the specialist's Agent settings.",
    "permission_denied": "This action is not permitted, or its configuration changed. Check permissions and start a new message.",
    "internal_error": "An internal AI execution error occurred. Use the request ID to check the backend logs.",
}
_HTTP_CODES = {
    "model_auth_error", "model_rate_limited", "model_upstream_error",
    "model_bad_request", "model_content_rejected", "model_not_found", "model_http_error",
}
_EVENT_STAGES = {
    "model_call": "model", "answer_delta": "model", "assistant_response": "model",
    "analysis_summary": "model", "analysis_summary_delta": "model",
    "tool_call": "tool", "tool_result": "tool", "approval_required": "approval",
    "agent_start": "agent",
}
_TAG_LIMITS = {"agent": 48, "agent_title": 120, "delegation_id": 64}


def safe_chat_error(exc):
    code = "internal_error"
    if isinstance(exc, ModelCallError):
        if isinstance(exc.code, str) and exc.code in _MESSAGES:
            code = exc.code
    elif isinstance(exc, (PermissionError, DjangoPermissionDenied, ApiPermissionDenied)):
        code = "permission_denied"
    result = {"code": code, "message": _MESSAGES[code]}
    if isinstance(exc, ModelCallError) and code in _HTTP_CODES:
        if type(exc.status_code) is int and 100 <= exc.status_code <= 599:
            result["status_code"] = exc.status_code
    if isinstance(exc, ModelCallError) and code == "model_bad_request":
        hint = validation_hint(getattr(exc, "validation", None))
        if hint:
            result["message"] = f"{result['message']} {hint}"[:500]
    if isinstance(exc, ModelCallError) and code in {"model_bad_request", "model_content_rejected"}:
        summary = model_request_summary_text(getattr(exc, "request_summary", None))
        if summary:
            # Consumed by the page stream logger, never sent to the browser.
            result["_model_request_summary"] = summary
    return result


def event_progress(event, previous=None):
    """Track the last reported stage, not the inferred cause of a later failure."""
    previous = previous or {}
    stage = _EVENT_STAGES.get(event.get("type"))
    if stage is None:
        return dict(previous)
    result = {"stage": stage}
    for key, limit in _TAG_LIMITS.items():
        if isinstance(event.get(key), str) and event[key]:
            result[key] = event[key][:limit]
    iteration = event.get("iteration")
    same_scope = all(result.get(key) == previous.get(key) for key in ("agent", "delegation_id"))
    if iteration is None and same_scope:
        iteration = previous.get("iteration")
    if type(iteration) is int and iteration >= 0:
        result["iteration"] = iteration
    if stage in {"tool", "approval"} and isinstance(event.get("tool"), str):
        result["tool"] = event["tool"][:200]
    return result
