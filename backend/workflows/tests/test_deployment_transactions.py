import queue
import tempfile
import threading
import time
from pathlib import Path
from unittest import skipUnless
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import connection, connections, transaction
from django.test import TransactionTestCase, override_settings
from rest_framework.test import APIClient

from workflows.models import PrefectDeployment, Workflow, WorkflowSchedule, WorkflowStep
from workflows.prefect_client import PrefectAPIError
from workflows.prefect_dispatcher import schedule_slug
from workflows.publisher import publish_workflow
from workflows.serializers import WorkflowCreateSerializer


@skipUnless(connection.vendor == 'postgresql', 'Deployment concurrency requires PostgreSQL row locks.')
@override_settings(WORKFLOW_ENCRYPTION_KEYS=[])
class DeploymentTransactionTests(TransactionTestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        generated = patch('workflows.publisher.GENERATED_FLOWS_DIR', Path(directory.name))
        generated.start()
        self.addCleanup(generated.stop)
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
        self.assertEqual(upsert.call_args.kwargs['slug'], schedule_slug(schedule))
        self.assertEqual(WorkflowSchedule.objects.filter(workflow=workflow).count(), 1)

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
