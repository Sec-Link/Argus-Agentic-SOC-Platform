"""Map a saved Splunk alert index into the shared Alert table."""

import hashlib
import json

from django.db import DatabaseError, transaction
from django.utils import timezone

from integrations.models import Integration
from integrations.serializers import validate_splunk_config
from integrations.splunk import fetch_events

from .models import Alert
from .services import _extract_alert_timestamp, _get_alert_field, _normalize_alert_severity


def normalize_splunk_event(event):
    result = dict(event)
    raw = result.get('_raw')
    if isinstance(raw, str):
        try:
            fields = json.loads(raw)
        except (ValueError, TypeError):
            fields = None
        if isinstance(fields, dict):
            for key, value in fields.items():
                if result.get(key) in (None, ''):
                    result[key] = value
    return result


def _text(value, limit=None):
    if value is None:
        return None
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=True)
    return text[:limit] if limit else text


def sync_splunk_alerts_to_db(*, integration_id, size=500):
    integration = Integration.objects.get(pk=integration_id, type='splunk_search')
    config = validate_splunk_config(integration.config)
    size = max(1, min(int(size), 1000))
    events = fetch_events(config, size)
    inserted = updated = skipped = 0
    for raw_event in events:
        event = normalize_splunk_event(raw_event)
        native_id = _get_alert_field(event, 'alert_id', 'event_id', 'body.alert_id', 'body.event_id')
        if native_id is not None:
            identity = str(native_id)
        elif event.get('_cd'):
            identity = json.dumps([event.get('_bkt'), event['_cd']], sort_keys=True)
        else:
            identity = json.dumps(raw_event, sort_keys=True, ensure_ascii=True)
        # Namespace IDs per connector/index to avoid collisions with ES or other Splunk sources.
        seed = json.dumps([str(integration.id), config['index'], identity])
        alert_id = 'splunk_' + hashlib.sha256(seed.encode()).hexdigest()[:56]
        timestamp = _extract_alert_timestamp(event)
        if timestamp is None:
            timestamp = _extract_alert_timestamp({'timestamp': event.get('_time')})
        try:
            status = int(_get_alert_field(event, 'status', 'body.status') or 0)
            if not -2147483648 <= status <= 2147483647:
                status = 0
        except (ValueError, TypeError, OverflowError):
            status = 0
        defaults = {
            'timestamp': timestamp or timezone.now(),
            'severity': _normalize_alert_severity(_get_alert_field(event, 'severity', 'level', 'urgency', 'body.severity', 'body.level')),
            'message': _text(_get_alert_field(event, 'message', 'body.message', 'title', '_raw')),
            'rule_id': _text(_get_alert_field(event, 'rule_id', 'body.rule_id', 'savedsearch_name', 'search_name'), 100),
            'title': _text(_get_alert_field(event, 'title', 'body.title', 'rule_name', 'savedsearch_name', 'search_name'), 256),
            'status': status,
            'description': _text(_get_alert_field(event, 'description', 'body.description', 'details')),
            'category': _text(_get_alert_field(event, 'category', 'body.category', 'sourcetype'), 100),
            'source_data': {**event, 'connector_type': 'splunk_search', 'integration_id': str(integration.id),
                            'external_alert_id': native_id, 'alert_id': alert_id, 'source_index': config['index']},
        }
        try:
            # Serialize concurrent fetches for this connector; Alert has no unique ID constraint.
            with transaction.atomic():
                Integration.objects.select_for_update().get(pk=integration.id)
                existing = Alert.objects.filter(alert_id=alert_id, source_index=config['index']).first()
                if existing:
                    for key, value in defaults.items():
                        setattr(existing, key, value)
                    existing.save(update_fields=list(defaults))
                else:
                    Alert.objects.create(alert_id=alert_id, source_index=config['index'], **defaults)
            updated += int(existing is not None)
            inserted += int(existing is None)
        except DatabaseError:
            skipped += 1
    return {
        'ok': skipped == 0, 'integration_id': str(integration.id), 'index': config['index'],
        'fetched': len(events), 'inserted': inserted, 'updated': updated, 'skipped': skipped,
        'limit_reached': len(events) == size,
        'errors': [f'{skipped} records could not be stored.'] if skipped else [],
    }
