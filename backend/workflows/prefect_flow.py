"""Reference Prefect flow for the SOAR generic deployment."""
from __future__ import annotations

from pathlib import Path
import sys

from prefect import flow

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from workflows.flows.generic_workflow_flow import run_soar_workflow as generic_run_soar_workflow


@flow(name='soar-generic')
def run_soar_workflow(
    manifest_ref: str,
    execution_id: str,
    trigger_data: dict | None = None,
    trigger_source: str = 'manual',
) -> dict:
    """Generic SOAR flow bound to the shared Prefect deployment."""
    return generic_run_soar_workflow(
        manifest_ref=manifest_ref,
        execution_id=execution_id,
        trigger_data=trigger_data,
        trigger_source=trigger_source,
    )
