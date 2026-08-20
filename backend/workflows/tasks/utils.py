"""Shared helpers for Prefect workflow tasks."""
from __future__ import annotations

import os
import sys
from typing import Any, Dict


def ensure_django_ready() -> None:
    """Initialize Django for task execution (ORM + settings)."""
    backend_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    if backend_root not in sys.path:
        sys.path.insert(0, backend_root)
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "siem_project.settings")

    import django

    if not django.apps.apps.ready:
        django.setup()


def normalize_action_result(result: Any) -> Dict[str, Any]:
    """Normalize ActionResult to a serializable dict."""
    if hasattr(result, "to_dict"):
        return result.to_dict()
    if isinstance(result, dict):
        return result
    return {"success": True, "data": result, "error": "", "logs": ""}


def execute_action(action_type: str, action_config: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Execute an action via ActionRegistry and return a normalized dict."""
    ensure_django_ready()
    from ..actions import ActionRegistry
    from ..secret_config import decrypt_config_for_execution, redact_values, sensitive_fields

    action = ActionRegistry.get_action(action_type)
    # why here need to decypt twice
    execution_config = decrypt_config_for_execution(action_type, action_config or {})
    secrets = [execution_config.get(field) for field in sensitive_fields(action_type)]
    try:
        result = action.execute(execution_config, context or {})
    except Exception as exc:
        # Prefect persists task exceptions, so never let a credential-bearing
        # upstream error escape into task state or logs.
        safe_error = redact_values(str(exc), secrets)
        raise RuntimeError(safe_error) from None
    return redact_values(normalize_action_result(result), secrets)

