from django.urls import path
from .views import (
    EcsPresetFieldsView,
    GlobalRiskConfigView,
    NotableEventListView,
    NotableEventResolveView,
    RiskFunnelView,
    RiskProfileDetailView,
    RiskProfileListView,
    RiskRuleConfigView,
    RiskSankeyView,
    RiskTopEntitiesView,
)

urlpatterns = [
    path('ecs-presets/', EcsPresetFieldsView.as_view()),
    path('global-config/', GlobalRiskConfigView.as_view()),
    path('rule-config/', RiskRuleConfigView.as_view()),
    path('profiles/', RiskProfileListView.as_view()),
    path('profiles/<int:pk>/', RiskProfileDetailView.as_view()),
    path('notable/', NotableEventListView.as_view()),
    path('notable/<int:pk>/resolve/', NotableEventResolveView.as_view()),
    # Dashboard aggregations
    path('funnel/', RiskFunnelView.as_view()),
    path('sankey/', RiskSankeyView.as_view()),
    path('top-entities/', RiskTopEntitiesView.as_view()),
]
