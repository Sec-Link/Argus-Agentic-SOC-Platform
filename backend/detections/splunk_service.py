"""Publish generated SPL with durable operation records and target isolation."""

import hashlib
import json
import time
import uuid
from datetime import timedelta
from urllib.parse import quote

import requests
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from accounts.audit import AuditService, request_ip, request_user_agent
from accounts.models import AuditLog
from integrations.http_client import ConnectorHttpError, connector_request, validate_connector_url
from integrations.serializers import validate_splunk_config
from integrations.splunk import request_options

from .models import LocalDetectionDeployment, SplunkRulePublication
from .services import user_name_from_request
from .sigma import extract_rule_meta
from .splunk_compiler import compile_splunk


class PublicationConflict(APIException):
    status_code = 409
    default_detail = 'The publication state changed. Refresh before retrying.'


class SplunkPublishError(APIException):
    status_code = 502
    default_detail = 'Splunk publication failed. Refresh the remote state before retrying.'


def remote_name(rule, integration):
    return 'argus_' + uuid.uuid5(uuid.NAMESPACE_URL, f'{rule.rule_uuid}:{integration.pk}').hex


def _marker(publication):
    return f'Argus rule ID: {publication.rule.rule_uuid}; integration: {publication.integration_id}'


def _path(config, name=''):
    base = f"/servicesNS/{quote(config['owner'], safe='')}/{quote(config['app'], safe='')}/saved/searches"
    return base + ('/' + quote(name, safe='') if name else '')


def _request(config, method, path, data=None):
    started = time.monotonic()
    try:
        with connector_request(method, config['host'] + path, params={'output_mode': 'json'},
                               data=data, stream=True, **request_options(config)) as response:
            if response.status_code == 404 and method == 'GET':
                return None
            if not 200 <= response.status_code < 300:
                raise SplunkPublishError(f'Splunk returned HTTP {response.status_code}. Check publisher permissions and configuration.')
            raw = bytearray()
            for chunk in response.iter_content(65536):
                raw.extend(chunk)
                if len(raw) > 1024 * 1024 or time.monotonic() - started > 25:
                    raise SplunkPublishError('Splunk response exceeded the size or time limit.')
            result = json.loads(raw) if raw else {}
            if not isinstance(result, dict):
                raise ValueError
            messages = result.get('messages') or []
            if not isinstance(messages, list):
                raise ValueError
            if any(isinstance(item, dict) and item.get('type') in {'ERROR', 'FATAL'} for item in messages):
                raise SplunkPublishError('Splunk rejected the saved-search request. Review the publisher configuration.')
            return result
    except ConnectorHttpError as exc:
        raise SplunkPublishError(str(exc)) from exc
    except requests.exceptions.SSLError as exc:
        raise SplunkPublishError('Splunk TLS certificate verification failed.') from exc
    except (requests.RequestException, OSError, ValueError) as exc:
        raise SplunkPublishError('Splunk request failed or returned invalid JSON. Refresh before retrying.') from exc


def _read_remote(publication, config):
    result = _request(config, 'GET', _path(config, publication.remote_name))
    if result is None:
        return None
    try:
        content = result['entry'][0]['content']
        if not isinstance(content, dict):
            raise ValueError
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise SplunkPublishError('Splunk returned an unexpected saved-search response.') from exc
    if not str(content.get('description', '')).startswith(_marker(publication) + '\n'):
        raise PublicationConflict('The remote name is not owned by this Argus publication.')
    if str(content.get('disabled')).lower() not in {'0', '1', 'true', 'false'}:
        raise SplunkPublishError('Splunk returned an invalid saved-search enabled state.')
    return content


def _boolean(value):
    return str(value).lower() in {'1', 'true'}


def _matches(content, parameters):
    bool_fields = {'is_scheduled', 'disabled', 'alert.digest_mode', 'alert.track', 'alert.suppress', 'action.email', 'action.webhook'}
    ignored = {'disabled'}
    for flag, option in [('alert.suppress', 'alert.suppress.period'), ('action.email', 'action.email.to'),
                         ('action.webhook', 'action.webhook.param.url')]:
        if not _boolean(parameters.get(flag)):
            ignored.add(option)
    for key, expected in parameters.items():
        if key in ignored:
            continue
        actual = content.get(key, '')
        if key in bool_fields:
            matches = _boolean(actual) == _boolean(expected)
        elif key in {'actions', 'action.email.to'}:
            matches = {part.strip() for part in str(actual).split(',') if part.strip()} == {
                part.strip() for part in str(expected).split(',') if part.strip()
            }
        else:
            matches = str(actual).strip() == str(expected).strip()
        if not matches:
            return False
    return True


