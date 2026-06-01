"""
Workflow API Views

REST API endpoints for managing workflows, executions, and actions.
"""
import re
import logging
from typing import Any, Dict

from django.db.models import Count, Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.utils.text import slugify

from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from .actions import ActionRegistry
from .engine import execute_workflow
from .models import (
    ActionTemplate,
    SavedWorkflowNode,
    Workflow,
    WorkflowExecution,
    WorkflowStep,
    WorkflowSchedule,
)
from .serializers import (
    ActionTemplateSerializer,
    SavedWorkflowNodeSerializer,
    WorkflowCreateSerializer,
    WorkflowDetailSerializer,
    WorkflowExecuteSerializer,
    WorkflowExecutionDetailSerializer,
    WorkflowExecutionListSerializer,
    WorkflowListSerializer,
    WorkflowStepCreateSerializer,
    WorkflowStepSerializer,
    WorkflowScheduleSerializer,
)
from . import prefect_client


logger = logging.getLogger(__name__)


class ActionTemplateViewSet(viewsets.ModelViewSet):
    queryset = ActionTemplate.objects.all()
    serializer_class = ActionTemplateSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = ActionTemplate.objects.all()

        category = self.request.query_params.get('category')
        if category:
            queryset = queryset.filter(category=category)

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        return queryset

    @action(detail=False, methods=['get'])
    def available_actions(self, request):
        return Response(ActionRegistry.get_action_info())

    @action(detail=False, methods=['post'], url_path='bootstrap-presets')
    def bootstrap_presets(self, request):
        presets = [
            {
                'action_type': 'block_ip',
                'name': 'Block IP (Isolation)',
                'description': 'Block a suspicious IP on the security device',
                'category': 'containment',
            },
            {
                'action_type': 'disable_user',
                'name': 'Disable User (Isolation)',
                'description': 'Disable a compromised user account',
                'category': 'containment',
            },
            {
                'action_type': 'send_email',
                'name': 'Security Alert Email',
                'description': 'Send a security notification email',
                'category': 'notification',
            },
            {
                'action_type': 'send_webhook',
                'name': 'Security Alert Webhook',
                'description': 'Send a security notification webhook',
                'category': 'notification',
            },
        ]

        info = {item['action_type']: item for item in ActionRegistry.get_action_info()}
        created = 0
        updated = 0
        for preset in presets:
            action_type = preset['action_type']
            meta = info.get(action_type, {})
            defaults = {
                'name': preset['name'],
                'description': preset['description'],
                'category': preset['category'],
                'config_schema': meta.get('config_schema', {}),
                'default_config': {},
                'is_active': True,
            }
            obj, was_created = ActionTemplate.objects.update_or_create(
                action_type=action_type,
                defaults=defaults,
            )
            if was_created:
                created += 1
            else:
                updated += 1

        return Response({'created': created, 'updated': updated})


