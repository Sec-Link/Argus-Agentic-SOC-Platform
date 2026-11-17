# Architecture Overview

This document describes the overall architecture, major components.

## Purpose
This document provides a concise, English-language reference for developers and operators that need to understand the code layout, runtime topology, and primary API entry points for the SIEM / SOC platform.

## High-level architecture

The project uses a classic frontend-backend separation:

- Frontend: Next.js (App Router) + React + Ant Design — provides the UI, page routing, and a proxy route handler for API requests.
- Backend: Django 6 + Django REST Framework — provides REST APIs, business logic, and orchestration capabilities.
- Database: PostgreSQL is the primary persistent store.
- Optional: Elasticsearch for alert ingestion/search (can be configured per deployment).

## Backend apps (concise)
- `accounts`: Authentication, OTP, RBAC utilities.
- `alerts`: Alert ingestion, caching, dashboard aggregation endpoints.
- `tickets`: SLA-aware ticket CRUD, status transitions, attachments, logs, SLA metrics.
- `dashboards`: Dashboard metadata, layout and widget definitions, editor APIs.
- `integrations`: External connector metadata and connection testing (DB/ES/etc.).
- `cmdb`: Asset/CI management and sample import helpers.
- `correlation`: Policy & event stubs for correlation features.
- `workflows`: SOAR-style workflow definitions and execution engine.
- `orchestrator`: Scheduled tasks, runs, and execution utilities.
- `ai_assistant`: AI assistant, MCP gateway and JSON-RPC tooling.
- `siem_project`: Django project settings, URL routing, middleware.

## Optional modules

Backend apps are registered as modules in `backend/siem_project/modules.py`. Optional modules that a deployment does not need can be turned off; they are then left out of `INSTALLED_APPS` and their URLs are not mounted.

- **Core (always loaded):** accounts, integrations, alerts, detections, tickets, ai_assistant, dashboards, cmdb. Other modules import these at module level; dashboards is the landing page, and it imports cmdb.
- **Optional:** correlation, orchestrator, workflows, workflow_interfaces, risk, reports.
- **Dependencies:** orchestrator requires correlation; workflow_interfaces requires workflows; reports requires correlation and risk. A module is disabled automatically when one of its requirements is disabled.
- **How to change it:** Administration → Module Management (superusers save, staff can view), or the `ARGUS_DISABLED_MODULES` environment variable, which always wins.
- **Restart required:** `INSTALLED_APPS` is fixed when a process starts. A saved change applies only after every backend process restarts (and any Prefect worker that loads the Django settings).
- **Data is kept:** disabling a module does not drop its tables or run its migrations. Re-enable it and restart to get it back; pending migrations for it run at that startup.
- **Disabled APIs:** requests under a disabled module's prefix return `404` with `"code": "module_disabled"` (authentication is still required).
- **Startup safety:** invalid saved values are ignored. If the database cannot be read at startup, the backend starts with only `ARGUS_DISABLED_MODULES` applied and logs a warning, so a module disabled in the UI may be loaded until the next successful start. Use the environment variable for modules that must stay off.
- **Recovery / rollback:** set `ARGUS_MODULE_DB_BOOTSTRAP=false` and restart to ignore the saved selection and load every module not listed in `ARGUS_DISABLED_MODULES`.
- **Adding a cross-module import:** declare it in `requires` or guard it with `is_module_enabled()`; `siem_project/tests/test_modules.py` fails otherwise.

## Frontend code map (important files/areas)
- App shell & routing: `frontend/src/app` (Next.js App Router pages and layout)
- API proxy: `frontend/src/app/api/v1/[...path]/route.ts` (forwards requests to backend)
- API client / utils: `frontend/src/lib` or `frontend/src/services` (Axios wrappers)
- Modules: `frontend/src/modules` (domain UIs, e.g. `tickets`, `dashboards`, `integrations`)
- Components: `frontend/src/components` (shared UI pieces)

## Database & Migrations
- Django models are the single source of truth for schema.
- Migrations (Django `migrations/` files) record schema changes and should be tracked in Git for existing deployments.
- For a brand-new deployment you can create the schema from models by running `python manage.py migrate` (migrations still recommended to be present in repo to provide a deterministic history).

## Production notes
- Use `docker-compose.prod.yml` or Kubernetes manifests in `k8s/` for containerized deployment.
- Ensure `SECRET_KEY`, `ALLOWED_HOSTS`, and database credentials are set securely.
- When deploying to an existing database, always run migrations and review potential conflicts (e.g., duplicated columns/migration order issues).

## Security and best practices
- Keep `SECRET_KEY` out of VCS and set it via environment variables in production.
- Use HTTPS and set `CSRF_TRUSTED_ORIGINS` and `ALLOWED_HOSTS` appropriately.
- Sanitize and validate all integration inputs; prefer parameterized queries and ORM usage.
- Limit AI/MCP tool access with authentication and auditing.

## Troubleshooting checklist (common issues)
- Backend 500s often come from DB schema mismatch — run `python manage.py showmigrations` and `python manage.py migrate`.
- If you see `ProgrammingError: column "X" of relation "Y" already exists`, check migration history and whether migrations were applied out-of-order.
- Next.js module not found errors often indicate moved/deleted files under `frontend/src/`—update imports or remove references.
- React/Antd runtime warnings (e.g., `message` usage) may be fixed by using hooks/components instead of static imports.