def _publish_payload(publication, rule):
    config = publication.config
    yaml_text = str(rule.payload.get('yaml') or '')
    compiled = compile_splunk(yaml_text, index=config['index'], sourcetype=config['sourcetype'])
    meta = extract_rule_meta(yaml_text)
    spl = compiled['splunk']
    query = spl if spl.startswith('search ') else f'search {spl}'
    actions = [name for name, active in [('webhook', config['webhook_url']), ('email', config['email_to'])] if active]
    if config['webhook_url']:
        try:
            validate_connector_url(config['webhook_url'])
        except ConnectorHttpError as exc:
            raise ValidationError(str(exc)) from exc
    parameters = {
        'description': _marker(publication) + '\n' + str(meta.get('title') or rule.name) + '\n' + str(meta.get('description') or ''),
        'search': query, 'is_scheduled': '1', 'disabled': '1',
        'cron_schedule': config['cron_schedule'],
        'dispatch.earliest_time': f'-{config["lookback_minutes"]}m', 'dispatch.latest_time': 'now',
        'alert_type': 'number of events', 'alert_comparator': config['comparator'],
        'alert_condition': '',
        'alert_threshold': str(config['threshold']), 'alert.track': '1',
        'alert.severity': str({'informational': 1, 'low': 2, 'medium': 3, 'high': 4, 'critical': 5}.get(str(meta.get('level') or rule.severity), 3)),
        'alert.digest_mode': '1' if config['digest_mode'] else '0',
        'alert.suppress': '1' if config['suppress_seconds'] else '0',
        'alert.suppress.period': f'{config["suppress_seconds"]}s' if config['suppress_seconds'] else '',
        'actions': ','.join(actions),
        'action.webhook': '1' if config['webhook_url'] else '0',
        'action.webhook.param.url': config['webhook_url'],
        'action.email': '1' if config['email_to'] else '0',
        'action.email.to': ','.join(config['email_to']),
    }
    return {'version': rule.version, 'source_hash': hashlib.sha256(yaml_text.encode()).hexdigest(),
            'config': config, 'query': query, 'parameters': parameters}


def _assert_idle(publication):
    if publication.busy_until and publication.busy_until > timezone.now():
        raise PublicationConflict('An operation is in progress. Refresh after it finishes.')


def save_publication(rule, integration, config, actor):
    with transaction.atomic():
        # Lock the parent to serialize first-time upserts before the unique row exists.
        rule = type(rule).objects.select_for_update().get(pk=rule.pk)
        if rule.is_deleted:
            raise PublicationConflict('The local rule was deleted. Reload the rule list.')
        publication, _ = SplunkRulePublication.objects.select_for_update().get_or_create(
            rule=rule, integration=integration, defaults={'remote_name': remote_name(rule, integration)},
        )
        _assert_idle(publication)
        if publication.status in {'pending', 'pending_sync'}:
            raise PublicationConflict('Refresh the uncertain remote state before changing this configuration.')
        publication.config = config
        publication.updated_by = actor
        publication.save()
        return publication


