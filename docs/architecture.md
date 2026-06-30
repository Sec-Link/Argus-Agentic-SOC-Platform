---
layout: default
title: "Architecture"
---

# Architecture Overview

This document describes the overall architecture, major components, and data flow of the Argus Agentic SOC Platform.

---

## System Diagram

<!--
  IMAGE PLACEHOLDER — how to reference images on GitHub Pages:

  1. Place your diagram file in docs/assets/images/ (e.g., architecture-diagram.png)
  2. Reference it with relative_url filter so it works under the /ECHO-Agentic-SOC-Platform/ baseurl:

  ![Architecture Diagram]({{ '/assets/images/architecture-diagram.png' | relative_url }})

  WITHOUT relative_url the image will 404 on GitHub Pages because the site lives at a subpath.
-->

```
┌─────────────────────────────────────────────────────────────────┐
│                    Security Analyst / SOC Operator               │
└──────────────────────────────┬──────────────────────────────────┘
                               │ Browser
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│  Frontend — Next.js 15 + React 18 + Ant Design 5                 │
│  Operator console: dashboards, alerts, tickets, CMDB, workflows  │
└──────────────────────────────┬───────────────────────────────────┘
                               │ /api/v1/* (proxy route handler)
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│  Backend — Django 6 + DRF                                        │
│  REST APIs · Business logic · RBAC · Orchestration               │
│                                                                  │
│  alerts │ tickets │ cmdb │ dashboards │ integrations             │
│  correlation │ workflows │ orchestrator │ ai_assistant │ accounts │
└──────┬─────────────────────────────────────┬─────────────────────┘
       │                                     │ optional
       ▼                                     ▼
┌──────────────┐                    ┌──────────────────────┐
│  PostgreSQL  │                    │  Elasticsearch        │
│  (primary)   │                    │  (alert ingestion)    │
└──────────────┘                    └──────────────────────┘
```

---

## Frontend

**Stack:** Next.js 15 App Router · React 18 · Ant Design 5

- `frontend/src/app/` — page routes and root layout
- `frontend/src/app/api/v1/[...path]/route.ts` — API proxy: forwards all `/api/v1/*` requests to the Django backend, centralising auth headers
- `frontend/src/modules/` — domain UI modules (`alerts`, `tickets`, `dashboards`, `detections`, etc.)
- `frontend/src/components/` — shared UI components (layout, header, sidebar)
- `frontend/src/services/` — Axios-based API client wrappers per domain

---

## Backend

**Stack:** Django 6 · Django REST Framework · DRF Token Auth

The backend is split into domain-focused Django apps, each responsible for its own models, serializers, views, and URL routing.

| App | Responsibility |
|-----|---------------|
| `accounts` | Authentication, OTP, user management, RBAC helpers |
| `alerts` | Alert ingestion, caching, dashboard aggregation, ES/webhook sync |
| `tickets` | SLA-aware ticket CRUD, lifecycle transitions, work logs, attachments |
| `dashboards` | Dashboard chart stats: funnel, Sankey, SLA metrics |
| `detections` | Sigma-based detection rule management and Elasticsearch rule push |
| `integrations` | External connector metadata and connectivity testing |
| `cmdb` | Asset inventory (CI management) and audit logs |
| `correlation` | Alert→ticket auto-creation policy with configurable match keys |
| `workflows` | SOAR-style workflow definitions, steps, and execution engine |
| `workflow_interfaces` | External webhook/ingest interface endpoints |
| `orchestrator` | Scheduled task definitions, execution records, and dispatch |
| `ai_assistant` | AI conversation, MCP tool registry, skill config, external MCP server management |
| `siem_project` | Django project settings, top-level URL routing, middleware |

---

## Data Layer

- **PostgreSQL 16** is the primary datastore for all platform objects (alerts, tickets, rules, assets, etc.)
- **Elasticsearch** is an optional external alert source. When configured, the backend syncs alerts from an ES index into PostgreSQL for the UI to consume.
- Django ORM + migrations are the single source of truth for schema. Run `python manage.py migrate` on every deployment.

---

## Intelligence Layer (AI Assistant + MCP)

The `ai_assistant` app exposes:

- **Conversational chat** endpoint (`/api/v1/ai-assistant/chat`) for ticket analysis
- **MCP JSON-RPC gateway** (`/api/v1/mcp`) compatible with the Model Context Protocol
- **Built-in MCP tools**: ticket context retrieval, similar-case search, CMDB asset lookup, observable extraction
- **External MCP server management**: register, start/stop, and monitor third-party MCP servers

---

## Automation Layer

Two complementary automation engines:

| Engine | Role |
|--------|------|
| **Orchestrator** | Time-based task scheduling with execution records and audit trail |
| **Workflows** | Event-driven process logic — API call sequences, condition branches, SOAR patterns |

---

## Deployment Topology

```
Docker Compose (dev):     frontend:3000 → backend:8000 → db:5432
Docker Compose (prod):    nginx:80 → frontend → backend:8000 → db:5432
Kubernetes:               Ingress → frontend Deployment → backend Deployment → PostgreSQL StatefulSet
```

See `docker-compose.dev.yml`, `docker-compose.prod.yml`, and `k8s/` for manifests.

---

## Security Design

- All API routes require `Authorization: Token <token>` (DRF Token Auth)
- RBAC enforced per-view via `accounts.permissions.RbacModelPermissions`
- Read-only user flag (`is_readonly`) blocks all write operations via `DenyReadonlyUser` middleware
- `SECRET_KEY`, `POSTGRES_PASSWORD`, and similar secrets must be provided via environment variables — never committed to VCS
- MCP tool access is gated by authentication; audit logs are written for all tool invocations

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Backend 500 on startup | DB schema mismatch | `python manage.py showmigrations` + `migrate` |
| `column already exists` error | Out-of-order migrations | Check migration history, squash if needed |
| Frontend API calls return 401 | Missing or expired token | Re-login; check token storage in browser |
| No alerts in UI | ES not configured or sync not run | Check Integrations page; trigger manual sync |
| AI chat fails | MCP tool errors | Check `ai_assistant` logs; verify external MCP server status |
