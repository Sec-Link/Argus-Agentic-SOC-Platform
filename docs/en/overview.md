---
layout: default
title: "Overview"
lang: en
lang_ref: overview
---

# Argus — Agentic SOC Platform

Argus is an AI-native Security Operations Center (SOC) platform that unifies alert ingestion, incident investigation, detection engineering, and automated response under a single operational interface. Built for modern security teams, it replaces fragmented toolchains with a coherent, evidence-driven workflow powered by AI agents and a flexible SOAR engine.

## Key Capabilities

| Capability | Description |
|---|---|
| **Unified Alert Ingestion** | Connects to Elasticsearch (ELK), Splunk, and other sources via a configurable data pipeline |
| **AI-Assisted Investigation** | Per-ticket AI assistant provides alert explanations, risk assessment, IOC extraction, and recommended actions |
| **AI Skills** | Markdown skills (SKILL.md) that the AI assistant selects and applies when they match an alert or chat request; ten investigation skills ship in the library |
| **Detection Engineering** | Sigma rule library with field mapping management, multi-backend publishing (Splunk, Elastic), and publish history audit |
| **Detection Coverage** | Log source coverage and MITRE ATT&CK technique coverage, configured and viewed from the Dashboard |
| **Automated Response (SOAR)** | Visual workflow editor for no-code playbooks with scheduling, webhook triggers, and Prefect orchestration |
| **Interfaces** | Managed endpoints for workflows, with call logs and manual test calls |
| **SLA Tracking** | Automatic MTTA / MTTI / MTTC / MTTR calculation with color-coded compliance indicators |
| **Collaborative War Room** | Per-ticket workspace for analyst notes, file evidence, handle logs, and AI-generated task lists |
| **Reports** | Report Designer with live SOC metrics, charts, a placeholder-based Markdown template, and Markdown / PDF export |
| **MCP Tool Framework** | Extensible Model Context Protocol layer enabling AI agents to invoke external security tools at runtime |
| **Access Control and Audit** | Users, groups, per-permission RBAC, guest (read-only) accounts, registration approvals, and audit logs |

## Platform Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Argus Platform                        │
├──────────────┬──────────────────┬───────────────────────┤
│   Frontend   │     Backend      │     Data Pipeline     │
│  (Next.js)   │  (Django REST)   │  ES → Orchestrator →  │
│   Port 3000  │   Port 8000      │  Correlation → Alerts  │
└──────────────┴────────┬─────────┴───────────────────────┘
                        │
            ┌───────────┼───────────┐
            │           │           │
        PostgreSQL    AI Layer    Prefect
        (Data Store) (OpenAI     (Workflow
                      compat.)    Engine)
```

The platform is deployed with Docker Compose. The compose stack contains the frontend, the backend, PostgreSQL, and a short-lived `backend-app-init` container that copies the backend application into the shared `argus_backend_app` volume and then exits. The Prefect server and Prefect worker are **not** part of the compose stack; they are external services that the backend reaches through `PREFECT_API_URL`. See [Docker Deployment]({{ '/en/docker-deployment/' | relative_url }}) for details.

## Module Index

| # | Module | Purpose |
|---|---|---|
| 1 | **Overview** | Platform introduction and navigation guide (this page) |
| 2 | **Installation** | Docker-based quick-start deployment |
| 3 | **Dashboard** | Real-time monitoring overview and alert statistics |
| 4 | **Detection Coverage** | Log source and MITRE ATT&CK coverage |
| 5 | **Ticket Handling** | Incident lifecycle management, SLA tracking, War Room, Workflows |
| 6 | **Alerts** | Alert ingestion, list view, triage, and correlation |
| 7 | **Assets** | Asset inventory and asset correlation |
| 8 | **Use Case Management** | Sigma rule library, field mappings, publish history |
| 9 | **Data Onboarding** | ELK integration setup, Orchestrator scheduling, Correlation policy |
| 10 | **Automation** | Interfaces, Workflows, and workflow Executions |
| 11 | **Reports** | Report Designer, placeholders, Markdown and PDF export |
| 12 | **AI Agent** | AI assistant configuration, MCP tool management, Skills |
| 13 | **Docker Deployment** | Docker Compose orchestration, production settings, Kubernetes notes |

## Quick Reference

| Item | Value |
|---|---|
| Platform URL | `https://siem.seclink.info/` |
| Login Method | **Internal Login** (username or email, and password) or **Guest Login** (email OTP, read-only) |
| Default Landing Page | `Monitoring → Overview` (Dashboard) |
| Target Users | SOC Analysts, Detection Engineers, SIEM Administrators |

> After login the system lands on **Dashboard Overview**. If no data source has been configured, all statistics display as zero. Start at [Data Onboarding]({{ '/en/data-onboarding/' | relative_url }}) to connect your first source.
