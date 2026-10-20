"""Bounded model validation hints containing only known protocol field names."""

import json
import re
from itertools import islice


_FIELDS = frozenset({
    "model", "messages", "messages[]", "messages[].role", "messages[].content",
    "messages[].name", "messages[].reasoning_content", "messages[].tool_call_id",
    "messages[].tool_calls", "messages[].tool_calls[]",
    "messages[].tool_calls[].id", "messages[].tool_calls[].type",
    "messages[].tool_calls[].function", "messages[].tool_calls[].function.name",
    "messages[].tool_calls[].function.arguments",
    "tools", "tools[]", "tools[].type", "tools[].function", "tools[].function.name",
    "tools[].function.description", "tools[].function.parameters", "tools[].function.strict",
    "tool_choice", "tool_choice.type", "tool_choice.function", "tool_choice.function.name",
    "temperature", "top_p", "max_tokens", "max_completion_tokens", "parallel_tool_calls",
    "stream", "stream_options", "stream_options.include_usage", "response_format",
    "response_format.type", "response_format.json_schema", "reasoning_effort",
    "thinking", "thinking.type",
})
_ISSUES = {
    "missing": "missing", "invalid_type": "invalid type", "invalid_value": "invalid value",
    "unsupported": "unsupported", "extra_field": "unexpected field",
    "context_limit": "context limit", "rejected": "rejected",
}
_PROVIDER_ISSUES = {
    "missing": "missing", "value_error.missing": "missing",
    "missing_required_parameter": "missing",
    "invalid_type": "invalid_type", "string_type": "invalid_type",
    "list_type": "invalid_type", "dict_type": "invalid_type", "int_type": "invalid_type",
    "float_type": "invalid_type", "bool_type": "invalid_type",
    "model_attributes_type": "invalid_type", "type_error.str": "invalid_type",
    "type_error.list": "invalid_type", "type_error.dict": "invalid_type",
    "type_error.integer": "invalid_type", "type_error.float": "invalid_type",
    "type_error.bool": "invalid_type",
    "invalid_value": "invalid_value", "invalid_parameter": "invalid_value",
    "literal_error": "invalid_value", "enum": "invalid_value", "value_error.const": "invalid_value",
    "greater_than": "invalid_value", "greater_than_equal": "invalid_value",
    "less_than": "invalid_value", "less_than_equal": "invalid_value",
    "unsupported_parameter": "unsupported", "unsupported_value": "unsupported",
    "extra_forbidden": "extra_field", "value_error.extra": "extra_field",
    "context_length_exceeded": "context_limit",
}


def _field(location):
    if isinstance(location, str):
        if len(location) > 200 or not re.fullmatch(r"[a-z_][a-z_0-9]*(?:\[\d{1,6}\]|\.[a-z_0-9]+)*", location):
            return None
        location = re.sub(r"\[(\d{1,6})\]", r".\1", location).split(".")
    if not isinstance(location, (list, tuple)) or not 1 <= len(location) <= 10:
        return None
    if location[0] == "body":
        location = location[1:]
    parts = []
    for part in location:
        if type(part) is int and 0 <= part <= 999999:
            parts.append("[]")
        elif isinstance(part, str) and len(part) <= 64:
            parts.append("[]" if re.fullmatch(r"[0-9]{1,6}", part) else part)
        else:
            return None
    field = ".".join(parts).replace(".[]", "[]")
    return field if field in _FIELDS else None


def _validation_entries(body, depth=0):
    """Unwrap bounded structured errors, including SDK-unwrapped JSON strings."""
    if depth > 4:
        return
    if isinstance(body, str):
        if len(body) > 16384:
            return
        try:
            if len(body.encode("utf-8")) > 16384:
                return
            decoded = json.loads(body)
        except (ValueError, RecursionError, UnicodeError):
            return
        yield from _validation_entries(decoded, depth + 1)
    elif isinstance(body, list):
        for entry in body[:8]:
            yield from _validation_entries(entry, depth + 1)
    elif isinstance(body, dict):
        if "loc" in body or "param" in body:
            yield body
            return
        wrappers = [key for key in ("error", "detail", "errors") if key in body]
        if wrappers:
            for key in wrappers:
                yield from _validation_entries(body[key], depth + 1)
        else:
            yield body


def extract_model_validation(body):
    """Extract up to three canonical hints; never inspect provider error prose."""
    result = []
    for entry in islice(_validation_entries(body), 8):
        if not isinstance(entry, dict):
            continue
        field = _field(entry.get("loc", entry.get("param")))
        if field is None:
            continue
        issue = "rejected"
        for key in ("code", "type"):
            value = entry.get(key)
            if isinstance(value, str) and len(value) <= 64 and value in _PROVIDER_ISSUES:
                issue = _PROVIDER_ISSUES[value]
                break
        hint = {"field": field, "issue": issue}
        if hint not in result:
            result.append(hint)
        if len(result) == 3:
            break
    return result


def validation_hint(entries):
    """Revalidate exception metadata before constructing a public fixed message."""
    if not isinstance(entries, (list, tuple)):
        return ""
    hints = []
    for entry in entries[:8]:
        if not isinstance(entry, dict):
            continue
        field, issue = entry.get("field"), entry.get("issue")
        if not isinstance(field, str) or len(field) > 80 or field not in _FIELDS:
            continue
        if not isinstance(issue, str) or len(issue) > 32 or issue not in _ISSUES:
            continue
        hint = f"Rejected field: {field} ({_ISSUES[issue]})."
        if hint not in hints:
            hints.append(hint)
        if len(hints) == 3:
            break
    return " ".join(hints)
