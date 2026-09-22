import os
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from workflows import prefect_client
from workflows.engine import execute_workflow
from workflows.models import PrefectDeployment, Workflow, WorkflowSchedule, WorkflowStep
from workflows.publisher import publish_workflow


class DeploymentBindingTests(TestCase):
    def setUp(self):
        environment = patch.dict(os.environ, {'PREFECT_API_URL': 'http://prefect.test/api', 'PREFECT_DEPLOYMENT_ID': str(uuid4())})
        environment.start()
        self.addCleanup(environment.stop)
        self.first = PrefectDeployment.objects.create(id=uuid4(), name='Site A', status='NOT_READY')
        self.second = PrefectDeployment.objects.create(id=uuid4(), name='Site B', status='READY')
        self.user = get_user_model().objects.create_user(username='deployment-bindings')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def workflow(self, deployment=None):
        workflow = Workflow.objects.create(
            name='Bound workflow', prefect_deployment_id=str((deployment or self.first).id),
            is_active=True, created_by=self.user,
        )
        WorkflowStep.objects.create(workflow=workflow, name='Log', order=0,
                                    action_type='log', action_config={'message': 'done'})
        publish_workflow(workflow)
        return workflow

    @staticmethod
    def url(workflow):
        return f'/api/v1/workflows/workflows/{workflow.id}/'

    def test_registry_list_is_read_only_and_old_sync_never_overwrites_workflows(self):
        first, second = self.workflow(), self.workflow()
        with patch('workflows.prefect_client.list_deployments') as remote:
            response = self.client.get('/api/v1/workflows/prefect/deployments/')
            retired = self.client.post('/api/v1/workflows/prefect/sync/', {}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()['deployments'][0]), {
            'id', 'name', 'work_pool_name', 'work_queue_name', 'status', 'is_available', 'last_synced_at',
        })
        self.assertEqual(retired.status_code, 410)
        remote.assert_not_called()
        for workflow in (first, second):
            workflow.refresh_from_db()
            self.assertTrue(workflow.is_active)
            self.assertFalse(workflow.is_draft)
            self.assertEqual(workflow.name, 'Bound workflow')

    def test_draft_flags_cannot_publish_and_publish_requires_a_registered_uuid(self):
        response = self.client.post('/api/v1/workflows/workflows/', {'name': 'Draft'}, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        workflow = Workflow.objects.get(pk=response.json()['id'])
        WorkflowStep.objects.create(workflow=workflow, name='Log', action_type='log', action_config={'message': 'draft'})
        unchanged = self.client.patch(self.url(workflow), {'is_draft': False}, format='json')
        self.assertEqual(unchanged.status_code, 200, unchanged.content)
        self.assertTrue(unchanged.data['is_draft'])
        for payload in ({'prefect_deployment_id': 'invalid'}, {'prefect_deployment_id': str(uuid4())}):
            rejected = self.client.patch(self.url(workflow), payload, format='json')
            self.assertEqual(rejected.status_code, 400, rejected.content)
        self.assertEqual(self.client.post(self.url(workflow) + 'publish/', {}, format='json').status_code, 400)
        selected = self.client.patch(self.url(workflow), {
            'prefect_deployment_id': str(self.first.id), 'is_draft': False,
        }, format='json')
        self.assertEqual(selected.status_code, 200, selected.content)
        self.assertTrue(selected.data['is_draft'])
        self.assertEqual(self.client.post(self.url(workflow) + 'publish/', {}, format='json').status_code, 200)
        workflow.refresh_from_db()
        self.assertFalse(workflow.is_draft)

    def test_invalid_old_binding_allows_other_edits_but_not_new_selection(self):
        workflow = self.workflow()
        self.first.is_available = False
        self.first.save()
        updated = self.client.patch(self.url(workflow), {
            'description': 'Can still edit', 'prefect_deployment_id': str(self.first.id),
        }, format='json')
        self.assertEqual(updated.status_code, 200, updated.content)
        other = self.workflow(self.second)
        rejected = self.client.patch(self.url(other), {'prefect_deployment_id': str(self.first.id)}, format='json')
        self.assertEqual(rejected.status_code, 400)

    @patch('workflows.prefect_client.create_flow_run')
    def test_dispatch_uses_current_binding_and_never_falls_back(self, create):
        create.side_effect = lambda **kwargs: {'id': str(uuid4()), 'state': {'type': 'SCHEDULED'}}
        first, shared, second = self.workflow(), self.workflow(), self.workflow(self.second)
        for workflow, source in ((first, 'manual'), (shared, 'ticket_binding:1'), (second, 'alert:1')):
            self.assertEqual(execute_workflow(workflow, trigger_source=source).status, 'pending')
        self.assertEqual([call.kwargs['deployment_id'] for call in create.call_args_list],
                         [str(self.first.id), str(self.first.id), str(self.second.id)])
        Workflow.objects.filter(pk=first.pk).update(prefect_deployment_id=str(self.second.id))
        execute_workflow(first, trigger_source='interface:ingest')
        self.assertEqual(create.call_args.kwargs['deployment_id'], str(self.second.id))
        create.reset_mock()
        Workflow.objects.filter(pk=first.pk).update(prefect_deployment_id='')
        self.assertEqual(execute_workflow(first).status, 'failed')
        self.first.is_available = False
        self.first.save()
        self.assertEqual(execute_workflow(shared).status, 'failed')
        create.assert_not_called()

    def test_active_and_paused_plans_both_block_rebinding_and_cannot_be_reparented(self):
        workflow, other = self.workflow(), self.workflow(self.second)
        for active in (True, False):
            plan = WorkflowSchedule.objects.create(workflow=workflow, cron='0 * * * *', is_active=active)
            rejected = self.client.patch(self.url(workflow), {'prefect_deployment_id': str(self.second.id)}, format='json')
            self.assertEqual(rejected.status_code, 400)
            moved = self.client.patch(f'/api/v1/workflows/schedules/{plan.id}/', {'workflow': str(other.id)}, format='json')
            self.assertEqual(moved.status_code, 400)
            plan.delete()

    def test_failed_remote_delete_keeps_plan_and_cron_then_missing_remote_allows_cleanup(self):
        workflow = self.workflow()
        workflow.trigger_type, workflow.schedule_cron = 'scheduled', '0 * * * *'
        workflow.save()
        plan = WorkflowSchedule.objects.create(
            workflow=workflow, name='default', cron=workflow.schedule_cron,
            sync_status='synced', synced_version=workflow.version,
        )
        url = f'/api/v1/workflows/schedules/{plan.id}/'
        with patch('workflows.prefect_client.list_deployment_schedules', side_effect=prefect_client.PrefectAPIError('offline')):
            response = self.client.delete(url)
        self.assertEqual(response.status_code, 400)
        self.assertTrue(WorkflowSchedule.objects.filter(pk=plan.pk).exists())
        plan.refresh_from_db()
        self.assertEqual(plan.sync_status, 'synced')
        self.assertEqual(plan.last_error, '')
        workflow.refresh_from_db()
        self.assertEqual(workflow.schedule_cron, '0 * * * *')
        self.first.is_available = False
        self.first.save()
        with patch('workflows.prefect_client.list_deployment_schedules', side_effect=prefect_client.PrefectDeploymentNotFound('gone')):
            self.assertEqual(self.client.delete(url).status_code, 204)
        workflow.refresh_from_db()
        self.assertIsNone(workflow.schedule_cron)
        with patch('workflows.prefect_dispatcher.sync_schedule') as sync:
            response = self.client.patch(self.url(workflow), {'prefect_deployment_id': str(self.second.id)}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(workflow.schedules.exists())
        sync.assert_not_called()
        with patch('workflows.prefect_client.upsert_deployment_schedule', return_value={}) as upsert, self.captureOnCommitCallbacks(execute=True):
            response = self.client.patch(self.url(workflow), {'schedule_cron': '15 * * * *'}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(upsert.call_args.kwargs['deployment_id'], str(self.second.id))
        self.assertEqual(workflow.schedules.count(), 1)

    def test_uncertain_remote_create_retains_local_plan_id_for_cleanup(self):
        workflow = self.workflow()
        callbacks = []
        with patch('workflows.views.transaction.on_commit', side_effect=callbacks.append):
            response = self.client.post('/api/v1/workflows/schedules/', {
                'workflow': str(workflow.id), 'schedule_type': 'cron', 'cron': '0 * * * *',
            }, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        plan = workflow.schedules.get()
        from rest_framework.exceptions import ValidationError
        with patch('workflows.prefect_client.upsert_deployment_schedule', side_effect=prefect_client.PrefectAPIError('response lost')):
            with self.assertRaisesMessage(ValidationError, str(plan.id)):
                callbacks[0]()
        self.assertTrue(WorkflowSchedule.objects.filter(pk=plan.id).exists())
        plan.refresh_from_db()
        self.assertEqual(plan.sync_status, 'failed')
        self.assertIn('response lost', plan.last_error)
        self.assertIsNone(plan.synced_version)
        self.assertEqual(self.client.patch(self.url(workflow), {'prefect_deployment_id': str(self.second.id)}, format='json').status_code, 400)
