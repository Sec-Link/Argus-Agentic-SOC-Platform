"""dashboards URLs — mounted at /api/v1/dashboards/."""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import DashboardViewSet

app_name = 'dashboards'

router = DefaultRouter()
router.register(r'', DashboardViewSet, basename='dashboard')

urlpatterns = [
    path('', include(router.urls)),
]
