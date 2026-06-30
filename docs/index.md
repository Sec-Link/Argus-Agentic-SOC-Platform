---
layout: home
title: "Argus SOC Platform"
---

# Argus — Agentic Security Operations Center

**Argus** is an AI-native SOC platform that unifies alert ingestion, incident investigation,
MITRE ATT&CK correlation, workflow automation, and AI-assisted analysis into a single operator
console.

> Built on **Next.js 15 + React 18** (frontend) and **Django 6 + DRF** (backend),
> backed by **PostgreSQL** with optional **Elasticsearch** alert ingestion.

---

## Core Capabilities

| Module | What it does |
|--------|-------------|
| **Alerts** | Ingest, deduplicate, and display security events from Elasticsearch or webhooks |
| **Tickets** | SLA-tracked incident lifecycle with work logs, attachments, and status transitions |
| **CMDB** | Asset inventory with contextual enrichment linked to alerts and tickets |
| **Dashboards** | Operational charts: alert funnel, 5-stage MITRE Sankey, SLA trends |
| **Detections** | Sigma-compatible detection rules pushed to Elasticsearch |
| **Correlation** | Policy-driven alert→ticket auto-creation with configurable match keys |
| **Workflows** | SOAR-style workflow definitions with API call chaining |
| **Orchestrator** | Scheduled task execution with run history and audit logs |
| **AI Assistant** | Conversational analysis with MCP tool registry (ticket context, CMDB lookup, observable extraction) |
| **Integrations** | Elasticsearch and Splunk connectors with live connectivity tests |

---

## Documentation

| Section | Description |
|---------|-------------|
| [Quick Start]({{ '/quickstart' | relative_url }}) | Up and running in under 5 minutes with Docker Compose |
| [Installation]({{ '/installation' | relative_url }}) | Full deployment guide: dev, production, and Kubernetes |
| [Architecture]({{ '/architecture' | relative_url }}) | System topology, backend apps, and data flow |
| [Configuration]({{ '/configuration' | relative_url }}) | All environment variables and runtime settings |
| [API Reference]({{ '/api-overview' | relative_url }}) | REST endpoints across all modules |
| [FAQ]({{ '/faq' | relative_url }}) | Common issues and troubleshooting |

---

## Tech Stack

```
Frontend   Next.js 15 · React 18 · Ant Design 5
Backend    Django 6 · Django REST Framework · DRF Token Auth
Database   PostgreSQL 16
Search     Elasticsearch (optional alert source)
Deploy     Docker Compose · Kubernetes
```

---

## Source

[github.com/Sec-Link/ECHO-Agentic-SOC-Platform](https://github.com/Sec-Link/ECHO-Agentic-SOC-Platform)