class WorkflowViewSet(viewsets.ModelViewSet):
    queryset = Workflow.objects.all()
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.action == 'list':
            return WorkflowListSerializer
        if self.action in ['create', 'update', 'partial_update']:
            return WorkflowCreateSerializer
        return WorkflowDetailSerializer

    def get_queryset(self):
        queryset = Workflow.objects.all()

        trigger_type = self.request.query_params.get('trigger_type')
        if trigger_type:
            queryset = queryset.filter(trigger_type=trigger_type)

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        is_draft = self.request.query_params.get('is_draft')
        if is_draft is not None:
            queryset = queryset.filter(is_draft=is_draft.lower() == 'true')

        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(Q(name__icontains=search) | Q(description__icontains=search))

        return queryset

    def _prefect_flow_name(self, workflow: Workflow) -> str:
        return f"soar-{slugify(workflow.name) or workflow.id}"

    def _ensure_prefect_deployment(self, workflow: Workflow) -> None:
        if workflow.execution_engine != 'prefect':
            return
        if not prefect_client.has_api():
            return
        if (workflow.prefect_deployment_id or '').strip():
            return

        try:
            flow_id = prefect_client.get_or_create_flow_id(self._prefect_flow_name(workflow))
            created = prefect_client.create_deployment(
                flow_id=flow_id,
                name=self._prefect_flow_name(workflow),
                entrypoint='backend/workflows/prefect_flow.py:run_soar_workflow',
                parameters={},
                tags=(workflow.tags or []) + [f'workflow:{workflow.id}'],
            )
            deployment_id = created.get('id') or created.get('deployment_id')
            if deployment_id:
                workflow.prefect_deployment_id = str(deployment_id)
                workflow.save(update_fields=['prefect_deployment_id'])
        except prefect_client.PrefectAPIError as exc:
            logger.warning('Prefect deployment auto-create failed for workflow %s: %s', workflow.id, exc)

    @staticmethod
    def _prefect_schedule_payload(schedule: WorkflowSchedule | None) -> Dict[str, Any] | None:
        if not schedule:
            return None
        if schedule.schedule_type == 'interval':
            return {'interval': schedule.interval_seconds or 0}
        return {'cron': schedule.cron or '', 'timezone': schedule.timezone or 'UTC'}

    def _sync_prefect_schedule(self, schedule: WorkflowSchedule | None, workflow: Workflow) -> None:
        if workflow.execution_engine != 'prefect':
            return
        deployment_id = (workflow.prefect_deployment_id or '').strip() or None
        if not prefect_client.is_configured(deployment_id):
            return
        schedule_payload = self._prefect_schedule_payload(schedule)
        try:
            prefect_client.update_deployment_schedule(
                deployment_id=prefect_client.resolve_deployment_id(deployment_id),
                schedule=schedule_payload,
                is_active=bool(schedule.is_active) if schedule else False,
            )
        except prefect_client.PrefectAPIError as exc:
            logger.warning('Prefect schedule sync failed for workflow %s: %s', workflow.id, exc)

    def _sync_default_schedule(self, workflow: Workflow) -> None:
        if workflow.trigger_type != 'scheduled' or not workflow.schedule_cron:
            WorkflowSchedule.objects.filter(workflow=workflow, name='default').update(is_active=False)
            self._sync_prefect_schedule(None, workflow)
            return

        schedule, _ = WorkflowSchedule.objects.update_or_create(
            workflow=workflow,
            name='default',
            defaults={
                'schedule_type': 'cron',
                'cron': workflow.schedule_cron,
                'interval_seconds': None,
                'timezone': 'UTC',
                'is_active': workflow.is_active,
                'trigger_source': 'schedule',
                'trigger_data': {},
                'created_by': workflow.created_by,
            },
        )
        self._sync_prefect_schedule(schedule, workflow)

    def _sync_prefect_deployment(self, workflow: Workflow) -> None:
        if workflow.execution_engine != 'prefect':
            return
        deployment_id = (workflow.prefect_deployment_id or '').strip() or None
        if not deployment_id:
            return
        if not prefect_client.is_configured(deployment_id):
            return

        payload = {
            'name': workflow.name,
            'description': workflow.description or '',
            'tags': (workflow.tags or []) + [f'workflow:{workflow.id}'],
        }
        try:
            prefect_client.update_deployment(
                deployment_id=prefect_client.resolve_deployment_id(deployment_id),
                payload=payload,
            )
        except prefect_client.PrefectAPIError as exc:
            logger.warning('Prefect deployment sync failed for workflow %s: %s', workflow.id, exc)

    def perform_create(self, serializer):
        workflow = serializer.save(created_by=self.request.user)
        self._sync_default_schedule(workflow)
        self._ensure_prefect_deployment(workflow)
        self._sync_prefect_deployment(workflow)

    def perform_update(self, serializer):
        workflow = serializer.save()
        self._sync_default_schedule(workflow)
        self._ensure_prefect_deployment(workflow)
        self._sync_prefect_deployment(workflow)


