"""Ticket management tasks (create/update tickets)."""
from __future__ import annotations

from typing import Any, Dict

from prefect import task

from .utils import execute_action


@task(name="create_ticket")
def create_ticket_task(action_config: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Create a ticket using the existing workflow action implementation."""
    return execute_action("create_ticket", action_config, context)


@task(name="update_ticket")
def update_ticket_task(action_config: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Update tickets based on the provided matching criteria."""
    return execute_action("update_ticket", action_config, context)

