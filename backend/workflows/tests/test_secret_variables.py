import io
import json
from copy import deepcopy
from unittest.mock import patch
from uuid import uuid4

from cryptography.fernet import Fernet
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.exceptions import ValidationError

from workflows.models import PrefectDeployment, Workflow, WorkflowRevision
from workflows.prefect.secrets import decrypt_secret_variable, encrypt_payload
from workflows.publisher import build_published_export, import_workflow_from_json_payload, publish_workflow
from workflows.secret_config import SecretConfigError, is_encrypted
from workflows.serializers import WorkflowCreateSerializer, WorkflowDetailSerializer, WorkflowListSerializer, WorkflowStepCreateSerializer


class WorkflowSecretVariablesTests(TestCase):
    def setUp(self):
        self.key = Fernet.generate_key().decode('ascii')
        settings_override = override_settings(WORKFLOW_ENCRYPTION_KEYS=[self.key])
        settings_override.enable()
        self.addCleanup(settings_override.disable)
        self.user = get_user_model().objects.create_user(username='secret-variables')
        self.value = 'private-workflow-token-42'
        self.deployment_id = str(uuid4())
        PrefectDeployment.objects.create(id=self.deployment_id, name='secret-variables', is_available=True)

    def create_workflow(self, **changes):
        data = {'name': 'Secret variables', 'variables': {'site': 'SOC'}, 'secret_variables': {'token': self.value},
                'prefect_deployment_id': self.deployment_id}
        data.update(changes)
        serializer = WorkflowCreateSerializer(data=data)
        serializer.is_valid(raise_exception=True)
        return serializer.save(created_by=self.user)

    def test_write_only_encryption_blank_preservation_and_deletion(self):
        workflow = self.create_workflow()
        workflow.refresh_from_db()
        token = workflow.secret_variables['token']
        self.assertTrue(is_encrypted(token))
        self.assertEqual(decrypt_secret_variable('token', token, keys=[self.key]), self.value)
        for serializer_type in (WorkflowCreateSerializer, WorkflowDetailSerializer, WorkflowListSerializer):
            result = serializer_type(workflow).data
            self.assertEqual(result['configured_secret_variables'], ['token'])
            self.assertNotIn('secret_variables', result)
            self.assertNotIn(self.value, str(result))
            self.assertNotIn('enc:v1:', str(result))
        for payload in ({'description': 'Changed'}, {'secret_variables': {'token': ''}}):
            serializer = WorkflowCreateSerializer(workflow, data=payload, partial=True)
            serializer.is_valid(raise_exception=True)
            workflow = serializer.save()
            self.assertEqual(workflow.secret_variables['token'], token)
        serializer = WorkflowCreateSerializer(workflow, data={'secret_variables': {}}, partial=True)
        serializer.is_valid(raise_exception=True)
        self.assertEqual(serializer.save().secret_variables, {})

    def test_values_names_collisions_and_ciphertexts_fail_without_disclosure(self):
        token = encrypt_payload({'version': 1, 'kind': 'workflow_variable', 'name': 'token', 'value': self.value}, [self.key])
        malformed = [[], None, {'token': ''}, {'token': 42}, {'bad.name': self.value}, {'site': self.value}, {'renamed': token}, {'token': token[:-6] + 'broken'}]
        for secrets in malformed:
            serializer = WorkflowCreateSerializer(data={'name': 'Invalid', 'variables': {'site': 'SOC'}, 'secret_variables': secrets})
            self.assertFalse(serializer.is_valid(), secrets)
            self.assertNotIn(self.value, str(serializer.errors))
            self.assertNotIn(token, str(serializer.errors))
        with override_settings(WORKFLOW_ENCRYPTION_KEYS=[Fernet.generate_key().decode('ascii')]):
            serializer = WorkflowCreateSerializer(data={'name': 'Wrong environment', 'secret_variables': {'token': token}})
            self.assertFalse(serializer.is_valid())
            self.assertNotIn(token, str(serializer.errors))

    def test_clone_publish_export_and_import_preserve_only_ciphertext(self):
        workflow = self.create_workflow(steps=[{
            'order': 0, 'name': 'Call', 'action_type': 'api_call',
            'action_config': {'url': 'https://example.com', 'auth_type': 'bearer', 'auth_secret': '{{variables.token}}'},
        }])
        publish_workflow(workflow, register_deployment=False)
        exported, _ = build_published_export(workflow)
        self.assertEqual(exported['secret_variables'], workflow.secret_variables)
        self.assertNotIn(self.value, json.dumps(exported))
        imported = import_workflow_from_json_payload(exported, created_by=self.user, update_existing=False)
        self.assertEqual(imported.secret_variables, workflow.secret_variables)
        clone = imported.clone(user=self.user)
        self.assertEqual(clone.secret_variables, imported.secret_variables)
        clone.secret_variables.clear()
        self.assertEqual(list(imported.secret_variables), ['token'])
        with override_settings(WORKFLOW_ENCRYPTION_KEYS=[Fernet.generate_key().decode('ascii')]):
            with self.assertRaises(ValidationError) as error:
                import_workflow_from_json_payload(exported, created_by=self.user, update_existing=False)
            self.assertNotIn(self.value, str(error.exception))

    def test_only_sensitive_fields_accept_references_and_conditions_reject_them(self):
        valid_config = {'url': 'https://example.com', 'headers': [{'key': 'X-Key', 'sensitive': True, 'value': '{{variables.token}}'}]}
        workflow = self.create_workflow(steps=[{'order': 0, 'name': 'Call', 'action_type': 'api_call', 'action_config': valid_config}])
        invalid_steps = [
            {'action_type': 'log', 'action_config': {'message': '{{variables.token}}'}},
            {'action_type': 'api_call', 'action_config': {'url': 'https://example.com', 'headers': [{'key': 'X-Key', 'value': '{{variables.token}}'}]}},
            {'node_type': 'condition', 'action_type': 'condition', 'condition': {'field': 'variables.token', 'operator': 'exists'}},
            {'node_type': 'condition', 'action_type': 'condition', 'condition': {'field': 'trigger_data.x', 'value': '{{variables.token}}'}},
        ]
        for step in invalid_steps:
            serializer = WorkflowCreateSerializer(workflow, data={'steps': [{'order': 0, 'name': 'Invalid', **step}]}, partial=True)
            serializer.is_valid(raise_exception=True)
            with self.assertRaises(ValidationError):
                serializer.save()
            self.assertEqual(workflow.steps.get().name, 'Call')
        step = workflow.steps.get()
        serializer = WorkflowStepCreateSerializer(step, data={'action_config': {**valid_config, 'body_template': '{{variables.token}}'}}, partial=True)
        self.assertFalse(serializer.is_valid())

    def test_secret_removal_requires_updating_references_in_the_same_save(self):
        workflow = self.create_workflow(steps=[{'order': 0, 'name': 'Call', 'action_type': 'api_call', 'action_config': {'url': 'https://example.com', 'auth_type': 'bearer', 'auth_secret': '{{variables.token}}'}}])
        serializer = WorkflowCreateSerializer(workflow, data={'secret_variables': {}}, partial=True)
        serializer.is_valid(raise_exception=True)
        with self.assertRaises(ValidationError):
            serializer.save()
        workflow.refresh_from_db()
        self.assertIn('token', workflow.secret_variables)
        serializer = WorkflowCreateSerializer(workflow, data={'secret_variables': {}, 'steps': []}, partial=True)
        serializer.is_valid(raise_exception=True)
        self.assertEqual(serializer.save().secret_variables, {})

    def test_model_writes_encrypt_and_publish_rejects_plaintext_bypass(self):
        workflow = Workflow.objects.create(name='Direct write', created_by=self.user, secret_variables={'token': self.value})
        self.assertTrue(is_encrypted(workflow.secret_variables['token']))
        Workflow.objects.filter(pk=workflow.pk).update(secret_variables={'token': self.value})
        workflow.refresh_from_db()
        with self.assertRaisesRegex(ValueError, 'secret variables'):
            publish_workflow(workflow, register_deployment=False)
        self.assertFalse(WorkflowRevision.objects.exists())

    def test_management_command_rotates_secret_variables_in_database_and_manifests(self):
        workflow = self.create_workflow()
        publish_workflow(workflow, register_deployment=False)
        publish_workflow(workflow, register_deployment=False)
        original = dict(workflow.secret_variables)
        revisions = list(WorkflowRevision.objects.filter(workflow=workflow))
        new_key = Fernet.generate_key().decode('ascii')
        with (
            override_settings(WORKFLOW_ENCRYPTION_KEYS=[new_key, self.key]),
            patch('workflows.management.commands.migrate_workflow_secrets.publish_workflow') as publish,
        ):
            call_command('migrate_workflow_secrets', rotate=True, stdout=io.StringIO())
            workflow.refresh_from_db()
            self.assertEqual(workflow.secret_variables, original)
            for revision in revisions:
                revision.refresh_from_db()
                self.assertEqual(revision.manifest['secret_variables'], original)
            publish.assert_not_called()
            call_command('migrate_workflow_secrets', rotate=True, apply=True, stdout=io.StringIO())
        workflow.refresh_from_db()
        rotated = [workflow.secret_variables, publish.call_args.args[0].secret_variables]
        for revision in revisions:
            revision.refresh_from_db()
            rotated.append(revision.manifest['secret_variables'])
        for variables in rotated:
            self.assertNotEqual(variables, original)
            self.assertEqual(decrypt_secret_variable('token', variables['token'], [new_key]), self.value)

    def test_rotation_failure_rolls_back_draft_and_all_revisions(self):
        workflow = self.create_workflow()
        publish_workflow(workflow, register_deployment=False)
        original = dict(workflow.secret_variables)
        with (
            override_settings(WORKFLOW_ENCRYPTION_KEYS=[Fernet.generate_key().decode('ascii'), self.key]),
            patch('workflows.management.commands.migrate_workflow_secrets.publish_workflow', side_effect=ValueError('failed')),
            self.assertRaisesRegex(ValueError, 'failed'),
        ):
            call_command('migrate_workflow_secrets', rotate=True, apply=True, stdout=io.StringIO())
        workflow.refresh_from_db()
        self.assertEqual(workflow.secret_variables, original)
        self.assertEqual(WorkflowRevision.objects.get().manifest['secret_variables'], original)
