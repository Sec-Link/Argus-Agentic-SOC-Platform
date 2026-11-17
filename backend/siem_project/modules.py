"""Argus module registry and enable/disable resolution.

Argus is built from Django apps ("modules"). Optional modules can be switched
off so that they are not added to ``INSTALLED_APPS`` and their URLs are not
mounted. This file is the single source of truth for which modules exist, which
are optional, and which depend on each other.

Design constraints (see AGENTS.md):

* This file is imported by ``settings.py`` *before* Django's app registry is
  ready, so it must not import models or anything that touches the ORM.
* ``INSTALLED_APPS`` is fixed for the lifetime of a process. A change made on
  the Module Management page is only the *desired* state; it takes effect the
  next time the backend processes start.
* Startup must never crash because of stored module state. Invalid stored
  values are ignored with a warning, and an unreadable database falls back to
  the environment-only configuration.
* Disabling a module never deletes its tables or data. Re-enabling it and
  restarting restores the module.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Iterable, Mapping

logger = logging.getLogger(__name__)

# Environment variable holding a comma-separated list of module keys that the
# operator force-disables. It always wins over the state saved from the UI.
ENV_DISABLED_MODULES = 'ARGUS_DISABLED_MODULES'
# Set to false to ignore the state saved in the database (recovery switch).
ENV_DB_BOOTSTRAP = 'ARGUS_MODULE_DB_BOOTSTRAP'

# Reasons reported to the UI for a module that is not effectively enabled.
REASON_ADMIN = 'admin'
REASON_ENVIRONMENT = 'environment'
REASON_DEPENDENCY = 'dependency'

_BOOTSTRAP_TIMEOUT_SECONDS = 3


@dataclass(frozen=True)
class ModuleSpec:
    """Static description of one Argus module."""

    key: str
    label: str
    description: str
    # Entries added to INSTALLED_APPS when the module is enabled.
    apps: tuple[str, ...]
    # (URL prefix, urlconf module) pairs mounted when the module is enabled.
    urls: tuple[tuple[str, str], ...]
    # Core modules are imported at module level by other modules and can never
    # be disabled.
    core: bool = False
    # Optional modules this module imports at module level. If any of them is
    # disabled, this module cannot be loaded either. Core modules are implied
    # and are not listed. Kept honest by siem_project/tests/test_modules.py.
    requires: tuple[str, ...] = ()


# Order matters: it is the INSTALLED_APPS order used before modules existed.
MODULES: tuple[ModuleSpec, ...] = (
    ModuleSpec(
        key='accounts',
        label='Accounts & Access',
        description='Authentication, RBAC, audit logs, and system settings.',
        apps=('accounts',),
        urls=(
            ('api/v1/accounts/', 'accounts.urls'),
            ('api/v1/permissions/', 'accounts.urls_permissions'),
            ('api/v1/rbac/', 'accounts.urls_rbac'),
        ),
        core=True,
    ),
    ModuleSpec(
        key='correlation',
        label='Correlation',
        description='Correlation policies and correlated events.',
        apps=('correlation',),
        urls=(('api/v1/correlation/', 'correlation.urls'),),
    ),
    ModuleSpec(
        key='integrations',
        label='Integrations',
        description='External data sources and connector configuration.',
        apps=('integrations',),
        urls=(('api/v1/integrations/', 'integrations.urls'),),
        core=True,
    ),
    ModuleSpec(
        key='alerts',
        label='Alerts',
        description='Alert ingestion, storage, and triage.',
        apps=('alerts',),
        urls=(('api/v1/alerts/', 'alerts.urls'),),
        core=True,
    ),
    ModuleSpec(
        key='dashboards',
        label='Dashboards',
        description='Overview dashboard, detection coverage, and log source discovery.',
        apps=('dashboards',),
        urls=(('api/v1/dashboards/', 'dashboards.urls'),),
        # Core: the Overview dashboard is the landing page of the product.
        core=True,
    ),
    ModuleSpec(
        key='tickets',
        label='Tickets',
        description='Incident tickets, work logs, and ticket policies.',
        apps=('tickets',),
        urls=(('api/v1/tickets/', 'tickets.urls'),),
        core=True,
    ),
    ModuleSpec(
        key='cmdb',
        label='Assets (CMDB)',
        description='Asset inventory.',
        apps=('cmdb',),
        urls=(('api/v1/cmdb/', 'cmdb.urls'),),
        # Core because the core dashboards module imports it at module level.
        core=True,
    ),
    ModuleSpec(
        key='ai_assistant',
        label='AI Assistant',
        description='AI assistant, skills, and MCP servers used by tickets.',
        apps=('ai_assistant',),
        urls=(('api/v1/ai-assistant/', 'ai_assistant.urls'),),
        core=True,
    ),
    ModuleSpec(
        key='orchestrator',
        label='Orchestrator',
        description='Scheduled data pipeline tasks.',
        apps=('orchestrator.apps.OrchestratorConfig',),
        urls=(('api/v1/orchestrator/', 'orchestrator.urls'),),
        requires=('correlation',),
    ),
    ModuleSpec(
        key='workflows',
        label='Workflows',
        description='SOAR workflows and workflow executions.',
        apps=('workflows.apps.WorkflowsConfig',),
        urls=(('api/v1/workflows/', 'workflows.urls'),),
    ),
    ModuleSpec(
        key='workflow_interfaces',
        label='Workflow Interfaces',
        description='Inbound interface endpoints that trigger workflows.',
        apps=('workflow_interfaces',),
        urls=(('api/v1/interfaces/', 'workflow_interfaces.urls'),),
        requires=('workflows',),
    ),
    ModuleSpec(
        key='detections',
        label='Detection',
        description='Detection rules and rule publication.',
        apps=('detections',),
        urls=(('api/v1/detections/', 'detections.urls'),),
        core=True,
    ),
    ModuleSpec(
        key='risk',
        label='Risk (RBA)',
        description='Risk-based alerting scores and risk events.',
        apps=('risk',),
        urls=(('api/v1/risk/', 'risk.urls'),),
    ),
    ModuleSpec(
        key='reports',
        label='Reports',
        description='SOC report generation.',
        apps=('reports',),
        urls=(('api/v1/reports/', 'reports.urls'),),
        requires=('correlation', 'risk'),
    ),
)

MODULES_BY_KEY: dict[str, ModuleSpec] = {spec.key: spec for spec in MODULES}
MODULE_KEYS: tuple[str, ...] = tuple(spec.key for spec in MODULES)
CORE_MODULE_KEYS: frozenset[str] = frozenset(spec.key for spec in MODULES if spec.core)
OPTIONAL_MODULE_KEYS: frozenset[str] = frozenset(MODULE_KEYS) - CORE_MODULE_KEYS


@dataclass(frozen=True)
class ModuleState:
    """Result of resolving the requested disabled modules."""

    # Module keys that are loaded, in registry order.
    enabled: tuple[str, ...]
    # Module key -> reason (REASON_*) for every module that is not loaded.
    disabled: Mapping[str, str] = field(default_factory=dict)

    def is_enabled(self, key: str) -> bool:
        return key in self.enabled


def required_by(key: str) -> tuple[str, ...]:
    """Return the modules that directly require ``key``, in registry order."""
    return tuple(spec.key for spec in MODULES if key in spec.requires)


def dependents_of(key: str) -> tuple[str, ...]:
    """Return every module that directly or indirectly requires ``key``."""
    found: set[str] = set()
    pending = [key]
    while pending:
        for dependent in required_by(pending.pop()):
            if dependent not in found:
                found.add(dependent)
                pending.append(dependent)
    return tuple(k for k in MODULE_KEYS if k in found)


def split_module_keys(values: Iterable[object]) -> tuple[set[str], list[str], list[str]]:
    """Split raw values into (valid optional keys, unknown values, core keys)."""
    valid: set[str] = set()
    unknown: list[str] = []
    core: list[str] = []
    for value in values:
        if not isinstance(value, str) or value not in MODULES_BY_KEY:
            unknown.append(str(value)[:64])
        elif value in CORE_MODULE_KEYS:
            core.append(value)
        else:
            valid.add(value)
    return valid, unknown, core


def validate_disabled_modules(values: Iterable[object]) -> list[str]:
    """Return human-readable problems with a requested disabled set.

    Used by the API so that an administrator cannot save a state that would be
    silently changed at startup. An empty list means the request is valid.
    """
    disabled, unknown, core = split_module_keys(values)
    errors: list[str] = []
    if unknown:
        errors.append(f"Unknown module(s): {', '.join(sorted(set(unknown)))}.")
    if core:
        errors.append(f"Core module(s) cannot be disabled: {', '.join(sorted(set(core)))}.")
    for spec in MODULES:
        if spec.key in disabled:
            continue
        missing = [dep for dep in spec.requires if dep in disabled]
        if missing:
            errors.append(
                f"Module '{spec.key}' requires {', '.join(repr(m) for m in missing)}; "
                f"disable '{spec.key}' as well or keep its requirements enabled."
            )
    return errors


def resolve_module_state(
    admin_disabled: Iterable[object] = (),
    env_disabled: Iterable[str] = (),
) -> ModuleState:
    """Compute which modules are loaded.

    ``admin_disabled`` is the state saved from the UI and is treated as
    untrusted: unknown or core keys are ignored with a warning instead of
    failing startup. ``env_disabled`` must already be validated (see
    ``parse_env_disabled_modules``). Modules whose requirements are disabled
    are disabled as well, so the result is always loadable.
    """
    admin_valid, unknown, core = split_module_keys(admin_disabled)
    if unknown or core:
        logger.warning(
            'Ignoring invalid stored module state (unknown=%s, core=%s).', sorted(set(unknown)), sorted(set(core)),
        )

    reasons: dict[str, str] = {key: REASON_ADMIN for key in admin_valid}
    # Environment overrides the UI, so it is the reason shown when both apply.
    reasons.update({key: REASON_ENVIRONMENT for key in env_disabled})

    # Cascade to a fixed point: a module cannot load without its requirements.
    changed = True
    while changed:
        changed = False
        for spec in MODULES:
            if spec.key not in reasons and any(dep in reasons for dep in spec.requires):
                reasons[spec.key] = REASON_DEPENDENCY
                changed = True

    enabled = tuple(key for key in MODULE_KEYS if key not in reasons)
    return ModuleState(enabled=enabled, disabled={k: reasons[k] for k in MODULE_KEYS if k in reasons})


def parse_env_disabled_modules(raw: str | None) -> tuple[str, ...]:
    """Parse ``ARGUS_DISABLED_MODULES``.

    Operator configuration fails fast: a typo that silently left a module
    enabled would be worse than a clear startup error.
    """
    from django.core.exceptions import ImproperlyConfigured

    values = [item.strip() for item in (raw or '').split(',') if item.strip()]
    valid, unknown, core = split_module_keys(values)
    if unknown:
        raise ImproperlyConfigured(
            f"{ENV_DISABLED_MODULES} contains unknown module(s): {', '.join(sorted(set(unknown)))}. "
            f"Optional modules: {', '.join(sorted(OPTIONAL_MODULE_KEYS))}."
        )
    if core:
        raise ImproperlyConfigured(
            f"{ENV_DISABLED_MODULES} contains core module(s) that cannot be disabled: {', '.join(sorted(set(core)))}."
        )
    return tuple(key for key in MODULE_KEYS if key in valid)


def load_admin_disabled_modules(database: Mapping[str, object]) -> tuple[list[object], bool]:
    """Read the disabled modules saved from the UI, without the Django ORM.

    Returns ``(values, loaded)``. ``loaded`` is False when the state could not
    be read (database unreachable, table or column not migrated yet, ...). In
    that case startup continues with no UI-disabled modules; this is logged
    because it means a module an administrator disabled may be loaded.

    The ORM cannot be used here because settings are still being evaluated.
    Only the exception type is logged so connection details never reach logs.
    """
    if 'postgresql' not in str(database.get('ENGINE', '')):
        return [], False
    try:
        import psycopg2

        connection = psycopg2.connect(
            dbname=database.get('NAME'),
            user=database.get('USER'),
            password=database.get('PASSWORD'),
            host=database.get('HOST'),
            port=database.get('PORT'),
            connect_timeout=_BOOTSTRAP_TIMEOUT_SECONDS,
            options=f'-c statement_timeout={_BOOTSTRAP_TIMEOUT_SECONDS * 1000}',
        )
        try:
            with connection.cursor() as cursor:
                cursor.execute('SELECT disabled_modules FROM accounts_system_settings ORDER BY id LIMIT 1')
                row = cursor.fetchone()
        finally:
            connection.close()
    except Exception as exc:  # Startup must survive any database problem.
        logger.warning(
            'Module state could not be read from the database (%s); '
            'starting with only %s applied.', type(exc).__name__, ENV_DISABLED_MODULES,
        )
        return [], False

    values = row[0] if row else []
    if not isinstance(values, list):
        logger.warning('Ignoring stored module state: expected a list.')
        return [], True
    return values, True


def installed_apps_for(enabled: Iterable[str]) -> list[str]:
    """Return the INSTALLED_APPS entries for the enabled modules."""
    enabled_set = set(enabled)
    return [app for spec in MODULES if spec.key in enabled_set for app in spec.apps]


def is_module_enabled(key: str) -> bool:
    """Return True when ``key`` is loaded in this process.

    Use this before optional cross-module calls, for example::

        if is_module_enabled('risk'):
            from risk.services import process_alert_for_risk
    """
    from django.conf import settings

    return key in getattr(settings, 'ARGUS_ENABLED_MODULES', MODULE_KEYS)
