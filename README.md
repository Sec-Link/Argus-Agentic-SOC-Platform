# Argus-Agentic-SOC-Platform

This repository contains the Argus-Agentic-SOC-Platform — an AI-native Agentic Security Operations Center (SOC) platform focused on unifying alerts ingestion, incident investigation, ticket collaboration, asset correlation, workflow orchestration, and AI-assisted analysis.

The project uses a separated frontend/backend architecture: the frontend is built with Next.js + React to provide the operator console, the backend uses Django + Django REST Framework to provide APIs and orchestration, and PostgreSQL is the primary data store. Elasticsearch is optionally supported as an external alert source.

---
<img width="1445" height="703" alt="image" src="https://github.com/user-attachments/assets/e4d1b273-3090-4632-85b9-2b455860e73a" />


---
## 1. Product Positioning

The platform consolidates core SOC objects into one product with open-source solutions:

- Alerts: alert ingestion, caching, search, and display
- Tickets: incident/ticket management and collaboration
- CMDB: asset inventory and contextual linking
- Dashboards: operational dashboards and visualizations
- Integrations: connectors and external configuration
- Correlation: correlation rules and analysis
- Workflows / Orchestrator: automation and scheduling
- AI Assistant: security-focused intelligent analysis and MCP tool integration

---

## 2. Core Capabilities

### Security Operations
- Unified alert ingestion and paginated lists
- Ticket lifecycle and activity history
- Asset-context enrichment
- Dashboard-based operational views
- Correlation rules and investigative helpers

### Automation
- Workflow orchestration and API-driven calls
- Scheduled task execution and audit logs
- Automation chains for tickets/alerts

### AI Features
- Built-in AI Assistant conversational interface
- MCP-style tool registry and JSON-RPC connector
- Ticket-context queries, similar-case retrieval, CMDB queries, and observable extraction

### Platform Capabilities
- Token-based authentication
- OTP login/verification endpoints
- PostgreSQL persistence
- Docker Compose and Kubernetes deployment manifests

---

## 3. System Architecture Diagram

```mermaid
flowchart LR
    U[Security Analyst / SOC Operator] --> FE[Frontend\nNext.js 15 + React 18 + Ant Design]
    FE -->|/api/v1| BFF[API Proxy Layer\nNext Route Handler]
    BFF --> BE[Django API Layer\nDjango 6 + DRF]

    subgraph Core_Backend_Modules[Core Backend Modules]
        A[Alerts]
        T[Tickets]
        C[CMDB]
        D[Dashboards]
        I[Integrations]
        R[Correlation]
        W[Workflows]
        O[Orchestrator]
        AI[AI Assistant + MCP]
        AUTH[Accounts / Auth / RBAC]
    end

    BE --> A
    BE --> T
    BE --> C
    BE --> D
    BE --> I
    BE --> R
    BE --> W
    BE --> O
    BE --> AI
    BE --> AUTH

    A --> PG[(PostgreSQL)]
    T --> PG
    C --> PG
    D --> PG
    I --> PG
    R --> PG
    W --> PG
    O --> PG
    AI --> PG
    AUTH --> PG

    A -. optional ingestion .-> ES[(Elasticsearch)]
    I -. connect .-> EXT[External Systems / Data Sources]
    AI -. MCP / tool calling .-> MCP[MCP Servers / Tool Endpoints]
    O -. scheduled execution .-> TASKS[Scheduled Tasks]
```

### Architecture Notes

1. Frontend: Built with Next.js App Router; handles pages, UI composition, and API proxying.
2. API Layer: Django + DRF provide unified business APIs (auth, alerts, tickets, CMDB, workflows, AI).
3. Business Layer: Domain features are organized into Django apps for independent evolution and RBAC.
4. Data Layer: PostgreSQL is the primary datastore; Elasticsearch is an optional alert source.
5. Intelligence Layer: AI Assistant offers conversation and tool-call capabilities, exposing MCP-style interfaces.
6. Automation Layer: Orchestrator and Workflows provide scheduled execution, orchestration, and audit trails.
More information:
https://github.com/Sec-Link/Argus-Agentic-SOC-Platform/blob/main/docs/architecture.md

---

## 4. Tech Stack

### Frontend
- Next.js 15
- React 18
- Ant Design 5

### Backend
- Django 6
- Django REST Framework
- DRF Token Authentication

### Data / Infrastructure
PostgreSQL 16 (optional)
Elasticsearch (optional)
---

## 5. Main Modules

| Module | Responsibility |
| --- | --- |
| `accounts` | Authentication, login, OTP, and permissions |
| `alerts` | Alert ingestion, caching, display, and search |
| `ai_assistant` | AI conversation, MCP tooling, and context routing |
| `cmdb` | Asset management and queries |
| `dashboards` | Visualization dashboards and views |
| `integrations` | External connectors and configuration |
| `correlation` | Correlation rules and investigative helpers |
| `workflows` | Workflow definitions and execution API |
| `workflow_interfaces` | Workflow interface adapter layer |
| `orchestrator` | Scheduled tasks, execution, and records |
| `tickets` | Incident/ticket management and related workflows |

---

## 6. Repository Layout

```text
Argus-Agentic-SOC-Platform/
├── backend/                  # Django backend
│   ├── accounts/
│   ├── alerts/
│   ├── ai_assistant/
│   ├── cmdb/
│   ├── correlation/
│   ├── dashboards/
│   ├── integrations/
│   ├── orchestrator/
│   ├── tickets/
│   ├── workflow_interfaces/
│   ├── workflows/
│   └── siem_project/         # Django project settings / urls
├── frontend/                 # Next.js frontend
│   └── src/
│       ├── app/
│       ├── components/
│       ├── modules/
│       ├── services/
│       └── lib/
├── k8s/                      # Kubernetes manifests
├── docker-compose.dev.yml    # Dev compose
├── docker-compose.prod.yml   # Prod compose
├── env.example               # Env template
└── makefile                  # Helper targets
```

---

## 7. User Manual
https://sec-link.github.io/Argus-Agentic-SOC-Platform/zh/overview/

## 8. API and access

The backend uses `/api/v1/` as the API prefix. Main areas include:

- `/api/v1/auth/`: login, logout, register, OTP
- `/api/v1/alerts/`: alerts capabilities
- `/api/v1/tickets/`: ticketing capabilities
- `/api/v1/cmdb/`: asset management
- `/api/v1/workflows/`: workflow capabilities
- `/api/v1/integrations/`: integration config and tests
- `/api/v1/ai-assistant/`: AI assistant and tooling
- `/api/v1/mcp/`: MCP JSON-RPC and tool registry

The frontend proxies `/api/v1/*` requests via a Next.js route handler to the backend service, centralizing browser-side API access.
More information: 
https://github.com/Sec-Link/Argus-Agentic-SOC-Platform/blob/main/docs/api-overview.md

---

## 9. Deployment

### Docker Compose
- `docker-compose.dev.yml`: local development
- `docker-compose.prod.yml`: production container setup

### Kubernetes
The `k8s/` directory contains basic deployment manifests:

- `k8s/backend-deploy.yaml`
- `k8s/frontend-deploy.yaml`
- `k8s/postgres-deploy.yaml`

---

## 10. Security & Hardening

In production we recommend:

- Use a secure random `SECRET_KEY`
- Precisely set `ALLOWED_HOSTS` and `CSRF_TRUSTED_ORIGINS`
- Add backups and monitoring for DB, object storage, and logs
- Configure access boundaries, auditing, and least-privilege for AI/MCP features


---
