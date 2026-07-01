"""Workflow publisher for versioned and atomic Prefect manifests."""
from __future__ import annotations

import json
import logging
import os
import tempfile
from datetime import datetime, timezone as dt_timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List

from .models import Workflow
from .persistence import persist_workflow_definition
from .prefect_dispatcher import _serialize_workflow
from .flows.generic_workflow_flow import ACTION_TASKS

logger = logging.getLogger(__name__)

GENERATED_FLOWS_DIR = Path(__file__).resolve().parent / 'flows' / 'generated'
CURRENT_POINTER_FILENAME = 'current.json'


def _workflow_dir(workflow: Workflow) -> Path:
    return GENERATED_FLOWS_DIR / str(workflow.id)


def _manifest_filename(version: int) -> str:
    return f'v{version}.json'


def _atomic_write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix=path.stem + '.', suffix='.tmp', dir=str(path.parent))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False, default=str)
        os.replace(temp_path, path)
    except Exception:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        raise


def _active_steps(workflow: Workflow) -> List[Dict[str, Any]]:
    return list((_serialize_workflow(workflow).get('steps') or []))


def _validate_action_types(steps: Iterable[Dict[str, Any]]) -> None:
    supported = set(ACTION_TASKS.keys())
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


def _build_manifest_record(workflow: Workflow, version: int) -> Dict[str, Any]:
    payload = _serialize_workflow(workflow)
    payload['trigger_conditions'] = workflow.trigger_conditions or {}
    payload['_meta'] = {
        'published_at': datetime.now(dt_timezone.utc).isoformat(),
        'workflow_db_id': str(workflow.id),
        'version': version,
        'execution_engine': workflow.execution_engine,
        'trigger_type': workflow.trigger_type,
        'trigger_conditions': workflow.trigger_conditions or {},
        'schedule_cron': workflow.schedule_cron or None,
        'tags': list(workflow.tags or []),
        'manifest_filename': _manifest_filename(version),
        'workflow_name': workflow.name,
    }
    return payload


def _current_pointer_payload(workflow: Workflow, version: int, published_at: str) -> Dict[str, Any]:
    return {
        'workflow_id': str(workflow.id),
        'workflow_name': workflow.name,
        'current_version': version,
        'manifest_filename': _manifest_filename(version),
        'published_at': published_at,
    }


def _manifest_path_for_version(workflow: Workflow, version: int) -> Path:
    return _workflow_dir(workflow) / _manifest_filename(version)


def _current_pointer_path(workflow: Workflow) -> Path:
    return _workflow_dir(workflow) / CURRENT_POINTER_FILENAME


def resolve_manifest_metadata(workflow: Workflow) -> Dict[str, Any]:
    pointer_path = _current_pointer_path(workflow)
    if not pointer_path.exists():
        raise FileNotFoundError(f'Published manifest pointer not found for workflow {workflow.id}')
    with open(pointer_path, 'r', encoding='utf-8') as handle:
        return json.load(handle)


def get_published_state(workflow: Workflow) -> Dict[str, Any]:
    try:
        pointer = resolve_manifest_metadata(workflow)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
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


def _next_publish_version(workflow: Workflow) -> int:
    try:
        pointer = resolve_manifest_metadata(workflow)
        return int(pointer.get('current_version') or 0) + 1
    except (FileNotFoundError, json.JSONDecodeError, OSError, TypeError, ValueError):
        return max(int(workflow.version or 1), 1)


def load_manifest_definition(workflow: Workflow, version: int) -> Dict[str, Any]:
    manifest_path = _manifest_path_for_version(workflow, version)
    if not manifest_path.exists():
        raise FileNotFoundError(f'Published manifest not found: {manifest_path.name}')
    with open(manifest_path, 'r', encoding='utf-8') as handle:
        return json.load(handle)


