"""Workflow publisher for versioned and atomic Prefect manifests."""
from __future__ import annotations

import logging
from copy import deepcopy
from datetime import datetime, timezone as dt_timezone
from typing import Any, Dict, Iterable, List
from uuid import UUID

from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from .prefect.actions import ActionRegistry

from .models import Workflow, WorkflowRevision, WorkflowStep
from .persistence import persist_workflow_definition
from .secret_config import (
    SecretConfigError,
    decrypt_sensitive_value,
    is_encrypted,
    prepare_config_for_storage,
    prepare_secret_variables,
    sensitive_fields,
    validate_workflow_secret_references,
)

logger = logging.getLogger(__name__)

def _serialize_step(step: WorkflowStep) -> Dict[str, Any]:
    config: Dict[str, Any] = {}
    if step.action_template and step.action_template.default_config:
        config.update(step.action_template.default_config)
    config.update(step.action_config or {})
    return {
        'id': str(step.id),
        'order': step.order,
        'name': step.name,
        'node_type': step.node_type,
        'node_category': step.node_category,
        'action_type': step.action_type,
        'action_config': config,
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


def serialize_workflow(workflow: Workflow) -> Dict[str, Any]:
    steps = workflow.steps.filter(is_active=True).select_related('action_template').order_by('order')
    return {
        'id': str(workflow.id),
        'name': workflow.name,
        'description': workflow.description,
        'trigger_type': workflow.trigger_type,
        'variables': deepcopy(workflow.variables),
        'secret_variables': deepcopy(workflow.secret_variables),
        'edges': workflow.edges or [],
        'steps': [_serialize_step(step) for step in steps],
    }


def _manifest_filename(version: int) -> str:
    return f'v{version}.json'


def _validate_action_types(steps: Iterable[Dict[str, Any]]) -> None:
    supported = set(ActionRegistry.get_all_actions())
    invalid: List[str] = []
    for step in steps:
        node_type = step.get('node_type')
        action_type = str(step.get('action_type') or '').strip()
        if node_type != 'action':
            continue
        if action_type not in supported:
            invalid.append(f"{step.get('name') or action_type}: {action_type}")
    if invalid:
        joined = '; '.join(invalid)
        raise ValueError(f'Unsupported workflow action types: {joined}')


def _validate_action_configs(steps: Iterable[Dict[str, Any]]) -> None:
    invalid: List[str] = []
    for step in steps:
        if step.get('node_type') != 'action':
            continue
        action_type = str(step.get('action_type') or '').strip()
        config = step.get('action_config') or {}
        try:
            # Validation only: reuse stored ciphertext without decrypting values
            # into the manifest or changing the database configuration.
            prepare_config_for_storage(
                action_type,
                {},
                existing=config,
                require_sensitive=True,
            )
        except SecretConfigError as exc:
            detail = '; '.join(str(message) for message in exc.messages)
            invalid.append(f"{step.get('name') or action_type}: {detail}")

    if invalid:
        raise ValueError(
            'Workflow action configuration is incomplete: ' + '; '.join(invalid)
        )


def _build_manifest_record(workflow: Workflow, version: int) -> Dict[str, Any]:
    payload = serialize_workflow(workflow)
    payload['trigger_conditions'] = workflow.trigger_conditions or {}
    payload['_meta'] = {
        'published_at': datetime.now(dt_timezone.utc).isoformat(),
        'workflow_db_id': str(workflow.id),
        'version': version,
        'execution_engine': 'prefect',
        'trigger_type': workflow.trigger_type,
        'trigger_conditions': workflow.trigger_conditions or {},
        'schedule_cron': workflow.schedule_cron or None,
        'tags': list(workflow.tags or []),
        'manifest_filename': _manifest_filename(version),
        'workflow_name': workflow.name,
    }
    return payload


def resolve_manifest_metadata(workflow: Workflow) -> Dict[str, Any]:
    revision = workflow.published_revision
    if revision is None:
        raise FileNotFoundError(f'Published manifest pointer not found for workflow {workflow.id}')
    if revision.workflow_id != workflow.id:
        raise ValueError('Published manifest pointer belongs to another workflow.')
    if revision.version < 1:
        raise ValueError('Published manifest version is invalid.')
    return {
        'workflow_id': str(workflow.id),
        'workflow_name': workflow.name,
        'current_version': revision.version,
        'manifest_filename': _manifest_filename(revision.version),
        'published_at': revision.published_at.isoformat(),
    }


def load_current_published_manifest(workflow: Workflow) -> tuple[Dict[str, Any], Dict[str, Any]]:
    """Load and validate the manifest selected by a workflow's current pointer."""
    pointer = resolve_manifest_metadata(workflow)
    manifest = _validate_published_manifest(
        workflow, pointer['current_version'], deepcopy(workflow.published_revision.manifest),
    )
    pointer['workflow_name'] = manifest.get('name', workflow.name)
    return pointer, manifest


def get_published_state(workflow: Workflow) -> Dict[str, Any]:
    try:
        pointer = resolve_manifest_metadata(workflow)
    except (FileNotFoundError, TypeError, ValueError):
        return {
            'published_version': None,
            'published_at': None,
            'has_unpublished_changes': bool(workflow.is_draft),
        }

    return {
        'published_version': pointer.get('current_version'),
        'published_at': pointer.get('published_at'),
        'has_unpublished_changes': bool(workflow.is_draft),
    }


def build_published_export(workflow: Workflow) -> tuple[Dict[str, Any], Dict[str, Any]]:
    """Return the last published manifest, including encrypted secret values."""
    pointer, manifest = load_current_published_manifest(workflow)
    exported = deepcopy(manifest)
    meta = exported.setdefault('_meta', {})
    meta['export_source'] = 'last_published_manifest'
    meta['contains_encrypted_sensitive_values'] = True
    return exported, pointer


def _next_publish_version(workflow: Workflow) -> int:
    latest = WorkflowRevision.objects.filter(workflow=workflow).aggregate(version=Max('version'))['version']
    if latest is not None:
        return max(int(workflow.version or 1), latest) + 1
    return max(int(workflow.version or 1), 1)


def load_manifest_definition(workflow: Workflow, version: int) -> Dict[str, Any]:
    try:
        return WorkflowRevision.objects.values_list('manifest', flat=True).get(
            workflow=workflow, version=version,
        )
    except WorkflowRevision.DoesNotExist as exc:
        raise FileNotFoundError(f'Published manifest not found: {_manifest_filename(version)}') from exc


def _validate_published_manifest(
    workflow: Workflow,
    version: int,
    manifest: Dict[str, Any],
) -> Dict[str, Any]:
    """Validate the identity and executable structure of one manifest."""
    if not isinstance(manifest, dict):
        raise ValueError('Published workflow manifest must be an object.')
    meta = manifest.get('_meta')
    if not isinstance(meta, dict):
        raise ValueError('Published workflow manifest metadata is invalid.')
    if str(manifest.get('id') or '') != str(workflow.id) or str(meta.get('workflow_db_id') or '') != str(workflow.id):
        raise ValueError('Published workflow manifest belongs to another workflow.')
    try:
        manifest_version = int(meta.get('version') or 0)
    except (TypeError, ValueError) as exc:
        raise ValueError('Published workflow manifest version is invalid.') from exc
    if manifest_version != version:
        raise ValueError('Published workflow manifest version does not match the requested version.')
    if str(meta.get('manifest_filename') or '') != _manifest_filename(version):
        raise ValueError('Published workflow manifest filename does not match its version.')

    steps = manifest.get('steps')
    if not isinstance(steps, list):
        raise ValueError('Published workflow manifest steps must be a list.')
    step_ids = set()
    validated_steps = []
    node_types = {choice[0] for choice in WorkflowStep.NODE_TYPE_CHOICES}
    failure_modes = {choice[0] for choice in WorkflowStep.ON_FAILURE_CHOICES}
    for step in steps:
        if not isinstance(step, dict):
            raise ValueError('Published workflow manifest contains an invalid step.')
        try:
            step_id = str(UUID(str(step.get('id') or '')))
        except (ValueError, TypeError, AttributeError) as exc:
            raise ValueError('Published workflow manifest contains an invalid step ID.') from exc
        if step_id in step_ids:
            raise ValueError(f'Published workflow manifest contains duplicate step ID {step_id}.')
        step_ids.add(step_id)
        if not isinstance(step.get('name'), str):
            raise ValueError(f'Published workflow step {step_id} has an invalid name.')
        order = step.get('order')
        if isinstance(order, bool) or not isinstance(order, int) or order < 0:
            raise ValueError(f'Published workflow step {step_id} has an invalid order.')
        node_type = step.get('node_type')
        if node_type not in node_types:
            raise ValueError(f'Published workflow step {step_id} has an invalid node type.')
        action_type = step.get('action_type')
        if not isinstance(action_type, str) or (node_type == 'action' and not action_type.strip()):
            raise ValueError(f'Published workflow step {step_id} has an invalid action type.')
        if not isinstance(step.get('node_category'), str):
            raise ValueError(f'Published workflow step {step_id} has an invalid node category.')
        if not isinstance(step.get('action_config'), dict):
            raise ValueError(f'Published workflow step {step_id} has an invalid action config.')
        if not isinstance(step.get('condition'), dict):
            raise ValueError(f'Published workflow step {step_id} has an invalid condition.')
        if not isinstance(step.get('connections'), list):
            raise ValueError(f'Published workflow step {step_id} has invalid connections.')
        if step.get('on_failure') not in failure_modes:
            raise ValueError(f'Published workflow step {step_id} has an invalid failure mode.')
        for field in ('timeout_seconds', 'retry_count', 'retry_delay_seconds'):
            value = step.get(field)
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise ValueError(f'Published workflow step {step_id} has an invalid {field}.')
        if not isinstance(step.get('is_active'), bool):
            raise ValueError(f'Published workflow step {step_id} has an invalid active flag.')
        validated_steps.append((step_id, step))

    for step_id, step in validated_steps:
        targets = list(step['connections'])
        targets.extend(
            step.get(field)
            for field in ('next_step_true', 'next_step_false')
            if step.get(field) is not None
        )
        for target in targets:
            try:
                target_id = str(UUID(str(target)))
            except (ValueError, TypeError, AttributeError) as exc:
                raise ValueError(f'Published workflow step {step_id} has an invalid target step ID.') from exc
            if target_id not in step_ids:
                raise ValueError(
                    f'Published workflow step {step_id} references missing step {target_id}.'
                )
    try:
        secrets = prepare_secret_variables(manifest.get('secret_variables', {}), encrypted_only=True)
        validate_workflow_secret_references(manifest.get('variables', {}), secrets, steps)
    except SecretConfigError as exc:
        raise ValueError('Workflow secret variables or references are invalid: ' + '; '.join(exc.messages)) from exc
    return manifest


def load_published_manifest(workflow: Workflow, version: int) -> Dict[str, Any]:
    """Load one immutable workflow version and validate its execution identity."""
    try:
        version = int(version)
    except (TypeError, ValueError) as exc:
        raise ValueError('Published manifest version is invalid.') from exc
    if version < 1:
        raise ValueError('Published manifest version is invalid.')
    return _validate_published_manifest(
        workflow,
        version,
        load_manifest_definition(workflow, version),
    )


@transaction.atomic
def publish_workflow(
    workflow: Workflow,
    *,
    register_deployment: bool = True,
) -> Dict[str, Any]:
    locked = Workflow.objects.select_for_update().get(pk=workflow.pk)
    publish_version = _next_publish_version(locked)
    manifest = _build_manifest_record(locked, publish_version)
    _validate_action_types(manifest['steps'])
    _validate_action_configs(manifest['steps'])
    _validate_published_manifest(locked, publish_version, manifest)
    published_at = manifest['_meta']['published_at']
    revision = WorkflowRevision.objects.create(
        workflow=locked, version=publish_version, manifest=manifest,
        published_at=datetime.fromisoformat(published_at),
    )
    Workflow.objects.filter(pk=locked.pk).update(
        version=publish_version, execution_engine='prefect', is_draft=False,
        published_revision=revision, updated_at=timezone.now(),
    )
    locked.schedules.update(sync_status='pending', last_error='')
    workflow.refresh_from_db()

    logger.info('Published workflow "%s" (id=%s) version %s', workflow.name, workflow.id, publish_version)
    manifest_filename = _manifest_filename(publish_version)
    return {
        'slug': str(workflow.id),
        'manifest_ref': f'{workflow.id}/{manifest_filename}',
        'manifest_path': '',
        'manifest_version': publish_version,
        'manifest_filename': manifest_filename,
        'published_at': published_at,
        'steps_count': len(manifest['steps']),
        'deployment_registered': False,
        'deployment_id': workflow.prefect_deployment_id or None,
    }


def import_workflow_from_json_payload(
    payload: Dict[str, Any],
    *,
    created_by,
    update_existing: bool = True,
    import_report: Dict[str, Any] | None = None,
) -> Workflow:
    payload = deepcopy(payload)
    removed_secret_fields: List[Dict[str, Any]] = []
    for step in payload.get('steps') or []:
        if not isinstance(step, dict):
            continue
        action_type = str(step.get('action_type') or '').strip()
        config = step.get('action_config')
        if not isinstance(config, dict):
            continue

        original_config = deepcopy(config)
        invalid_fields: List[str] = []
        for field in sensitive_fields(action_type):
            value = original_config.get(field)
            if not is_encrypted(value):
                continue
            try:
                decrypt_sensitive_value(
                    action_type,
                    field,
                    value,
                    original_config,
                )
            except SecretConfigError:
                invalid_fields.append(field)

        for field in invalid_fields:
            config.pop(field, None)
        if invalid_fields:
            removed_secret_fields.append({
                'step_name': str(step.get('name') or action_type or 'Unnamed step'),
                'action_type': action_type,
                'fields': sorted(invalid_fields),
            })

    if import_report is not None:
        import_report['removed_secret_fields'] = removed_secret_fields

    meta = payload.get('_meta', {})
    trigger_type = meta.get('trigger_type') or payload.get('trigger_type', 'manual')
    trigger_conditions = meta.get('trigger_conditions') or payload.get('trigger_conditions') or {}
    schedule_cron = meta.get('schedule_cron')
    tags = meta.get('tags') or payload.get('tags', [])

    workflow = persist_workflow_definition(
        workflow_definition=payload,
        created_by=created_by,
        trigger_type=trigger_type,
        trigger_conditions=trigger_conditions,
        schedule_cron=schedule_cron,
        is_active=False,
        is_draft=True,
        tags=tags,
        update_existing=update_existing,
        require_sensitive=False,
        preserve_existing_secrets=False,
    )
    logger.info('Imported workflow "%s" (id=%s) as an inactive draft', workflow.name, workflow.id)
    return workflow
