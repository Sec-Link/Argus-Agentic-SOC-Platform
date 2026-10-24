import json
import os
import socket
from types import SimpleNamespace
from unittest.mock import Mock, patch

import requests
from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import resolve
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIRequestFactory, force_authenticate

from alerts.models import Alert, ESIntegrationConfig
from alerts.services import _alerts_queryset_for_active_index
from alerts.tasks import sync_splunk_alerts_to_db
from integrations.http_client import ConnectorHttpError, _PinnedAdapter, connector_request, validate_connector_url
from integrations.models import Integration
from integrations.serializers import IntegrationSerializer, validate_splunk_config
from integrations.splunk import SplunkError, fetch_events, test_connection
from integrations.views import IntegrationViewSet, test_splunk_connection


CONFIG = {
    'host': 'https://splunk.example.test:8089', 'index': 'security',
    'auth_type': 'basic', 'username': 'synthetic-user', 'password': 'synthetic-password',
    'verify_certs': True, 'lookback_hours': 24,
}


def mock_response(content, status=200):
    response = Mock(status_code=status)
    response.__enter__ = Mock(return_value=response)
    response.__exit__ = Mock(return_value=False)
    response.iter_content.return_value = [content]
    return response


class SplunkConfigTests(SimpleTestCase):
    def test_config_validation_and_field_allowlist(self):
        validated = validate_splunk_config({**CONFIG, 'create_tickets': True, 'search': '| delete'})
        self.assertNotIn('create_tickets', validated)
        self.assertNotIn('search', validated)
        for invalid in ['*', 'security" | delete', 'a,b', 'a' * 65]:
            with self.subTest(index=invalid), self.assertRaises(ValidationError):
                validate_splunk_config({**CONFIG, 'index': invalid})

    def test_host_rejects_embedded_credentials_paths_queries_and_bad_ports(self):
        for host in ['file:///tmp/test', 'https://user:pass@example.test', 'https://example.test/admin',
                     'https://example.test?url=x', 'https://example.test:0', 'https://example.test:70000']:
            with self.subTest(host=host), self.assertRaises(ValidationError):
                validate_splunk_config({**CONFIG, 'host': host})

    def test_blank_credentials_preserve_saved_values_but_changed_target_needs_new_secret(self):
        self.assertEqual(validate_splunk_config({'password': ''}, CONFIG)['password'], CONFIG['password'])
        for config in [{'host': 'https://different.example.test:8089'}, {'username': 'different'}, {'password': '***'}]:
            with self.subTest(config=config), self.assertRaises(ValidationError):
                validate_splunk_config(config, CONFIG)

    def test_secrets_are_hidden_for_all_roles(self):
        instance = Integration(name='Splunk', type='splunk_search', config={**CONFIG, 'token': 'synthetic-token'})
        config = IntegrationSerializer(instance).data['config']
        self.assertNotIn('password', config)
        self.assertNotIn('token', config)
        self.assertTrue(config['password_configured'])
        self.assertTrue(config['token_configured'])

    @patch('integrations.serializers.is_user_readonly', return_value=False)
    def test_existing_elastic_contract_is_unchanged(self, _readonly):
        instance = Integration(name='ES', type='elasticsearch', config={'host': 'https://es.example.test', 'password': 'synthetic'})
        self.assertEqual(IntegrationSerializer(instance).data['config'], instance.config)
        serializer = IntegrationSerializer(data={'name': 'ES', 'type': 'elasticsearch', 'config': {'host': 'anything'}})
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_time_window_and_tls_are_validated(self):
        for config in [{'lookback_hours': 0}, {'lookback_hours': 169}, {'verify_certs': 'invalid'}]:
            with self.subTest(config=config), self.assertRaises(ValidationError):
                validate_splunk_config({**CONFIG, **config})


