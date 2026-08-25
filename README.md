<div align="center">

### Open Source AI-Native SOC Platform

**Deploy as a Complete SOC Platform OR Integrate with Existing Security Ecosystems**

[🚀 Quick Start](#-quick-start) · [📖 Documentation](https://sec-link.github.io/Argus-Agentic-SOC-Platform/) · [⭐ GitHub](https://github.com/Sec-Link/Argus-Agentic-SOC-Platform)

</div>

##  Overview

Argus is an open-source **AI-native Agentic SOC platform** designed for modern security operations.

It provides a complete security operations foundation with:

- ✅AI-powered Investigation
- ✅Security Workflow Automation
- ✅Alert and Incident Management
- ✅Threat Intelligence Enrichment
- ✅Asset Context Management

At the same time, Argus is built with a **loosely coupled and API-first architecture**, allowing organizations to:

- ✅ Extend Argus with custom security capabilities
- ✅ Integrate Argus into existing SOC ecosystems

---
## 1. Product Components

The platform consolidates core SOC objects into one product with open-source solutions:




- **Alerts**: alert ingestion, caching, search, and display
- **Tickets**: incident/ticket management and collaboration
- **CMDB**: asset inventory and contextual linking
- **Dashboards**: operational dashboards and visualizations
- **Integrations**: connectors and external configuration
- **Correlation**: correlation rules and analysis
- **Workflows / Orchestrator**: automation and scheduling
- **AI Assistant**: security-focused intelligent analysis and MCP tool integration

---

## 2. Core Capabilities

### Security Operations
- Unified alert ingestion and paginated lists
- Ticket lifecycle and activity history
- Dashboard-based operational views

### Detection
- Out-of-box use cases detection and correlation rules
- Detection-as-code and rule versioning
- Write-once, run-anywhere detection with Sigma rules

### Automation
- Workflow orchestration and API-driven calls
- Scheduled task execution and audit logs
- Automation chains for tickets/alerts

### AI Features
- Built-in AI Assistant conversational interface
- MCP-style tool registry and JSON-RPC connector
- Ticket-context queries, similar-case retrieval, CMDB queries, and observable extraction



---

## 3. System Architecture Diagram

### Architecture Notes

1. Frontend: Built with Next.js App Router; handles pages, UI composition, and API proxying.
2. API Layer: Django + DRF provide unified business APIs (auth, alerts, tickets, CMDB, workflows, AI).
3. Business Layer: Domain features are organized into Django apps for independent evolution and RBAC.
4. Data Layer: PostgreSQL is the primary datastore; Elasticsearch is an optional alert source.
5. Intelligence Layer: AI Assistant offers conversation and tool-call capabilities, exposing MCP-style interfaces.
6. Automation Layer: Orchestrator and Workflows provide scheduled execution, orchestration, and audit trails.

**More information:**
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

## 5. Repository Layout

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

## 6. User Manual
https://sec-link.github.io/Argus-Agentic-SOC-Platform/zh/overview/

## 7. API and access

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
**More information:**
https://github.com/Sec-Link/Argus-Agentic-SOC-Platform/blob/main/docs/api-overview.md

---

## 8. Deployment

### Docker Compose
- `docker-compose.dev.yml`: local development
- `docker-compose.prod.yml`: production container setup

### Kubernetes
The `k8s/` directory contains basic deployment manifests:

- `k8s/backend-deploy.yaml`
- `k8s/frontend-deploy.yaml`
- `k8s/postgres-deploy.yaml`

---

## 9. Security & Hardening

In production we recommend:

- Use a secure random `SECRET_KEY`
- Precisely set `ALLOWED_HOSTS` and `CSRF_TRUSTED_ORIGINS`
- Add backups and monitoring for DB, object storage, and logs
- Configure access boundaries, auditing, and least-privilege for AI/MCP features

## 10. Contribution
We welcome contributions! Please refer to our [CONTRIBUTING.md](https://github.com/Sec-Link/Argus-Agentic-SOC-Platform/blob/main/CONTRIBUTING.md) for more information.


---
