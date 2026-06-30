---
layout: default
title: "Quick Start"
nav_order: 1
---

# Quick Start

Get Argus running locally in under 5 minutes using Docker Compose.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) ≥ 24
- [Docker Compose](https://docs.docker.com/compose/install/) ≥ 2.20
- [GNU Make](https://www.gnu.org/software/make/)

---

## Step 1 — Clone the repository

```bash
git clone https://github.com/Sec-Link/ECHO-Agentic-SOC-Platform.git
cd ECHO-Agentic-SOC-Platform
```

---

## Step 2 — Configure environment

Copy the template and set minimum required values:

```bash
cp env.example .env
```

Edit `.env` — the only values you must change for a local run:

```env
SECRET_KEY=replace-with-a-long-random-string
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1,backend

POSTGRES_DB=siem_db
POSTGRES_USER=siem_user
POSTGRES_PASSWORD=siem_password
POSTGRES_HOST=db
POSTGRES_PORT=5432

BACKEND_ORIGIN=http://backend:8000
```

> **Elasticsearch is optional.** Leave ES variables unset to use the mock/webhook alert path.

---

## Step 3 — Start the stack

```bash
make build-dev
```

This builds images, starts containers, runs Django migrations, and starts the Next.js dev server.

| Service | URL |
|---------|-----|
| Operator Console (frontend) | <http://localhost:3000> |
| Django API | <http://localhost:8000/api/v1/> |
| Django Admin | <http://localhost:8000/admin/> |
| PostgreSQL | `localhost:5432` |

---

## Step 4 — Create a superuser

```bash
docker compose -f docker-compose.dev.yml exec backend python manage.py createsuperuser
```

Follow the prompts to set username and password, then log in at <http://localhost:3000>.

---

## Step 5 — Explore

1. **Dashboard** — `http://localhost:3000/dashboard` — overview KPI cards and funnel chart
2. **Alerts** — `http://localhost:3000/alerts` — alert list (empty until a data source is configured)
3. **Integrations** — `http://localhost:3000/integrations` — connect Elasticsearch or Splunk
4. **Tickets** — `http://localhost:3000/tickets` — incident management
5. **Detections** — `http://localhost:3000/detection` — Sigma-based detection rules

---

## Common make targets

```bash
make logs-dev       # Tail all container logs
make restart-dev    # Restart all containers
make redeploy-dev   # Pull latest changes, rebuild, restart
make build-prod     # Build production stack
```

---

## Next steps

- [Full installation guide]({{ '/installation' | relative_url }}) — production, TLS, Kubernetes
- [Configuration reference]({{ '/configuration' | relative_url }}) — all environment variables
- [Connect Elasticsearch]({{ '/installation#elasticsearch-optional' | relative_url }}) — live alert ingestion
