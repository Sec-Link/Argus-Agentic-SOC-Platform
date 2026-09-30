from __future__ import annotations

import base64
import hashlib
import json
import os
import re
from copy import deepcopy
from typing import Any, Dict, Iterable
from urllib.parse import quote, quote_plus

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from .actions import ActionRegistry
from .actions.base import ResolvedSecret
from .conditions import normalize_condition_field

ENCRYPTED_PREFIX = "enc:v1:"
VARIABLE_REFERENCE = re.compile(r"\{\{\s*(\w+(?:\.\w+)*)\s*\}\}")


class RuntimeSecretError(ValueError):
    pass


def _keys_from_env() -> list[str]:
    keys = [item.strip() for item in os.getenv("WORKFLOW_ENCRYPTION_KEYS", "").split(",") if item.strip()]
    if not keys:
        raise RuntimeSecretError("WORKFLOW_ENCRYPTION_KEYS is required by the workflow worker.")
    return keys


def fernet_ring(keys: Iterable[str]) -> tuple[Fernet, MultiFernet]:
    try:
        fernets = [Fernet(str(key).encode("ascii")) for key in keys]
        if not fernets:
            raise ValueError("no keys")
        return fernets[0], MultiFernet(fernets)
    except (TypeError, ValueError) as exc:
        raise RuntimeSecretError("WORKFLOW_ENCRYPTION_KEYS contains an invalid Fernet key.") from exc


def encrypt_payload(payload: Dict[str, Any], keys: Iterable[str]) -> str:
    primary, _ = fernet_ring(keys)
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return ENCRYPTED_PREFIX + primary.encrypt(raw).decode("ascii")


def decrypt_payload(value: Any, keys: Iterable[str]) -> Dict[str, Any]:
    if not isinstance(value, str) or not value.startswith(ENCRYPTED_PREFIX):
        raise RuntimeSecretError("Sensitive value is not encrypted.")
    _, ring = fernet_ring(keys)
    try:
        raw = ring.decrypt(value[len(ENCRYPTED_PREFIX):].encode("ascii"))
        payload = json.loads(raw.decode("utf-8"))
    except (InvalidToken, UnicodeError, ValueError, TypeError, json.JSONDecodeError) as exc:
        raise RuntimeSecretError("Sensitive value could not be decrypted.") from exc
    if not isinstance(payload, dict):
        raise RuntimeSecretError("Sensitive value payload is invalid.")
    return payload


def decrypt_secret_variable(name: str, value: Any, keys: Iterable[str] | None = None) -> str:
    payload = decrypt_payload(value, list(keys) if keys is not None else _keys_from_env())
    if (
        payload.get("version") != 1
        or payload.get("kind") != "workflow_variable"
        or payload.get("name") != name
        or not isinstance(payload.get("value"), str)
        or not payload["value"]
    ):
        raise RuntimeSecretError("Secret variable is invalid for the declared name.")
    return payload["value"]


def _secret_path(path: str, names: set[str]) -> bool:
    path = normalize_condition_field(path)
    if path.startswith("workflow."):
        path = path[len("workflow."):]
    parts = path.split(".")
    return parts[0] == "_secret_variables" or (
        bool(names) and parts[0] == "variables" and (len(parts) == 1 or parts[1] in names)
    )


def validate_secret_context_path(path: str, secret_names: Iterable[str]) -> None:
    if _secret_path(path, set(secret_names)):
        raise RuntimeSecretError("Secret variables can only be used in sensitive action fields.")


def _sensitive_paths(action_type: str, config: Dict[str, Any]) -> set[tuple]:
    action = ActionRegistry.get_all_actions().get(action_type)
    schema = getattr(action, "config_schema", {}) or {}
    paths = {
        (name,) for name, spec in (schema.get("properties") or {}).items()
        if isinstance(spec, dict) and spec.get("x-sensitive")
    }
    if action_type == "api_call":
        paths.update(
            (section, index, "value")
            for section in ("headers", "query_params")
            for index, item in enumerate(config.get(section) or [])
            if isinstance(item, dict) and item.get("sensitive") is True
        )
    return paths


def validate_secret_variable_references(action_type: str, plaintext_config: Dict[str, Any], secret_names: Iterable[str]) -> None:
    names = set(secret_names)
    permitted = {f"variables.{name}" for name in names}
    allowed = _sensitive_paths(action_type, plaintext_config)
    action = ActionRegistry.get_all_actions().get(action_type)
    properties = (getattr(action, "config_schema", {}) or {}).get("properties") or {}

    def visit(value: Any, path: tuple = ()) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                visit(key, path + (key, "__key__"))
                visit(item, path + (key,))
        elif isinstance(value, list):
            for index, item in enumerate(value):
                visit(item, path + (index,))
        elif isinstance(value, str):
            for match in VARIABLE_REFERENCE.finditer(value):
                reference = match.group(1)
                if _secret_path(reference, names) and (
                    path not in allowed or reference not in permitted
                ):
                    raise RuntimeSecretError("Secret variables can only be used in sensitive action fields.")
                if reference in permitted:
                    bindings = (properties.get(path[0]) or {}).get("x-secret-bindings", []) if len(path) == 1 else ["url"]
                    if any(
                        isinstance(plaintext_config.get(field), str)
                        and ("{{" in plaintext_config[field] or "}}" in plaintext_config[field])
                        for field in bindings
                    ):
                        raise RuntimeSecretError("Secret variable references require fixed action target and authentication settings.")

    visit(plaintext_config)


