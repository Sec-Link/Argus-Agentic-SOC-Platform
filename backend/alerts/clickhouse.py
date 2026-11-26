"""Ingest explicitly mapped ClickHouse alerts without triggering automation."""

import hashlib
import json
import threading
from contextlib import contextmanager
from uuid import UUID
from weakref import WeakValueDictionary

from django.db import DatabaseError, connection, transaction

from integrations.clickhouse import ClickHouseError, ClickHouseFetchInProgress, fetch_events
from integrations.models import Integration
from integrations.serializers import validate_clickhouse_config

from .models import Alert
from .services import _extract_alert_timestamp, _normalize_alert_severity

_FETCH_LOCKS = WeakValueDictionary()
_FETCH_LOCKS_GUARD = threading.Lock()


@contextmanager
def _fetch_lock(integration_id):
    identity = str(UUID(str(integration_id)))
    with _FETCH_LOCKS_GUARD:
        lock = _FETCH_LOCKS.setdefault(identity, threading.Lock())
    if not lock.acquire(blocking=False):
        raise ClickHouseFetchInProgress('A fetch is already running for this ClickHouse integration. Retry after it completes.')
    try:
        with transaction.atomic():
            if connection.vendor == 'postgresql':
                key = int.from_bytes(hashlib.sha256(
                    b'argus:clickhouse-fetch:v1:' + identity.encode('ascii')
                ).digest()[:8], byteorder='big', signed=True)
                with connection.cursor() as cursor:
                    cursor.execute('SELECT pg_try_advisory_xact_lock(%s)', [key])
                    acquired = cursor.fetchone()[0]
                if not acquired:
                    raise ClickHouseFetchInProgress('A fetch is already running for this ClickHouse integration. Retry after it completes.')
            # Transaction-scoped PostgreSQL locks cannot expire during the HTTP query;
            # SQLite's in-memory tests use the local guard above instead.
            yield
    finally:
        lock.release()


def _text(value, limit=None):
    if value is None:
        return None
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=True)
    return text[:limit] if limit else text


def sync_clickhouse_alerts_to_db(*, integration_id, size=500):
    with _fetch_lock(integration_id):
        return _sync_clickhouse_alerts_to_db(integration_id=integration_id, size=size)


def _sync_clickhouse_alerts_to_db(*, integration_id, size):
    integration = Integration.objects.get(pk=integration_id, type='clickhouse')
    config = validate_clickhouse_config({}, integration.config)
    size = max(1, min(int(size), 1000))
    events = fetch_events(config, size)
    source = f'{config["database"]}.{config["table"]}'
    inserted = updated = skipped = 0
    # The advisory lock already covers the HTTP query; this row lock also protects configuration validation.
    with transaction.atomic():
        locked = Integration.objects.select_for_update().get(pk=integration.id)
        if locked.config != integration.config:
            raise ClickHouseError('ClickHouse configuration changed during fetch; retry with the saved configuration.')
        for event in events:
            native_id = event.get('alert_id')
            timestamp = _extract_alert_timestamp(event)
            if (isinstance(native_id, bool) or not isinstance(native_id, (str, int))
                    or not str(native_id).strip() or len(str(native_id)) > 1024 or timestamp is None):
                skipped += 1
                continue
            seed = json.dumps([str(integration.id), source, str(native_id)])
            alert_id = 'clickhouse_' + hashlib.sha256(seed.encode()).hexdigest()[:53]
            try:
                status = int(event.get('status') or 0)
                if not -2147483648 <= status <= 2147483647:
                    status = 0
            except (TypeError, ValueError, OverflowError):
                status = 0
            defaults = {
                'timestamp': timestamp, 'severity': _normalize_alert_severity(event.get('severity')),
                'message': _text(event.get('message')), 'title': _text(event.get('title'), 256),
                'rule_id': _text(event.get('rule_id'), 100), 'category': _text(event.get('category'), 100),
                'description': _text(event.get('description')), 'status': status,
                'source_data': {**event, 'connector_type': 'clickhouse', 'integration_id': str(integration.id),
                    'external_alert_id': native_id, 'alert_id': alert_id, 'source_index': source},
            }
            try:
                with transaction.atomic():
                    existing = Alert.objects.filter(
                        alert_id=alert_id, source_index=source,
                        source_data__connector_type='clickhouse',
                        source_data__integration_id=str(integration.id),
                    ).first()
                    if existing:
                        for key, value in defaults.items():
                            setattr(existing, key, value)
                        existing.save(update_fields=list(defaults))
                    else:
                        Alert.objects.create(alert_id=alert_id, source_index=source, **defaults)
                inserted += int(existing is None)
                updated += int(existing is not None)
            except DatabaseError:
                skipped += 1
    return {'ok': skipped == 0, 'integration_id': str(integration.id), 'source': source,
        'fetched': len(events), 'inserted': inserted, 'updated': updated, 'skipped': skipped,
        'limit_reached': len(events) == size,
        'errors': [f'{skipped} records had invalid identity/time or could not be stored.'] if skipped else []}
