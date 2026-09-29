"""Import legacy published snapshots during a workflows maintenance window."""
from __future__ import annotations

import json
import re
from pathlib import Path
from uuid import UUID

from django.core.exceptions import ImproperlyConfigured
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from workflows.models import Workflow, WorkflowExecution, WorkflowRevision
from workflows.publisher import _validate_published_manifest
from workflows.secret_config import SecretConfigError, decrypt_config_for_execution


def _timestamp(value):
    parsed = parse_datetime(value) if isinstance(value, str) else None
    if parsed is None or timezone.is_naive(parsed):
        raise ValueError('published_at must be a timestamp with a timezone.')
    return parsed


def _json_text(payload):
    return json.dumps(payload, sort_keys=True, ensure_ascii=False, allow_nan=False)


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON object key.')
        result[key] = value
    return result


def _read_json(path):
    try:
        payload = json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=_unique_object)
        if not isinstance(payload, dict):
            raise ValueError('JSON root must be an object.')
        _json_text(payload)
        return payload
    except (OSError, UnicodeError, ValueError) as exc:
        raise CommandError(f'Cannot read valid manifest JSON: {path.name}.') from exc


def _validate_manifest(workflow, version, payload):
    _validate_published_manifest(workflow, version, payload)
    if type(payload['_meta']['version']) is not int:
        raise ValueError('Manifest version must be an integer.')
    variables = payload.get('variables', {})
    if not isinstance(variables, dict) or any(not name.isascii() or not name.isidentifier() for name in variables):
        raise ValueError('Manifest variables must use ASCII identifiers.')
    edges = payload.get('edges', [])
    if not isinstance(edges, list) or any(
        not isinstance(edge, dict) or any(not isinstance(edge.get(end), str) or not edge[end] for end in ('source', 'target'))
        for edge in edges
    ):
        raise ValueError('Manifest visual edges are invalid.')
    # Visual edges can include inactive draft nodes omitted from executable steps.
    # Preserve historical definitions, including intentional failures; do not republish them.
    for step in payload['steps']:
        decrypt_config_for_execution(step['action_type'], step['action_config'])
    return _timestamp(payload['_meta'].get('published_at'))


