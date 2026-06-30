import json
import os
import requests
import traceback
import secrets
import hashlib
from datetime import timedelta
from django.conf import settings
from django.core.exceptions import ValidationError
from django.utils import timezone, dateparse
from .models import Task, TaskRun
from integrations.models import Integration
from alerts.models import Alert
from correlation.models import CorrelationPolicy, CorrelationEvent
from tickets.models import EventTicket, TicketWorkLog

DEST_TABLE = "alerts_alert"
MAX_ALERT_CHAR_LENGTHS = {
    "alert_id": 64,
    "severity": 16,
    "source_index": 64,
    "rule_id": 100,
    "title": 256,
    "category": 100,
    "ticket_number": 64,
}

# -----------------------------
# English notes:
# This module provides task execution utilities and currently centers on
# `execute_task`.
# - `execute_task(task)` runs a Task synchronously and creates/updates the
#   corresponding TaskRun record.
# - When Task config specifies `sync: 'es_to_db'`, the function performs
#   Elasticsearch-to-database ingestion using the configured source/destination.
# - During execution, log lines are written into `TaskRun.logs`, and final run
#   status (`success`/`failed`/`partial`) plus completion timestamp are set.
#
# The function is shared by both API-triggered runs (`TaskViewSet.run`) and
# scheduler-triggered runs, so behavior stays consistent across environments.
# This comment update does not change runtime behavior.
# -----------------------------


