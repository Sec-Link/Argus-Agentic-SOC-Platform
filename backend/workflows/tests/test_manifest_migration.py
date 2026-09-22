import io
import json
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from uuid import uuid4

from cryptography.fernet import Fernet
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings
from django.utils.dateparse import parse_datetime

from workflows.models import Workflow, WorkflowExecution, WorkflowRevision, WorkflowStep
from workflows.publisher import _build_manifest_record, build_published_export
from workflows.secret_config import prepare_config_for_storage


class WorkflowManifestMigrationTests(TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.source = Path(directory.name)
        self.workflow = Workflow.objects.create(name='Migration draft', version=8, is_draft=True, is_active=False)
        WorkflowStep.objects.create(workflow=self.workflow, order=0, name='Log', action_type='log', action_config={'message': 'published'})
        settings_override = override_settings(WORKFLOW_ENCRYPTION_KEYS=[Fernet.generate_key().decode('ascii')])
        settings_override.enable()
        self.addCleanup(settings_override.disable)

    def write_revision(self, version=1, *, current=True, payload=None):
        payload = deepcopy(payload) if payload is not None else _build_manifest_record(self.workflow, version)
        directory = self.source / str(self.workflow.pk)
        directory.mkdir(exist_ok=True)
        (directory / f'v{version}.json').write_text(json.dumps(payload), encoding='utf-8')
        if current:
            (directory / 'current.json').write_text(json.dumps({
                'workflow_id': str(self.workflow.pk), 'current_version': version,
                'manifest_filename': f'v{version}.json', 'published_at': payload['_meta']['published_at'],
            }), encoding='utf-8')
        return payload

    def run_import(self, *, apply=False):
        output = io.StringIO()
        call_command('migrate_workflow_manifests', source=str(self.source), apply=apply, stdout=output)
        return output.getvalue()

    def test_all_history_current_dry_run_idempotency_and_source_preservation(self):
        first = self.write_revision(1)
        last = self.write_revision(3, current=False)
        WorkflowExecution.objects.create(workflow=self.workflow, workflow_version=3)
        source_bytes = {path: path.read_bytes() for path in self.source.rglob('*.json')}
        self.assertIn('Dry-run', self.run_import())
        self.assertFalse(WorkflowRevision.objects.exists())
        self.run_import(apply=True)
        self.run_import(apply=True)
        revisions = {row.version: row for row in WorkflowRevision.objects.all()}
        self.assertEqual(set(revisions), {1, 3})
        self.assertEqual(revisions[1].manifest, first)
        self.assertEqual(revisions[3].manifest, last)
        self.workflow.refresh_from_db()
        self.assertEqual(self.workflow.published_revision_id, revisions[1].pk)
        self.assertEqual((self.workflow.version, self.workflow.is_draft, self.workflow.is_active), (8, True, False))
        self.assertEqual({path: path.read_bytes() for path in source_bytes}, source_bytes)

    def test_history_without_current_does_not_publish(self):
        self.write_revision(current=False)
        self.assertIn('history only', self.run_import(apply=True))
        self.workflow.refresh_from_db()
        self.assertIsNone(self.workflow.published_revision_id)
        self.assertEqual(WorkflowRevision.objects.count(), 1)

    def test_invalid_snapshot_or_pointer_never_partially_imports(self):
        good = self.write_revision()
        bad = _build_manifest_record(self.workflow, 2)
        cases = []
        wrong_id = deepcopy(bad)
        wrong_id['id'] = str(uuid4())
        cases.append(wrong_id)
        wrong_time = deepcopy(bad)
        wrong_time['_meta']['published_at'] = '2026-01-01T12:00:00'
        cases.append(wrong_time)
        bad_graph = deepcopy(bad)
        bad_graph['steps'][0]['connections'] = [str(uuid4())]
        cases.append(bad_graph)
        bad_variables = deepcopy(bad)
        bad_variables['variables'] = []
        cases.append(bad_variables)
        bad_edges = deepcopy(bad)
        bad_edges['edges'] = [{'source': str(uuid4())}]
        cases.append(bad_edges)
        for payload in cases:
            with self.subTest(payload=payload['_meta']['published_at']):
                self.write_revision(2, current=False, payload=payload)
                with self.assertRaises(CommandError):
                    self.run_import(apply=True)
                self.assertFalse(WorkflowRevision.objects.exists())
        directory = self.source / str(self.workflow.pk)
        (directory / 'v2.json').write_text('{invalid', encoding='utf-8')
        with self.assertRaisesRegex(CommandError, 'valid manifest JSON'):
            self.run_import(apply=True)
        self.assertFalse(WorkflowRevision.objects.exists())
        self.write_revision(2, current=False)
        pointer = json.loads((directory / 'current.json').read_text(encoding='utf-8'))
        pointer.update(current_version=9, manifest_filename='v9.json')
        (directory / 'current.json').write_text(json.dumps(pointer), encoding='utf-8')
        with self.assertRaisesRegex(CommandError, 'missing current'):
            self.run_import(apply=True)
        self.assertFalse(WorkflowRevision.objects.exists())
        self.assertEqual(json.loads((directory / 'v1.json').read_text(encoding='utf-8')), good)

    def test_duplicate_json_keys_and_unexpected_source_files_are_rejected(self):
        self.write_revision()
        path = self.source / str(self.workflow.pk) / 'v1.json'
        path.write_text('{"id":"first","id":"second"}', encoding='utf-8')
        with self.assertRaisesRegex(CommandError, 'valid manifest JSON'):
            self.run_import(apply=True)
        self.write_revision()
        path.with_name('unrecognized.json').write_text('{}', encoding='utf-8')
        with self.assertRaisesRegex(CommandError, 'Unexpected source file'):
            self.run_import(apply=True)
        self.assertFalse(WorkflowRevision.objects.exists())

    def test_orphans_and_missing_execution_references_block_import(self):
        self.write_revision()
        orphan = self.source / str(uuid4())
        orphan.mkdir()
        with self.assertRaisesRegex(CommandError, 'Orphan'):
            self.run_import(apply=True)
        self.assertFalse(WorkflowRevision.objects.exists())
        orphan.rmdir()
        WorkflowExecution.objects.create(workflow=self.workflow, workflow_version=99)
        with self.assertRaisesRegex(CommandError, 'Execution references missing'):
            self.run_import(apply=True)
        self.assertFalse(WorkflowRevision.objects.exists())

    def test_conflicts_and_newer_database_pointer_cannot_be_overwritten(self):
        payload = self.write_revision()
        self.run_import(apply=True)
        changed = deepcopy(payload)
        changed['name'] = 'Conflicting published name'
        self.write_revision(payload=changed)
        with self.assertRaisesRegex(CommandError, 'Conflicting database snapshot'):
            self.run_import(apply=True)
        self.write_revision(payload=payload)
        newer = _build_manifest_record(self.workflow, 5)
        revision = WorkflowRevision.objects.create(workflow=self.workflow, version=5, manifest=newer,
                                                   published_at=parse_datetime(newer['_meta']['published_at']))
        Workflow.objects.filter(pk=self.workflow.pk).update(published_revision=revision)
        with self.assertRaisesRegex(CommandError, 'refusing to replace'):
            self.run_import(apply=True)
        self.workflow.refresh_from_db()
        self.assertEqual(self.workflow.published_revision_id, revision.pk)

    def test_invalid_action_ciphertext_and_wrong_keys_block_import_without_disclosure(self):
        secret = 'migration-private-value'
        payload = _build_manifest_record(self.workflow, 1)
        payload['steps'][0].update(action_type='api_call', action_config=prepare_config_for_storage(
            'api_call', {'url': 'https://example.com', 'auth_type': 'bearer', 'auth_secret': secret},
        ))
        self.write_revision(payload=payload)
        with override_settings(WORKFLOW_ENCRYPTION_KEYS=[Fernet.generate_key().decode('ascii')]):
            with self.assertRaises(CommandError) as error:
                self.run_import(apply=True)
            self.assertNotIn(secret, str(error.exception))
        payload['steps'][0]['action_config']['auth_secret'] = secret
        self.write_revision(payload=payload)
        with self.assertRaises(CommandError) as error:
            self.run_import(apply=True)
        self.assertNotIn(secret, str(error.exception))
        self.assertFalse(WorkflowRevision.objects.exists())

    def test_historical_expected_failure_keeps_missing_sensitive_fields_and_exports_unchanged(self):
        originals = {}
        for version in (1, 2):
            payload = _build_manifest_record(self.workflow, version)
            payload['steps'][0].update(name='Expected failure', action_type='block_ip', action_config={
                'ip_address': '192.0.2.1', 'api_url': 'https://example.com/block',
            })
            originals[version] = self.write_revision(version, payload=payload)
        self.assertIn('Dry-run', self.run_import())
        self.run_import(apply=True)
        for revision in WorkflowRevision.objects.filter(workflow=self.workflow):
            self.assertEqual(revision.manifest, originals[revision.version])
        self.workflow.refresh_from_db()
        exported, pointer = build_published_export(self.workflow)
        self.assertEqual(pointer['current_version'], 2)
        self.assertEqual(exported['steps'], originals[2]['steps'])
        self.assertNotIn('api_key', exported['steps'][0]['action_config'])

    def test_readback_failure_rolls_back_revisions_and_pointer(self):
        self.write_revision()
        real_create = WorkflowRevision.objects.create

        def corrupt_readback(**kwargs):
            row = real_create(**kwargs)
            WorkflowRevision.objects.filter(pk=row.pk).update(manifest={})
            return row

        with patch('workflows.management.commands.migrate_workflow_manifests.WorkflowRevision.objects.create', side_effect=corrupt_readback):
            with self.assertRaisesRegex(CommandError, 'verification failed'):
                self.run_import(apply=True)
        self.assertFalse(WorkflowRevision.objects.exists())
        self.workflow.refresh_from_db()
        self.assertIsNone(self.workflow.published_revision_id)