def load_manifest_definition_by_ref(manifest_ref: str) -> Dict[str, Any]:
    manifest_path = GENERATED_FLOWS_DIR / manifest_ref
    if not manifest_path.exists():
        raise FileNotFoundError(f'Published manifest not found: {manifest_ref}')
    with open(manifest_path, 'r', encoding='utf-8') as handle:
        return json.load(handle)


def publish_workflow(
    workflow: Workflow,
    *,
    register_deployment: bool = True,
) -> Dict[str, Any]:
    active_steps = _active_steps(workflow)
    _validate_action_types(active_steps)

    publish_version = _next_publish_version(workflow)
    manifest = _build_manifest_record(workflow, publish_version)
    manifest_path = _manifest_path_for_version(workflow, publish_version)
    pointer_path = _current_pointer_path(workflow)
    published_at = manifest['_meta']['published_at']

    _atomic_write_json(manifest_path, manifest)
    _atomic_write_json(pointer_path, _current_pointer_payload(workflow, publish_version, published_at))

    workflow.version = publish_version
    workflow.execution_engine = 'prefect'
    workflow.is_draft = False
    workflow.save(update_fields=['version', 'execution_engine', 'is_draft', 'updated_at'])

    logger.info('Published workflow "%s" (id=%s) version %s to %s', workflow.name, workflow.id, publish_version, manifest_path)
    return {
        'slug': str(workflow.id),
        'manifest_ref': f'{workflow.id}/{manifest_path.name}',
        'manifest_path': str(manifest_path),
        'manifest_version': publish_version,
        'manifest_filename': manifest_path.name,
        'published_at': published_at,
        'steps_count': len(active_steps),
        'deployment_registered': False,
        'deployment_id': workflow.prefect_deployment_id or None,
    }


def list_published_manifests() -> List[Dict[str, Any]]:
    if not GENERATED_FLOWS_DIR.exists():
        return []

    manifests: List[Dict[str, Any]] = []
    for pointer_file in sorted(GENERATED_FLOWS_DIR.glob(f'*/{CURRENT_POINTER_FILENAME}')):
        try:
            with open(pointer_file, 'r', encoding='utf-8') as handle:
                pointer = json.load(handle)
            workflow_dir = pointer_file.parent
            manifest_filename = pointer.get('manifest_filename') or ''
            manifest_path = workflow_dir / manifest_filename
            with open(manifest_path, 'r', encoding='utf-8') as handle:
                data = json.load(handle)
            meta = data.get('_meta', {})
            manifests.append({
                'filename': f"{workflow_dir.name}/{manifest_filename}",
                'slug': workflow_dir.name,
                'name': data.get('name', workflow_dir.name),
                'description': data.get('description', ''),
                'steps_count': len(data.get('steps', [])),
                'published_at': meta.get('published_at'),
                'version': meta.get('version'),
                'trigger_type': meta.get('trigger_type', 'manual'),
                'tags': meta.get('tags', []),
                'has_flow_file': False,
            })
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning('Skipping invalid manifest pointer %s: %s', pointer_file, exc)
    return manifests


def import_workflow_from_manifest(
    filename: str,
    *,
    created_by,
    update_existing: bool = True,
) -> Workflow:
    manifest_path = GENERATED_FLOWS_DIR / filename
    if not manifest_path.exists():
        raise FileNotFoundError(f'Manifest file not found: {filename}')

    with open(manifest_path, 'r', encoding='utf-8') as handle:
        payload = json.load(handle)
    return import_workflow_from_json_payload(
        payload,
        created_by=created_by,
        update_existing=update_existing,
    )


def import_workflow_from_json_payload(
    payload: Dict[str, Any],
    *,
    created_by,
    update_existing: bool = True,
) -> Workflow:
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
        is_active=True,
        is_draft=False,
        tags=tags,
        update_existing=update_existing,
    )
    logger.info('Imported workflow "%s" (id=%s) from published payload', workflow.name, workflow.id)
    return workflow
