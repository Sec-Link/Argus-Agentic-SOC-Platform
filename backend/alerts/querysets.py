"""Source scopes for alert ingestion and maintenance."""

from django.db.models import Q

from .models import Alert


def es_alerts_queryset(index_name: str | None = None):
    # ES records predate connector markers; keep null/missing markers compatible.
    qs = Alert.objects.filter(
        Q(source_data__connector_type__isnull=True)
        | ~Q(source_data__connector_type__in=['splunk_search', 'clickhouse'])
    )
    return qs.filter(source_index=index_name) if index_name else qs
