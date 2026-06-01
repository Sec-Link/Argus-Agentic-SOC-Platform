"""
Prefect REST client for the workflows app.

This is a thin wrapper around `requests` that talks to a Prefect Server's
REST API. It is intentionally self-contained: configuration is read directly
from environment variables here so that wiring up Prefect does not require
edits to ``settings.py``, ``requirements.txt``, or ``env.example``.

Environment variables (all optional except the first two when Prefect is in use):
    PREFECT_API_URL          Base URL of Prefect API, e.g. http://prefect-server:4200/api
    PREFECT_DEPLOYMENT_ID    UUID of the generic SOAR deployment registered on Prefect.
    PREFECT_API_KEY          Optional bearer token for Prefect Cloud / secured server.
    PREFECT_TIMEOUT_SECONDS  HTTP timeout for individual calls (default 10).

Prefect flow run states are mapped here to the ``WorkflowExecution.STATUS_CHOICES``
enum used elsewhere in the app, so the rest of the codebase never deals with
Prefect-specific vocabulary.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

import requests

logger = logging.getLogger(__name__)


# Prefect state names → WorkflowExecution status values.
# Prefect 2.x/3.x both use the same canonical state types here.
PREFECT_STATE_TO_STATUS = {
    'SCHEDULED': 'pending',
    'PENDING': 'pending',
    'RUNNING': 'running',
    'PAUSED': 'paused',
    'COMPLETED': 'completed',
    'FAILED': 'failed',
    'CRASHED': 'failed',
    'CANCELLED': 'cancelled',
    'CANCELLING': 'cancelled',
}

TERMINAL_STATUSES = {'completed', 'failed', 'cancelled'}


class PrefectConfigError(RuntimeError):
    """Raised when Prefect env vars are missing or malformed."""


class PrefectAPIError(RuntimeError):
    """Raised when Prefect API returns a non-2xx response."""


def _api_base() -> str:
    url = os.getenv('PREFECT_API_URL', '').rstrip('/')
    if not url:
        raise PrefectConfigError(
            'PREFECT_API_URL is not set; cannot dispatch to Prefect.'
        )
    return url


def _deployment_id() -> str:
    deployment_id = os.getenv('PREFECT_DEPLOYMENT_ID', '').strip()
    if not deployment_id:
        raise PrefectConfigError(
            'PREFECT_DEPLOYMENT_ID is not set; register the generic SOAR '
            'deployment on Prefect first.'
        )
    return deployment_id


def resolve_deployment_id(override: Optional[str] = None) -> str:
    if override:
        return str(override).strip()
    return _deployment_id()


def _headers() -> Dict[str, str]:
    headers = {'Content-Type': 'application/json'}
    api_key = os.getenv('PREFECT_API_KEY', '').strip()
    if api_key:
        headers['Authorization'] = f'Bearer {api_key}'
    return headers


def _timeout() -> float:
    try:
        return float(os.getenv('PREFECT_TIMEOUT_SECONDS', '10'))
    except (TypeError, ValueError):
        return 10.0


def is_configured(deployment_id: Optional[str] = None) -> bool:
    """Cheap pre-flight check used by callers that want to fall back gracefully."""
    if not os.getenv('PREFECT_API_URL'):
        return False
    if deployment_id:
        return True
    return bool(os.getenv('PREFECT_DEPLOYMENT_ID'))


def map_state_to_status(state_type: Optional[str]) -> str:
    """Map a Prefect state_type string to our internal execution status."""
    if not state_type:
        return 'pending'
    return PREFECT_STATE_TO_STATUS.get(str(state_type).upper(), 'running')


def create_flow_run(
    *,
    parameters: Dict[str, Any],
    name: Optional[str] = None,
    tags: Optional[list] = None,
    deployment_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Create a flow run on the configured generic deployment.

    Returns the parsed JSON body, which contains at minimum ``id`` (the flow
    run UUID) and ``state``.
    """
    url = f"{_api_base()}/deployments/{resolve_deployment_id(deployment_id)}/create_flow_run"
    payload: Dict[str, Any] = {'parameters': parameters}
    if name:
        payload['name'] = name
    if tags:
        payload['tags'] = list(tags)

    resp = requests.post(url, json=payload, headers=_headers(), timeout=_timeout())
    if resp.status_code >= 400:
        raise PrefectAPIError(
            f'Prefect create_flow_run returned {resp.status_code}: {resp.text[:500]}'
        )
    return resp.json()


def get_flow_run(flow_run_id: str) -> Dict[str, Any]:
    """Fetch the full flow run record (state, timestamps, parameters)."""
    url = f"{_api_base()}/flow_runs/{flow_run_id}"
    resp = requests.get(url, headers=_headers(), timeout=_timeout())
    if resp.status_code == 404:
        raise PrefectAPIError(f'Flow run {flow_run_id} not found on Prefect.')
    if resp.status_code >= 400:
        raise PrefectAPIError(
            f'Prefect get_flow_run returned {resp.status_code}: {resp.text[:500]}'
        )
    return resp.json()


