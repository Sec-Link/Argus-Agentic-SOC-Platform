from django.core.management.base import BaseCommand, CommandError

from workflows import prefect_client
from workflows.deployment_registry import require_deployment
from workflows.models import WorkflowSchedule
from workflows.prefect_dispatcher import sync_schedule


class Command(BaseCommand):
    help = 'Replace the legacy shared Prefect schedule and sync active and paused workflow schedules.'

    def handle(self, *args, **options):
        schedules = list(
            WorkflowSchedule.objects.filter(
                workflow__execution_engine='prefect',
            ).select_related('workflow')
        )
        synced = 0
        cleaned_deployments = set()
        errors = []
        for item in schedules:
            try:
                sync_schedule(item.pk)
                synced += 1
            except (OSError, ValueError, TypeError, KeyError, prefect_client.PrefectAPIError, prefect_client.PrefectConfigError) as exc:
                errors.append(f'Schedule {item.id} ({item.workflow.name}): {exc}')
                continue
            try:
                deployment_id = require_deployment(item.workflow.prefect_deployment_id)
                if deployment_id not in cleaned_deployments:
                    prefect_client.delete_deployment_schedule_by_slug(
                        deployment_id=deployment_id,
                        slug='argus-workflow-schedule',
                    )
                    cleaned_deployments.add(deployment_id)
            except (OSError, ValueError, prefect_client.PrefectAPIError, prefect_client.PrefectConfigError) as exc:
                errors.append(f'Legacy schedule cleanup for deployment {item.workflow.prefect_deployment_id}: {exc}')
        self.stdout.write(f'Synced {synced} Prefect schedule(s).')
        if errors:
            raise CommandError('\n'.join(errors))
