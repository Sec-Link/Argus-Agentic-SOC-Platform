from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from rest_framework.exceptions import ValidationError

from ...deployment_registry import require_deployment
from ...persistence import persist_workflow_definition
from ...sample_workflows.critical_ticket_email_workflow import build_critical_ticket_email_workflow_definition
from ...serializers import WorkflowCreateSerializer
from ...views import WorkflowViewSet

User = get_user_model()


class Command(BaseCommand):
    help = 'Import the critical ticket email playbook as a durable Django workflow.'

    def add_arguments(self, parser):
        parser.add_argument('--recipient', default='achen@seclink.info', help='Recipient email address')
        parser.add_argument('--username', default='', help='Existing username to own the workflow')
        parser.add_argument('--activate', action='store_true', help='Mark the workflow active after import')
        parser.add_argument('--deployment-id', default='', help='Registered Prefect deployment UUID (required with --activate)')

    def handle(self, *args, **options):
        recipient = (options.get('recipient') or '').strip()
        if not recipient:
            raise CommandError('--recipient is required')
        deployment_id = (options.get('deployment_id') or '').strip()
        if options.get('activate') and not deployment_id:
            raise CommandError('--activate requires --deployment-id; import a draft to bind later.')
        if deployment_id:
            try:
                deployment_id = require_deployment(deployment_id)
            except ValueError as exc:
                raise CommandError(str(exc)) from exc

        username = (options.get('username') or '').strip()
        created_by = None
        if username:
            created_by = User.objects.filter(username=username).first()
            if created_by is None:
                raise CommandError(f'User not found: {username}')

        workflow_definition, _ = build_critical_ticket_email_workflow_definition(recipient=recipient)
        try:
            with transaction.atomic():
                workflow = persist_workflow_definition(
                    workflow_definition=workflow_definition,
                    created_by=created_by,
                    trigger_type='ticket_created',
                    trigger_conditions={},
                    is_active=False,
                    is_draft=True,
                    tags=['playbook', 'email', 'critical-ticket'],
                    update_existing=True,
                )
                if deployment_id:
                    serializer = WorkflowCreateSerializer(instance=workflow, data={
                        'prefect_deployment_id': deployment_id,
                        'is_active': bool(options.get('activate')),
                        'is_draft': True,
                    }, partial=True)
                    serializer.is_valid(raise_exception=True)
                    workflow = serializer.save()
                WorkflowViewSet()._sync_default_schedule(workflow)
        except (ValueError, ValidationError) as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write(self.style.SUCCESS(f'Imported workflow: {workflow.name}'))
        self.stdout.write(f'  id={workflow.id}')
        self.stdout.write(f'  execution_engine={workflow.execution_engine}')
        self.stdout.write(f'  prefect_deployment_id={workflow.prefect_deployment_id or "(unbound)"}')
        self.stdout.write(f'  is_active={workflow.is_active}')
        self.stdout.write(f'  is_draft={workflow.is_draft}')
        self.stdout.write(f'  steps={workflow.steps.count()}')