def cancel_flow_run(flow_run_id: str) -> None:
    """
    Ask Prefect to cancel an in-flight flow run. Idempotent: cancelling an
    already-terminal run is a no-op from our perspective.
    """
    url = f"{_api_base()}/flow_runs/{flow_run_id}/set_state"
    payload = {
        'state': {'type': 'CANCELLING', 'name': 'Cancelling'},
        'force': False,
    }
    resp = requests.post(url, json=payload, headers=_headers(), timeout=_timeout())
    # Prefect returns 200 or 201 for accepted state transitions; treat 409
    # (already terminal) as success since the user's intent is satisfied.
    if resp.status_code in (200, 201, 409):
        return
    raise PrefectAPIError(
        f'Prefect cancel_flow_run returned {resp.status_code}: {resp.text[:500]}'
    )


def update_deployment_schedule(
    *,
    deployment_id: str,
    schedule: Dict[str, Any] | None,
    is_active: bool,
) -> Dict[str, Any]:
    """
    Update the schedule attached to a Prefect deployment.

    Prefect 3.7.x accepts a ``schedule`` object on the deployment. We use this
    to keep Prefect's scheduler aligned with Django's WorkflowSchedule records.
    """
    url = f"{_api_base()}/deployments/{deployment_id}"
    payload: Dict[str, Any] = {
        'schedule': schedule,
        'is_schedule_active': bool(is_active),
    }
    resp = requests.patch(url, json=payload, headers=_headers(), timeout=_timeout())
    if resp.status_code >= 400:
        raise PrefectAPIError(
            f'Prefect update_deployment_schedule returned {resp.status_code}: {resp.text[:500]}'
        )
    return resp.json()


def list_deployments(limit: int = 200) -> list[Dict[str, Any]]:
    """List Prefect deployments for UI sync."""
    url = f"{_api_base()}/deployments?limit={limit}"
    resp = requests.get(url, headers=_headers(), timeout=_timeout())
    if resp.status_code >= 400:
        raise PrefectAPIError(
            f'Prefect list_deployments returned {resp.status_code}: {resp.text[:500]}'
        )
    data = resp.json()
    if isinstance(data, dict) and 'deployments' in data:
        return data.get('deployments') or []
    return data if isinstance(data, list) else []


def get_deployment(deployment_id: str) -> Dict[str, Any]:
    """Fetch a single Prefect deployment by id."""
    url = f"{_api_base()}/deployments/{deployment_id}"
    resp = requests.get(url, headers=_headers(), timeout=_timeout())
    if resp.status_code == 404:
        raise PrefectAPIError(f'Deployment {deployment_id} not found on Prefect.')
    if resp.status_code >= 400:
        raise PrefectAPIError(
            f'Prefect get_deployment returned {resp.status_code}: {resp.text[:500]}'
        )
    return resp.json()


def update_deployment(
    *,
    deployment_id: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    """Update deployment metadata (name/description/tags/parameters)."""
    url = f"{_api_base()}/deployments/{deployment_id}"
    resp = requests.patch(url, json=payload, headers=_headers(), timeout=_timeout())
    if resp.status_code >= 400:
        raise PrefectAPIError(
            f'Prefect update_deployment returned {resp.status_code}: {resp.text[:500]}'
        )
    return resp.json()


def has_api() -> bool:
    """Return True when Prefect API URL is configured."""
    return bool(os.getenv('PREFECT_API_URL'))


def get_flow_by_name(flow_name: str) -> Dict[str, Any] | None:
    """Fetch a Prefect flow by name if it exists."""
    url = f"{_api_base()}/flows/name/{flow_name}"
    resp = requests.get(url, headers=_headers(), timeout=_timeout())
    if resp.status_code == 404:
        return None
    if resp.status_code >= 400:
        raise PrefectAPIError(
            f'Prefect get_flow_by_name returned {resp.status_code}: {resp.text[:500]}'
        )
    return resp.json()


def create_flow(flow_name: str) -> Dict[str, Any]:
    """Create a Prefect flow if it does not already exist."""
    url = f"{_api_base()}/flows/"
    payload = {'name': flow_name}
    resp = requests.post(url, json=payload, headers=_headers(), timeout=_timeout())
    if resp.status_code >= 400:
        raise PrefectAPIError(
            f'Prefect create_flow returned {resp.status_code}: {resp.text[:500]}'
        )
    return resp.json()


def get_or_create_flow_id(flow_name: str) -> str:
    """Return the flow id for the given name, creating the flow if needed."""
    existing = get_flow_by_name(flow_name)
    if existing and existing.get('id'):
        return str(existing['id'])
    created = create_flow(flow_name)
    return str(created.get('id'))


def create_deployment(
    *,
    flow_id: str,
    name: str,
    entrypoint: str,
    parameters: Dict[str, Any] | None = None,
    tags: list[str] | None = None,
) -> Dict[str, Any]:
    """Create a Prefect deployment for the given flow."""
    url = f"{_api_base()}/deployments/"
    payload: Dict[str, Any] = {
        'flow_id': flow_id,
        'name': name,
        'entrypoint': entrypoint,
    }
    if parameters is not None:
        payload['parameters'] = parameters
    if tags:
        payload['tags'] = list(tags)
    resp = requests.post(url, json=payload, headers=_headers(), timeout=_timeout())
    if resp.status_code >= 400:
        raise PrefectAPIError(
            f'Prefect create_deployment returned {resp.status_code}: {resp.text[:500]}'
        )
    return resp.json()
