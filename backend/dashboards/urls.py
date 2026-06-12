"""Dashboard chart URLs — mounted at /api/v1/dashboards/."""
from django.urls import path

from .views import DashboardViewSet

app_name = 'dashboards'

urlpatterns = [
    # Only live dashboard chart endpoints remain after retiring the editor CRUD surface.
    path(
        'conversion-stats/',
        DashboardViewSet.as_view({'get': 'conversion_stats'}),
        name='conversion-stats',
    ),
    path(
        'sankey-stats/',
        DashboardViewSet.as_view({'get': 'sankey_stats'}),
        name='sankey-stats',
    ),
]
