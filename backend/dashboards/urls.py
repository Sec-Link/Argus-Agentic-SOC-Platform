"""Dashboard chart URLs — mounted at /api/v1/dashboards/."""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import DashboardViewSet, LogSourceCategoryViewSet

router = DefaultRouter()
router.register('log-source-categories', LogSourceCategoryViewSet, basename='log-source-category')

app_name = 'dashboards'

urlpatterns = [
    path('', include(router.urls)),
    path(
        'log-source-coverage/',
        DashboardViewSet.as_view({'get': 'log_source_coverage'}),
        name='log-source-coverage',
    ),
    # Only live dashboard chart endpoints remain after retiring the editor CRUD surface.
    path(
        'conversion-stats/',
        DashboardViewSet.as_view({'get': 'conversion_stats'}),
        name='conversion-stats',
    ),
    path(
        'event-flow/',
        DashboardViewSet.as_view({'get': 'event_flow'}),
        name='event-flow',
    ),
    path(
        'funnel-stats/',
        DashboardViewSet.as_view({'get': 'funnel_stats'}),
        name='funnel-stats',
    ),
    path(
        'attack-catalog/',
        DashboardViewSet.as_view({'get': 'attack_catalog'}),
        name='attack-catalog',
    ),
    path(
        'attack-catalog/sync/',
        DashboardViewSet.as_view({'post': 'attack_catalog_sync'}),
        name='attack-catalog-sync',
    ),
    path(
        'attack-coverage/',
        DashboardViewSet.as_view({'get': 'attack_coverage'}),
        name='attack-coverage',
    ),
    path(
        'sankey-stats/',
        DashboardViewSet.as_view({'get': 'sankey_stats'}),
        name='sankey-stats',
    ),
]
