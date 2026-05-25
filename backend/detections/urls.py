from django.urls import path

from .kibana_views import KibanaConnectorsView, KibanaDetectionRuleDetailView, KibanaDetectionRulePreviewView, KibanaDetectionRulesView
from .views import DetectionRuleDetailView, DetectionRulesView, DetectionRuleTestView

urlpatterns = [
    # Kibana Detection Engine API proxy
    path("kibana/rules/", KibanaDetectionRulesView.as_view(), name="kibana-detection-rules"),
    path("kibana/rules/<str:rule_id>/", KibanaDetectionRuleDetailView.as_view(), name="kibana-detection-rule-detail"),
    path("kibana/rules/<str:rule_id>", KibanaDetectionRuleDetailView.as_view()),
    path("kibana/rules/preview/", KibanaDetectionRulePreviewView.as_view(), name="kibana-detection-rule-preview"),
    path("kibana/connectors/", KibanaConnectorsView.as_view(), name="kibana-connectors"),

    # ElastAlert2 file-based API proxy (legacy)
    path("rules/", DetectionRulesView.as_view(), name="detection-rules"),
    path("rules/<path:rule_id>/", DetectionRuleDetailView.as_view(), name="detection-rule-detail"),
    path("rules/<path:rule_id>", DetectionRuleDetailView.as_view()),
    path("test/", DetectionRuleTestView.as_view(), name="detection-rule-test"),
]