class Command(BaseCommand):
    help = (
        'Import all legacy vN.json snapshots and current.json pointers into the database. '
        'Freeze workflows writes and secret rotation first. Source files are never changed; '
        'without --apply this only validates the migration.'
    )

    def add_arguments(self, parser):
        parser.add_argument('--source', required=True, help='Legacy generated directory to read.')
        parser.add_argument('--apply', action='store_true', help='Commit the validated import atomically.')

    def _collect(self, source, workflows):
        revisions, pointers = {}, {}
        for directory in sorted(source.iterdir()):
            try:
                workflow_id = UUID(directory.name)
            except ValueError as exc:
                raise CommandError(f'Unexpected entry in source: {directory.name}.') from exc
            if (not directory.is_dir() or directory.is_symlink()
                    or directory.resolve().parent != source or directory.name != str(workflow_id)):
                raise CommandError(f'Invalid workflow directory: {directory.name}.')
            workflow = workflows.get(workflow_id)
            if workflow is None:
                raise CommandError(f'Orphan manifest directory: {workflow_id}.')
            pointer = None
            for path in sorted(directory.iterdir()):
                if not path.is_file() or path.is_symlink() or path.resolve().parent != directory:
                    raise CommandError(f'Unexpected source entry: {directory.name}/{path.name}.')
                match = re.fullmatch(r'v([1-9][0-9]*)\.json', path.name)
                if path.name == 'current.json':
                    pointer = _read_json(path)
                elif match:
                    version = int(match[1])
                    payload = _read_json(path)
                    try:
                        published_at = _validate_manifest(workflow, version, payload)
                    except (ValueError, TypeError, KeyError, SecretConfigError, ImproperlyConfigured) as exc:
                        raise CommandError(f'Invalid published snapshot: {directory.name}/{path.name}.') from exc
                    revisions[workflow_id, version] = (payload, published_at)
                else:
                    raise CommandError(f'Unexpected source file: {directory.name}/{path.name}.')
            if pointer is None:
                pointers[workflow_id] = None
                self.stdout.write(f'No current pointer for {workflow_id}; importing history only.')
                continue
            version = pointer.get('current_version')
            key = workflow_id, version if type(version) is int else None
            if (type(version) is not int or version < 1
                    or pointer.get('workflow_id') != str(workflow_id)
                    or pointer.get('manifest_filename') != f'v{version}.json'
                    or key not in revisions):
                raise CommandError(f'Invalid or missing current snapshot for {workflow_id}.')
            try:
                if _timestamp(pointer.get('published_at')) != revisions[key][1]:
                    raise ValueError('Pointer publication time differs from its snapshot.')
            except (TypeError, ValueError) as exc:
                raise CommandError(f'Invalid current publication time for {workflow_id}.') from exc
            pointers[workflow_id] = version
        return revisions, pointers

    def handle(self, *args, **options):
        source = Path(options['source']).resolve()
        if not source.is_dir():
            raise CommandError('Source must be an existing legacy generated directory.')
        # A maintenance window prevents legacy file writers racing this import.
        with transaction.atomic():
            queryset = Workflow.objects.order_by('pk')
            if options['apply']:
                queryset = queryset.select_for_update()
            workflows = {item.pk: item for item in queryset}
            try:
                incoming, pointers = self._collect(source, workflows)
            except OSError as exc:
                raise CommandError('Cannot enumerate the complete source directory.') from exc
            existing = {(item.workflow_id, item.version): item for item in WorkflowRevision.objects.all()}
            by_id = {item.pk: item for item in existing.values()}
            for key, (payload, published_at) in incoming.items():
                stored = existing.get(key)
                if stored and (_json_text(stored.manifest) != _json_text(payload)
                               or stored.published_at != published_at):
                    raise CommandError(f'Conflicting database snapshot: {key[0]}/v{key[1]}.')
            for workflow_id, version in pointers.items():
                current_id = workflows[workflow_id].published_revision_id
                if current_id is not None:
                    current = by_id.get(current_id)
                    if current is None or (current.workflow_id, current.version) != (workflow_id, version):
                        raise CommandError(f'Current database pointer differs for {workflow_id}; refusing to replace it.')
            available = set(existing) | set(incoming)
            missing = set(WorkflowExecution.objects.values_list('workflow_id', 'workflow_version')) - available
            if missing:
                references = ', '.join(f'{pk}/v{version}' for pk, version in sorted(missing))
                raise CommandError(f'Execution references missing published snapshots: {references}.')
            created = len(set(incoming) - set(existing))
            self.stdout.write(f'Validated {len(incoming)} snapshots; {created} to create; {len(pointers)} pointers to verify.')
            if not options['apply']:
                self.stdout.write('Dry-run only; no data was changed.')
                return
            for key, (payload, published_at) in incoming.items():
                if key not in existing:
                    existing[key] = WorkflowRevision.objects.create(
                        workflow_id=key[0], version=key[1], manifest=payload, published_at=published_at,
                    )
            for workflow_id, version in pointers.items():
                revision_id = existing[workflow_id, version].pk if version is not None else None
                Workflow.objects.filter(pk=workflow_id).update(published_revision_id=revision_id)
            # Read back inside the transaction so verification failures undo the whole import.
            stored = {(item.workflow_id, item.version): item for item in WorkflowRevision.objects.all()}
            for key, (payload, published_at) in incoming.items():
                if (_json_text(stored[key].manifest) != _json_text(payload)
                        or stored[key].published_at != published_at):
                    raise CommandError(f'Snapshot verification failed: {key[0]}/v{key[1]}.')
            stored_pointers = dict(Workflow.objects.filter(pk__in=pointers).values_list('pk', 'published_revision_id'))
            for workflow_id, version in pointers.items():
                expected = stored[workflow_id, version].pk if version is not None else None
                if stored_pointers.get(workflow_id) != expected:
                    raise CommandError(f'Pointer verification failed: {workflow_id}.')
        self.stdout.write(self.style.SUCCESS(f'Imported {created} snapshots; source files were not changed.'))
