"""Module Management API.

Lets administrators see which Argus modules are loaded and choose which
optional modules should be loaded after the next backend restart. The rules
(core modules, dependencies, startup behavior) live in siem_project/modules.py.

Security notes:
* Changing the module state affects the whole platform, so writes require a
  superuser. Staff users can read the state. Authorization is enforced here,
  not by hiding controls in the frontend.
* Every accepted change is written to the audit log.
* Saving never loads or unloads code in the running process and never touches
  module data; it only records the desired state.
"""
from __future__ import annotations

import logging

from django.conf import settings
from django.db import transaction
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from siem_project.modules import (
    MODULES,
    MODULES_BY_KEY,
    required_by,
    resolve_module_state,
    split_module_keys,
)

from .audit import AuditService, request_ip, request_user_agent
from .models import AuditLog, SystemSettings
from .serializers import ModuleStateUpdateSerializer

logger = logging.getLogger(__name__)


class IsSuperuserOrStaffReadOnly(permissions.BasePermission):
    """Staff may read; only superusers may change the module state."""

    def has_permission(self, request, view):
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            return False
        if request.method in permissions.SAFE_METHODS:
            return bool(user.is_staff or user.is_superuser)
        return bool(user.is_superuser)


def _active_modules() -> tuple[str, ...]:
    """Modules loaded in this process (fixed at startup)."""
    return tuple(settings.ARGUS_ENABLED_MODULES)


def _module_payload(stored_disabled, user) -> dict:
    """Describe every module: what runs now and what will run after restart."""
    active = set(_active_modules())
    env_disabled = set(getattr(settings, 'ARGUS_ENV_DISABLED_MODULES', ()))
    admin_disabled, _unknown, _core = split_module_keys(stored_disabled)
    # The state the next process start would resolve to.
    target = resolve_module_state(admin_disabled, env_disabled)

    modules = []
    for spec in MODULES:
        will_be_enabled = target.is_enabled(spec.key)
        modules.append({
            'key': spec.key,
            'label': spec.label,
            'description': spec.description,
            'core': spec.core,
            'requires': list(spec.requires),
            'required_by': list(required_by(spec.key)),
            # Loaded in the process that answered this request.
            'active': spec.key in active,
            # What the administrator asked for on this page.
            'desired_enabled': spec.key not in admin_disabled,
            # What the next restart will load, after environment overrides
            # and dependency rules are applied.
            'effective_enabled': will_be_enabled,
            'disabled_reason': target.disabled.get(spec.key),
            'env_disabled': spec.key in env_disabled,
            'pending_restart': (spec.key in active) != will_be_enabled,
        })
    return {
        'modules': modules,
        'restart_required': any(m['pending_restart'] for m in modules),
        # False when this process could not read the saved state at startup
        # and therefore started from the environment configuration only.
        'state_loaded_at_startup': bool(getattr(settings, 'ARGUS_MODULE_STATE_LOADED', False)),
        'can_manage': bool(user.is_superuser),
    }


class EnabledModulesAPIView(APIView):
    """List the modules loaded in this process.

    Available to every authenticated user so the UI can hide navigation for
    modules that are not loaded. It exposes module keys only.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response({'enabled_modules': list(_active_modules())})


class ModuleManagementAPIView(APIView):
    permission_classes = [IsSuperuserOrStaffReadOnly]

    def get(self, request):
        row = SystemSettings.get_solo()
        return Response(_module_payload(row.disabled_modules, request.user))

    def put(self, request):
        serializer = ModuleStateUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        requested = serializer.validated_data['disabled_modules']

        # Lock the settings row so concurrent saves cannot interleave.
        with transaction.atomic():
            row = SystemSettings.objects.select_for_update().get(pk=SystemSettings.get_solo().pk)
            previous = list(row.disabled_modules or [])
            row.disabled_modules = requested
            row.save(update_fields=['disabled_modules', 'updated_at'])

        if previous != requested:
            AuditService.log_safe(
                event_type=AuditLog.EventType.ACTIVITY,
                status=AuditLog.Status.SUCCESS,
                action_type=AuditLog.ActionType.FEATURE_EXEC,
                path=request.path,
                method=request.method,
                admin_email=request.user.email,
                ip_address=request_ip(request),
                user_agent=request_user_agent(request),
                metadata={
                    'action': 'module_state_update',
                    'actor': request.user.get_username(),
                    'previous_disabled_modules': previous,
                    'disabled_modules': requested,
                },
            )
            logger.info(
                'Module state changed by %s: disabled=%s (applies at next restart)',
                request.user.get_username(), requested,
            )
        return Response(_module_payload(requested, request.user))


class ModuleDisabledAPIView(APIView):
    """Answer requests under the URL prefix of a module that is not loaded.

    Uses the default authentication requirement so that anonymous callers
    cannot probe which modules are disabled.
    """

    def _respond(self, request, *args, module: str = '', **kwargs):
        spec = MODULES_BY_KEY.get(module)
        label = spec.label if spec else 'This'
        return Response(
            {'detail': f'{label} module is disabled.', 'code': 'module_disabled', 'module': module},
            status=status.HTTP_404_NOT_FOUND,
        )

    get = post = put = patch = delete = _respond
