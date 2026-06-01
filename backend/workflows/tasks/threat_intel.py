"""Threat-intel lookup tasks (IP/Hash reputation checks)."""
from __future__ import annotations

from typing import Any, Dict

from prefect import task

from .utils import execute_action


@task(name="ip_lookup")
def ip_lookup_task(action_config: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Query threat-intel data for an IP address."""
    return execute_action("ip_lookup", action_config, context)


@task(name="hash_lookup")
def hash_lookup_task(action_config: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Query threat-intel data for a file hash."""
    return execute_action("hash_lookup", action_config, context)

