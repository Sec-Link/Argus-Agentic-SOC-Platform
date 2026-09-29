"""Project compatible Prefect deployments into Django without creating workflows."""

from uuid import UUID

from django.db import transaction
from django.utils import timezone

from .models import PrefectDeployment

GENERIC_ENTRYPOINT = 'backend/workflows/prefect/flow.py:run_soar_workflow'
DEPLOYMENT_EVENT_NAMES = [
    'prefect.deployment.created', 'prefect.deployment.updated',
    'prefect.deployment.deleted', 'prefect.deployment.ready',
    'prefect.deployment.not-ready',
]


def require_deployment(deployment_id):
    """Return an available registered UUID, without falling back to another target."""
    if not deployment_id:
        raise ValueError('Select a Prefect deployment for this workflow before execution.')
    try:
        deployment_id = UUID(str(deployment_id).strip())
    except (ValueError, AttributeError, TypeError):
        raise ValueError('Prefect deployment ID must be a valid UUID.') from None
    if not PrefectDeployment.objects.filter(pk=deployment_id, is_available=True).exists():
        raise ValueError('The selected Prefect deployment is not registered or is no longer available.')
    return str(deployment_id)


@transaction.atomic
def apply_deployment_snapshot(deployments):
    """Apply only a complete validated snapshot, called under consumer leadership."""
    if not isinstance(deployments, list):
        raise ValueError('Prefect deployment snapshot must be a list.')
    compatible = {}
    seen = set()
    for deployment in deployments:
        if not isinstance(deployment, dict):
            raise ValueError('Prefect deployment entries must be objects.')
        try:
            deployment_id = UUID(str(deployment['id']))
        except (KeyError, ValueError, TypeError):
            raise ValueError('Prefect deployment snapshot contains an invalid UUID.') from None
        if deployment_id in seen:
            raise ValueError('Prefect deployment snapshot contains duplicate UUIDs.')
        seen.add(deployment_id)
        fields = {}
        for name, maximum in (('name', 255), ('work_pool_name', 255), ('work_queue_name', 255), ('status', 32)):
            value = deployment.get(name)
            if value is None and name != 'name':
                value = ''
            if not isinstance(value, str) or len(value) > maximum or (name == 'name' and not value.strip()):
                raise ValueError(f'Prefect deployment snapshot contains an invalid {name}.')
            fields[name] = value
        tags = deployment.get('tags')
        entrypoint = deployment.get('entrypoint')
        if not isinstance(tags, list) or any(not isinstance(tag, str) for tag in tags):
            raise ValueError('Prefect deployment tags must be a list of strings.')
        if entrypoint is not None and not isinstance(entrypoint, str):
            raise ValueError('Prefect deployment entrypoint must be a string or null.')
        if 'soar' in tags and (entrypoint or '').replace('\\', '/') == GENERIC_ENTRYPOINT:
            compatible[deployment_id] = fields

    synced_at = timezone.now()
    for deployment_id, fields in compatible.items():
        PrefectDeployment.objects.update_or_create(
            pk=deployment_id,
            defaults={**fields, 'is_available': True, 'last_synced_at': synced_at},
        )
    PrefectDeployment.objects.exclude(pk__in=compatible).update(
        is_available=False, last_synced_at=synced_at,
    )