def execute_task(task: Task) -> TaskRun:
    """Execute a Task synchronously and return the created TaskRun.
    This mirrors the logic previously in the TaskViewSet.run action so it can be
    reused by a scheduler or the API endpoint.
    """
    run = TaskRun.objects.create(task=task, started_at=timezone.now(), status='running')
    cfg = task.config or {}
    log_lines = []

    def _truncate_text(value, max_length: int):
        """Return a database-safe string while preserving None/blank semantics."""
        if value in (None, ''):
            return None
        text = str(value)
        if len(text) <= max_length:
            return text
        return text[:max_length]

    def _normalize_severity(value):
        """Normalize noisy vendor severity values before saving to alerts_alert.

        The alert table is used by dashboard aggregations, so preserving a
        compact severity tier is more useful than storing a very long vendor
        label that can overflow the DB column.
        """
        if value in (None, ''):
            return None
        text = str(value).strip()
        lower = text.lower()
        if lower in {'critical', 'crit', 'fatal', 'emergency', 'emerg', 'panic'}:
            return 'critical'
        if lower in {'high', 'error', 'err', 'severe'}:
            return 'high'
        if lower in {'medium', 'med', 'moderate', 'warning', 'warn'}:
            return 'medium'
        if lower in {'low', 'info', 'informational', 'notice', 'debug'}:
            return 'low'
        try:
            numeric = int(float(text))
            if numeric >= 12:
                return 'critical'
            if numeric >= 9:
                return 'high'
            if numeric >= 6:
                return 'medium'
            return 'low'
        except Exception:
            return _truncate_text(text.lower(), MAX_ALERT_CHAR_LENGTHS["severity"])

    def _stable_fingerprint(payload: dict) -> str:
        """Build a deterministic hash for dedup/change detection."""
        try:
            normalized = json.dumps(payload or {}, ensure_ascii=True, sort_keys=True, separators=(',', ':'))
        except Exception:
            normalized = str(payload)
        return hashlib.sha256(normalized.encode('utf-8')).hexdigest()

    def _looks_unresolved_template(value) -> bool:
        if value is None:
            return False
        s = str(value)
        return '{{' in s and '}}' in s

    def _sanitize_doc(doc):
        if isinstance(doc, dict):
            out = {}
            for k, v in doc.items():
                cleaned = _sanitize_doc(v)
                if cleaned is None:
                    continue
                out[k] = cleaned
            return out
        if isinstance(doc, list):
            cleaned_list = []
            for item in doc:
                cleaned_item = _sanitize_doc(item)
                if cleaned_item is not None:
                    cleaned_list.append(cleaned_item)
            return cleaned_list
        if _looks_unresolved_template(doc):
            return None
        return doc
    had_nonfatal_errors = False
    try:
        if cfg.get('sync') == 'es_to_db':
            src_id = cfg.get('source_integration')
            dest_id = cfg.get('dest_integration')
            index = cfg.get('index')
            limit = cfg.get('limit', 1000)
            ticket_policy_id = cfg.get('ticket_policy_id')
            # locate integrations
            try:
                es_it = Integration.objects.get(id=src_id)
            except Integration.DoesNotExist as nde:
                raise Exception(f"Integration not found: {nde}")

            # Allow using the current Django DB without a persisted Integration record.
            # Frontend sends dest_integration="__django_default__" to indicate this.
            if not dest_id or str(dest_id) == "__django_default__":
                try:
                    db_engine = (settings.DATABASES.get('default', {}) or {}).get('ENGINE', '') or ''
                except Exception:
                    db_engine = ''
                if 'mysql' in db_engine:
                    db_type = 'mysql'
                else:
                    db_type = 'postgresql'
                dest_it = Integration(
                    name='Django default DB',
                    type=db_type,
                    config={'django_db': cfg.get('django_db') or 'default'},
                )
            else:
                try:
                    dest_it = Integration.objects.get(id=dest_id)
                except Integration.DoesNotExist as nde:
                    raise Exception(f"Integration not found: {nde}")

            # Force fixed destination table for orchestrator sync.
            try:
                import copy
                dest_it = copy.deepcopy(dest_it)
                dest_cfg = dest_it.config or {}
                dest_cfg['table'] = DEST_TABLE
                dest_it.config = dest_cfg
            except Exception:
                pass

            log_lines.append(f"Starting ES->DB sync from index={index} limit={limit}")
            query = cfg.get('query')
            # if no explicit query, try to compute a range from timestamp fields (caller may set this)
            if not query and cfg.get('timestamp_field') and cfg.get('timestamp_from'):
                query = { 'query': { 'range': { cfg.get('timestamp_field'): { 'gte': cfg.get('timestamp_from'), 'lte': cfg.get('timestamp_to', 'now') } } } }

            use_alerts_sync = (
                DEST_TABLE == 'alerts_alert'
                or bool(cfg.get('use_alerts_sync'))
                or str(cfg.get('sync_mode') or '').lower() == 'alerts'
            )
            if not use_alerts_sync:
                raise Exception("Only alerts_alert ORM sync is supported in this mode.")

            def _pick_es_host(es_cfg: dict) -> str | None:
                hosts = es_cfg.get('hosts')
                if isinstance(hosts, (list, tuple)) and hosts:
                    return str(hosts[0])
                if isinstance(hosts, str) and hosts.strip():
                    return hosts.split(',')[0].strip()
                host = es_cfg.get('host')
                return str(host) if host else None

            def _parse_ts(value):
                if not value:
                    return None
                if _looks_unresolved_template(value):
                    return None
                if isinstance(value, (int, float)):
                    try:
                        return timezone.datetime.fromtimestamp(float(value), tz=timezone.utc)
                    except Exception:
                        return None
                if isinstance(value, str):
                    dt = dateparse.parse_datetime(value)
                    if dt and timezone.is_naive(dt):
                        dt = timezone.make_aware(dt, timezone.utc)
                    return dt
                if isinstance(value, timezone.datetime):
                    return value if timezone.is_aware(value) else timezone.make_aware(value, timezone.utc)
                return None

            def _get_field(doc: dict, *keys):
                for key in keys:
                    if not key:
                        continue
                    if key in doc and doc.get(key) not in (None, ''):
                        return doc.get(key)
                    if '.' in key:
                        cur = doc
                        for part in key.split('.'):
                            if not isinstance(cur, dict):
                                cur = None
                                break
                            cur = cur.get(part)
                        if cur not in (None, ''):
                            return cur
                return None

            def _fetch_es_docs(es_cfg: dict):
                host = _pick_es_host(es_cfg)
                if not host:
                    raise Exception("ES host not configured")
                auth = None
                if es_cfg.get('username'):
                    auth = (es_cfg.get('username'), es_cfg.get('password'))
                body = query or {"query": {"match_all": {}}}
                search_url = host.rstrip('/') + f"/{index}/_search?size={limit}"
                r = requests.post(search_url, json=body, auth=auth, timeout=30)
                r.raise_for_status()
                hits = r.json().get('hits', {}).get('hits', [])
                docs = []
                for h in hits:
                    doc = h.get('_source', {}) or {}
                    if isinstance(doc, dict):
                        doc = {**doc, '_es_id': h.get('_id'), 'source_index': h.get('_index') or index}
                    docs.append(doc)
                return docs

            es_cfg = es_it.config or {}
            docs = _fetch_es_docs(es_cfg)
            inserted = 0
            updated = 0
            unchanged = 0
            ticket_candidates = []
            for doc in docs:
                # Prefer the original alert identity inside nested bodies before
                # falling back to the ES document id. This keeps deduplication
                # stable when a source wraps normalized alert fields under
                # `body` but Elasticsearch assigns a different `_id`.
                alert_id = _get_field(doc, 'alert_id', 'event_id', 'body.alert_id', 'body.event_id', 'es_id', '_es_id')
                if not alert_id:
                    continue
                alert_id = _truncate_text(alert_id, MAX_ALERT_CHAR_LENGTHS["alert_id"])
                # ensure downstream logic (ticket creation) can read alert_id/es_id
                doc['alert_id'] = str(alert_id)
                if doc.get('es_id') is None and doc.get('_es_id') is not None:
                    doc['es_id'] = doc.get('_es_id')
                ts_val = _get_field(doc, 'timestamp', '@timestamp', 'date', 'event_time', 'time', 'body.@timestamp', 'body.date')
                raw_severity = _get_field(doc, 'severity', 'level', 'body.severity')
                message = _get_field(doc, 'message', 'title', 'body.title', 'body.message')
                title = _get_field(doc, 'title', 'body.title')
                description = _get_field(doc, 'description', 'details', 'body.description')
                clean_doc = _sanitize_doc(doc if isinstance(doc, dict) else {})
                parsed_ts = _parse_ts(ts_val) or timezone.now()
                defaults = {
                    # Ensure persisted timestamp is always valid for trend aggregation.
                    'timestamp': parsed_ts,
                    'severity': _normalize_severity(raw_severity),
                    'message': message,
                    'source_index': _truncate_text(index, MAX_ALERT_CHAR_LENGTHS["source_index"]),
                    'rule_id': _truncate_text(_get_field(doc, 'rule_id', 'body.rule_id'), MAX_ALERT_CHAR_LENGTHS["rule_id"]),
                    'title': _truncate_text(title, MAX_ALERT_CHAR_LENGTHS["title"]),
                    'status': None,
                    'description': description,
                    'category': _truncate_text(_get_field(doc, 'category', 'body.category'), MAX_ALERT_CHAR_LENGTHS["category"]),
                    'source_data': {**(clean_doc or {}), **doc},
                }
                # Normalize the in-memory candidate as well, because the later
                # ticket/correlation code reads top-level fields from `doc`.
                doc['severity'] = defaults['severity']
                doc['message'] = message
                doc['rule_id'] = defaults['rule_id']
                doc['title'] = title
                doc['description'] = description
                doc['category'] = defaults['category']
                source_index_value = _truncate_text(index, MAX_ALERT_CHAR_LENGTHS["source_index"])
                existing = Alert.objects.filter(
                    alert_id=str(alert_id),
                    source_index=source_index_value,
                ).first()

                incoming_fp = _stable_fingerprint(doc)
                existing_fp = _stable_fingerprint((existing.source_data or {})) if existing else None
                changed = existing is None or existing_fp != incoming_fp

                if existing is None:
                    Alert.objects.create(
                        alert_id=str(alert_id),
                        **defaults,
                    )
                    inserted += 1
                    ticket_candidates.append(doc)
                else:
                    # Always refresh seen-time; only mark as ticket candidate when changed.
                    existing.timestamp = defaults.get('timestamp')
                    existing.severity = defaults.get('severity')
                    existing.message = defaults.get('message')
                    existing.rule_id = defaults.get('rule_id')
                    existing.title = defaults.get('title')
                    existing.status = defaults.get('status')
                    existing.description = defaults.get('description')
                    existing.category = defaults.get('category')
                    existing.source_data = defaults.get('source_data')
                    existing.save()
                    updated += 1
                    if changed:
                        ticket_candidates.append(doc)
                    else:
                        unchanged += 1

            log_lines.append(
                f"Sync result (alerts ORM): fetched={len(docs)} inserted={inserted} updated={updated} unchanged={unchanged}"
            )
            res = {'status': 'ok', 'inserted_es_ids': [], 'docs': docs, 'docs_with_ids': None}
            # if sync produced a log file, try to include its contents
            try:
                lp = res.get('log_path')
                if lp:
                    if os.path.isfile(lp):
                        with open(lp, 'r', encoding='utf-8') as lf:
                            log_lines.append('\n---- sync log file ----')
                            log_lines.append(lf.read())
            except Exception:
                pass

            def update_target_table(alert_id_value, ticket_number):
                if not alert_id_value or not ticket_number:
                    return
                updated_rows = Alert.objects.filter(
                    alert_id=str(alert_id_value),
                    source_index=index,
                ).update(ticket_number=str(ticket_number))
                if updated_rows == 0:
                    log_lines.append(f"No alerts updated for alert_id={alert_id_value} in alerts_alert")

            created_count = 0
            matched_count = 0
            skipped_count = 0
            try:
                should_create_tickets = True
                conditions = {}
                if ticket_policy_id:
                    # ticket_policies app removed; ignore policy filtering
                    log_lines.append("Ticket policies disabled; ignoring ticket_policy_id")
                else:
                    log_lines.append("No ticket policy set; defaulting to create tickets for all synced alerts")

                if should_create_tickets:
                    inserted_es_ids = res.get('inserted_es_ids') or []
                    docs = list(ticket_candidates)
                    docs_with_ids = res.get('docs_with_ids')
                    if isinstance(docs_with_ids, list):
                        docs = [d.get('source') for d in docs_with_ids if d.get('es_id') in inserted_es_ids]
                    if docs is None:
                        es_cfg = es_it.config or {}
                        host = es_cfg.get('host')
                        auth = None
                        if es_cfg.get('username'):
                            auth = (es_cfg.get('username'), es_cfg.get('password'))
                        q = query or {"query": {"match_all": {}}}
                        search_url = host.rstrip('/') + f"/{index}/_search?size={limit}"
                        r = requests.post(search_url, json=q, auth=auth, timeout=30)
                        r.raise_for_status()
                        hits = r.json().get('hits', {}).get('hits', [])
                        docs = [h.get('_source', {}) for h in hits]

                    def get_field(doc, field):
                        if not field:
                            return None
                        parts = field.split('.')
                        cur = doc
                        for p in parts:
                            if not isinstance(cur, dict):
                                return None
                            cur = cur.get(p)
                            if cur is None:
                                return None
                        return cur

                    def eval_rule(doc, rule):
                        op = rule.get('op')
                        field = rule.get('field')
                        value = rule.get('value')
                        cur = get_field(doc, field)
                        def to_number(v):
                            if v is None:
                                return None
                            if isinstance(v, (int, float)):
                                return float(v)
                            try:
                                return float(str(v).strip())
                            except Exception:
                                return None
                        if op == 'eq':
                            return cur == value
                        if op == 'ne':
                            return cur != value
                        if op == 'in':
                            return cur in (value or [])
                        if op == 'contains':
                            return isinstance(cur, str) and isinstance(value, str) and value in cur
                        if op == 'exists':
                            return (cur is not None) if value else (cur is None)
                        if op in ('gt', 'gte', 'lt', 'lte'):
                            left = to_number(cur)
                            right = to_number(value)
                            if left is None or right is None:
                                return False
                            if op == 'gt':
                                return left > right
                            if op == 'gte':
                                return left >= right
                            if op == 'lt':
                                return left < right
                            if op == 'lte':
                                return left <= right
                        if op == 'regex':
                            try:
                                import re
                                return isinstance(cur, str) and re.search(value, cur) is not None
                            except Exception:
                                return False
                        return False

                    def eval_conditions(doc, cond):
                        if not cond:
                            return True
                        logic = (cond.get('logic') or 'AND').upper()
                        rules = cond.get('rules') or []
                        if logic == 'OR':
                            return any(eval_rule(doc, r) for r in rules)
                        return all(eval_rule(doc, r) for r in rules)

                    def map_priority(sev):
                        if not isinstance(sev, str):
                            return 'medium'
                        s = sev.lower()
                        if s == 'critical':
                            return 'critical'
                        if s == 'high':
                            return 'high'
                        if s == 'medium':
                            return 'medium'
                        if s == 'low':
                            return 'low'
                        return 'medium'

                    def build_correlation_key(doc):
                        # Enforce policy-defined keys strictly when configured.
                        if policy_match_keys:
                            parts = []
                            missing = []
                            for key in policy_match_keys:
                                val = get_field(doc, key)
                                if val is None or val == '':
                                    missing.append(key)
                                    continue
                                if isinstance(val, (dict, list)):
                                    try:
                                        val = json.dumps(val, ensure_ascii=True, sort_keys=True)
                                    except Exception:
                                        val = str(val)
                                else:
                                    val = str(val)
                                parts.append(val if len(policy_match_keys) == 1 else f"{key}={val}")
                            if parts:
                                if missing:
                                    log_lines.append(
                                        f"Correlation key fallback: missing policy keys {missing}, using available keys only"
                                    )
                                return "|".join(parts)
                            log_lines.append(
                                f"Correlation key fallback: missing all policy keys {policy_match_keys}, using alert identity"
                            )

                        parts = []
                        for key in policy_match_keys:
                            val = get_field(doc, key)
                            if val is None or val == '':
                                continue
                            if isinstance(val, (dict, list)):
                                try:
                                    val = json.dumps(val, ensure_ascii=True, sort_keys=True)
                                except Exception:
                                    val = str(val)
                            else:
                                val = str(val)
                            if len(policy_match_keys) == 1:
                                parts.append(val)
                            else:
                                parts.append(f"{key}={val}")
                        if parts:
                            return "|".join(parts)
                        fallback = doc.get('title') or doc.get('message')
                        if fallback:
                            return str(fallback)
                        fallback_id = doc.get('alert_id') or doc.get('event_id') or doc.get('es_id')
                        return str(fallback_id) if fallback_id else ''

                    correlation_policy = CorrelationPolicy.objects.filter(enabled=True).order_by('-updated_at').first()
                    correlation_enabled = bool(correlation_policy and correlation_policy.enabled)
                    correlation_rules = (correlation_policy.rules_expression if correlation_policy else {}) or {}
                    correlation_window = correlation_rules.get('window_minutes') or (correlation_policy.window_minutes if correlation_policy else 0) or 0
                    policy_match_keys = list(correlation_policy.match_keys) if correlation_policy and correlation_policy.match_keys else []
                    attached_count = 0

                    def record_correlation_event(ticket_number, alert_id, occurred_at, correlation_key):
                        CorrelationEvent.objects.create(
                            ticket_id=ticket_number,
                            alert_ids=[alert_id] if alert_id else [],
                            threat_object=correlation_key,
                            matched_keys=policy_match_keys,
                            occurred_at=occurred_at,
                        )

                    def create_ticket_from_alert(payload):
                        """Create a ticket locally so orchestrator jobs do not depend on self-HTTP auth."""
                        event_siem_id = str(payload.get('event_siem_id') or '').strip()
                        if event_siem_id:
                            existing_ticket = EventTicket.objects.filter(
                                event_siem_id=event_siem_id,
                                is_deleted=False,
                            ).first()
                            if existing_ticket:
                                return existing_ticket, False

                        ticket = EventTicket(
                            event_siem_id=event_siem_id or None,
                            title=_truncate_text(payload.get('title') or 'SIEM Alert', 255) or 'SIEM Alert',
                            description=payload.get('description') or '',
                            alert_message=payload.get('alert_message') or '',
                            priority=payload.get('priority') or 'medium',
                            status=payload.get('status') or 'new',
                            create_uid=payload.get('create_uid') or 'siem',
                        )
                        ticket.full_clean(exclude=['ticket_number'])
                        ticket.save()
                        return ticket, True

                    for doc in docs or []:
                        if not eval_conditions(doc, conditions):
                            skipped_count += 1
                            continue
                        matched_count += 1
                        correlation_key = build_correlation_key(doc)

                        payload = {
                            'event_siem_id': doc.get('alert_id') or doc.get('event_id') or doc.get('es_id'),
                            'title': doc.get('title') or doc.get('message') or 'SIEM Alert',
                            'description': doc.get('description') or doc.get('message') or doc.get('raw') or '',
                            'alert_message': json.dumps(doc, ensure_ascii=True),
                            'priority': map_priority(doc.get('severity')),
                            'status': 'new',
                            'create_uid': 'siem',
                        }
                        try:
                            alert_id = doc.get('alert_id') or doc.get('event_id') or doc.get('es_id')
                            occurred_at = timezone.now()
                            if correlation_enabled and correlation_window:
                                window_start = occurred_at - timedelta(minutes=int(correlation_window))
                                match_keys_label = policy_match_keys or ['title']
                                if correlation_key:
                                    log_lines.append(
                                        f"Correlation check keys={match_keys_label} value='{correlation_key}' window_start={window_start.isoformat()}"
                                    )
                                    existing_event = (
                                        CorrelationEvent.objects.filter(
                                            threat_object=correlation_key,
                                            occurred_at__gte=window_start,
                                            ticket_id__isnull=False,
                                        )
                                        .order_by('-occurred_at')
                                        .first()
                                    )
                                    existing_ticket = None
                                    if existing_event and existing_event.ticket_id:
                                        existing_ticket = EventTicket.objects.filter(
                                            ticket_number=existing_event.ticket_id,
                                            progress_status='in_progress',
                                            is_deleted=False,
                                        ).first()
                                    if existing_ticket:
                                        log_lines.append(
                                            f"Correlation hit ticket={existing_ticket.ticket_number} created_time={existing_ticket.created_time.isoformat()}"
                                        )
                                        TicketWorkLog.objects.create(
                                            ticket=existing_ticket,
                                            created_by=None,
                                            log_entry=f"Correlated alert received (alert_id={alert_id}, key={correlation_key}).",
                                        )
                                        record_correlation_event(existing_ticket.ticket_number, alert_id, occurred_at, correlation_key)
                                        attached_count += 1
                                        if alert_id:
                                            update_target_table(alert_id, existing_ticket.ticket_number)
                                        continue
                                    log_lines.append("Correlation miss: no ticket matched")

                            ticket, was_created = create_ticket_from_alert(payload)
                            ticket_number = ticket.ticket_number
                            if was_created:
                                created_count += 1
                                log_lines.append(f"Created ticket={ticket_number} for alert_id={alert_id}")
                            else:
                                attached_count += 1
                                log_lines.append(f"Existing ticket={ticket_number} reused for alert_id={alert_id}")
                            update_target_table(alert_id, ticket_number)
                            if correlation_enabled:
                                correlation_key = build_correlation_key(doc)
                                record_correlation_event(ticket_number, alert_id, occurred_at, correlation_key)
                        except ValidationError as e:
                            log_lines.append(f"Ticket validation failed for alert_id={doc.get('alert_id')}: {e}")
                            skipped_count += 1
                            had_nonfatal_errors = True
                        except Exception as e:
                            log_lines.append(f"Ticket creation failed for alert_id={doc.get('alert_id')}: {str(e)}")
                            skipped_count += 1
                            had_nonfatal_errors = True
                    log_lines.append(
                        f"Ticket creation summary matched={matched_count} created={created_count} attached={attached_count} skipped={skipped_count}"
                    )
                    if matched_count > 0 and created_count == 0 and skipped_count > 0:
                        had_nonfatal_errors = True
            except Exception as e:
                log_lines.append(f"Ticket creation failed: {str(e)}")
                had_nonfatal_errors = True
        else:
            log_lines.append(f"Executing task {task.id}")
            log_lines.append(f"Config: {json.dumps(task.config)}")

        run.logs = "\n".join(log_lines)
        run.status = 'partial' if had_nonfatal_errors else 'success'
        run.finished_at = timezone.now()
        run.save()
        return run
    except Exception as e:
        run.status = 'failed'
        run.logs = "\n".join([
            *log_lines,
            f"Task failed: {str(e)}",
            traceback.format_exc(),
        ])
        run.finished_at = timezone.now()
        run.save()
        return run


def seed_correlation_events(max_tickets=20, min_events=2, max_events=5, hours=6):
    tickets = list(EventTicket.objects.filter(is_deleted=False).order_by('-created_time')[:max_tickets])
    if not tickets:
        return {'created': 0, 'tickets': 0}
    now = timezone.now()
    created = 0
    for ticket in tickets:
        count = secrets.choice(range(min_events, max_events + 1))
        for idx in range(count):
            occurred_at = now - timedelta(minutes=secrets.choice(range(0, hours * 60 + 1)))
            alert_id = f"seed-{ticket.ticket_number}-{idx + 1}"
            CorrelationEvent.objects.create(
                ticket_id=ticket.ticket_number,
                alert_ids=[alert_id],
                threat_object=ticket.title or ticket.ticket_number,
                matched_keys=['title'],
                occurred_at=occurred_at,
            )
            created += 1
    return {'created': created, 'tickets': len(tickets)}
