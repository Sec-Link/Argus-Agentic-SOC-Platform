"""
Workflow URL Configuration

API routes for the workflows app.
"""
from django.urls import path, include
from rest_framework.routers import SimpleRouter

from .views import (
    ActionTemplateViewSet,
    PrefectDeploymentListView,
    PrefectDeploymentSyncView,
    WorkflowViewSet,
    WorkflowStepViewSet,
    WorkflowExecutionViewSet,
    WorkflowStatsView,
    SavedWorkflowNodeViewSet,
    WorkflowScheduleViewSet,
)

# API Router - use SimpleRouter to avoid duplicate format suffix converter registration
router = SimpleRouter()
router.register(r'action-templates', ActionTemplateViewSet, basename='action-template')
router.register(r'workflows', WorkflowViewSet, basename='workflow')
router.register(r'executions', WorkflowExecutionViewSet, basename='execution')
router.register(r'steps', WorkflowStepViewSet, basename='step')
router.register(r'saved-nodes', SavedWorkflowNodeViewSet, basename='saved-node')
router.register(r'schedules', WorkflowScheduleViewSet, basename='schedule')

# API URL patterns
urlpatterns = [
    path('', include(router.urls)),
    path('stats/', WorkflowStatsView.as_view(), name='workflow-stats'),
    path('prefect/deployments/', PrefectDeploymentListView.as_view(), name='prefect-deployments'),
    path('prefect/sync/', PrefectDeploymentSyncView.as_view(), name='prefect-sync'),
]
