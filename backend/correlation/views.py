from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from accounts.permissions import HasDjangoPermissions
from datetime import datetime, timedelta
from django.utils import timezone
from django.db import connection
from .models import CorrelationPolicy, CorrelationEvent
from .serializers import CorrelationPolicySerializer
try:
    from orchestrator.utils import seed_correlation_events
except Exception:
    def seed_correlation_events(*args, **kwargs):
        return {'created': 0, 'tickets': 0}


class CorrelationPolicyView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {"GET": "correlation.view_correlationpolicy", "POST": "correlation.change_correlationpolicy"}

    def get(self, request):
        policy = CorrelationPolicy.objects.order_by('id').first()
        if not policy:
            policy = CorrelationPolicy.objects.create(
                enabled=False,
                window_minutes=30,
                match_keys=['threat_object', 'alert_type'],
                match_risk_object=True,
                match_detection_rule=True,
                match_source_ip=False,
                match_username=False,
                time_window_hours=8,
                match_action='attach',
                rules_expression={
                    'window_minutes': 30,
                    'order_by': ['threat_object', 'alert_type'],
                },
            )
        data = CorrelationPolicySerializer(policy).data
        return Response(data)

    def post(self, request):
        policy = CorrelationPolicy.objects.order_by('id').first()
        if not policy:
            policy = CorrelationPolicy.objects.create()
        serializer = CorrelationPolicySerializer(policy, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class CorrelationEventsView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {"GET": "correlation.view_correlationevent"}

    def get(self, request):
        # Parse time range (fallback to last 1h)
        try:
            to_str = request.query_params.get('to')
            from_str = request.query_params.get('from')
            to_ts = datetime.fromisoformat(to_str.replace('Z','+00:00')) if to_str else timezone.now()
            from_ts = datetime.fromisoformat(from_str.replace('Z','+00:00')) if from_str else to_ts - timedelta(hours=1)
        except Exception:
            to_ts = timezone.now()
            from_ts = to_ts - timedelta(hours=1)

        bucket = request.query_params.get('bucket', '5m')
        seed_flag = str(request.query_params.get('seed', '')).lower() in ('1', 'true', 'yes')
        if seed_flag:
            user = getattr(request, "user", None)
            if not getattr(user, "is_superuser", False) and not user.has_perm("correlation.add_correlationevent"):
                return Response({"detail": "Permission denied."}, status=403)
        seed_result = None
        if seed_flag:
            try:
                seed_result = seed_correlation_events(
                    max_tickets=int(request.query_params.get('seed_tickets') or 20),
                    min_events=int(request.query_params.get('seed_min') or 2),
                    max_events=int(request.query_params.get('seed_max') or 5),
                    hours=int(request.query_params.get('seed_hours') or 6),
                )
            except Exception:
                seed_result = {'created': 0, 'tickets': 0}
        bucket_minutes = 5
        if bucket.endswith('m'):
            bucket_minutes = int(bucket[:-1])
        elif bucket.endswith('h'):
            bucket_minutes = int(bucket[:-1]) * 60
        bucket_seconds = bucket_minutes * 60
        series = []
        table = []

        def get_columns(cur, table_name):
            cur.execute(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = %s
                """,
                [table_name],
            )
            return {r[0] for r in cur.fetchall()}

        with connection.cursor() as cur:
            columns = get_columns(cur, 'alerts')
            time_col = 'timestamp' if 'timestamp' in columns else ('date' if 'date' in columns else None)
            ticket_col = 'ticket_number' if 'ticket_number' in columns else None
            risk_col = 'risk_object' if 'risk_object' in columns else ('title' if 'title' in columns else None)
            rule_col = 'rule_id' if 'rule' in columns else ('alert_type' if 'alert_type' in columns else ('signature' if 'signature' in columns else None))
            alert_id_col = 'alert_id' if 'alert_id' in columns else None

            if time_col and ticket_col:
                time_expr = f'"{time_col}"'
                risk_expr = f'"{risk_col}"' if risk_col else 'NULL'
                rule_expr = f'"{rule_col}"' if rule_col else 'NULL'
                alert_expr = f'"{alert_id_col}"' if alert_id_col else 'NULL'

                cur.execute(
                    f"""
                    SELECT
                        to_timestamp(floor(extract(epoch from {time_expr}) / %s) * %s) AT TIME ZONE 'UTC' AS bucket_time,
                        count(distinct {ticket_col}) AS cnt
                    FROM alerts0119
                    WHERE {time_expr} IS NOT NULL
                      AND {time_expr} >= %s AND {time_expr} <= %s
                      AND {ticket_col} IS NOT NULL
                    GROUP BY bucket_time
                    ORDER BY bucket_time
                    """,
                    [bucket_seconds, bucket_seconds, from_ts, to_ts],
                )
                bucket_rows = cur.fetchall()

                cur.execute(
                    f"""
                    SELECT
                        {ticket_col},
                        count(*) AS alert_count,
                        max({time_expr}) AS last_alert_time,
                        (array_agg({risk_expr} ORDER BY {time_expr} DESC))[1] AS risk_object,
                        (array_agg({rule_expr} ORDER BY {time_expr} DESC))[1] AS rule_name,
                        array_agg({alert_expr}) AS alert_ids
                    FROM alerts0119
                    WHERE {time_expr} IS NOT NULL
                      AND {time_expr} >= %s AND {time_expr} <= %s
                      AND {ticket_col} IS NOT NULL
                    GROUP BY {ticket_col}
                    ORDER BY last_alert_time DESC
                    LIMIT 100
                    """,
                    [from_ts, to_ts],
                )
                for ticket_number, alert_count, last_alert_time, risk_object, rule_name, alert_ids in cur.fetchall():
                    table.append({
                        'ticket_id': ticket_number,
                        'alert_count': alert_count,
                        'last_alert_time': last_alert_time.isoformat() if last_alert_time else None,
                        'top_threat_object': risk_object,
                        'top_rule': rule_name,
                        'alert_ids': alert_ids or [],
                    })
            else:
                bucket_rows = []

        if not table:
            events = CorrelationEvent.objects.filter(occurred_at__range=(from_ts, to_ts)).order_by('occurred_at')
            bucket_map = {}
            for ev in events:
                ts = ev.occurred_at
                ts_utc = ts.astimezone(timezone.UTC).replace(tzinfo=None)
                bucket_time = datetime.utcfromtimestamp(
                    (int(ts_utc.timestamp()) // bucket_seconds) * bucket_seconds
                )
                bucket_map[bucket_time] = bucket_map.get(bucket_time, 0) + 1
            ticket_map = {}
            for ev in events:
                key = ev.ticket_id
                item = ticket_map.get(key)
                if not item:
                    item = {
                        'ticket_id': key,
                        'alert_count': 0,
                        'last_alert_time': None,
                        'top_threat_object': ev.threat_object,
                        'top_rule': None,
                        'alert_ids': [],
                    }
                    ticket_map[key] = item
                item['alert_count'] += len(ev.alert_ids or [])
                for aid in ev.alert_ids or []:
                    if aid not in item['alert_ids']:
                        item['alert_ids'].append(aid)
                if not item['last_alert_time'] or (ev.occurred_at and ev.occurred_at > item['last_alert_time']):
                    item['last_alert_time'] = ev.occurred_at
                    item['top_threat_object'] = ev.threat_object
                    item['top_rule'] = item.get('top_rule') or None
            table = []
            for row in ticket_map.values():
                table.append({
                    'ticket_id': row['ticket_id'],
                    'alert_count': row['alert_count'],
                    'last_alert_time': row['last_alert_time'].isoformat() if row['last_alert_time'] else None,
                    'top_threat_object': row['top_threat_object'],
                    'top_rule': row.get('top_rule'),
                    'alert_ids': row['alert_ids'],
                })
            table.sort(key=lambda r: r['last_alert_time'] or '', reverse=True)
            bucket_rows = [(k, v) for k, v in bucket_map.items()]

        bucket_map = {}
        for row in bucket_rows:
            bucket_time = row[0]
            if bucket_time and hasattr(bucket_time, 'tzinfo') and bucket_time.tzinfo is not None:
                bucket_time = bucket_time.astimezone(timezone.UTC).replace(tzinfo=None)
            bucket_map[bucket_time] = row[1]
        current = from_ts
        while current <= to_ts:
            current_utc = current.astimezone(timezone.UTC).replace(tzinfo=None)
            bucket_time = datetime.utcfromtimestamp(
                (int(current_utc.timestamp()) // bucket_seconds) * bucket_seconds
            )
            count = bucket_map.get(bucket_time, 0)
            series.append({'time': bucket_time.isoformat(), 'count': count})
            current = current + timedelta(minutes=bucket_minutes)
        payload = {'bucket': bucket, 'series': series, 'table': table}
        if seed_flag:
            payload['seeded'] = seed_result
        return Response(payload)
