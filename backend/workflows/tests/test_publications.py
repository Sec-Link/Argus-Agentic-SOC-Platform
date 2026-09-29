import builtins
import io
import os
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack, contextmanager
from copy import deepcopy
from threading import Barrier, Event
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import connections, transaction
from django.db.models.query import QuerySet
from django.test import TestCase, TransactionTestCase, override_settings, skipUnlessDBFeature
from rest_framework.test import APIClient

from workflows import publisher
from workflows.models import Workflow, WorkflowRevision, WorkflowSchedule, WorkflowStep
from workflows.prefect_dispatcher import apply_runtime_snapshot, build_run_envelope, register_runtime_execution


@contextmanager
def forbid_flows_access():
    """Catch hidden filesystem fallbacks without touching existing user manifests."""
    def guarded(original):
        def call(path, *args, **kwargs):
            if isinstance(path, (str, bytes, os.PathLike)):
                normalized = os.path.abspath(os.fsdecode(path)).replace('\\', '/').casefold()
                if '/workflows/flows/' in normalized + '/':
                    raise AssertionError('Local workflows/flows access is forbidden')
            return original(path, *args, **kwargs)
        return call

    with ExitStack() as stack:
        for module, names in ((builtins, ('open',)), (io, ('open',)),
                              (os, ('open', 'stat', 'mkdir', 'listdir', 'scandir'))):
            for name in names:
                stack.enter_context(patch.object(module, name, guarded(getattr(module, name))))
        yield


@override_settings(WORKFLOW_ENCRYPTION_KEYS=[])
class PublicationTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='publications')
        self.workflow = Workflow.objects.create(name='Published name', version=4, is_active=True)
        self.step = WorkflowStep.objects.create(
            workflow=self.workflow, name='Published step', action_type='log',
            action_config={'message': 'published'},
        )

    def test_database_only_export_import_and_historical_callbacks(self):
        with forbid_flows_access():
            result = publisher.publish_workflow(self.workflow)
            self.assertEqual(result['manifest_path'], '')
            self.assertEqual(result['manifest_ref'], f'{self.workflow.id}/v4.json')
            self.assertEqual(result['manifest_filename'], 'v4.json')
            self.assertFalse(self.workflow.is_draft)

            self.workflow.name = 'Changed draft'
            self.workflow.save()
            self.step.name = 'Changed step'
            self.step.save()
            self.workflow.refresh_from_db()
            self.assertTrue(self.workflow.is_draft)
            exported, pointer = publisher.build_published_export(self.workflow)
            self.assertEqual(pointer['current_version'], 4)
            self.assertEqual(exported['name'], 'Published name')
            self.assertEqual(exported['steps'][0]['name'], 'Published step')
            imported = publisher.import_workflow_from_json_payload(
                exported, created_by=self.user, update_existing=False,
            )
            self.assertTrue(imported.is_draft)
            self.assertFalse(imported.is_active)
            self.assertIsNone(imported.published_revision_id)
            self.assertNotEqual(imported.steps.get().id, self.step.id)
            exported['steps'].clear()
            self.assertEqual(len(publisher.load_published_manifest(self.workflow, 4)['steps']), 1)

            self.assertEqual(publisher.publish_workflow(self.workflow)['manifest_version'], 5)
            self.step.delete()
            run, _, _ = build_run_envelope(
                self.workflow, execution_id=None, trigger_source='manual',
                trigger_data={}, workflow_version=4,
            )
            old_step = run['workflow']['definition']['steps'][0]
            self.assertEqual(old_step['name'], 'Published step')
            run_id = str(uuid4())
            execution = register_runtime_execution({
                'prefect_flow_run_id': run_id, 'workflow_id': str(self.workflow.id),
                'workflow_version': 4,
            })
            execution = apply_runtime_snapshot(execution, {
                'prefect_flow_run_id': run_id, 'status': 'completed',
                'step_results': [{'step_id': old_step['id'], 'status': 'completed'}],
            })
            self.assertEqual(execution.workflow_version, 4)
            self.assertEqual(execution.step_executions.get().step_name, 'Published step')

    def test_unpublished_export_remains_409_and_missing_versions_remain_file_not_found(self):
        client = APIClient()
        client.force_authenticate(self.user)
        with forbid_flows_access():
            response = client.get(f'/api/v1/workflows/workflows/{self.workflow.id}/export/')
            self.assertEqual(response.status_code, 409)
            with self.assertRaises(FileNotFoundError):
                publisher.load_published_manifest(self.workflow, 1)
            with self.assertRaises(FileNotFoundError):
                publisher.load_current_published_manifest(self.workflow)

    def test_import_updates_only_the_draft_and_keeps_published_history(self):
        publisher.publish_workflow(self.workflow)
        revision_id = self.workflow.published_revision_id
        exported, _ = publisher.build_published_export(self.workflow)
        exported['description'] = 'Imported draft'
        exported['steps'][0]['name'] = 'Imported step'
        imported = publisher.import_workflow_from_json_payload(exported, created_by=self.user)
        self.assertEqual(imported.pk, self.workflow.pk)
        self.assertEqual(imported.published_revision_id, revision_id)
        self.assertEqual(imported.description, 'Imported draft')
        self.assertEqual(imported.steps.get().name, 'Imported step')
        self.assertTrue(imported.is_draft)
        self.assertFalse(imported.is_active)
        self.assertEqual(WorkflowRevision.objects.filter(workflow=imported).count(), 1)
        self.assertEqual(publisher.build_published_export(imported)[0]['steps'][0]['name'], 'Published step')

    def test_metadata_does_not_load_the_snapshot_or_add_queries_per_workflow(self):
        publisher.publish_workflow(self.workflow)
        with self.assertNumQueries(1):
            states = [publisher.get_published_state(workflow) for workflow in
                      Workflow.objects.select_related('published_revision').defer('published_revision__manifest')]
        self.assertEqual(states[0]['published_version'], 4)
        self.assertFalse(states[0]['has_unpublished_changes'])

    def test_pointer_and_snapshot_identity_are_validated(self):
        publisher.publish_workflow(self.workflow)
        other = Workflow.objects.create(name='Other')
        Workflow.objects.filter(pk=other.pk).update(published_revision=self.workflow.published_revision)
        other.refresh_from_db()
        with self.assertRaisesRegex(ValueError, 'another workflow'):
            publisher.load_current_published_manifest(other)
        self.assertIsNone(publisher.get_published_state(other)['published_version'])
        manifest = deepcopy(self.workflow.published_revision.manifest)
        manifest['_meta']['version'] = 5
        WorkflowRevision.objects.filter(workflow=self.workflow).update(manifest=manifest)
        self.workflow.refresh_from_db()
        with self.assertRaisesRegex(ValueError, 'requested version'):
            publisher.load_current_published_manifest(self.workflow)

    def test_publish_uses_latest_database_draft_and_highest_history_version(self):
        publisher.publish_workflow(self.workflow)
        manifest = publisher._build_manifest_record(self.workflow, 10)
        WorkflowRevision.objects.create(workflow=self.workflow, version=10, manifest=manifest,
                                        published_at=self.workflow.published_revision.published_at)
        Workflow.objects.filter(pk=self.workflow.pk).update(name='Fresh database name')
        with patch.object(publisher, 'serialize_workflow', wraps=publisher.serialize_workflow) as serialize:
            result = publisher.publish_workflow(self.workflow)
        serialize.assert_called_once()
        self.assertEqual(result['manifest_version'], 11)
        self.assertEqual(self.workflow.name, 'Fresh database name')
        self.assertEqual(self.workflow.published_revision.manifest['name'], 'Fresh database name')

    def test_mid_publish_failure_rolls_back_snapshot_pointer_and_state(self):
        publisher.publish_workflow(self.workflow)
        revision_id = self.workflow.published_revision_id
        self.workflow.description = 'Unpublished edit'
        self.workflow.save()
        original_update = QuerySet.update

        def fail_after_pointer_update(queryset, **kwargs):
            if queryset.model is WorkflowSchedule:
                raise RuntimeError('injected publication failure')
            return original_update(queryset, **kwargs)

        with patch.object(QuerySet, 'update', fail_after_pointer_update):
            with self.assertRaisesRegex(RuntimeError, 'injected'):
                publisher.publish_workflow(self.workflow)
        self.workflow.refresh_from_db()
        self.assertEqual(WorkflowRevision.objects.filter(workflow=self.workflow).count(), 1)
        self.assertEqual(self.workflow.published_revision_id, revision_id)
        self.assertEqual(self.workflow.version, 4)
        self.assertTrue(self.workflow.is_draft)

    def test_publish_marks_paused_plans_pending_and_delete_cascades_history(self):
        plan = WorkflowSchedule.objects.create(
            workflow=self.workflow, is_active=False, cron='0 * * * *',
            sync_status='failed', last_error='Old error',
        )
        publisher.publish_workflow(self.workflow)
        plan.refresh_from_db()
        self.assertEqual(plan.sync_status, 'pending')
        self.assertEqual(plan.last_error, '')
        self.workflow.delete()
        self.assertFalse(WorkflowRevision.objects.exists())
        self.assertFalse(WorkflowSchedule.objects.filter(pk=plan.pk).exists())


