"""Containment tasks (blocking IPs and disabling users)."""
from __future__ import annotations

from typing import Any, Dict

from prefect import task

from .utils import execute_action


@task(name="block_ip")
def block_ip_task(action_config: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Block an IP address using the existing workflow action implementation."""
    return execute_action("block_ip", action_config, context)


@task(name="disable_user")
def disable_user_task(action_config: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Disable a user account using the existing workflow action implementation."""
    return execute_action("disable_user", action_config, context)