class PrefectDeploymentListView(APIView):
    """Expose Prefect deployments so the UI can display them alongside workflows."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        if not prefect_client.has_api():
            return Response({'deployments': [], 'error': 'Prefect not configured.'})
        try:
            deployments = prefect_client.list_deployments()
        except prefect_client.PrefectAPIError as exc:
            return Response({'deployments': [], 'error': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        return Response({'deployments': deployments})


class PrefectDeploymentSyncView(APIView):
    """Sync Prefect deployments into Django workflows for bidirectional visibility."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if not prefect_client.has_api():
            return Response({'synced': 0, 'error': 'Prefect not configured.'}, status=status.HTTP_400_BAD_REQUEST)

        dry_run = str(request.data.get('dry_run', 'false')).lower() == 'true'
        synced = 0
        created = 0
        updated = 0
        try:
            deployments = prefect_client.list_deployments()
        except prefect_client.PrefectAPIError as exc:
            return Response({'synced': 0, 'error': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        for dep in deployments:
            dep_id = dep.get('id') or dep.get('deployment_id')
            if not dep_id:
                continue
            name = dep.get('name') or 'Prefect Deployment'
            description = dep.get('description') or ''

            defaults = {
                'description': description,
                'execution_engine': 'prefect',
                'is_active': False,
                'is_draft': True,
                'tags': list(set((dep.get('tags') or []) + ['prefect'])),
            }

            if dry_run:
                synced += 1
                continue

            obj, was_created = Workflow.objects.update_or_create(
                prefect_deployment_id=str(dep_id),
                defaults={
                    'name': name,
                    **defaults,
                },
            )
            synced += 1
            if was_created:
                created += 1
            else:
                updated += 1

        return Response({'synced': synced, 'created': created, 'updated': updated, 'dry_run': dry_run})


class WorkflowScheduleViewSet(viewsets.ModelViewSet):
    queryset = WorkflowSchedule.objects.select_related('workflow')
    serializer_class = WorkflowScheduleSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = WorkflowSchedule.objects.select_related('workflow')
        workflow_id = self.request.query_params.get('workflow')
        if workflow_id:
            queryset = queryset.filter(workflow_id=workflow_id)
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')
        return queryset

    @staticmethod
    def _prefect_schedule_payload(schedule: WorkflowSchedule) -> Dict[str, Any] | None:
        if schedule.schedule_type == 'interval':
            return {'interval': schedule.interval_seconds or 0}
        return {'cron': schedule.cron or '', 'timezone': schedule.timezone or 'UTC'}

    def _sync_prefect_schedule(self, schedule: WorkflowSchedule) -> None:
        workflow = schedule.workflow
        if workflow.execution_engine != 'prefect':
            return
        deployment_id = (workflow.prefect_deployment_id or '').strip() or None
        if not prefect_client.is_configured(deployment_id):
            return
        try:
            prefect_client.update_deployment_schedule(
                deployment_id=prefect_client.resolve_deployment_id(deployment_id),
                schedule=self._prefect_schedule_payload(schedule),
                is_active=bool(schedule.is_active),
            )
        except prefect_client.PrefectAPIError as exc:
            logger.warning('Prefect schedule sync failed for schedule %s: %s', schedule.id, exc)

    def perform_create(self, serializer):
        schedule = serializer.save(created_by=self.request.user)
        self._sync_prefect_schedule(schedule)

    def perform_update(self, serializer):
        schedule = serializer.save()
        self._sync_prefect_schedule(schedule)

    @action(detail=True, methods=['post'])
    def pause(self, request, pk=None):
        schedule = self.get_object()
        schedule.is_active = False
        schedule.save(update_fields=['is_active'])
        self._sync_prefect_schedule(schedule)
        return Response({'status': 'paused'})

    @action(detail=True, methods=['post'])
    def resume(self, request, pk=None):
        schedule = self.get_object()
        schedule.is_active = True
        schedule.save(update_fields=['is_active'])
        self._sync_prefect_schedule(schedule)
        return Response({'status': 'resumed'})

    @action(detail=True, methods=['post'], url_path='execute')
    def execute_plan(self, request, pk=None):
        schedule = self.get_object()
        execution = execute_workflow(
            workflow=schedule.workflow,
            trigger_data=schedule.trigger_data or {},
            trigger_source=schedule.trigger_source or 'schedule',
            executed_by=request.user,
        )
        return Response(WorkflowExecutionDetailSerializer(execution).data, status=status.HTTP_201_CREATED)



class WorkflowStepViewSet(viewsets.ModelViewSet):
    serializer_class = WorkflowStepSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = WorkflowStep.objects.all()
        workflow_id = self.request.query_params.get('workflow')
        if workflow_id:
            queryset = queryset.filter(workflow_id=workflow_id)

        node_category = self.request.query_params.get('node_category')
        if node_category:
            queryset = queryset.filter(node_category=node_category)

        return queryset.order_by('workflow', 'order')

    def get_serializer_class(self):
        if self.action in ['create', 'update', 'partial_update']:
            return WorkflowStepCreateSerializer
        return WorkflowStepSerializer

    @action(detail=False, methods=['post'])
    def reorder(self, request):
        step_orders = request.data.get('step_orders', [])

        for item in step_orders:
            step_id = item.get('id')
            order = item.get('order')
            if step_id is not None and order is not None:
                WorkflowStep.objects.filter(id=step_id).update(order=order)

        return Response({'status': 'reordered'})


class WorkflowExecutionViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = WorkflowExecution.objects.all()
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.action == 'list':
            return WorkflowExecutionListSerializer
        return WorkflowExecutionDetailSerializer

    def get_queryset(self):
        queryset = WorkflowExecution.objects.all()

        workflow_id = self.request.query_params.get('workflow')
        if workflow_id:
            queryset = queryset.filter(workflow_id=workflow_id)

        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        start_date = self.request.query_params.get('start_date')
        if start_date:
            queryset = queryset.filter(created_at__gte=start_date)

        end_date = self.request.query_params.get('end_date')
        if end_date:
            queryset = queryset.filter(created_at__lte=end_date)

        return queryset

    def retrieve(self, request, *args, **kwargs):
        # Opportunistically reconcile non-terminal Prefect-backed executions
        # with the upstream flow run before serializing. Failures are
        # swallowed so a Prefect outage never breaks the detail page.
        execution = self.get_object()
        if (
            execution.workflow.execution_engine == 'prefect'
            and execution.status not in {'completed', 'failed', 'cancelled'}
            and execution.task_result_id
        ):
            try:
                from . import prefect_dispatcher
                prefect_dispatcher.sync_status(execution)
                execution.refresh_from_db()
            except Exception:  # pragma: no cover - defensive
                pass
        serializer = self.get_serializer(execution)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        execution = self.get_object()

        if execution.status not in ['pending', 'running', 'paused']:
            return Response({'error': 'Cannot cancel execution in current state'}, status=status.HTTP_400_BAD_REQUEST)

        # For Prefect-backed runs we forward the cancel to Prefect first; the
        # local DB row is then marked cancelled regardless so the UI reflects
        # the operator's intent immediately even if Prefect is slow.
        if execution.workflow.execution_engine == 'prefect' and execution.task_result_id:
            try:
                from . import prefect_dispatcher
                prefect_dispatcher.cancel(execution)
            except Exception:  # pragma: no cover - defensive
                pass

        execution.status = 'cancelled'
        execution.completed_at = timezone.now()
        execution.save(update_fields=['status', 'completed_at'])

        return Response(
            {
                'status': 'cancelled',
                'execution_id': str(execution.id),
                'task_result_id': execution.task_result_id or None,
            }
        )

    @action(detail=True, methods=['post'], url_path='refresh-prefect-status')
    def refresh_prefect_status(self, request, pk=None):
        """
        Force-sync a Prefect-backed execution from the Prefect Server.

        Used by the executions UI when the operator clicks 'Refresh from
        Prefect'. Returns the up-to-date detail payload.
        """
        execution = self.get_object()
        if execution.workflow.execution_engine != 'prefect':
            return Response(
                {'error': 'Execution is not running on the Prefect engine.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not execution.task_result_id:
            return Response(
                {'error': 'No Prefect flow run id recorded for this execution.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            from . import prefect_dispatcher
            prefect_dispatcher.sync_status(execution)
            execution.refresh_from_db()
        except Exception as exc:
            return Response(
                {'error': f'Prefect sync failed: {exc}'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return Response(WorkflowExecutionDetailSerializer(execution).data)

    @action(detail=True, methods=['get'])
    def steps(self, request, pk=None):
        execution = self.get_object()
        from .serializers import StepExecutionSerializer
        steps = execution.step_executions.all()
        serializer = StepExecutionSerializer(steps, many=True)
        return Response(serializer.data)


class SavedWorkflowNodeViewSet(viewsets.ModelViewSet):
    serializer_class = SavedWorkflowNodeSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = SavedWorkflowNode.objects.filter(created_by=self.request.user)

        node_category = self.request.query_params.get('node_category')
        if node_category:
            queryset = queryset.filter(node_category=node_category)

        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(Q(name__icontains=search) | Q(action_type__icontains=search))

        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)



class WorkflowStatsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        total_workflows = Workflow.objects.count()
        active_workflows = Workflow.objects.filter(is_active=True).count()

        total_executions = WorkflowExecution.objects.count()
        completed_executions = WorkflowExecution.objects.filter(status='completed').count()
        failed_executions = WorkflowExecution.objects.filter(status='failed').count()
        running_executions = WorkflowExecution.objects.filter(status='running').count()

        recent_executions = WorkflowExecution.objects.order_by('-created_at')[:10]
        status_counts = WorkflowExecution.objects.values('status').annotate(count=Count('id'))

        return Response(
            {
                'workflows': {
                    'total': total_workflows,
                    'active': active_workflows,
                    'inactive': total_workflows - active_workflows,
                },
                'executions': {
                    'total': total_executions,
                    'completed': completed_executions,
                    'failed': failed_executions,
                    'running': running_executions,
                    'success_rate': (completed_executions / total_executions * 100) if total_executions > 0 else 0,
                },
                'status_breakdown': {item['status']: item['count'] for item in status_counts},
                'recent_executions': WorkflowExecutionListSerializer(recent_executions, many=True).data,
            }
        )
