"""orchestrator URLs — mounted at /api/v1/orchestrator/."""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import TaskRequestLogViewSet, TaskRunViewSet, TaskViewSet

app_name = 'orchestrator'

router = DefaultRouter()
router.register(r'tasks', TaskViewSet, basename='task')
router.register(r'task_runs', TaskRunViewSet, basename='taskrun')
router.register(r'task_request_logs', TaskRequestLogViewSet, basename='taskrequestlog')

urlpatterns = [
    path('', include(router.urls)),
]
