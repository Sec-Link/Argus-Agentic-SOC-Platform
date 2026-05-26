from django.urls import path

from .kibana_views import KibanaConnectorsView, KibanaDetectionRuleDetailView, KibanaDetectionRulePreviewView, KibanaDetectionRuleVersionsView, KibanaDetectionRulesView
from .views import (
    DetectionMappingListView,
    DetectionMappingUploadView,
    DetectionRuleDetailView,
    DetectionRuleCompileView,
    DetectionRulesView,
    DetectionRuleTestView,
    DetectionRuleUploadView,
)

urlpatterns = [
    # Publish/remote rule APIs (legacy `kibana/*` paths kept for compatibility)
    path("publish/rules/", KibanaDetectionRulesView.as_view(), name="publish-detection-rules"),
    path("publish/rules/<str:rule_id>/", KibanaDetectionRuleDetailView.as_view(), name="publish-detection-rule-detail"),
    path("publish/rules/<str:rule_id>", KibanaDetectionRuleDetailView.as_view()),
    path("publish/rules/<str:rule_id>/versions/", KibanaDetectionRuleVersionsView.as_view(), name="publish-detection-rule-versions"),
    path("publish/rules/<str:rule_id>/rollback/", KibanaDetectionRuleVersionsView.as_view()),
    path("publish/rules/preview/", KibanaDetectionRulePreviewView.as_view(), name="publish-detection-rule-preview"),
    path("publish/connectors/", KibanaConnectorsView.as_view(), name="publish-connectors"),

    # Local rule APIs
    path("rules/", DetectionRulesView.as_view(), name="detection-rules"),
    path("rules/upload/", DetectionRuleUploadView.as_view(), name="detection-rules-upload"),
    path("mappings/", DetectionMappingListView.as_view(), name="detection-mappings"),
    path("mappings/upload/", DetectionMappingUploadView.as_view(), name="detection-mappings-upload"),
    path("rules/<path:rule_id>/", DetectionRuleDetailView.as_view(), name="detection-rule-detail"),
    path("rules/<path:rule_id>", DetectionRuleDetailView.as_view()),
    path("rules/compile/", DetectionRuleCompileView.as_view(), name="detection-rule-compile"),
    path("test/", DetectionRuleTestView.as_view(), name="detection-rule-test"),
]