class SplunkTransportTests(SimpleTestCase):
    @patch('integrations.splunk.connector_request')
    def test_server_info_returns_only_safe_metadata_and_closes_response(self, request):
        request.return_value = mock_response(json.dumps({'entry': [{'content': {
            'version': '9.4.2', 'build': 'abc123', 'product_type': 'enterprise',
            'serverName': 'sensitive-host', 'token': 'synthetic-token', 'licenseKeys': ['secret'],
        }}]}, indent=2).encode())
        result = test_connection(CONFIG)
        self.assertEqual(result['server_info'], {'version': '9.4.2', 'build': 'abc123', 'product_type': 'enterprise'})
        self.assertNotIn('sensitive-host', json.dumps(result))
        request.return_value.__exit__.assert_called_once()

    @patch('integrations.splunk.connector_request')
    def test_token_auth_and_tls_toggle(self, request):
        request.return_value = mock_response(b'{"entry":[{"content":{"version":"9.4"}}]}')
        test_connection({**CONFIG, 'auth_type': 'token', 'token': 'synthetic-token', 'verify_certs': False})
        self.assertEqual(request.call_args.kwargs['headers']['Authorization'], 'Splunk synthetic-token')
        self.assertFalse(request.call_args.kwargs['verify'])
        self.assertIsNone(request.call_args.kwargs['auth'])

    @patch('integrations.splunk.connector_request')
    def test_export_reads_only_final_rows_and_uses_fixed_bounded_spl(self, request):
        rows = [{'preview': True, 'result': {'alert_id': 'preview'}}, {'preview': False, 'result': {'alert_id': 'final'}}]
        request.return_value = mock_response(('\n'.join(json.dumps(row) for row in rows)).encode())
        self.assertEqual(fetch_events(CONFIG, 20), [{'alert_id': 'final'}])
        self.assertTrue(request.call_args.args[1].endswith('/services/search/v2/jobs/export'))
        self.assertEqual(request.call_args.kwargs['data']['search'], 'search index="security" | head 20')
        self.assertEqual(request.call_args.kwargs['data']['earliest_time'], '-24h')

    @patch('integrations.splunk.connector_request')
    def test_upstream_failures_never_expose_response_or_exception_contents(self, request):
        for value in [mock_response(b'synthetic-secret', 401), mock_response(b'bad sensitive json'),
                      mock_response(b'{"messages":[{"type":"ERROR","text":"sensitive details"}]}')]:
            request.return_value = value
            with self.assertRaises(SplunkError) as caught:
                fetch_events(CONFIG, 10)
            self.assertNotIn('sensitive', str(caught.exception))
        request.side_effect = requests.ConnectionError('synthetic-password')
        with self.assertRaisesMessage(SplunkError, 'Could not connect to Splunk.'):
            test_connection(CONFIG)

    @patch('integrations.splunk.connector_request')
    def test_oversized_and_truncated_streams_fail_without_partial_success(self, request):
        request.return_value = mock_response(b'x' * (1024 * 1024 + 1))
        with self.assertRaises(SplunkError):
            fetch_events(CONFIG, 10)
        response = mock_response(b'')
        response.iter_content.side_effect = requests.Timeout('synthetic-secret')
        request.return_value = response
        with self.assertRaisesMessage(SplunkError, 'Splunk request timed out.'):
            fetch_events(CONFIG, 10)

    @override_settings(DEBUG=False)
    @patch.dict(os.environ, {'CONNECTOR_HTTP_ALLOWED_HOSTS': 'splunk.example.test'})
    @patch('integrations.http_client.socket.getaddrinfo')
    def test_metadata_loopback_and_ipv4_mapped_metadata_are_always_blocked(self, resolve_ip):
        for address in ['169.254.169.254', '100.100.100.200', '127.0.0.1', '::ffff:169.254.169.254']:
            resolve_ip.return_value = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', (address, 8089))]
            with self.subTest(address=address), self.assertRaises(ConnectorHttpError):
                validate_connector_url(CONFIG['host'])

    @override_settings(DEBUG=False)
    @patch.dict(os.environ, {'CONNECTOR_HTTP_ALLOWED_HOSTS': ''})
    @patch('integrations.http_client.socket.getaddrinfo', return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('10.1.2.3', 8089))])
    def test_explicit_allowlist_is_required_in_production(self, _resolve):
        with self.assertRaises(ConnectorHttpError):
            validate_connector_url(CONFIG['host'])

    @patch('integrations.http_client.socket.getaddrinfo', return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('10.1.2.3', 8089))])
    @patch('integrations.http_client.requests.Session')
    @override_settings(DEBUG=False)
    @patch.dict(os.environ, {'CONNECTOR_HTTP_ALLOWED_HOSTS': 'splunk.example.test'})
    def test_requests_pin_checked_ip_disable_proxies_and_forbid_redirects(self, session_class, _resolve):
        session = session_class.return_value.__enter__.return_value
        connector_request('GET', CONFIG['host'], allow_redirects=True)
        self.assertFalse(session.trust_env)
        self.assertFalse(session.request.call_args.kwargs['allow_redirects'])
        adapter = session.mount.call_args.args[1]
        self.assertEqual(adapter.address, '10.1.2.3')
        self.assertEqual(session.request.call_args.kwargs['headers']['Host'], 'splunk.example.test:8089')

    def test_pinned_https_retains_tls_hostname_and_sni(self):
        adapter = _PinnedAdapter('10.1.2.3', 'splunk.example.test')
        request = requests.Request('GET', CONFIG['host']).prepare()
        with patch.object(adapter.poolmanager, 'connection_from_host') as pool:
            adapter.get_connection_with_tls_context(request, verify=True)
        self.assertEqual(pool.call_args.kwargs['host'], '10.1.2.3')
        self.assertEqual(pool.call_args.kwargs['pool_kwargs']['server_hostname'], 'splunk.example.test')
        self.assertEqual(pool.call_args.kwargs['pool_kwargs']['assert_hostname'], 'splunk.example.test')
        adapter.close()

    @override_settings(DEBUG=False)
    @patch.dict(os.environ, {'CONNECTOR_HTTP_ALLOWED_HOSTS': '10.1.0.0/16'})
    @patch('integrations.http_client.socket.getaddrinfo')
    def test_cidr_allowlist_checks_all_dns_answers(self, resolve_ip):
        resolve_ip.return_value = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', (ip, 8089)) for ip in ['10.1.2.3', '10.2.3.4']]
        with self.assertRaises(ConnectorHttpError):
            validate_connector_url(CONFIG['host'])