def execute_publication(publication, action, request, expected_version=None):
    actor = user_name_from_request(request)
    with transaction.atomic():
        publication = SplunkRulePublication.objects.select_for_update().select_related('rule', 'integration').get(pk=publication.pk)
        _assert_idle(publication)
        if publication.rule.is_deleted and action not in {'delete', 'disable', 'refresh'}:
            raise PublicationConflict('The local rule was deleted. Only remote cleanup is allowed.')
        if action not in {'refresh', 'delete', 'disable'} and publication.status in {'pending', 'pending_sync'}:
            raise PublicationConflict('Refresh the uncertain remote state before retrying.')
        local_only = action == 'delete' and publication.status == 'draft' and not publication.published_version and not publication.pending_payload
        connection = None if local_only else validate_splunk_config(publication.integration.config, publisher=True)
        snapshot = dict(publication.pending_payload)
        if action == 'publish':
            if publication.rule.version != expected_version:
                raise PublicationConflict('The local rule changed. Reload it before publishing.')
            snapshot = _publish_payload(publication, publication.rule)
        if action == 'enable' and (publication.status != 'synced' or not publication.published_version
                or publication.config != publication.published_config):
            raise PublicationConflict('Publish the current configuration and rule version before enabling.')
        if action == 'enable':
            current_snapshot = _publish_payload(publication, publication.rule)
            if (current_snapshot['source_hash'] != publication.published_source_hash
                    or current_snapshot['query'] != publication.published_query):
                raise PublicationConflict('Sigma or field mappings changed. Republish before enabling.')
        operation = uuid.uuid4()
        if publication.operation_id:
            LocalDetectionDeployment.objects.filter(
                target=f'splunk:{publication.integration_id}', status='pending', payload__publication_id=str(publication.pk),
            ).update(status='pending_sync', message='Operation lease expired; remote state is being reconciled.')
        publication.operation_id = operation
        publication.busy_until = timezone.now() + timedelta(seconds=180)
        publication.pending_payload = snapshot
        publication.status = 'pending'
        publication.message = ''
        publication.save()
        record = LocalDetectionDeployment.objects.create(
            rule=publication.rule, rule_name=publication.rule.name, target=f'splunk:{publication.integration_id}',
            action=action, status='pending', remote_id=publication.remote_name, remote_rule_id=publication.remote_name, created_by=actor,
            payload={'publication_id': str(publication.pk), 'rule_version': publication.rule.version},
        )

    try:
        content = None if local_only else _read_remote(publication, connection)
        path = None if local_only else _path(connection, publication.remote_name)
        if action == 'publish':
            parameters = snapshot['parameters']
            _request(connection, 'POST', path if content is not None else _path(connection),
                     data=parameters if content is not None else {'name': publication.remote_name, **parameters})
            content = _read_remote(publication, connection)
            if content is None or not _matches(content, parameters) or not _boolean(content.get('disabled')):
                raise SplunkPublishError('Splunk did not confirm the disabled rule configuration. Refresh before retrying.')
        elif action in {'enable', 'disable'}:
            if content is None:
                raise PublicationConflict('The remote rule no longer exists. Publish it again.')
            if action == 'enable' and not _matches(content, publication.published_parameters):
                raise PublicationConflict('The remote rule changed outside Argus. Republish before enabling.')
            _request(connection, 'POST', path, data={'disabled': '0' if action == 'enable' else '1'})
            content = _read_remote(publication, connection)
            if content is None or _boolean(content.get('disabled')) != (action == 'disable'):
                raise SplunkPublishError('Splunk did not confirm the requested enabled state.')
        elif action == 'delete' and content is not None:
            _request(connection, 'DELETE', path)
            if _read_remote(publication, connection) is not None:
                raise SplunkPublishError('Splunk did not confirm deletion. Refresh before retrying.')

        with transaction.atomic():
            current = SplunkRulePublication.objects.select_for_update().get(pk=publication.pk)
            if current.operation_id != operation:
                raise PublicationConflict()
            if action == 'delete':
                current.delete()
            else:
                if action == 'publish' or (action == 'refresh' and content is not None
                        and snapshot.get('parameters') and _matches(content, snapshot['parameters'])):
                    current.published_version = snapshot['version']
                    current.published_source_hash = snapshot['source_hash']
                    current.published_config = snapshot['config']
                    current.published_query = snapshot['query']
                    current.published_parameters = snapshot['parameters']
                current.enabled = content is not None and not _boolean(content.get('disabled'))
                current.status = ('missing' if content is None else
                                  'synced' if current.published_parameters and _matches(content, current.published_parameters) else 'drifted')
                current.message = '' if current.status == 'synced' else 'Remote rule is missing or differs from the published configuration.'
                current.pending_payload = {}
                current.operation_id = None
                current.busy_until = None
                current.updated_by = actor
                current.save()
            record.status = 'success'
            record.save(update_fields=['status'])
            AuditService.log_event(event_type=AuditLog.EventType.ACTIVITY, action_type=AuditLog.ActionType.FEATURE_EXEC,
                                   status=AuditLog.Status.SUCCESS, user_email=getattr(request.user, 'email', ''),
                                   ip_address=request_ip(request), user_agent=request_user_agent(request),
                                   metadata={'action': f'splunk_rule_{action}', **record.payload, 'integration_id': str(publication.integration_id)})
        return None if action == 'delete' else current
    except (SplunkPublishError, PublicationConflict, ConnectorHttpError) as exc:
        message = str(exc.detail) if isinstance(exc, APIException) else 'The connector target was rejected.'
        with transaction.atomic():
            SplunkRulePublication.objects.filter(pk=publication.pk, operation_id=operation).update(
                status='pending_sync', message=message[:255], operation_id=None, busy_until=None,
            )
            record.status, record.message = 'failed', message[:255]
            record.save(update_fields=['status', 'message'])
            AuditService.log_event(event_type=AuditLog.EventType.ACTIVITY, action_type=AuditLog.ActionType.FEATURE_EXEC,
                                   status=AuditLog.Status.FAILURE, user_email=getattr(request.user, 'email', ''),
                                   metadata={'action': f'splunk_rule_{action}', **record.payload})
        raise
