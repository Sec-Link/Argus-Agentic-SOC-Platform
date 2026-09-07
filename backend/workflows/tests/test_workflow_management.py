from io import StringIO
from unittest.mock import patch
from uuid import uuid4

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings

from workflows.models import PrefectDeployment, Workflow, WorkflowSchedule


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
        self.assertFalse(workflow.is_draft)

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
        self.assertFalse(workflow.is_draft)
        self.assertFalse(workflow.steps.exists())

    @patch('workflows.management.commands.sync_prefect_schedules.sync_schedule')
    @patch('workflows.prefect_client.delete_deployment_schedule_by_slug')
    def test_sync_reports_unbound_schedule_and_still_syncs_bound_schedule(self, delete, sync):
        deployment = PrefectDeployment.objects.create(id=uuid4(), name='office', is_available=True)
        bound = Workflow.objects.create(name='Bound', prefect_deployment_id=str(deployment.id))
        unbound = Workflow.objects.create(name='Unbound')
        Workflow.objects.create(name='Unrelated draft', is_draft=True)
        scheduled = WorkflowSchedule.objects.create(workflow=bound, name='bound', cron='0 * * * *')
        missing = WorkflowSchedule.objects.create(workflow=unbound, name='unbound', cron='0 * * * *')
        output = StringIO()
        with self.assertRaisesMessage(CommandError, str(missing.id)):
            call_command('sync_prefect_schedules', stdout=output)
        sync.assert_called_once_with(scheduled)
        delete.assert_called_once_with(deployment_id=str(deployment.id), slug='argus-workflow-schedule')
        self.assertIn('Synced 1 Prefect schedule(s).', output.getvalue())
