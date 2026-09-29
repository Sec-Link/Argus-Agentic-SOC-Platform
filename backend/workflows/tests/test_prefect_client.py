from __future__ import annotations

import os
from unittest.mock import Mock, patch

import requests
from django.test import SimpleTestCase

from workflows import prefect_client


class PrefectClientTests(SimpleTestCase):
    def setUp(self) -> None:
        self.env = patch.dict(os.environ, {
            'PREFECT_API_URL': 'http://prefect.test/api',
            'PREFECT_DEPLOYMENT_ID': 'deployment-id',
        })
        self.env.start()
        self.addCleanup(self.env.stop)

    @staticmethod
    def response(payload, status=200, text='{}'):
        response = Mock(status_code=status, text=text, content=text.encode())
        response.json.return_value = payload
        return response

    @patch('workflows.prefect_client.requests.post')
    def test_create_flow_run_sends_run_idempotency_and_api_version(self, post: Mock) -> None:
        post.return_value = self.response({'id': 'flow-run-id', 'state': {'type': 'SCHEDULED'}})
        run = {'schema_version': 1, 'execution_id': 'execution-id'}

        result = prefect_client.create_flow_run(
            parameters={'run': run},
            deployment_id='deployment-id',
            idempotency_key='execution-id',
        )

        self.assertEqual(result['id'], 'flow-run-id')
        self.assertEqual(post.call_args.args[0], 'http://prefect.test/api/deployments/deployment-id/create_flow_run')
        self.assertEqual(post.call_args.kwargs['json'], {
            'parameters': {'run': run},
            'idempotency_key': 'execution-id',
        })
        self.assertEqual(post.call_args.kwargs['headers']['X-PREFECT-API-VERSION'], '0.8.4')

    @patch('workflows.prefect_client.requests.post')
    def test_list_deployments_uses_filter_endpoint(self, post: Mock) -> None:
        post.return_value = self.response([{'id': 'one', 'name': 'soar-generic'}])

        deployments = prefect_client.list_deployments(limit=25)

        self.assertEqual(deployments[0]['name'], 'soar-generic')
        self.assertEqual(post.call_args.args[0], 'http://prefect.test/api/deployments/filter')
        self.assertEqual(post.call_args.kwargs['json'], {'limit': 25, 'offset': 0, 'sort': 'NAME_ASC'})

    def test_environment_deployment_is_never_a_fallback(self):
        self.assertFalse(prefect_client.is_configured())
        self.assertFalse(prefect_client.is_configured('  '))
        self.assertTrue(prefect_client.is_configured('deployment-id'))
        with self.assertRaises(prefect_client.PrefectConfigError):
            prefect_client.resolve_deployment_id()

    @patch('workflows.prefect_client.requests.post')
    def test_list_deployments_collects_all_pages_and_rejects_incomplete_snapshots(self, post):
        post.side_effect = [self.response([{'id': 'one'}]), self.response([{'id': 'two'}]), self.response([])]
        self.assertEqual(prefect_client.list_deployments(limit=1), [{'id': 'one'}, {'id': 'two'}])
        self.assertEqual([call.kwargs['json']['offset'] for call in post.call_args_list], [0, 1, 2])
        for response in ({}, [None], [{'id': 'one'}]):
            with self.subTest(response=response):
                post.side_effect = [self.response([{'id': 'one'}]), self.response(response)]
                with self.assertRaises(prefect_client.PrefectAPIError):
                    prefect_client.list_deployments(limit=1)
        post.side_effect = [self.response([{'id': 'one'}]), requests.ConnectionError('second page unavailable')]
        with self.assertRaises(prefect_client.PrefectAPIError):
            prefect_client.list_deployments(limit=1)

    @patch('workflows.prefect_client.requests.get')
    def test_missing_deployment_schedules_have_a_specific_error(self, get):
        get.return_value = self.response({}, status=404)
        with self.assertRaises(prefect_client.PrefectDeploymentNotFound):
            prefect_client.list_deployment_schedules('removed')

    @patch('workflows.prefect_client.requests.patch')
    @patch('workflows.prefect_client.requests.get')
    def test_schedule_upsert_updates_only_matching_schedule(self, get: Mock, patch_request: Mock) -> None:
        get.return_value = self.response([
            {'id': 'schedule-a', 'slug': 'argus-workflow-a'},
            {'id': 'schedule-b', 'slug': 'argus-workflow-b'},
        ])
        patch_request.return_value = self.response({}, status=204, text='')

        prefect_client.upsert_deployment_schedule(
            deployment_id='deployment-id',
            slug='argus-workflow-b',
            schedule={'cron': '0 * * * *', 'timezone': 'UTC'},
            is_active=False,
            parameters={'run': {'schema_version': 1}},
        )

        self.assertEqual(
            patch_request.call_args.args[0],
            'http://prefect.test/api/deployments/deployment-id/schedules/schedule-b',
        )
        self.assertNotIn('schedules', patch_request.call_args.kwargs['json'])
        self.assertEqual(patch_request.call_args.kwargs['json']['parameters']['run']['schema_version'], 1)

    @patch('workflows.prefect_client.requests.post', side_effect=requests.ConnectionError('offline'))
    def test_network_errors_are_mapped(self, post: Mock) -> None:
        with self.assertRaises(prefect_client.PrefectAPIError):
            prefect_client.list_deployments()

    @patch('workflows.prefect_client._request')
    def test_events_follow_pages_on_configured_server_only(self, request):
        request.side_effect = [
            self.response({'events': [{'id': 'first'}], 'next_page': 'https://other.test/api/events/filter/next?page-token=abc%3D'}),
            self.response({'events': [{'id': 'last'}], 'next_page': None}),
        ]
        self.assertEqual(list(prefect_client.iter_events({})), [{'id': 'first'}, {'id': 'last'}])
        # Use the server's default page size; Prefect's event API caps it at 50.
        self.assertEqual(request.call_args_list[0].kwargs['json'], {'filter': {}})
        self.assertEqual(request.call_args.args, ('get', '/events/filter/next'))
        self.assertEqual(request.call_args.kwargs['params'], {'page-token': 'abc='})

    def test_self_hosted_prefect_auth_string_is_used_for_replay_requests(self):
        with patch.dict(os.environ, {'PREFECT_API_KEY': '', 'PREFECT_API_AUTH_STRING': 'user:pass'}):
            self.assertEqual(prefect_client._headers()['Authorization'], 'Basic dXNlcjpwYXNz')

    @patch('workflows.prefect_client._request')
    def test_schedule_cleanup_distinguishes_missing_deployment_from_invalid_response(self, request):
        request.return_value = self.response({}, status=404)
        with self.assertRaises(prefect_client.PrefectDeploymentNotFound):
            prefect_client.list_deployment_schedules('deployment-id')
        for payload in ({}, [None], [{'slug': 'unconfirmed'}]):
            request.return_value = self.response(payload)
            with self.subTest(payload=payload), self.assertRaises(prefect_client.PrefectAPIError):
                prefect_client.delete_deployment_schedule_by_slug(deployment_id='deployment-id', slug='unconfirmed')
