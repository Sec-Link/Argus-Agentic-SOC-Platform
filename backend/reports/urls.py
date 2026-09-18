from django.urls import path

from .views import ReportGenerateView

urlpatterns = [
    path("generate/", ReportGenerateView.as_view()),
]
