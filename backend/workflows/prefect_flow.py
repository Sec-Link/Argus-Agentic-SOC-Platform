"""
Reference Prefect flow for the SOAR generic deployment.

This file is NOT imported by Django at runtime. It exists so that the ops
team registering the Prefect deployment has a single canonical implementation
of the flow contract that ``prefect_dispatcher.py`` expects.

Deploy on the Prefect side, e.g.::

    prefect deploy backend/workflows/prefect_flow.py:run_soar_workflow \
        --name soar-generic --pool default-process

The deployment id is then exported to Django via the ``PREFECT_DEPLOYMENT_ID``
environment variable.

Flow contract:
    Parameters
        workflow_definition: dict   Serialized workflow + steps; see
                                    prefect_dispatcher._serialize_workflow.
        execution_id:        str    UUID of the WorkflowExecution row in Django.
        trigger_data:        dict   Forwarded into the engine context.
        trigger_source:      str    Human-readable trigger label.
    Return value
        {
          'execution_id':  '...',
          'status':        'completed' | 'failed',
          'step_results':  [
              {
                'step_id':       '<uuid>',
                'status':        'completed' | 'failed' | 'skipped',
                'attempt_number': 1,
                'input_data':    { ... },
                'output_data':   { ... },
                'error_message': '',
                'logs':          '',
              },
              ...
          ],
        }

Django polls Prefect for the flow run state and, once terminal, projects
``step_results`` back into ``StepExecution`` rows.
"""
from __future__ import annotations

# Imports are inside the flow so this file can be statically inspected by
# Django without Prefect being installed in the Django process.


def run_soar_workflow(
    workflow_definition: dict,
    execution_id: str,
    trigger_data: dict | None = None,
    trigger_source: str = 'manual',
) -> dict:
    """
    Generic SOAR flow. One Prefect deployment serves every Django workflow.

    This wrapper delegates to ``workflows.flows.generic_workflow_flow`` so the
    flow logic is maintained in the new flows package.
    """
    from workflows.flows.generic_workflow_flow import run_soar_workflow as _flow

    return _flow(
        workflow_definition=workflow_definition,
        execution_id=execution_id,
        trigger_data=trigger_data,
        trigger_source=trigger_source,
    )

