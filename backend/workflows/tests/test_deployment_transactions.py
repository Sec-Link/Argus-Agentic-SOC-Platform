import queue
import threading
import time
from unittest import skipUnless
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import connection, connections, transaction
from django.test import TransactionTestCase, override_settings
from rest_framework.test import APIClient

from workflows.models import PrefectDeployment, Workflow, WorkflowSchedule, WorkflowStep
from workflows.prefect_client import PrefectAPIError
from workflows.prefect_dispatcher import schedule_slug, sync_schedule
from workflows.publisher import publish_workflow
from workflows.serializers import WorkflowCreateSerializer


@override_settings(WORKFLOW_ENCRYPTION_KEYS=[])
class DeploymentTransactionTests(TransactionTestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='deployment-transactions')
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.first = PrefectDeployment.objects.create(id=uuid4(), name='First')
        self.second = PrefectDeployment.objects.create(id=uuid4(), name='Second')

    def workflow(self, **overrides):
        workflow = Workflow.objects.create(
            name='Transaction workflow', created_by=self.user,
            prefect_deployment_id=str(self.first.id), **overrides,
        )
        WorkflowStep.objects.create(
            workflow=workflow, order=0, name='Log', node_type='action',
            action_type='log', action_config={'message': 'transaction test'},
        )
        return workflow

    @patch('workflows.prefect_client.upsert_deployment_schedule', side_effect=PrefectAPIError('response timed out'))
    def test_schedule_create_timeout_keeps_the_uuid_and_blocks_rebinding(self, upsert):
        workflow = self.workflow()
        publish_workflow(workflow)
        response = self.client.post('/api/v1/workflows/schedules/', {
            'workflow': str(workflow.id), 'name': 'Hourly',
            'schedule_type': 'cron', 'cron': '0 * * * *',
        }, format='json')

        self.assertEqual(response.status_code, 400, response.data)
        schedule = WorkflowSchedule.objects.get(workflow=workflow)
        self.assertIn(str(schedule.id), str(response.json()))
        self.assertEqual(upsert.call_args.kwargs['slug'], schedule_slug(schedule))
        self.assertEqual(upsert.call_args.kwargs['deployment_id'], str(self.first.id))
        self.assertEqual(schedule.sync_status, 'failed')
        self.assertIn('response timed out', schedule.last_error)

        binding = self.client.patch(f'/api/v1/workflows/workflows/{workflow.id}/', {
            'prefect_deployment_id': str(self.second.id),
        }, format='json')
        self.assertEqual(binding.status_code, 400, binding.data)
        self.assertIn('prefect_deployment_id', binding.data)
        workflow.refresh_from_db()
        self.assertEqual(workflow.prefect_deployment_id, str(self.first.id))

        upsert.side_effect = None
        upsert.return_value = {}
        retry = self.client.patch(f'/api/v1/workflows/schedules/{schedule.id}/', {
            'cron': '15 * * * *',
        }, format='json')
        self.assertEqual(retry.status_code, 200, retry.data)
        self.assertEqual(retry.data['sync_status'], 'synced')
        self.assertEqual(upsert.call_args.kwargs['slug'], schedule_slug(schedule))
        self.assertEqual(WorkflowSchedule.objects.filter(workflow=workflow).count(), 1)
        schedule.refresh_from_db()
        self.assertEqual(schedule.sync_status, 'synced')
        self.assertEqual(schedule.synced_version, workflow.version)
        self.assertEqual(schedule.last_error, '')
        self.assertIsNotNone(schedule.last_synced_at)

    @patch('workflows.prefect_client.upsert_deployment_schedule', return_value={})
    def test_schedule_create_returns_the_committed_sync_state(self, upsert):
        workflow = self.workflow()
        publish_workflow(workflow)
        response = self.client.post('/api/v1/workflows/schedules/', {
            'workflow': str(workflow.pk), 'cron': '0 * * * *',
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['sync_status'], 'synced')
        self.assertEqual(response.data['synced_version'], workflow.version)

    @patch('workflows.prefect_client.upsert_deployment_schedule', side_effect=PrefectAPIError('response timed out'))
    def test_publishing_reports_sync_failure_after_default_plan_has_committed(self, upsert):
        workflow = self.workflow(trigger_type='scheduled', schedule_cron='0 * * * *')
        response = self.client.post(f'/api/v1/workflows/workflows/{workflow.id}/publish/', {}, format='json')

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.json()['schedule_errors'])
        schedule = WorkflowSchedule.objects.get(workflow=workflow, name='default')
        self.assertIn(str(schedule.id), str(response.json()['schedule_errors']))
        self.assertEqual(upsert.call_args.kwargs['slug'], schedule_slug(schedule))
        upsert.assert_called_once()
        workflow.refresh_from_db()
        self.assertFalse(workflow.is_draft)
        self.assertEqual(schedule.sync_status, 'failed')
        self.assertIn('response timed out', schedule.last_error)

    @patch('workflows.prefect_client.upsert_deployment_schedule', return_value={})
    def test_update_pause_and_resume_keep_requested_state_when_sync_fails(self, upsert):
        workflow = self.workflow()
        publish_workflow(workflow)
        schedule = WorkflowSchedule.objects.create(workflow=workflow, cron='0 * * * *')
        sync_schedule(schedule.pk)
        schedule.refresh_from_db()
        synced_at = schedule.last_synced_at
        synced_version = schedule.synced_version
        upsert.side_effect = PrefectAPIError('response timed out')
        url = f'/api/v1/workflows/schedules/{schedule.id}/'
        for action, payload, expected_active in (
            ('', {'cron': '15 * * * *'}, True),
            ('pause/', {}, False),
            ('resume/', {}, True),
        ):
            with self.subTest(action=action):
                request = self.client.post if action else self.client.patch
                response = request(url + action, payload, format='json')
                self.assertEqual(response.status_code, 400, response.data)
                schedule.refresh_from_db()
                self.assertEqual(schedule.cron, '15 * * * *')
                self.assertEqual(schedule.is_active, expected_active)
                self.assertEqual(schedule.sync_status, 'failed')
                self.assertIn('response timed out', schedule.last_error)
                self.assertEqual(schedule.synced_version, synced_version)
                self.assertEqual(schedule.last_synced_at, synced_at)
                self.assertEqual(upsert.call_args.kwargs['is_active'], expected_active)

    @patch('workflows.prefect_client.upsert_deployment_schedule', side_effect=PrefectAPIError('offline'))
    def test_default_plan_pause_commits_before_reporting_sync_failure(self, upsert):
        workflow = self.workflow(trigger_type='scheduled', schedule_cron='0 * * * *')
        publish_workflow(workflow)
        schedule = WorkflowSchedule.objects.create(workflow=workflow, name='default', cron=workflow.schedule_cron)
        response = self.client.patch(f'/api/v1/workflows/workflows/{workflow.id}/', {
            'schedule_cron': None,
        }, format='json')
        self.assertEqual(response.status_code, 400, response.data)
        workflow.refresh_from_db()
        schedule.refresh_from_db()
        self.assertIsNone(workflow.schedule_cron)
        self.assertFalse(schedule.is_active)
        self.assertEqual(schedule.sync_status, 'failed')
        self.assertIn('offline', schedule.last_error)

    @patch('workflows.prefect_client.upsert_deployment_schedule', return_value={})
    def test_delayed_sync_reloads_the_latest_published_version_and_plan(self, upsert):
        workflow = self.workflow()
        publish_workflow(workflow)
        stale = WorkflowSchedule.objects.create(workflow=workflow, cron='0 * * * *')
        WorkflowStep.objects.filter(workflow=workflow).update(action_config={'message': 'new version'})
        publish_workflow(workflow)
        WorkflowSchedule.objects.filter(pk=stale.pk).update(cron='15 * * * *', is_active=False)

        sync_schedule(stale)

        run = upsert.call_args.kwargs['parameters']['run']
        self.assertEqual(run['workflow']['version'], workflow.version)
        self.assertEqual(run['workflow']['definition']['steps'][0]['action_config']['message'], 'new version')
        self.assertEqual(upsert.call_args.kwargs['schedule']['cron'], '15 * * * *')
        self.assertFalse(upsert.call_args.kwargs['is_active'])
        stale.refresh_from_db()
        self.assertEqual(stale.synced_version, workflow.version)
        self.assertEqual(stale.sync_status, 'synced')

    @skipUnless(connection.vendor == 'postgresql', 'Schedule concurrency requires PostgreSQL row locks.')
    @patch('workflows.prefect_client.upsert_deployment_schedule', return_value={})
    def test_sync_waits_for_a_concurrent_publish_and_sends_its_version(self, upsert):
        workflow = self.workflow()
        publish_workflow(workflow)
        schedule = WorkflowSchedule.objects.create(workflow=workflow, cron='0 * * * *')
        process_ids = queue.Queue()
        results = queue.Queue()
        finished = threading.Event()

        def sync():
            try:
                with connection.cursor() as cursor:
                    cursor.execute("SET lock_timeout = '5s'")
                    cursor.execute('SELECT pg_backend_pid()')
                    process_ids.put(cursor.fetchone()[0])
                results.put(sync_schedule(schedule.pk))
            except BaseException as exc:
                results.put(exc)
            finally:
                connections.close_all()
                finished.set()

        worker = threading.Thread(target=sync, daemon=True)
        try:
            with transaction.atomic():
                Workflow.objects.select_for_update().get(pk=workflow.pk)
                with connection.cursor() as cursor:
                    cursor.execute('SELECT pg_backend_pid()')
                    owner_pid = cursor.fetchone()[0]
                worker.start()
                waiter_pid = process_ids.get(timeout=5)
                deadline = time.monotonic() + 3
                blocked = False
                while time.monotonic() < deadline:
                    with connection.cursor() as cursor:
                        cursor.execute('SELECT %s = ANY(pg_blocking_pids(%s))', [owner_pid, waiter_pid])
                        blocked = cursor.fetchone()[0]
                    if blocked:
                        break
                    finished.wait(0.01)
                self.assertTrue(blocked, 'The schedule sync did not wait for the publishing workflow lock.')
                publish_workflow(workflow)
            self.assertTrue(finished.wait(5), 'The schedule sync did not finish after publication committed.')
        finally:
            if worker.ident is not None:
                worker.join(timeout=6)

        result = results.get_nowait()
        if isinstance(result, BaseException):
            raise result
        workflow.refresh_from_db()
        self.assertEqual(upsert.call_args.kwargs['parameters']['run']['workflow']['version'], workflow.version)
        schedule.refresh_from_db()
        self.assertEqual(schedule.synced_version, workflow.version)

    @skipUnless(connection.vendor == 'postgresql', 'Deployment concurrency requires PostgreSQL row locks.')
    def test_binding_is_revalidated_after_waiting_for_a_concurrent_plan_creation(self):
        workflow = self.workflow()
        validated = queue.Queue()
        results = queue.Queue()
        finished = threading.Event()
        main_thread = threading.get_ident()
        original_validate = WorkflowCreateSerializer.validate

        def validate(serializer, attrs):
            result = original_validate(serializer, attrs)
            if threading.get_ident() != main_thread:
                with connection.cursor() as cursor:
                    cursor.execute("SET lock_timeout = '5s'")
                    cursor.execute('SELECT pg_backend_pid()')
                    validated.put(cursor.fetchone()[0])
            return result

        def rebind():
            try:
                client = APIClient()
                client.force_authenticate(self.user)
                response = client.patch(f'/api/v1/workflows/workflows/{workflow.id}/', {
                    'prefect_deployment_id': str(self.second.id),
                }, format='json')
                results.put((response.status_code, response.data))
            except BaseException as exc:
                results.put(exc)
            finally:
                connections.close_all()
                finished.set()

        worker = threading.Thread(target=rebind, daemon=True)
        try:
            with patch.object(WorkflowCreateSerializer, 'validate', validate):
                with transaction.atomic():
                    Workflow.objects.select_for_update().get(pk=workflow.pk)
                    with connection.cursor() as cursor:
                        cursor.execute('SELECT pg_backend_pid()')
                        owner_pid = cursor.fetchone()[0]
                    worker.start()
                    waiter_pid = validated.get(timeout=5)
                    deadline = time.monotonic() + 3
                    blocked = False
                    while time.monotonic() < deadline:
                        with connection.cursor() as cursor:
                            cursor.execute('SELECT %s = ANY(pg_blocking_pids(%s))', [owner_pid, waiter_pid])
                            blocked = cursor.fetchone()[0]
                        if blocked:
                            break
                        finished.wait(0.01)
                    self.assertTrue(blocked, 'The competing update never waited for the workflow row lock.')
                    WorkflowSchedule.objects.create(
                        workflow=workflow, name='Concurrent paused plan', cron='0 * * * *', is_active=False,
                    )
                self.assertTrue(finished.wait(5), 'The competing update did not finish after the row lock was released.')
        finally:
            if worker.ident is not None:
                worker.join(timeout=6)

        result = results.get_nowait()
        if isinstance(result, BaseException):
            raise result
        self.assertEqual(result[0], 400, result[1])
        self.assertIn('prefect_deployment_id', result[1])
        workflow.refresh_from_db()
        self.assertEqual(workflow.prefect_deployment_id, str(self.first.id))
        self.assertTrue(workflow.schedules.filter(is_active=False).exists())
