"""Utility tasks for generic workflow execution."""
from __future__ import annotations

from typing import Any, Dict

from prefect import task

from .utils import execute_action


@task(name="log")
def log_task(action_config: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Write a log message using the existing workflow action implementation."""
    return execute_action("log", action_config, context)


@task(name="delay")
def delay_task(action_config: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Delay execution for the requested number of seconds."""
    return execute_action("delay", action_config, context)

