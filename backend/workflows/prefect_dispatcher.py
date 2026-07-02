"""
Prefect dispatcher: bridge between Django ``WorkflowExecution`` records and
Prefect flow runs.
"""
from __future__ import annotations

import logging
from typing import Any, Dict

from django.utils import timezone

from .models import StepExecution, Workflow, WorkflowExecution, WorkflowStep
from . import prefect_client

logger = logging.getLogger(__name__)


def _serialize_step(step: WorkflowStep) -> Dict[str, Any]:
    return {
        'id': str(step.id),
        'order': step.order,
        'name': step.name,
        'node_type': step.node_type,
        'node_category': step.node_category,
        'action_type': step.action_type,
        'action_config': step.action_config or {},
        'timeout_seconds': step.timeout_seconds,
        'on_failure': step.on_failure,
        'retry_count': step.retry_count,
        'retry_delay_seconds': step.retry_delay_seconds,
        'condition': step.condition or {},
        'next_step_true': str(step.next_step_true) if step.next_step_true else None,
        'next_step_false': str(step.next_step_false) if step.next_step_false else None,
        'connections': list(step.connections or []),
        'is_active': step.is_active,
    }


def _serialize_workflow(workflow: Workflow) -> Dict[str, Any]:
    steps = list(workflow.steps.filter(is_active=True).order_by('order'))
    return {
        'id': str(workflow.id),
        'name': workflow.name,
        'description': workflow.description,
        'trigger_type': workflow.trigger_type,
        'edges': workflow.edges or [],
        'steps': [_serialize_step(step) for step in steps],
    }


def submit(execution: WorkflowExecution) -> WorkflowExecution:
    from .publisher import load_manifest_definition_by_ref, resolve_manifest_metadata

    try:
        pointer = resolve_manifest_metadata(execution.workflow)
        manifest_filename = str(pointer.get('manifest_filename') or '').strip()
        manifest_version = int(pointer.get('current_version') or 0)
        manifest_ref = f"{execution.workflow.id}/{manifest_filename}"
        manifest_definition = load_manifest_definition_by_ref(manifest_ref)
    except (OSError, ValueError, TypeError, KeyError) as exc:
        logger.exception('Failed to resolve published manifest for workflow %s', execution.workflow.id)
        execution.status = 'failed'
        execution.error_message = f'Published manifest unavailable: {exc}'
        execution.completed_at = timezone.now()
        execution.save(update_fields=['status', 'error_message', 'completed_at'])
        return execution

    parameters = {
        'manifest_ref': manifest_ref,
        'execution_id': str(execution.id),
        'trigger_data': execution.trigger_data or {},
        'trigger_source': execution.trigger_source or 'manual',
    }
    flow_run_name = f"{execution.workflow.name} :: {execution.id}"
    deployment_id = (execution.workflow.prefect_deployment_id or '').strip() or None

    try:
        result = prefect_client.create_flow_run(
            parameters=parameters,
            name=flow_run_name,
            tags=['soar', f'workflow:{execution.workflow.id}'],
            deployment_id=deployment_id,
        )
    except prefect_client.PrefectAPIError as exc:
        logger.exception('Prefect rejected flow run for execution %s', execution.id)
        execution.status = 'failed'
        execution.error_message = f'Prefect dispatch failed: {exc}'
        execution.completed_at = timezone.now()
        execution.save(update_fields=['status', 'error_message', 'completed_at'])
        return execution

    execution.task_result_id = str(result.get('id') or '')
    execution.status = 'running'
    execution.started_at = execution.started_at or timezone.now()
    execution.total_steps = len(manifest_definition.get('steps', []) or [])
    execution.context = {
        **(execution.context or {}),
        'manifest_ref': manifest_ref,
        'manifest_version': manifest_version,
        'published_at': pointer.get('published_at'),
    }
    execution.save(update_fields=['task_result_id', 'status', 'started_at', 'total_steps', 'context'])
    logger.info('Submitted Prefect flow run %s for workflow execution %s', execution.task_result_id, execution.id)
    return execution


def cancel(execution: WorkflowExecution) -> WorkflowExecution:
    """Forward a cancellation request to Prefect for the backing flow run.

    The caller is responsible for updating the local ``WorkflowExecution``
    row; this only propagates intent to Prefect. Idempotent when the flow run
    is already terminal.
    """
    if not execution.task_result_id:
        return execution
    prefect_client.cancel_flow_run(execution.task_result_id)
    logger.info('Requested Prefect cancel for flow run %s (execution %s)', execution.task_result_id, execution.id)
    return execution



def sync_status(execution: WorkflowExecution) -> WorkflowExecution:
    if not execution.task_result_id:
        return execution
    if execution.status in prefect_client.TERMINAL_STATUSES:
        return execution

    try:
        flow_run = prefect_client.get_flow_run(execution.task_result_id)
    except prefect_client.PrefectAPIError as exc:
        logger.warning('Prefect sync failed for execution %s: %s', execution.id, exc)
        return execution

    state = flow_run.get('state') or {}
    state_type = state.get('type') or flow_run.get('state_type')
    new_status = prefect_client.map_state_to_status(state_type)

    update_fields = []
    if execution.status != new_status:
        execution.status = new_status
        update_fields.append('status')

    started = flow_run.get('start_time')
    if started and not execution.started_at:
        from django.utils.dateparse import parse_datetime
        parsed = parse_datetime(started)
        if parsed:
            execution.started_at = parsed
            update_fields.append('started_at')

    if new_status in prefect_client.TERMINAL_STATUSES:
        ended = flow_run.get('end_time')
        if ended:
            from django.utils.dateparse import parse_datetime
            parsed = parse_datetime(ended)
            if parsed:
                execution.completed_at = parsed
                update_fields.append('completed_at')
        elif not execution.completed_at:
            execution.completed_at = timezone.now()
            update_fields.append('completed_at')

        if new_status == 'failed':
            message = state.get('message') or flow_run.get('state_name') or ''
            if message and not execution.error_message:
                execution.error_message = str(message)[:5000]
                update_fields.append('error_message')

    if update_fields:
        execution.save(update_fields=list(set(update_fields)))

    _sync_step_executions(execution, flow_run)
    return execution


def _sync_step_executions(execution: WorkflowExecution, flow_run: Dict[str, Any]) -> None:
    payload: Dict[str, Any] = {}
    for key in ('result', 'parameters'):
        candidate = flow_run.get(key)
        if isinstance(candidate, dict) and 'step_results' in candidate:
            payload = candidate
            break

    step_results = payload.get('step_results')
    if not isinstance(step_results, list):
        return

    completed_count = 0
    for entry in step_results:
        if not isinstance(entry, dict):
            continue
        step_id = entry.get('step_id')
        if not step_id:
            continue
        try:
            step = WorkflowStep.objects.get(id=step_id, workflow=execution.workflow)
        except WorkflowStep.DoesNotExist:
            continue

        defaults = {
            'status': entry.get('status') or 'completed',
            'attempt_number': int(entry.get('attempt_number') or 1),
            'output_data': entry.get('output_data') or {},
            'input_data': entry.get('input_data') or {},
            'error_message': entry.get('error_message') or '',
            'logs': entry.get('logs') or '',
            'completed_at': timezone.now(),
        }
        StepExecution.objects.update_or_create(
            workflow_execution=execution,
            step=step,
            defaults=defaults,
        )
        if defaults['status'] in ('completed', 'skipped'):
            completed_count += 1

    if completed_count:
        execution.completed_steps = completed_count
        execution.update_progress()
        execution.save(update_fields=['completed_steps', 'progress_percent'])
