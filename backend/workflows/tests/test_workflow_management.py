from io import StringIO
from unittest.mock import patch
from uuid import uuid4

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings

from workflows.models import PrefectDeployment, Workflow, WorkflowSchedule, WorkflowStep
from workflows.publisher import publish_workflow


@override_settings(WORKFLOW_ENCRYPTION_KEYS=[])
class WorkflowManagementTests(TestCase):
    @patch('workflows.management.commands.import_workflow_playbooks.WorkflowViewSet._sync_default_schedule')
    def test_import_activation_requires_explicit_registered_deployment(self, sync):
        with self.assertRaisesMessage(CommandError, '--activate requires --deployment-id'):
            call_command('import_workflow_playbooks', activate=True, stdout=StringIO())
        self.assertFalse(Workflow.objects.exists())

        deployment = PrefectDeployment.objects.create(id=uuid4(), name='office', is_available=True)
        call_command('import_workflow_playbooks', deployment_id=str(deployment.id), activate=True, stdout=StringIO())
        workflow = Workflow.objects.get()
        self.assertEqual(workflow.prefect_deployment_id, str(deployment.id))
        self.assertTrue(workflow.is_active)
        self.assertTrue(workflow.is_draft)

    def test_import_rebinding_rejects_existing_paused_schedule_without_partial_update(self):
        old_id = str(uuid4())
        workflow = Workflow.objects.create(
            name='Critical Ticket Email Notification', prefect_deployment_id=old_id,
            is_active=True, is_draft=False,
        )
        WorkflowSchedule.objects.create(workflow=workflow, name='paused', cron='0 * * * *', is_active=False)
        deployment = PrefectDeployment.objects.create(id=uuid4(), name='other', is_available=True)
        with self.assertRaisesMessage(CommandError, 'Delete all existing schedules'):
            call_command('import_workflow_playbooks', deployment_id=str(deployment.id), activate=True, stdout=StringIO())
        workflow.refresh_from_db()
        self.assertEqual(workflow.prefect_deployment_id, old_id)
        self.assertTrue(workflow.is_active)
        self.assertTrue(workflow.is_draft)
        self.assertFalse(workflow.steps.exists())

    @patch('workflows.prefect_client.upsert_deployment_schedule', return_value={})
    @patch('workflows.prefect_client.delete_deployment_schedule_by_slug')
    def test_sync_reports_unbound_schedule_and_still_syncs_active_and_paused_plans(self, delete, upsert):
        deployment = PrefectDeployment.objects.create(id=uuid4(), name='office', is_available=True)
        bound = Workflow.objects.create(name='Bound', prefect_deployment_id=str(deployment.id))
        WorkflowStep.objects.create(workflow=bound, name='Log', action_type='log', action_config={'message': 'test'})
        publish_workflow(bound)
        unbound = Workflow.objects.create(name='Unbound')
        Workflow.objects.create(name='Unrelated draft', is_draft=True)
        scheduled = WorkflowSchedule.objects.create(workflow=bound, name='bound', cron='0 * * * *')
        paused = WorkflowSchedule.objects.create(workflow=bound, name='paused', cron='15 * * * *', is_active=False)
        missing = WorkflowSchedule.objects.create(workflow=unbound, name='unbound', cron='0 * * * *')
        output = StringIO()
        with self.assertRaisesMessage(CommandError, str(missing.id)):
            call_command('sync_prefect_schedules', stdout=output)
        self.assertEqual(upsert.call_count, 2)
        self.assertEqual({call.kwargs['is_active'] for call in upsert.call_args_list}, {True, False})
        delete.assert_called_once_with(deployment_id=str(deployment.id), slug='argus-workflow-schedule')
        self.assertIn('Synced 2 Prefect schedule(s).', output.getvalue())
        for plan in (scheduled, paused):
            plan.refresh_from_db()
            self.assertEqual(plan.sync_status, 'synced')
            self.assertEqual(plan.synced_version, bound.version)
        missing.refresh_from_db()
        self.assertEqual(missing.sync_status, 'failed')
        self.assertTrue(missing.last_error)
