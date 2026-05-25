"""API views for alerts, dashboard aggregation and ES integration config."""

from __future__ import annotations

import logging
import time
from typing import Any
from django.utils.dateparse import parse_datetime
from django.utils import timezone

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ESIntegrationConfig
from .services import AlertService, _detect_es_major_version, _http_search, _index_has_field
from .tasks import get_or_create_alert_sync_schedule, sync_es_alerts_to_db

logger = logging.getLogger(__name__)

def _boolify(value: Any, *, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value).strip().lower() in {'1', 'true', 'yes', 'on'}

class AlertListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        alerts, source = AlertService.list_alerts(force_db=True)
        page = int(request.GET.get('page', 1))
        page_size = int(request.GET.get('page_size', 20))
        start = (page - 1) * page_size
        end = start + page_size
        resp = {
            'alerts': alerts[start:end],
            'page': page,
            'page_size': page_size,
            'total': len(alerts),
            'source': source,
        }
        if source == 'mock' and len(alerts) == 0:
            try:
                sample_alerts = AlertService.load_mock_alerts()
                resp['mock_total_available'] = len(sample_alerts)
            except Exception:
                pass
        return Response(resp)


class AlertDashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            all_time_raw = request.GET.get('all_time')
            start_time_raw = request.GET.get('start_time')
            end_time_raw = request.GET.get('end_time')
            all_time = _boolify(all_time_raw, default=False)

            start_time = None if all_time else (parse_datetime(start_time_raw) if start_time_raw else None)
            end_time = None if all_time else (parse_datetime(end_time_raw) if end_time_raw else None)
            if start_time and timezone.is_naive(start_time):
                start_time = timezone.make_aware(start_time, timezone.get_current_timezone())
            if end_time and timezone.is_naive(end_time):
                end_time = timezone.make_aware(end_time, timezone.get_current_timezone())

            data = AlertService.aggregate_dashboard(
                force_db=True,
                start_time=start_time,
                end_time=end_time,
                all_time=all_time,
            )
            return Response(data)
        except Exception as exc:
            logger.exception('Error in dashboard_alerts: %s', exc)
            return Response(
                {'error': 'Internal Server Error'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class AlertSyncView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        schedule = get_or_create_alert_sync_schedule()
        size_param = request.GET.get('size')
        fetch_all_param = request.GET.get('fetch_all')
        try:
            size = int(size_param) if size_param is not None else int(schedule.batch_size or 100)
        except Exception:
            size = int(schedule.batch_size or 100)
        fetch_all = (
            _boolify(fetch_all_param)
            if fetch_all_param is not None
            else bool(schedule.fetch_all)
        )

        started = time.monotonic()
        try:
            result = sync_es_alerts_to_db(size=size, fetch_all=fetch_all, force_config=True)
            result['duration_ms'] = int((time.monotonic() - started) * 1000)
            return Response({'ok': True, **(result or {})})
        except Exception as exc:
            logger.exception('Failed to sync ES->DB: %s', exc)
            return Response(
                {'ok': False, 'detail': str(exc)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class ESDiagnosticsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        cfg = ESIntegrationConfig.objects.order_by('-id').first()
        if not cfg:
            return Response({'es': False, 'detail': 'no config found'}, status=status.HTTP_200_OK)

        hosts = cfg.hosts_list() or []
        host = hosts[0] if hosts else None
        try:
            server_version = _detect_es_major_version(host) if host else None
        except Exception:
            server_version = None

        try:
            mapping_has_timestamp = _index_has_field(cfg, 'timestamp')
        except Exception:
            mapping_has_timestamp = False

        try:
            body = {'size': 5, 'query': {'match_all': {}}}
            if mapping_has_timestamp:
                body['sort'] = [{'timestamp': {'order': 'desc'}}]
            samples = _http_search(cfg, body, timeout=10)
        except Exception:
            samples = []

        return Response(
            {
                'es': True,
                'host': host,
                'server_version': server_version,
                'mapping_has_timestamp': mapping_has_timestamp,
                'sample_count': len(samples),
                'samples': samples,
            }
        )
