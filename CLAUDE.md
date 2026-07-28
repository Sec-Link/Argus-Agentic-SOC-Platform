# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ECHO is an AI-native Agentic Security Operations Center (SOC) platform — unified alert ingestion, incident investigation, ticket management, asset correlation, workflow orchestration, and AI-assisted analysis.

Stack: Django 6 / Python 3.13 backend, Next.js 16 / React 18 frontend, PostgreSQL. Optional integrations: Elasticsearch, Redis, Prefect, Kibana Detection Engine.

## Development Commands

All Docker operations are via `make`:

```bash
make build-dev          # Build and start dev environment
make redeploy-dev       # Rebuild and restart dev containers
make logs-dev           # Follow container logs
make clean-dev          # Teardown dev containers and volumes
make clean-rebuild-dev  # Full teardown + rebuild
```

Copy `env.example` to `.env` before first run.

### Running backend outside Docker

```bash
cd backend
python manage.py runserver 0.0.0.0:8000
python manage.py makemigrations
python manage.py migrate
```

### Running frontend outside Docker

```bash
cd frontend
npm run dev    # port 3000
npm run build
```

### Security scanning (CI only — no local lint config)

CI runs Bandit (`bandit -r ./backend -ll`), Semgrep, and Gitleaks on PRs via `.github/workflows/PR_Check.yml`.

## Architecture

### Request Flow

```
Browser → Frontend (Next.js :3000)
         └── /api/v1/[...path] proxy route → Backend (Django :8000)
                                            → PostgreSQL :5432
                                            → Elasticsearch (optional)
                                            → Prefect API :4200 (optional)
```

The frontend has a catch-all route handler at `frontend/src/app/api/v1/[...path]/` that forwards all API calls to the Django backend. `next.config.js` additionally rewrites `/admin/*`, `/static/*`, and `/media/*` to `BACKEND_ORIGIN`.

### Backend Django Apps

| App | Responsibility |
|---|---|
| `accounts` | Auth (token + OTP), RBAC, rate limiting, audit middleware |
| `alerts` | Alert ingestion, caching, search, Elasticsearch integration |
| `tickets` | Ticket CRUD, SLA tracking, status transitions, attachments, activity logs |
| `cmdb` | Asset/CI management |
| `detections` | Kibana Detection Engine proxy, Sigma rule support |
| `correlation` | Correlation rules and investigative helpers |
| `workflows` | SOAR-style workflow definitions and execution |
| `workflow_interfaces` | Adapter layer between workflow engine and platform |
| `orchestrator` | Scheduled tasks, execution records, cron utilities |
| `ai_assistant` | AI chat agent, MCP gateway (JSON-RPC), skill library, knowledge base |
| `integrations` | External connector config and connection testing |
| `dashboards` | Dashboard metadata, layout, widget definitions |
| `siem_project` | Django project settings and root URL routing |

All API routes are under `/api/v1/<app>/`. Authentication uses DRF `TokenAuthentication` — `Authorization: Token <token>` header. Default permission is `IsAuthenticated`.

### Frontend Structure

```
frontend/src/
  app/                  Next.js App Router pages
  modules/              Domain UI components (one directory per backend app)
  components/           Shared UI components
  services/             Per-domain Axios API client wrappers
    client.ts           Thin Axios wrapper
  api.ts                Global Axios client
  types.ts              Global TypeScript types
```

## Key Configuration

All configuration is via environment variables (see `env.example`). Critical ones:

| Variable | Purpose |
|---|---|
| `SECRET_KEY` | Django secret key |
| `POSTGRES_*` | Database connection |
| `BACKEND_ORIGIN` | Frontend → backend URL (e.g. `http://backend:8000`) |
| `REDIS_ENABLED` | Enable Redis caching (default `false`) |
| `OTP_AUTH_ENABLED` | Enable OTP email auth (default `true`) |
| `ES_HOST` / `ES_USERNAME` / `ES_PASSWORD` | Elasticsearch (optional) |
| `KIBANA_BASE_URL` / `KIBANA_API_KEY` | Kibana Detection Engine (optional) |
| `PREFECT_API_URL` / `PREFECT_DEPLOYMENT_ID` | Prefect workflow engine (optional) |

## Django Migrations

Before suggesting `makemigrations`/`migrate`, check that the target app has a `migrations/` directory with an `__init__.py`. If the directory is missing, create the migration file directly rather than repeatedly running `makemigrations`. The `docker-entrypoint.sh` runs migrations and `collectstatic` automatically on container start.

## Notes

- No test suite exists in this repo.
- Task execution uses `django.tasks.backends.immediate.ImmediateBackend` (in-process, synchronous — no Celery/worker required by default).
- Static files are served via WhiteNoise in production.
