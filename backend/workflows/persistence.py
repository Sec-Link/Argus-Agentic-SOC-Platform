from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, Iterable, List

from django.contrib.auth import get_user_model
from django.db import transaction

from .models import Workflow

User = get_user_model()


DEFAULT_NODE_POSITIONS = {
    'start': (250, 50),
    'condition': (250, 180),
    'action': (250, 320),
    'end': (250, 460),
}


def _coerce_step_id(value: Any) -> str:
    return str(value) if value is not None else ''


def _default_position(node_type: str, order: int) -> tuple[int, int]:
    base_x, base_y = DEFAULT_NODE_POSITIONS.get(node_type or 'action', (250, 180))
    return base_x, base_y + order * 140


def _normalize_step_payload(step: Dict[str, Any], order: int) -> Dict[str, Any]:
    node_type = step.get('node_type') or 'action'
    position_x = step.get('position_x')
    position_y = step.get('position_y')
    if position_x is None or position_y is None:
        default_x, default_y = _default_position(node_type, order)
        position_x = default_x if position_x is None else position_x
        position_y = default_y if position_y is None else position_y

    return {
        'id': step.get('id'),
        'order': int(step.get('order', order)),
        'name': step.get('name') or f'Step {order + 1}',
        'node_type': node_type,
        'node_category': step.get('node_category') or ('control' if node_type in ('start', 'end', 'condition') else 'utility'),
        'position_x': position_x,
        'position_y': position_y,
        'action_type': step.get('action_type') or node_type,
        'action_config': deepcopy(step.get('action_config') or {}),
        'timeout_seconds': int(step.get('timeout_seconds') or 300),
        'on_failure': step.get('on_failure') or 'stop',
        'retry_count': int(step.get('retry_count') or 0),
        'retry_delay_seconds': int(step.get('retry_delay_seconds') or 30),
        'condition': deepcopy(step.get('condition') or {}),
        'next_step_true': step.get('next_step_true'),
        'next_step_false': step.get('next_step_false'),
        'connections': list(step.get('connections') or []),
        'is_active': bool(step.get('is_active', True)),
    }


def build_edges_from_step_payloads(steps: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    step_list = list(steps)
    step_ids = {_coerce_step_id(step.get('id')) for step in step_list if step.get('id')}
    edges: List[Dict[str, Any]] = []

    def add_edge(source: Any, target: Any, source_handle: str | None = None, label: str | None = None) -> None:
        source_id = _coerce_step_id(source)
        target_id = _coerce_step_id(target)
        if not source_id or not target_id:
            return
        if source_id not in step_ids or target_id not in step_ids:
            return
        edges.append({
            'id': f'edge_{source_id}_{target_id}_{len(edges)}',
            'source': source_id,
            'target': target_id,
            'sourceHandle': source_handle,
            'targetHandle': None,
            'label': label,
        })

    for step in step_list:
        source_id = step.get('id')
        if step.get('node_type') == 'condition':
            add_edge(source_id, step.get('next_step_true'), 'true', 'Yes')
            add_edge(source_id, step.get('next_step_false'), 'false', 'No')
        for target in step.get('connections') or []:
            add_edge(source_id, target)

    if not edges and len(step_list) > 1:
        ordered = sorted(step_list, key=lambda item: item.get('order', 0))
        for index in range(len(ordered) - 1):
            add_edge(ordered[index].get('id'), ordered[index + 1].get('id'))

    return edges


@transaction.atomic
def persist_workflow_definition(
    *,
    workflow_definition: Dict[str, Any],
    created_by,
    trigger_type: str,
    trigger_conditions: Dict[str, Any] | None = None,
    schedule_cron: str | None = None,
    is_active: bool = True,
    is_draft: bool = False,
    tags: List[str] | None = None,
    update_existing: bool = True,
) -> Workflow:
    from .serializers import WorkflowCreateSerializer

    name = str(workflow_definition.get('name') or '').strip()
    if not name:
        raise ValueError('workflow_definition.name is required')

    raw_steps = list(workflow_definition.get('steps') or [])
    normalized_steps = [
        _normalize_step_payload(step, index)
        for index, step in enumerate(raw_steps)
    ]
    payload = {
        'name': name,
        'description': workflow_definition.get('description') or '',
        'trigger_type': trigger_type,
        'trigger_conditions': deepcopy(trigger_conditions or {}),
        'schedule_cron': schedule_cron,
        'is_active': bool(is_active),
        'is_draft': bool(is_draft),
        'version': int(workflow_definition.get('version') or 1),
        'tags': list(tags or workflow_definition.get('tags') or []),
        'edges': build_edges_from_step_payloads(normalized_steps),
        'steps': normalized_steps,
        'execution_engine': 'prefect',
    }

    instance = Workflow.objects.filter(name=name).first() if update_existing else None
    serializer = WorkflowCreateSerializer(instance=instance, data=payload)
    serializer.is_valid(raise_exception=True)
    workflow = serializer.save(created_by=created_by) if instance is None else serializer.save()

    workflow.created_by = created_by
    workflow.trigger_conditions = payload['trigger_conditions']
    workflow.schedule_cron = schedule_cron
    workflow.tags = payload['tags']
    workflow.edges = payload['edges']
    workflow.is_active = bool(is_active)
    workflow.is_draft = bool(is_draft)
    workflow.execution_engine = 'prefect'
    workflow.save(
        update_fields=[
            'created_by',
            'trigger_conditions',
            'schedule_cron',
            'tags',
            'edges',
            'is_active',
            'is_draft',
            'execution_engine',
            'updated_at',
        ]
    )

    step_map = {str(step.id): step for step in workflow.steps.all()}
    rebuilt_edges = []
    for step in workflow.steps.all().order_by('order'):
        step_id = str(step.id)
        if step.node_type == 'condition':
            if step.next_step_true and str(step.next_step_true) in step_map:
                rebuilt_edges.append({
                    'id': f'edge_{step_id}_{step.next_step_true}_{len(rebuilt_edges)}',
                    'source': step_id,
                    'target': str(step.next_step_true),
                    'sourceHandle': 'true',
                    'targetHandle': None,
                    'label': 'Yes',
                })
            if step.next_step_false and str(step.next_step_false) in step_map:
                rebuilt_edges.append({
                    'id': f'edge_{step_id}_{step.next_step_false}_{len(rebuilt_edges)}',
                    'source': step_id,
                    'target': str(step.next_step_false),
                    'sourceHandle': 'false',
                    'targetHandle': None,
                    'label': 'No',
                })
        for target in step.connections or []:
            target_id = str(target)
            if target_id in step_map:
                rebuilt_edges.append({
                    'id': f'edge_{step_id}_{target_id}_{len(rebuilt_edges)}',
                    'source': step_id,
                    'target': target_id,
                    'sourceHandle': None,
                    'targetHandle': None,
                    'label': None,
                })

    if rebuilt_edges:
        workflow.edges = rebuilt_edges
        workflow.save(update_fields=['edges', 'updated_at'])

    return workflow