@override_settings(WORKFLOW_ENCRYPTION_KEYS=[])
class PublicationConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.workflow = Workflow.objects.create(name='Concurrent publication')
        WorkflowStep.objects.create(workflow=self.workflow, name='Before', action_type='log',
                                    action_config={'message': 'before'})

    @skipUnlessDBFeature('has_select_for_update')
    def test_concurrent_publishers_get_distinct_monotonic_versions(self):
        start = Barrier(2)

        def publish():
            try:
                workflow = Workflow.objects.get(pk=self.workflow.pk)
                start.wait(timeout=10)
                return publisher.publish_workflow(workflow)['manifest_version']
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(publish) for _ in range(2)]
            versions = [future.result(timeout=15) for future in futures]
        self.assertEqual(sorted(versions), [1, 2])
        self.workflow.refresh_from_db()
        self.assertEqual(self.workflow.published_revision.version, 2)

    @skipUnlessDBFeature('has_select_for_update')
    def test_publish_waits_for_a_complete_locked_definition_edit(self):
        started = Event()

        def publish():
            try:
                workflow = Workflow.objects.get(pk=self.workflow.pk)
                started.set()
                publisher.publish_workflow(workflow)
                return workflow.published_revision.manifest
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            with transaction.atomic():
                locked = Workflow.objects.select_for_update().get(pk=self.workflow.pk)
                locked.name = 'After'
                locked.save()
                future = pool.submit(publish)
                self.assertTrue(started.wait(10))
                step = locked.steps.get()
                step.name = 'After'
                step.save()
            manifest = future.result(timeout=15)
        self.assertEqual(manifest['name'], 'After')
        self.assertEqual(manifest['steps'][0]['name'], 'After')
