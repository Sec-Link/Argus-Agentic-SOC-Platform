# accounts/urls_module_disabled.py — mounted at the URL prefix of every
# disabled module by siem_project/urls.py.
from django.urls import re_path

from accounts.module_views import ModuleDisabledAPIView

urlpatterns = [
    re_path(r'^.*$', ModuleDisabledAPIView.as_view(), name='module_disabled'),
]
