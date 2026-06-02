"""URL configuration for siem_project.

Root URLs delegate to per-module urls.py via include(). Direct view imports
and DRF router registrations live in the relevant module, not here.
"""
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path('admin/', admin.site.urls),

    # accounts (auth lives under /api/v1/accounts/auth/)
    path('api/v1/accounts/', include('accounts.urls')),
    path('api/v1/permissions/', include('accounts.urls_permissions')),
    path('api/v1/rbac/', include('accounts.urls_rbac')),

    # domain modules
    path('api/v1/alerts/', include('alerts.urls')),
    path('api/v1/correlation/', include('correlation.urls')),
    path('api/v1/tickets/', include('tickets.urls')),
    path('api/v1/workflows/', include('workflows.urls')),
    path('api/v1/interfaces/', include('workflow_interfaces.urls')),
    path('api/v1/detections/', include('detections.urls')),
    path('api/v1/cmdb/', include('cmdb.urls')),
    path('api/v1/integrations/', include('integrations.urls')),
    path('api/v1/dashboards/', include('dashboards.urls')),
    path('api/v1/ai-assistant/', include('ai_assistant.urls')),
    path('api/v1/orchestrator/', include('orchestrator.urls')),
]
