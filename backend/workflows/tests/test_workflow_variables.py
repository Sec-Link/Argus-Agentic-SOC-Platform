from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.test import TestCase

from workflows.prefect.executor import execute_action
from workflows.prefect.flow import run_soar_workflow
from workflows.publisher import build_published_export, import_workflow_from_json_payload, publish_workflow
from workflows.serializers import WorkflowCreateSerializer, WorkflowDetailSerializer


class WorkflowVariablesTests(TestCase):
    def test_declarations_survive_save_reopen_publish_import_and_clone(self):
        user = get_user_model().objects.create_user(username='workflow-variables')
        variables = {'recipient': 'soc@example.com', 'nested': {'site': 'SOC'}, 'enabled': False}
        serializer = WorkflowCreateSerializer(data={
            'name': 'Variables', 'variables': variables,
            'steps': [{'order': 0, 'name': 'Log', 'action_type': 'log', 'action_config': {'message': '{{variables.recipient}}'}}],
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)
        workflow = serializer.save(created_by=user)
        workflow.refresh_from_db()
        self.assertEqual(WorkflowDetailSerializer(workflow).data['variables'], variables)

        for invalid in ([], '', None, {'bad.name': 1}, {'1name': 1}, {'na-me': 1}, {'名字': 1}):
            serializer = WorkflowCreateSerializer(workflow, data={'variables': invalid}, partial=True)
            self.assertFalse(serializer.is_valid())
            self.assertIn('variables', serializer.errors)

        with TemporaryDirectory() as directory, patch('workflows.publisher.GENERATED_FLOWS_DIR', Path(directory)):
            publish_workflow(workflow, register_deployment=False)
            changed = WorkflowCreateSerializer(workflow, data={'variables': {'recipient': 'new@example.com'}}, partial=True)
            self.assertTrue(changed.is_valid(), changed.errors)
            changed.save()
            exported, _ = build_published_export(workflow)
            self.assertEqual(exported['variables'], variables)
            imported = import_workflow_from_json_payload(exported, created_by=user, update_existing=False)
            imported.refresh_from_db()
            self.assertEqual(WorkflowDetailSerializer(imported).data['variables'], variables)
            self.assertEqual(imported.steps.get().action_config['message'], '{{variables.recipient}}')
            clone = imported.clone(user=user)
            self.assertEqual(clone.variables, variables)
            clone.variables['nested']['site'] = 'Changed'
            self.assertEqual(imported.variables['nested']['site'], 'SOC')

            exported.pop('variables')
            legacy = import_workflow_from_json_payload(exported, created_by=user, update_existing=False)
            self.assertEqual(legacy.variables, {})

    def test_declared_variables_resolve_in_actions_and_conditions_without_mutating_the_manifest(self):
        workflow_id, condition_id, action_id = (str(uuid4()) for _ in range(3))
        definition = {
            'id': workflow_id, 'name': 'Runtime variables',
            'variables': {'recipient': 'soc@example.com', 'priority': 'high', 'nested': {'runs': 0}},
            'steps': [
                {'id': condition_id, 'order': 0, 'name': 'Condition', 'node_type': 'condition',
                 'condition': {'field': 'trigger_data.priority', 'operator': 'equals', 'value': '{{variables.priority}}'},
                 'next_step_true': action_id},
                {'id': action_id, 'order': 1, 'name': 'Log', 'node_type': 'action', 'action_type': 'log',
                 'action_config': {'message': '{{variables.recipient}} / {{variables.nested.runs}}'}},
            ],
        }
        original = deepcopy(definition)
        run = {'schema_version': 1, 'workflow': {'id': workflow_id, 'version': 1, 'definition': definition},
               'trigger': {'source': 'manual', 'data': {'priority': 'high'}}}

        def action_with_context_mutation(action_type, config, context):
            context['variables']['nested']['runs'] += 1
            return execute_action(action_type, config, context)

        with (
            patch('workflows.prefect.flow.flow_run', SimpleNamespace(id=uuid4())),
            patch('workflows.prefect.flow.get_run_logger', return_value=Mock()),
            patch('workflows.prefect.flow.emit_event') as emit,
            patch('workflows.prefect.flow.execute_action_task', SimpleNamespace(with_options=lambda **kwargs: action_with_context_mutation)),
        ):
            for _ in range(2):
                result = run_soar_workflow.fn(run)
                self.assertTrue(result['step_results'][0]['output_data']['condition_matched'])
                self.assertEqual(result['step_results'][1]['output_data']['message'], 'soc@example.com / 1')
                self.assertEqual(emit.call_args.kwargs['payload']['context']['variables']['message'], 'soc@example.com / 1')
                self.assertEqual(definition, original)
            definition['variables'] = []
            with self.assertRaisesRegex(ValueError, 'variables must be an object'):
                run_soar_workflow.fn(run)
