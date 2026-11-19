"""Bounded public call evidence, separate from transport credentials and reasoning."""

import json
import math
import re
from urllib.parse import quote, quote_plus


MAX_DETAIL_BYTES = 128 * 1024
_OMITTED = "[credential omitted]"
_PRIVATE = "[private reasoning omitted]"
_PRIVATE_KEYS = {"reasoning", "reasoningcontent", "reasoningdetails", "thinking", "signature", "encryptedcontent"}
_PRIVATE_TYPES = {"reasoning", "thinking", "redacted_thinking", "reasoning_content"}


def unavailable(reason="not_recorded"):
    return {"available": False, "data": None, "truncated": False, "reason": reason}


def snapshot(value, *, secrets=()):
    # Lazy import avoids the page-agent -> monitoring -> snapshot import cycle.
    from .page_agent import public_event

    secret_values = set()
    for secret in secrets:
        if isinstance(secret, str) and secret:
            secret_values.update((secret, quote(secret, safe=""), quote_plus(secret), json.dumps(secret)[1:-1]))
    secret_values = sorted(secret_values, key=len, reverse=True)
    remaining = MAX_DETAIL_BYTES - 512
    nodes = 0
    truncated = False

    def replace_secrets(text):
        for secret in secret_values:
            text = text.replace(secret, _OMITTED)
        return text

    def encoded(value):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8", errors="replace")

    def fit_text(text):
        nonlocal remaining, truncated
        text = text.encode("utf-8", errors="replace").decode("utf-8")
        if len(encoded(text)) > remaining:
            truncated = True
            left, right = 0, len(text)
            while left < right:
                middle = (left + right + 1) // 2
                if len(encoded(text[:middle])) <= max(2, remaining):
                    left = middle
                else:
                    right = middle - 1
            text = text[:left]
        remaining -= len(encoded(text))
        return text

    def secret_key(key):
        return public_event({key: "__value__"}).get(key) == _OMITTED

    def walk(item, depth=0):
        nonlocal remaining, nodes, truncated
        nodes += 1
        if depth > 24 or nodes > 5000 or remaining < 64:
            truncated = True
            return fit_text("[data omitted]")
        if isinstance(item, dict):
            if isinstance(item.get("type"), str) and item["type"] in _PRIVATE_TYPES:
                return fit_text(_PRIVATE)
            secret_label = any(isinstance(item.get(key), str) and secret_key(item[key])
                               for key in ("name", "key", "label_name", "type"))
            result = {}
            remaining -= 2
            for key, nested in item.items():
                if remaining < 64 or nodes > 5000:
                    truncated = True
                    break
                if not isinstance(key, str):
                    truncated = True
                    continue
                clean_key = replace_secrets(key)
                if len(encoded(clean_key)) > 1024:
                    truncated = True
                    clean_key = f"[field {len(result) + 1}]"
                clean_key = fit_text(clean_key)
                remaining -= 2
                normalized = re.sub(r"[^a-z]", "", key.lower())
                if normalized in _PRIVATE_KEYS:
                    result[clean_key] = fit_text(_PRIVATE)
                elif normalized in {"headers", "requestheaders", "responseheaders"} or secret_key(key) or (
                    secret_label and key in {"value", "label_value"}
                ):
                    result[clean_key] = fit_text(_OMITTED)
                else:
                    result[clean_key] = walk(nested, depth + 1)
            return result
        if isinstance(item, (list, tuple)):
            result = []
            remaining -= 2
            for nested in item:
                if remaining < 64 or nodes > 5000:
                    truncated = True
                    break
                remaining -= 1
                result.append(walk(nested, depth + 1))
            return result
        if isinstance(item, str):
            text = replace_secrets(item)
            if text.lstrip().startswith(("{", "[", '"')):
                try:
                    parsed = json.loads(text)
                except (ValueError, RecursionError):
                    pass
                else:
                    # Keep nested JSON as structured evidence so secrets and
                    # private fields use the same checks as ordinary objects.
                    return walk(parsed, depth + 1)
            text = re.sub(r"(?is)<think(?:ing)?>.*?(?:</think(?:ing)?>|$)", _PRIVATE, text)
            return fit_text(public_event(text))
        if item is None or isinstance(item, (bool, int)) or isinstance(item, float) and math.isfinite(item):
            try:
                size = len(encoded(item))
                if size > remaining:
                    truncated = True
                    return fit_text("[data omitted]")
                remaining -= size
            except (ValueError, OverflowError):
                return fit_text("[unsupported value omitted]")
            return item
        # Never serialize SDK objects or exception reprs into persisted evidence.
        return fit_text("[unsupported value omitted]")

    data = walk(value)
    return {"available": True, "data": data, "truncated": truncated}


def stored_detail(value):
    """Reapply today's redaction on read, including records made by older code."""
    if not isinstance(value, dict):
        return unavailable()
    if value.get("available") is not True:
        reason = value.get("reason")
        return unavailable(reason if reason in {"not_recorded", "pending", "not_executed", "unavailable"} else "unavailable")
    result = snapshot(value.get("data"))
    result["truncated"] |= bool(value.get("truncated"))
    return result
