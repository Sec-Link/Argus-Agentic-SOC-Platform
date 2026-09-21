from copy import deepcopy
from uuid import uuid4

from django.contrib.admin.sites import AdminSite
from django.contrib.auth import get_user_model
from django.test import RequestFactory, TestCase, override_settings
from rest_framework.test import APIClient

from workflows.admin import ActionTemplateAdmin, WorkflowAdmin, WorkflowStepAdmin
from workflows.models import ActionTemplate, Workflow, WorkflowExecution, WorkflowRevision, WorkflowStep
from workflows.publisher import build_published_export, publish_workflow


@override_settings(WORKFLOW_ENCRYPTION_KEYS=[])
class WorkflowDefinitionWriteTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='definition-writes')
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.workflow = Workflow.objects.create(name='Published workflow', is_active=False)
        self.step = WorkflowStep.objects.create(workflow=self.workflow, name='Original step', action_type='log',
                                                action_config={'message': 'original'})
        publish_workflow(self.workflow)
        self.original_revision = self.workflow.published_revision_id
        self.workflow_url = f'/api/v1/workflows/workflows/{self.workflow.pk}/'
        self.step_url = f'/api/v1/workflows/steps/{self.step.pk}/'

    def assert_published_unchanged(self):
        self.workflow.refresh_from_db()
        self.assertEqual(self.workflow.published_revision_id, self.original_revision)
        self.assertEqual(WorkflowRevision.objects.filter(workflow=self.workflow).count(), 1)
        self.assertEqual(build_published_export(self.workflow)[0]['steps'][0]['name'], 'Original step')

    def step_payload(self, **changes):
        data = {'id': str(self.step.pk), 'order': 0, 'name': 'Edited step', 'action_type': 'log',
                'action_config': {'message': 'edited'}}
        return {**data, **changes}

    def test_empty_step_replacement_remains_dirty_and_keeps_published_export(self):
        response = self.client.patch(self.workflow_url, {'steps': [], 'is_draft': False}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(self.workflow.steps.exists())
        self.assert_published_unchanged()
        self.assertTrue(self.workflow.is_draft)

    def test_clients_cannot_clear_dirty_state_or_change_publication_version(self):
        self.step.name = 'Unpublished edit'
        self.step.save()
        response = self.client.patch(self.workflow_url, {'is_draft': False, 'version': 999}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assert_published_unchanged()
        self.assertTrue(self.workflow.is_draft)
        self.assertEqual(self.workflow.version, 1)

    def test_stale_control_only_save_cannot_clear_a_concurrent_step_edit(self):
        stale = Workflow.objects.get(pk=self.workflow.pk)
        self.step.name = 'Changed after workflow was loaded'
        self.step.save()
        stale.is_active = True
        stale.save(update_fields=['is_active'])
        self.assert_published_unchanged()
        self.assertTrue(self.workflow.is_draft)

    def test_standalone_step_update_cannot_replace_its_identity(self):
        sibling = WorkflowStep.objects.create(workflow=self.workflow, name='Sibling', action_type='log',
                                               action_config={'message': 'keep sibling'})
        for new_id in (str(sibling.pk), str(uuid4()), None):
            with self.subTest(new_id=new_id):
                response = self.client.patch(self.step_url, {'id': new_id, 'name': 'Attempted replacement'}, format='json')
                self.assertEqual(response.status_code, 400, response.data)
                self.step.refresh_from_db()
                sibling.refresh_from_db()
                self.assertEqual(self.step.name, 'Original step')
                self.assertEqual(sibling.name, 'Sibling')
                self.assertEqual(self.workflow.steps.count(), 2)
        response = self.client.patch(self.step_url, {'id': str(self.step.pk), 'name': 'Valid update'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.step.refresh_from_db()
        self.assertEqual(self.step.name, 'Valid update')
        self.assert_published_unchanged()

    def test_step_create_and_cross_workflow_ids_keep_parent_and_snapshot(self):
        other = Workflow.objects.create(name='Other workflow', is_active=False)
        foreign = WorkflowStep.objects.create(workflow=other, name='Foreign step', action_type='log', action_config={})
        response = self.client.post('/api/v1/workflows/steps/', {
            'workflow': str(self.workflow.pk), 'id': str(uuid4()), 'name': 'New step',
            'action_type': 'log', 'action_config': {'message': 'new'},
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        for method, url, payload in (
            ('post', '/api/v1/workflows/steps/', self.step_payload(id=str(foreign.pk), workflow=str(self.workflow.pk))),
            ('patch', self.step_url, {'workflow': str(other.pk)}),
            ('patch', self.workflow_url, {'steps': [self.step_payload(id=str(foreign.pk))]}),
        ):
            with self.subTest(method=method, url=url):
                response = getattr(self.client, method)(url, payload, format='json')
                self.assertEqual(response.status_code, 400, response.data)
                foreign.refresh_from_db()
                self.assertEqual(foreign.workflow_id, other.pk)
                self.assertEqual(foreign.name, 'Foreign step')
                self.assertEqual(self.workflow.steps.count(), 2)
        self.assert_published_unchanged()
        self.assertTrue(self.workflow.is_draft)

    def test_standalone_branch_references_accept_blanks_and_preserve_omitted_fields(self):
        target = WorkflowStep.objects.create(workflow=self.workflow, name='Branch target', action_type='log', action_config={})
        response = self.client.patch(self.step_url, {
            'next_step_true': str(target.pk), 'next_step_false': '',
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        response = self.client.patch(self.step_url, {'name': 'Rename only'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.step.refresh_from_db()
        self.assertEqual(self.step.next_step_true, target.pk)
        self.assertIsNone(self.step.next_step_false)
        response = self.client.patch(self.step_url, {'next_step_true': 'not-a-uuid'}, format='json')
        self.assertEqual(response.status_code, 400, response.data)
        self.step.refresh_from_db()
        self.assertEqual(self.step.next_step_true, target.pk)

    def test_duplicate_ids_in_nested_replacement_fail_without_partial_update(self):
        first = self.step_payload(name='First duplicate')
        second = {**deepcopy(first), 'name': 'Second duplicate'}
        response = self.client.patch(self.workflow_url, {
            'description': 'Must not persist', 'steps': [first, second],
        }, format='json')
        self.assertEqual(response.status_code, 400, response.data)
        self.workflow.refresh_from_db()
        self.step.refresh_from_db()
        self.assertEqual(self.workflow.description, '')
        self.assertFalse(self.workflow.is_draft)
        self.assertEqual(self.step.name, 'Original step')
        self.assert_published_unchanged()

    def test_admin_bulk_step_delete_marks_dirty_and_workflow_delete_cascades(self):
        request = RequestFactory().post('/admin/workflows/')
        request.user = self.user
        site = AdminSite()
        step_admin = WorkflowStepAdmin(WorkflowStep, site)
        workflow_admin = WorkflowAdmin(Workflow, site)
        self.assertIn('workflow', step_admin.get_readonly_fields(request, self.step))
        for field in ('version', 'is_draft', 'published_revision'):
            self.assertIn(field, workflow_admin.get_readonly_fields(request, self.workflow))
        step_admin.delete_queryset(request, WorkflowStep.objects.filter(pk=self.step.pk))
        self.assert_published_unchanged()
        self.assertTrue(self.workflow.is_draft)
        self.assertFalse(self.workflow.steps.exists())
        WorkflowExecution.objects.create(workflow=self.workflow, workflow_version=1)
        workflow_admin.delete_queryset(request, Workflow.objects.filter(pk=self.workflow.pk))
        self.assertFalse(WorkflowRevision.objects.exists())
        self.assertFalse(WorkflowExecution.objects.exists())

    def test_template_changes_and_admin_deletion_mark_dirty_without_rewriting_export(self):
        template = ActionTemplate.objects.create(name='Log defaults', action_type='log', default_config={'message': 'before'})
        workflow = Workflow.objects.create(name='Uses template', is_active=False)
        WorkflowStep.objects.create(workflow=workflow, name='Template step', action_type='log', action_template=template)
        publish_workflow(workflow)
        template.default_config = {'message': 'after'}
        template.save()
        workflow.refresh_from_db()
        self.assertTrue(workflow.is_draft)
        self.assertEqual(build_published_export(workflow)[0]['steps'][0]['action_config']['message'], 'before')
        publish_workflow(workflow)
        ActionTemplateAdmin(ActionTemplate, AdminSite()).delete_queryset(None, ActionTemplate.objects.filter(pk=template.pk))
        workflow.refresh_from_db()
        self.assertTrue(workflow.is_draft)
        self.assertIsNone(workflow.steps.get().action_template_id)
        self.assertEqual(build_published_export(workflow)[0]['steps'][0]['action_config']['message'], 'after')