def resolve_secret_variable_config(
    action_type: str,
    plaintext_config: Dict[str, Any],
    encrypted_variables: Dict[str, Any],
    *,
    context: Dict[str, Any] | None = None,
    keys: Iterable[str] | None = None,
) -> tuple[Dict[str, Any], list[str]]:
    validate_secret_variable_references(action_type, plaintext_config, encrypted_variables)
    result = deepcopy(plaintext_config)
    references = {f"variables.{name}" for name in encrypted_variables}
    encryption_keys = list(keys) if keys is not None else None
    secrets: list[str] = []
    decrypted: Dict[str, str] = {}
    for path in _sensitive_paths(action_type, result):
        parent: Any = result
        for part in path[:-1]:
            parent = parent[part]
        value = parent.get(path[-1])
        if not isinstance(value, str) or not any(
            match.group(1) in references
            for match in VARIABLE_REFERENCE.finditer(value)
        ):
            continue

        def replace(match: re.Match[str]) -> str:
            reference = match.group(1)
            name = reference.removeprefix("variables.")
            if reference.startswith("variables.") and name in encrypted_variables:
                if name not in decrypted:
                    decrypted[name] = decrypt_secret_variable(name, encrypted_variables[name], encryption_keys)
                    secrets.append(decrypted[name])
                return decrypted[name]
            return ActionRegistry.get_action(action_type).resolve_variables("{{" + reference + "}}", context or {})

        parent[path[-1]] = ResolvedSecret(VARIABLE_REFERENCE.sub(replace, value))
    return result, secrets


def _normalise(field: str, value: Any, schema: Dict[str, Any]) -> Any:
    if value in (None, ""):
        value = ((schema.get("properties") or {}).get(field) or {}).get("default")
    if field == "provider" and value in (None, ""):
        return "generic"
    if isinstance(value, str):
        value = value.strip()
        if field in {"api_url", "url"}:
            value = value.rstrip("/")
    return value


def _item_identity(section: str, key: str) -> str:
    return key.casefold() if section == "headers" else key


def _item_digest(section: str, key: str, url: Any, schema: Dict[str, Any]) -> str:
    canonical = json.dumps(
        {
            "action_type": "api_call",
            "field": section,
            "item_key": key,
            "binding": {"url": _normalise("url", url, schema)},
        },
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def decrypt_config_for_execution(action_type: str, config: Dict[str, Any] | None, keys: Iterable[str] | None = None) -> Dict[str, Any]:
    result = deepcopy(config or {})
    action = ActionRegistry.get_all_actions().get(action_type)
    schema = deepcopy(getattr(action, "config_schema", {}) or {})
    encryption_keys = list(keys) if keys is not None else None
    for field, definition in (schema.get("properties") or {}).items():
        if not isinstance(definition, dict) or not definition.get("x-sensitive") or field not in result:
            continue
        if encryption_keys is None:
            encryption_keys = _keys_from_env()
        payload = decrypt_payload(result[field], encryption_keys)
        binding = {name: _normalise(name, result.get(name), schema) for name in definition.get("x-secret-bindings", [])}
        canonical = json.dumps({"action_type": action_type, "field": field, "binding": binding}, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        expected = hashlib.sha256(canonical).hexdigest()
        if payload.get("version") != 1 or payload.get("action_type") != action_type or payload.get("field") != field or payload.get("binding_digest") != expected:
            raise RuntimeSecretError(f"Sensitive field {field} is not valid for the current action target.")
        result[field] = payload.get("value")
    if action_type == "api_call":
        for section in ("headers", "query_params"):
            for item in result.get(section) or []:
                if not item.get("sensitive"):
                    continue
                if encryption_keys is None:
                    encryption_keys = _keys_from_env()
                key = str(item.get("key") or "")
                payload = decrypt_payload(item.get("value"), encryption_keys)
                if (
                    payload.get("version") != 1
                    or payload.get("action_type") != "api_call"
                    or payload.get("field") != section
                    or payload.get("item_key") != _item_identity(section, key)
                    or payload.get("binding_digest") != _item_digest(section, key, result.get("url"), schema)
                ):
                    raise RuntimeSecretError(
                        f"Sensitive {section} value is not valid for the current URL and key."
                    )
                item["value"] = payload.get("value")
    return result


def secret_values(action_type: str, config: Dict[str, Any], schema: Dict[str, Any]) -> list[Any]:
    values = [
        config.get(name)
        for name, spec in (schema.get("properties") or {}).items()
        if isinstance(spec, dict) and spec.get("x-sensitive")
    ]
    if action_type == "api_call":
        values.extend(
            item.get("value")
            for section in ("headers", "query_params")
            for item in config.get(section) or []
            if item.get("sensitive")
        )
        if config.get("auth_type") == "basic" and config.get("auth_secret"):
            credentials = f"{config.get('auth_username') or ''}:{config['auth_secret']}"
            values.append(base64.b64encode(credentials.encode("utf-8")).decode("ascii"))
    return values


def redact_values(value: Any, secrets: Iterable[Any]) -> Any:
    def strings(items: Iterable[Any]) -> list[str]:
        result: list[str] = []
        for item in items:
            if isinstance(item, str) and item:
                result.extend((item, quote(item, safe=""), quote_plus(item), json.dumps(item, ensure_ascii=True)[1:-1], base64.b64encode(item.encode("utf-8")).decode("ascii")))
            elif isinstance(item, dict):
                result.extend(strings(item.values()))
            elif isinstance(item, (list, tuple, set)):
                result.extend(strings(item))
        return result

    secret_strings = sorted(set(strings(secrets)), key=len, reverse=True)

    def redact(item: Any) -> Any:
        if isinstance(item, dict):
            return {redact(key): redact(child) for key, child in item.items()}
        if isinstance(item, list):
            return [redact(child) for child in item]
        if isinstance(item, tuple):
            return tuple(redact(child) for child in item)
        if isinstance(item, str):
            for secret in secret_strings:
                item = item.replace(secret, "[REDACTED]")
        return item

    return redact(value)
