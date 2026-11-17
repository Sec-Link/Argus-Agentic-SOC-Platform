"""Read-only platform scopes shared by Monitoring chart endpoints."""

from django.db.models import Q
from rest_framework.exceptions import ValidationError

from alerts.models import Alert, ESIntegrationConfig
from detections.models import LocalDetectionRule, SplunkRulePublication


def dashboard_platform(params):
    platform = params.get('platform')
    if platform is not None and platform not in {'elk', 'splunk'}:
        raise ValidationError({'platform': 'Choose elk or splunk.'})
    return platform


def dashboard_alerts(platform, *, active_index=True):
    qs = Alert.objects.all()
    if platform is not None:
        qs = qs.exclude(alert_id__isnull=True).exclude(alert_id='')
    if platform == 'splunk':
        return qs.filter(source_data__connector_type='splunk_search')
    if platform == 'elk':
        # Legacy ES rows have no connector marker, including SQL/JSON null payloads.
        qs = qs.filter(Q(source_data__connector_type__isnull=True) | ~Q(source_data__connector_type='splunk_search'))
        if active_index:
            cfg = ESIntegrationConfig.objects.order_by('-enabled', '-id').first()
            if cfg and cfg.index.strip():
                qs = qs.filter(source_index=cfg.index.strip())
    return qs


def dashboard_rules(platform=None, *, enabled_only=False):
    qs = LocalDetectionRule.objects.filter(is_deleted=False)
    if platform == 'splunk':
        publications = SplunkRulePublication.objects.filter(
            integration__type='splunk_rule_publisher', published_version__isnull=False,
        )
        if enabled_only:
            publications = publications.filter(enabled=True, status='synced')
        return qs.filter(pk__in=publications.values('rule_id'))
    return qs.filter(enabled=True) if enabled_only else qs


def dashboard_tickets(tickets, platform):
    if platform is None:
        return tickets
    linked_numbers = dashboard_alerts(platform).exclude(ticket_number__isnull=True).exclude(ticket_number='')
    return tickets.filter(ticket_number__in=linked_numbers.values('ticket_number'))
