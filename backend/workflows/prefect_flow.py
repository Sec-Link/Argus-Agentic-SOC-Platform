"""
Reference Prefect flow for the SOAR generic deployment.
"""
from __future__ import annotations


def run_soar_workflow(
    manifest_ref: str,
    execution_id: str,
    trigger_data: dict | None = None,
    trigger_source: str = 'manual',
) -> dict:
    """Generic SOAR flow bound to the shared Prefect deployment."""
    from .flows.generic_workflow_flow import run_soar_workflow as _flow

    return _flow(
        manifest_ref=manifest_ref,
        execution_id=execution_id,
        trigger_data=trigger_data,
        trigger_source=trigger_source,
    )
