"""Notification tasks (email and webhook)."""
from __future__ import annotations

from typing import Any, Dict

from prefect import task

from .utils import execute_action


@task(name="send_email")
def send_email_task(action_config: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Send an email notification."""
    return execute_action("send_email", action_config, context)


@task(name="send_webhook")
def send_webhook_task(action_config: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Send an HTTP webhook request."""
    return execute_action("send_webhook", action_config, context)

