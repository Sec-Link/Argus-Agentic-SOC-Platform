import os
import tempfile
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from django.test import TestCase
from django.core.exceptions import ImproperlyConfigured

from workflows.models import PrefectDeployment, Workflow, WorkflowStep
from workflows.prefect_client import PrefectAPIError, PrefectDeploymentNotFound
from workflows.prefect_dispatcher import build_run_envelope
from workflows.publisher import publish_workflow
from workflows.worker_auth import ensure_worker_credential
from workflows.worker_credentials import bootstrap_worker_credentials, sync_worker_credential


class WorkerProvisioningTests(TestCase):
    @patch('workflows.worker_credentials.ensure_worker_credential', side_effect=ImproperlyConfigured('disabled'))
    def test_identity_failure_becomes_dispatch_error(self, ensure):
        with patch.dict(os.environ, {'PREFECT_API_URL': 'http://prefect.test/api'}):
            with self.assertRaises(PrefectAPIError):
                sync_worker_credential()

    @patch('workflows.worker_credentials.Secret')
    @patch('workflows.prefect_client.get_deployment')
    @patch('workflows.prefect_client.update_deployment')
    def test_bootstrap_preserves_existing_parameters_and_publishes_only_reference(self, update, get, secret):
        credential = ensure_worker_credential()
        deployment = PrefectDeployment.objects.create(id=uuid4(), name='Generic')
        PrefectDeployment.objects.create(id=uuid4(), name='Unavailable', is_available=False)
        get.return_value = {'parameters': {'run': {'existing': True}}}
        with patch.dict(os.environ, {'PREFECT_API_URL': 'http://prefect.test/api', 'PREFECT_DEPLOYMENT_ID': 'generic'}):
            self.assertEqual(bootstrap_worker_credentials(), credential.block_name)
        secret.assert_called_once_with(value=credential.key)
        secret.return_value.save.assert_called_once_with(credential.block_name, overwrite=True)
        parameters = update.call_args.kwargs['payload']['parameters']
        self.assertEqual(parameters, {'run': {'existing': True}, 'worker_credential_block': credential.block_name})
        self.assertNotIn(credential.key, str(parameters))
        get.assert_called_once_with(str(deployment.id))
        update.reset_mock()
        get.return_value = {'parameters': parameters}
        with patch.dict(os.environ, {'PREFECT_API_URL': 'http://prefect.test/api'}):
            bootstrap_worker_credentials()
        update.assert_not_called()

    @patch('workflows.worker_credentials.Secret')
    @patch('workflows.prefect_client.get_deployment', side_effect=PrefectDeploymentNotFound('removed'))
    def test_deleted_deployment_does_not_prevent_bootstrap(self, get, secret):
        PrefectDeployment.objects.create(id=uuid4(), name='Removed')
        with patch.dict(os.environ, {'PREFECT_API_URL': 'http://prefect.test/api', 'PREFECT_DEPLOYMENT_ID': 'removed'}):
            self.assertEqual(bootstrap_worker_credentials(), ensure_worker_credential().block_name)

    @patch('workflows.worker_credentials.Secret')
    def test_manual_and_scheduled_envelopes_contain_no_secret(self, secret):
        with tempfile.TemporaryDirectory() as directory, patch(
            'workflows.publisher.GENERATED_FLOWS_DIR', Path(directory)
        ), patch.dict(os.environ, {'PREFECT_API_URL': 'http://prefect.test/api'}):
            workflow = Workflow.objects.create(name='Managed auth')
            WorkflowStep.objects.create(workflow=workflow, name='Create', order=0,
                                        action_type='create_ticket', action_config={'title': 'Test'})
            publish_workflow(workflow, register_deployment=False)
            for execution_id in ('manual-run', None):
                run, _, _ = build_run_envelope(workflow, execution_id=execution_id,
                                              trigger_source='schedule', trigger_data={})
                credential = ensure_worker_credential()
                self.assertEqual(run['worker_credential_block'], credential.block_name)
                self.assertNotIn(credential.key, str(run))
