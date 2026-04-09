from django.urls import path
from correlation import views

urlpatterns = [
    path('policy/', views.CorrelationPolicyView.as_view(), name='correlation-policy'),
    path('events/', views.CorrelationEventsView.as_view(), name='correlation-events'),
]
