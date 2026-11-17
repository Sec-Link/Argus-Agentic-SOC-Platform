"""URL configuration for siem_project.

Root URLs delegate to per-module urls.py via include(). Direct view imports
and DRF router registrations live in the relevant module, not here.

Which modules are mounted is decided by the module registry
(siem_project/modules.py). A disabled module's urlconf is never imported; its
URL prefix is routed to a small "module disabled" responder instead, so API
clients get an explicit answer rather than a generic 404.
"""
from django.conf import settings
from django.contrib import admin
from django.urls import include, path

from siem_project.modules import MODULES, MODULE_KEYS


def build_urlpatterns(enabled_modules):
    """Return the root URL patterns for the given enabled module keys."""
    enabled = set(enabled_modules)
    patterns = [path('admin/', admin.site.urls)]
    for spec in MODULES:
        for prefix, urlconf in spec.urls:
            if spec.key in enabled:
                patterns.append(path(prefix, include(urlconf)))
            else:
                # The extra kwarg tells the responder which module was hit.
                patterns.append(path(prefix, include('accounts.urls_module_disabled'), {'module': spec.key}))
    return patterns


urlpatterns = build_urlpatterns(getattr(settings, 'ARGUS_ENABLED_MODULES', MODULE_KEYS))
