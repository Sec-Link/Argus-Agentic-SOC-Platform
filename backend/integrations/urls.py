"""integrations URLs — mounted at /api/v1/integrations/."""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    IntegrationViewSet,
    integrations_preview_es_mapping,
    preview_es_index,
    test_db_connection,
    test_es_connection,
)

app_name = 'integrations'

router = DefaultRouter()
router.register(r'', IntegrationViewSet, basename='integration')

# Custom function-view endpoints intentionally have no trailing slash to match
# existing client URLs and to avoid colliding with the router's detail route
# (which requires a trailing slash).
urlpatterns = [
    path('test_db', test_db_connection, name='test_db'),
    path('test_es', test_es_connection, name='test_es'),
    path('preview_es', preview_es_index, name='preview_es'),
    path('preview_es_mapping', integrations_preview_es_mapping, name='preview_es_mapping'),
    path('', include(router.urls)),
]
