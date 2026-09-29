from __future__ import annotations

from typing import Any, Dict

from .actions import ActionRegistry
from .secrets import decrypt_config_for_execution, redact_values, resolve_secret_variable_config, secret_values


def execute_action(action_type: str, action_config: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    execution_config = decrypt_config_for_execution(action_type, action_config)
    encrypted_variables = context.get("_secret_variables") or {}
    action_context = {name: value for name, value in context.items() if name != "_secret_variables"}
    if encrypted_variables:
        action_context["variables"] = {
            name: value for name, value in (context.get("variables") or {}).items()
            if name not in encrypted_variables
        }
    execution_config, variable_secrets = resolve_secret_variable_config(
        action_type, execution_config, encrypted_variables, context=action_context,
    )
    schema = ActionRegistry.get_all_actions()[action_type].config_schema
    secrets = variable_secrets + secret_values(action_type, execution_config, schema)
    try:
        result = ActionRegistry.get_action(action_type).execute(execution_config, action_context)
    except Exception as exc:
        error = redact_values(str(exc), secrets)
    else:
        return redact_values(result.to_dict(), secrets)
    # Raise outside the handler so Prefect cannot retain the plaintext exception context.
    raise RuntimeError(error) from None
