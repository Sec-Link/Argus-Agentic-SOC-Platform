"""
Prefect task wrappers and workflow background tasks.

Each task in this package maps a workflow node action to a Prefect task so
executions appear in the Prefect UI with step-level visibility.
"""
from __future__ import annotations

import logging
from typing import Optional

from django.tasks import task

from .condition import condition_task
from .containment import block_ip_task, disable_user_task
from .notification import send_email_task, send_webhook_task
from .release import release_ip_task, enable_user_task
from .threat_intel import ip_lookup_task, hash_lookup_task
from .ticketing import create_ticket_task, update_ticket_task
from .utility import log_task, delay_task

logger = logging.getLogger(__name__)


@task(queue_name="default")
def run_workflow_task(execution_id: str) -> dict:
    """Execute a WorkflowExecution identified by *execution_id*."""
    from ..models import WorkflowExecution
    from ..engines import run_execution

    logger.info("Background task: starting workflow execution %s", execution_id)
    execution = WorkflowExecution.objects.select_related("workflow").get(id=execution_id)

    try:
        run_execution(execution)
    except Exception as exc:
        logger.exception(
            "Background task: workflow execution %s failed: %s", execution_id, exc
        )
        raise

    logger.info(
        "Background task: workflow execution %s finished with status '%s'",
        execution_id,
        execution.status,
    )
    return {"execution_id": execution_id, "status": execution.status}


@task(queue_name="default")
def trigger_workflows_for_event_task(
    trigger_type: str,
    trigger_source: str,
    trigger_data: dict,
    executed_by_id: Optional[int] = None,
) -> dict:
    """Find all active workflows matching *trigger_type* and execute them."""
    from django.contrib.auth.models import User

    from ..engine import execute_workflow
    from ..models import Workflow
    from ..signals import _matches_conditions

    executed_by: Optional[User] = None
    if executed_by_id is not None:
        try:
            executed_by = User.objects.get(pk=executed_by_id)
        except User.DoesNotExist:
            logger.warning(
                "trigger_workflows_for_event_task: user %s not found", executed_by_id
            )

    workflows = Workflow.objects.filter(
        trigger_type=trigger_type,
        is_active=True,
        is_draft=False,
    )

    triggered = 0
    skipped = 0

    for workflow in workflows:
        if not _matches_conditions(trigger_data, workflow.trigger_conditions):
            skipped += 1
            continue

        try:
            execution = execute_workflow(
                workflow=workflow,
                trigger_data=trigger_data,
                trigger_source=trigger_source,
                executed_by=executed_by,
            )
            triggered += 1
            logger.info(
                "Auto-triggered workflow '%s' (execution %s, status=%s)",
                workflow.name,
                execution.id,
                execution.status,
            )
        except Exception as exc:
            logger.exception(
                "Failed to trigger workflow '%s': %s", workflow.name, exc
            )

    return {"triggered": triggered, "skipped": skipped}


__all__ = [
    "condition_task",
    "block_ip_task",
    "disable_user_task",
    "send_email_task",
    "send_webhook_task",
    "release_ip_task",
    "enable_user_task",
    "ip_lookup_task",
    "hash_lookup_task",
    "create_ticket_task",
    "update_ticket_task",
    "log_task",
    "delay_task",
    "run_workflow_task",
    "trigger_workflows_for_event_task",
]

