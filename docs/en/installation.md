---
layout: default
title: "Installation"
lang: en
lang_ref: installation
---

# Installation

This guide walks through deploying the Argus Agentic SOC Platform using Docker Compose — the fastest path from zero to a running system.

## Prerequisites

| Software | Minimum Version | Notes |
|---|---|---|
| Docker | 24.0+ | Container runtime |
| Docker Compose | 2.20+ | Included in Docker Desktop |
| Git | 2.30+ | Clone the repository |
| Make *(optional)* | 4.0+ | Shortcut commands; install via `choco install make` on Windows |

## Quick Start

```bash
# 1. Clone the repository
git clone <repository-url>
cd ECHO-SOC-Platform

# 2. Create the environment file
cp env.example .env

# 3. Edit .env — fill in required variables (see below)

# 4. Build and start all services in development mode
docker-compose -f docker-compose.dev.yml up --build -d

# 5. Open the application
#    Frontend:    http://localhost:3000
#    Backend API: http://localhost:8000
```

## Environment Configuration

Copy the example file and set all required variables before starting containers.

### Required Variables

| Variable | Description | Example |
|---|---|---|
| `SECRET_KEY` | Django secret key (strong random string) | `change-me-in-production` |
| `DEBUG` | Enable debug mode | `False` |
| `ALLOWED_HOSTS` | Comma-separated allowed hostnames | `localhost,127.0.0.1` |
| `POSTGRES_DB` | PostgreSQL database name | `siem_db` |
| `POSTGRES_USER` | PostgreSQL username | `siem_user` |
| `POSTGRES_PASSWORD` | PostgreSQL password | `siem_password` |
| `POSTGRES_HOST` | Database hostname | `db` *(Docker service name)* |
| `POSTGRES_PORT` | Database port | `5432` |
| `BACKEND_ORIGIN` | Backend URL for frontend API calls | `http://backend:8000` |

> **Docker networking:** Set `POSTGRES_HOST=db`, not `localhost`. Both services share the same Docker Compose network and resolve each other by service name.

### Optional Variables

| Variable | Description | Default |
|---|---|---|
| `ES_HOST` | Elasticsearch URL | `http://localhost:9200` |
| `ES_USERNAME` | Elasticsearch username | `elastic` |
| `ES_PASSWORD` | Elasticsearch password | — |
| `PREFECT_API_URL` | Prefect Server API endpoint | `http://127.0.0.1:4200/api` |
| `REDIS_ENABLED` | Enable Redis caching | `false` |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379/0` |

### Email / SMTP

| Variable | Description | Example |
|---|---|---|
| `EMAIL_HOST` | SMTP server | `smtp.gmail.com` |
| `EMAIL_PORT` | SMTP port | `587` |
| `EMAIL_HOST_USER` | SMTP username | `noreply@example.com` |
| `EMAIL_HOST_PASSWORD` | SMTP password | — |
| `EMAIL_USE_TLS` | Use TLS | `true` |
| `DEFAULT_FROM_EMAIL` | Default sender address | `noreply@example.com` |

## Service Ports (Development)

| Service | Host Port | Container Port |
|---|---|---|
| Frontend (Next.js) | 3000 | 3000 |
| Backend (Django) | 8000 | 8000 |
| PostgreSQL | 5432 | 5432 |

## Verifying the Deployment

### 1. Check container status

```bash
docker ps
```

You should see three running containers: `frontend`, `backend`, and `postgres`.

### 2. Check backend health

```bash
curl http://localhost:8000/api/
```

### 3. Check database connectivity

```bash
docker exec -it postgres psql -U siem_user -d siem_db -c "SELECT 1;"
```

### 4. View logs

```bash
# All services
docker-compose -f docker-compose.dev.yml logs -f

# Single service
docker logs backend
```

## Common Makefile Commands

| Command | Description |
|---|---|
| `make build-dev` | Build and start development containers |
| `make redeploy-dev` | Stop, rebuild, and restart |
| `make logs-dev` | Tail development logs |
| `make clean-dev` | Remove all dev containers, volumes, and images |

> For production deployment (Gunicorn, port 80, hardened settings) see [Docker Deployment]({{ '/en/docker-deployment/' | relative_url }}).
