"""Release tasks (unblock IPs and re-enable users)."""
from __future__ import annotations

from typing import Any, Dict

from prefect import task

from .utils import execute_action


@task(name="release_ip")
def release_ip_task(action_config: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Release a previously blocked IP address."""
    return execute_action("release_ip", action_config, context)


@task(name="enable_user")
def enable_user_task(action_config: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Enable a previously disabled user account."""
    return execute_action("enable_user", action_config, context)

