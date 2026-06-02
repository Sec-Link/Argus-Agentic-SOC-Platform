from django.urls import path
from .views import AlertListView, AlertDashboardView, ESDiagnosticsView, AlertSyncView

urlpatterns = [
    path('list/', AlertListView.as_view(), name='alert-list'),
    path('dashboard/', AlertDashboardView.as_view(), name='alert-dashboard'),
    path('sync/', AlertSyncView.as_view(), name='alert-sync'),
    path('debug/es_status/', ESDiagnosticsView.as_view(), name='es-diagnostics'),
]