class SplunkIngestionTests(TestCase):
    def setUp(self):
        self.integration = Integration.objects.create(name='Splunk', type='splunk_search', config=CONFIG)

    @patch('alerts.splunk.fetch_events')
    @patch('risk.services.process_alert_for_risk')
    @patch('tickets.models.EventTicket.objects.create')
    def test_json_raw_fields_map_and_repeated_fetch_updates_without_automation(self, ticket, risk, fetch):
        fetch.return_value = [{'_time': '2026-10-24T00:00:00Z', '_raw': json.dumps({
            'alert_id': 'native-1', 'severity': 'high', 'title': 'Synthetic', 'message': 'Synthetic message',
            'rule_id': 'rule-1', 'status': 1, 'description': 'Details', 'category': 'malware',
        })}]
        first = sync_splunk_alerts_to_db(integration_id=self.integration.id)
        second = sync_splunk_alerts_to_db(integration_id=self.integration.id)
        self.assertEqual((first['inserted'], second['updated']), (1, 1))
        self.assertEqual(Alert.objects.count(), 1)
        alert = Alert.objects.get()
        self.assertEqual((alert.severity, alert.title, alert.rule_id, alert.status, alert.category), ('high', 'Synthetic', 'rule-1', 1, 'malware'))
        self.assertEqual(alert.timestamp.isoformat(), '2026-10-24T00:00:00+00:00')
        self.assertEqual(alert.source_index, 'security')
        self.assertLessEqual(len(alert.alert_id), 64)
        self.assertEqual(alert.source_data['external_alert_id'], 'native-1')
        ticket.assert_not_called()
        risk.assert_not_called()

    @patch('alerts.splunk.fetch_events')
    def test_identity_is_stable_without_native_id_and_isolated_between_sources(self, fetch):
        fetch.return_value = [{'_time': '1792800000', '_raw': 'synthetic', 'title': 'Synthetic', 'severity': 'low'}]
        sync_splunk_alerts_to_db(integration_id=self.integration.id)
        sync_splunk_alerts_to_db(integration_id=self.integration.id)
        second = Integration.objects.create(name='Another Splunk', type='splunk_search', config=CONFIG)
        sync_splunk_alerts_to_db(integration_id=second.id)
        self.assertEqual(Alert.objects.count(), 2)

    @patch('alerts.splunk.fetch_events')
    def test_splunk_alerts_remain_visible_with_active_es_index(self, fetch):
        ESIntegrationConfig.objects.create(index='es-alerts', enabled=True)
        fetch.return_value = [{'alert_id': 'native', 'timestamp': timezone.now().isoformat()}]
        sync_splunk_alerts_to_db(integration_id=self.integration.id)
        Alert.objects.create(alert_id='es-1', source_index='es-alerts')
        Alert.objects.create(alert_id='old-es', source_index='old-index')
        self.assertEqual(_alerts_queryset_for_active_index().count(), 2)

    @patch('integrations.views.test_splunk')
    def test_new_test_route_has_no_trailing_slash_and_requires_change_permission(self, test):
        self.assertEqual(resolve('/api/v1/integrations/test_splunk').url_name, 'test_splunk')
        request = APIRequestFactory().post('/api/v1/integrations/test_splunk', CONFIG, format='json')
        user = SimpleNamespace(is_authenticated=True, is_superuser=False, is_staff=True, has_perm=lambda perm: False)
        force_authenticate(request, user=user)
        self.assertEqual(test_splunk_connection(request).status_code, 403)
        test.assert_not_called()

    @patch('accounts.audit.AuditService.log_from_request')
    @patch('alerts.tasks.sync_splunk_alerts_to_db')
    def test_fetch_enforces_alert_write_permissions_and_audits_counts(self, sync, audit):
        view = IntegrationViewSet.as_view({'post': 'fetch_data'})
        factory = APIRequestFactory()
        user = SimpleNamespace(pk=1, is_authenticated=True, is_superuser=False, is_staff=True, email='synthetic@example.test', has_perm=lambda perm: perm == 'integrations.change_integration')
        request = factory.post('/fetch-data/', {}, format='json')
        force_authenticate(request, user=user)
        self.assertEqual(view(request, pk=str(self.integration.id)).status_code, 403)
        sync.assert_not_called()
        user.has_perm = lambda perm: True
        sync.return_value = {'ok': True, 'fetched': 1, 'inserted': 1, 'updated': 0, 'skipped': 0, 'errors': []}
        request = factory.post('/fetch-data/', {'size': 10}, format='json')
        force_authenticate(request, user=user)
        self.assertEqual(view(request, pk=str(self.integration.id)).status_code, 200)
        self.assertEqual(audit.call_args.kwargs['metadata']['inserted'], 1)
        self.assertNotIn('config', audit.call_args.kwargs['metadata'])

    @patch('accounts.services.is_user_readonly', return_value=True)
    def test_readonly_users_cannot_fetch(self, _readonly):
        request = APIRequestFactory().post('/fetch-data/', {}, format='json')
        user = SimpleNamespace(is_authenticated=True, is_superuser=False, is_staff=False, has_perm=lambda perm: True)
        force_authenticate(request, user=user)
        response = IntegrationViewSet.as_view({'post': 'fetch_data'})(request, pk=str(self.integration.id))
        self.assertEqual(response.status_code, 403)

    def test_fetch_rejects_invalid_batch_sizes(self):
        user = SimpleNamespace(pk=1, is_authenticated=True, is_superuser=True, is_staff=True)
        for size in [0, 1001, 'invalid']:
            request = APIRequestFactory().post('/fetch-data/', {'size': size}, format='json')
            force_authenticate(request, user=user)
            response = IntegrationViewSet.as_view({'post': 'fetch_data'})(request, pk=str(self.integration.id))
            self.assertEqual(response.status_code, 400)

    @patch('integrations.views.test_splunk', return_value={'ok': True, 'status': 200, 'server_info': {'version': '9.4'}})
    def test_unsaved_connection_needs_no_type_discriminator(self, test):
        request = APIRequestFactory().post('/api/v1/integrations/test_splunk', CONFIG, format='json')
        user = SimpleNamespace(pk=1, is_authenticated=True, is_superuser=True, is_staff=True)
        force_authenticate(request, user=user)
        response = test_splunk_connection(request)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['ok'])
        test.assert_called_once()

    @patch('alerts.splunk.fetch_events')
    def test_saving_does_not_fetch_and_response_never_echoes_credentials(self, fetch):
        request = APIRequestFactory().post('/integrations/', {
            'name': 'New Splunk', 'type': 'splunk_search', 'config': CONFIG,
        }, format='json')
        user = SimpleNamespace(pk=1, is_authenticated=True, is_superuser=True, is_staff=True)
        force_authenticate(request, user=user)
        response = IntegrationViewSet.as_view({'post': 'create'})(request)
        self.assertEqual(response.status_code, 201)
        self.assertNotIn('password', response.data['config'])
        self.assertTrue(response.data['config']['password_configured'])
        fetch.assert_not_called()

    @patch('integrations.views.test_splunk', return_value={'ok': True, 'status': 200, 'server_info': {}})
    def test_saved_connection_uses_server_side_credentials(self, test):
        request = APIRequestFactory().post('/test/', {'config': {'password': '', 'index': 'another'}}, format='json')
        force_authenticate(request, user=SimpleNamespace(pk=1, is_authenticated=True, is_superuser=True, is_staff=True))
        response = IntegrationViewSet.as_view({'post': 'test'})(request, pk=str(self.integration.id))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(test.call_args.args[0]['password'], CONFIG['password'])
        self.integration.refresh_from_db()
        self.assertEqual(self.integration.config['index'], 'security')

    @patch('accounts.audit.AuditService.log_from_request')
    @patch('alerts.tasks.sync_splunk_alerts_to_db', side_effect=SplunkError('Splunk returned HTTP 403.'))
    def test_fetch_failure_is_not_reported_as_success(self, sync, audit):
        request = APIRequestFactory().post('/fetch-data/', {}, format='json')
        force_authenticate(request, user=SimpleNamespace(pk=1, is_authenticated=True, is_superuser=True, is_staff=True, email='synthetic@example.test'))
        response = IntegrationViewSet.as_view({'post': 'fetch_data'})(request, pk=str(self.integration.id))
        self.assertEqual(response.status_code, 502)
        self.assertFalse(response.data['ok'])
        self.assertEqual(audit.call_args.kwargs['status'], 'failure')
