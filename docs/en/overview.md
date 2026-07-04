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
| **Unified Alert Ingestion** | Connects to Elasticsearch (ELK), EDR, SIEM, and other sources via a configurable data pipeline |
| **AI-Assisted Investigation** | Per-ticket AI assistant provides alert explanations, risk assessment, IOC extraction, and recommended actions |
| **Detection Engineering** | Sigma rule library with field mapping management, multi-backend publishing (Splunk, Elastic), and publish history audit |
| **Automated Response (SOAR)** | Visual workflow editor for no-code playbooks with scheduling, webhook triggers, and Prefect orchestration |
| **SLA Tracking** | Automatic MTTA / MTTI / MTTC / MTTR calculation with color-coded compliance indicators |
| **Collaborative War Room** | Per-ticket workspace for analyst notes, file evidence, handle logs, and AI-generated task lists |
| **MCP Tool Framework** | Extensible Model Context Protocol layer enabling AI agents to invoke external security tools at runtime |

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

The platform is fully containerized and deployable via Docker Compose. All three tiers — frontend, backend, and database — run as isolated services with well-defined network boundaries.

## Module Index

| # | Module | Purpose |
|---|---|---|
| 1 | **Overview** | Platform introduction and navigation guide (this page) |
| 2 | **Installation** | Docker-based quick-start deployment |
| 3 | **Dashboard** | Real-time monitoring overview and alert statistics |
| 4 | **Ticket Handling** | Incident lifecycle management, SLA tracking, War Room, Workflows |
| 5 | **Alerts** | Alert ingestion, list view, triage, and correlation |
| 6 | **Use Case Management** | Sigma rule library, field mappings, publish history |
| 7 | **Data Onboarding** | ELK integration setup, Orchestrator scheduling, Correlation policy |
| 8 | **Docker Deployment** | Production-grade Docker Compose orchestration |
| 9 | **AI Agent** | AI assistant configuration, MCP tool management, Skills |

## Quick Reference

| Item | Value |
|---|---|
| Platform URL | `https://siem.seclink.info/` |
| Login Method | Internal Login (username / password) |
| Default Landing Page | Monitor → Overview (Dashboard) |
| Target Users | SOC Analysts, Detection Engineers, SIEM Administrators |

> After login the system lands on **Dashboard Overview**. If no data source has been configured, all statistics display as zero. Start at [Data Onboarding]({{ '/en/data-onboarding/' | relative_url }}) to connect your first source.
