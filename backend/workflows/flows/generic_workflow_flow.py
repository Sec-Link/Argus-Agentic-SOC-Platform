"""
Generic Prefect flow for dynamic SOAR workflows.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List
import json
import os
import sys

from prefect import flow, get_run_logger

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'siem_project.settings')

import django

django.setup()

from django.utils import timezone

from workflows.condition_evaluator import evaluate_condition_object, resolve_context_path
from workflows.models import StepExecution, WorkflowExecution, WorkflowStep
from workflows.tasks import (
    block_ip_task,
    create_ticket_task,
    delay_task,
    disable_user_task,
    enable_user_task,
    hash_lookup_task,
    ip_lookup_task,
    log_task,
    release_ip_task,
    send_email_task,
    send_notification_task,
    send_webhook_task,
    update_ticket_task,
)

MANIFESTS_DIR = Path(__file__).resolve().parent / 'generated'


def _load_manifest_definition_by_ref(manifest_ref: str) -> Dict[str, Any]:
    manifest_path = MANIFESTS_DIR / manifest_ref
    with open(manifest_path, 'r', encoding='utf-8') as handle:
        return json.load(handle)



ACTION_TASKS = {
    'log': log_task,
    'delay': delay_task,
    'send_email': send_email_task,
    'send_webhook': send_webhook_task,
    'send_notification': send_notification_task,
    'create_ticket': create_ticket_task,
    'update_ticket': update_ticket_task,
    'ip_lookup': ip_lookup_task,
    'hash_lookup': hash_lookup_task,
    'block_ip': block_ip_task,
    'disable_user': disable_user_task,
    'release_ip': release_ip_task,
    'enable_user': enable_user_task,
}


def _next_by_order(ordered_steps: List[Dict[str, Any]], order_index: Dict[str, int], step_id: str) -> str | None:
    idx = order_index.get(step_id)
    if idx is None:
        return None
    if idx + 1 < len(ordered_steps):
        return str(ordered_steps[idx + 1].get('id'))
    return None


def _next_step_id(
    ordered_steps: List[Dict[str, Any]],
    order_index: Dict[str, int],
    step: Dict[str, Any],
    condition_result: bool | None = None,
) -> str | None:
    if step.get('node_type') == 'condition':
        if condition_result is True and step.get('next_step_true'):
            return str(step.get('next_step_true'))
        if condition_result is False and step.get('next_step_false'):
            return str(step.get('next_step_false'))
    connections = step.get('connections') or []
    if connections:
        return str(connections[0])
    return _next_by_order(ordered_steps, order_index, str(step.get('id')))


def _configured_action_task(action_task: Any, step: Dict[str, Any]) -> Any:
    timeout_seconds = int(step.get('timeout_seconds') or 0) or None
    retry_count = max(int(step.get('retry_count') or 0), 0)
    retry_delay_seconds = max(int(step.get('retry_delay_seconds') or 0), 0)
    return action_task.with_options(
        timeout_seconds=timeout_seconds,
        retries=retry_count,
        retry_delay_seconds=retry_delay_seconds,
    )


def _update_context_after_step(
    context: Dict[str, Any],
    step_id: Any,
    success: bool,
    output_data: Dict[str, Any],
) -> None:
    context['step_results'][step_id] = output_data
    if isinstance(output_data, dict):
        context['variables'].update(output_data)
    context['previous_step'] = {
        'step_id': str(step_id),
        'success': success,
        'output': output_data,
    }


def _mark_execution_running(
    execution_id: str,
    *,
    total_steps: int,
    context: Dict[str, Any],
) -> None:
    """Keep the Argus execution row authoritative while Prefect runs it."""
    execution = WorkflowExecution.objects.get(id=execution_id)
    execution.status = 'running'
    execution.started_at = execution.started_at or timezone.now()
    execution.completed_at = None
    execution.error_message = ''
    execution.total_steps = total_steps
    execution.context = context
    execution.save(update_fields=[
        'status', 'started_at', 'completed_at', 'error_message',
        'total_steps', 'context', 'updated_at',
    ])


def _persist_step_result(
    execution_id: str,
    entry: Dict[str, Any],
    *,
    context: Dict[str, Any],
    current_step: int,
) -> None:
    """Write one Prefect step result back to Django immediately."""
    execution = WorkflowExecution.objects.select_related('workflow').get(id=execution_id)
    try:
        step = WorkflowStep.objects.get(
            id=entry.get('step_id'),
            workflow=execution.workflow,
        )
    except (WorkflowStep.DoesNotExist, ValueError, TypeError):
        return

    now = timezone.now()
    StepExecution.objects.update_or_create(
        workflow_execution=execution,
        step=step,
        defaults={
            'status': entry.get('status') or 'completed',
            'attempt_number': max(int(entry.get('attempt_number') or 1), 1),
            'started_at': now,
            'completed_at': now,
            'input_data': entry.get('input_data') or {},
            'output_data': entry.get('output_data') or {},
            'error_message': entry.get('error_message') or '',
            'logs': entry.get('logs') or '',
        },
    )

    processed_count = execution.step_executions.filter(
        status__in=('completed', 'failed', 'skipped', 'cancelled'),
    ).count()
    execution.current_step = max(current_step, 0)
    execution.completed_steps = min(processed_count, execution.total_steps)
    execution.update_progress()
    execution.context = context
    execution.save(update_fields=[
        'current_step', 'completed_steps', 'progress_percent', 'context', 'updated_at',
    ])


def _mark_execution_finished(
    execution_id: str,
    *,
    status: str,
    results: List[Dict[str, Any]],
    context: Dict[str, Any],
    error: str = '',
) -> Dict[str, Any]:
    payload = {
        'execution_id': execution_id,
        'status': status,
        'step_results': results,
    }
    if error:
        payload['error'] = error

    execution = WorkflowExecution.objects.get(id=execution_id)
    execution.status = status
    execution.completed_at = timezone.now()
    execution.error_message = error
    execution.context = context
    execution.result_data = payload
    if status == 'completed':
        execution.completed_steps = execution.total_steps
        execution.progress_percent = 100.0 if execution.total_steps else 0.0
    execution.save(update_fields=[
        'status', 'completed_at', 'error_message', 'context', 'result_data',
        'completed_steps', 'progress_percent', 'updated_at',
    ])
    return payload


def _fail_execution(
    execution_id: str,
    *,
    results: List[Dict[str, Any]],
    context: Dict[str, Any],
    error: str,
) -> None:
    """Persist a business failure and make Prefect report a FAILED run."""
    _mark_execution_finished(
        execution_id,
        status='failed',
        results=results,
        context=context,
        error=error,
    )
    raise RuntimeError(error)


@flow(name='soar-generic')
def run_soar_workflow(
    manifest_ref: str,
    execution_id: str,
    trigger_data: Dict[str, Any] | None = None,
    trigger_source: str = 'manual',
) -> Dict[str, Any]:
    workflow_definition = _load_manifest_definition_by_ref(manifest_ref)
    logger = get_run_logger()
    logger.info(
        'Running SOAR workflow %s (execution %s)',
        workflow_definition.get('name'),
        execution_id,
    )

    trigger_payload = trigger_data or {}
    context: Dict[str, Any] = {
        'trigger_data': trigger_payload,
        'trigger_source': trigger_source,
        'execution_id': execution_id,
        'workflow_id': workflow_definition.get('id'),
        'workflow_name': workflow_definition.get('name'),
        'manifest_ref': manifest_ref,
        'variables': {},
        'step_results': {},
        'previous_step': {},
        'ticket': trigger_payload if isinstance(trigger_payload, dict) else {},
    }

    steps = list(workflow_definition.get('steps', []) or [])
    _mark_execution_running(execution_id, total_steps=len(steps), context=context)
    if not steps:
        return _mark_execution_finished(
            execution_id,
            status='completed',
            results=[],
            context=context,
        )

    steps_by_id = {str(step.get('id')): step for step in steps if step.get('id')}
    ordered_steps = sorted(steps, key=lambda item: item.get('order', 0))
    order_index = {str(step.get('id')): idx for idx, step in enumerate(ordered_steps) if step.get('id')}

    start_step = next((step for step in ordered_steps if step.get('node_type') == 'start'), None)
    current_step_id = str(start_step.get('id')) if start_step and start_step.get('id') else str(ordered_steps[0].get('id'))

    results: List[Dict[str, Any]] = []
    max_iterations = max(len(ordered_steps) * 5, 1)
    iterations = 0

    while current_step_id:
        iterations += 1
        if iterations > max_iterations:
            _fail_execution(
                execution_id,
                results=results,
                context=context,
                error='Workflow exceeded max iteration limit; possible loop in graph.',
            )

        step = steps_by_id.get(str(current_step_id))
        if not step:
            _fail_execution(
                execution_id,
                results=results,
                context=context,
                error=f'Workflow references missing step: {current_step_id}',
            )

        node_type = step.get('node_type')
        if node_type in ('start', 'end'):
            step_result = {
                'step_id': step.get('id'),
                'status': 'skipped',
                'attempt_number': 1,
                'input_data': {},
                'output_data': {},
                'error_message': '',
                'logs': f'skipped {node_type} node',
            }
            results.append(step_result)
            _persist_step_result(
                execution_id,
                step_result,
                context=context,
                current_step=iterations - 1,
            )
            if node_type == 'end':
                break
            current_step_id = _next_step_id(ordered_steps, order_index, step)
            continue

        if node_type == 'condition':
            try:
                condition_result = evaluate_condition_object(
                    step.get('condition') or {},
                    lambda path: resolve_context_path(context, path),
                    context,
                )
                output_data = {'condition_matched': condition_result}
                step_result = {
                    'step_id': step.get('id'),
                    'status': 'completed',
                    'attempt_number': 1,
                    'input_data': step.get('condition') or {},
                    'output_data': output_data,
                    'error_message': '',
                    'logs': f'Condition evaluated: {condition_result}',
                }
                _update_context_after_step(context, step.get('id'), True, output_data)
            except Exception as exc:
                condition_result = False
                step_result = {
                    'step_id': step.get('id'),
                    'status': 'failed',
                    'attempt_number': 1,
                    'input_data': step.get('condition') or {},
                    'output_data': {},
                    'error_message': str(exc),
                    'logs': f'Condition evaluation failed: {exc}',
                }
                _update_context_after_step(context, step.get('id'), False, {})

            results.append(step_result)
            _persist_step_result(
                execution_id,
                step_result,
                context=context,
                current_step=iterations - 1,
            )
            if step_result.get('status') == 'failed' and step.get('on_failure') == 'stop':
                _fail_execution(
                    execution_id,
                    results=results,
                    context=context,
                    error=step_result.get('error_message') or f"Condition step '{step.get('name')}' failed.",
                )

            current_step_id = _next_step_id(ordered_steps, order_index, step, condition_result=condition_result)
            continue

        action_type = step.get('action_type')
        action_task = ACTION_TASKS.get(action_type)
        if not action_task:
            step_result = {
                'step_id': step.get('id'),
                'status': 'failed',
                'attempt_number': 1,
                'input_data': step.get('action_config') or {},
                'output_data': {},
                'error_message': f'Unknown action type: {action_type}',
                'logs': 'No task mapped for action type',
            }
            results.append(step_result)
            _update_context_after_step(context, step.get('id'), False, {})
            _persist_step_result(
                execution_id,
                step_result,
                context=context,
                current_step=iterations - 1,
            )
            if step.get('on_failure') == 'stop':
                _fail_execution(
                    execution_id,
                    results=results,
                    context=context,
                    error=step_result['error_message'],
                )
            current_step_id = _next_step_id(ordered_steps, order_index, step)
            continue

        configured_task = _configured_action_task(action_task, step)
        try:
            action_result = configured_task(step.get('action_config') or {}, context)
        except Exception as exc:
            action_result = {
                'success': False,
                'data': {},
                'error': str(exc),
                'logs': f'Task execution failed: {exc}',
            }

        output_data = action_result.get('data', {}) if isinstance(action_result, dict) else {}
        success = bool(action_result.get('success', True)) if isinstance(action_result, dict) else True
        attempt_number = 1

        step_result = {
            'step_id': step.get('id'),
            'status': 'completed' if success else 'failed',
            'attempt_number': attempt_number,
            'input_data': step.get('action_config') or {},
            'output_data': output_data,
            'error_message': action_result.get('error', '') if isinstance(action_result, dict) else '',
            'logs': action_result.get('logs', '') if isinstance(action_result, dict) else '',
        }
        results.append(step_result)
        _update_context_after_step(context, step.get('id'), success, output_data)
        _persist_step_result(
            execution_id,
            step_result,
            context=context,
            current_step=iterations - 1,
        )

        if success is False and step.get('on_failure') == 'stop':
            _fail_execution(
                execution_id,
                results=results,
                context=context,
                error=step_result.get('error_message') or f"Action step '{step.get('name')}' failed.",
            )

        current_step_id = _next_step_id(ordered_steps, order_index, step)

    return _mark_execution_finished(
        execution_id,
        status='completed',
        results=results,
        context=context,
    )
