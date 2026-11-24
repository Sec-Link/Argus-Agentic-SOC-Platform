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
| Docker Compose | 2.20+ | Included in Docker Desktop; the Makefile calls `docker-compose` |
| Git | 2.30+ | Clone the repository |
| Make *(optional)* | 4.0+ | Shortcut commands; install via `choco install make` on Windows |

## Quick Start

```bash
# 1. Clone the repository
git clone <repository-url>
cd <cloned-folder>          # the folder created by git clone

# 2. Create the environment file
cp env.example .env

# 3. Edit .env — fill in required variables (see below)

# 4. Build and start all services in development mode
make build-dev
# without Make:
# docker-compose -f docker-compose.dev.yml up --build -d

# 5. Open the application
#    Frontend:    http://localhost:3000
#    Backend API: http://localhost:8000
```

`make build-dev` builds the images, runs the one-shot `backend-app-init` container, and then starts `backend` and `frontend`. It prints a warning that the shared `argus_backend_app` volume will be cleared and replaced; on a first install there is nothing to lose.

## Environment Configuration

Copy the example file and set all required variables before starting containers. `env.example` ships with `DEBUG=False`, so the production safety checks below apply from the first start unless you set `DEBUG=True` for local experiments.

### Required Variables

| Variable | Description | Example |
|---|---|---|
| `SECRET_KEY` | Django secret key; with `DEBUG=False` it must not be empty or a placeholder such as the one in `env.example` | `<random 50+ character string>` |
| `DEBUG` | Debug mode; use `False` for any shared or production environment | `False` |
| `WORKFLOW_ENCRYPTION_KEYS` | Comma-separated Fernet key ring for workflow secrets; the first key encrypts new values. **Required when `DEBUG=False`**, and every key must be a valid Fernet key | `<generated Fernet key>` |
| `ALLOWED_HOSTS` | Comma-separated allowed hostnames; must not contain `*` when `DEBUG=False` | `localhost,127.0.0.1,backend` |
| `CSRF_TRUSTED_ORIGINS` | Comma-separated origins, no spaces, including scheme | `http://localhost:3000` |
| `POSTGRES_DB` | PostgreSQL database name | `siem_db` |
| `POSTGRES_USER` | PostgreSQL username | `siem_user` |
| `POSTGRES_PASSWORD` | PostgreSQL password — replace the example value | `<strong password>` |
| `POSTGRES_HOST` | Database hostname | `db` *(Docker service name)* |
| `POSTGRES_PORT` | Database port | `5432` |
| `BACKEND_ORIGIN` | Backend URL used by the frontend proxy (and by Prefect worker callbacks) | `http://backend:8000` |

Generate the secrets:

```bash
# SECRET_KEY
python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"

# WORKFLOW_ENCRYPTION_KEYS (one Fernet key)
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

> **Docker networking:** Set `POSTGRES_HOST=db`, not `localhost` (the value in `env.example`). Services resolve each other by Compose service name.

> **OTP secret:** `env.example` sets `OTP_HASH_SECRET` to a placeholder. With `DEBUG=False` a placeholder value stops startup; set a random value or remove the line (it then falls back to `SECRET_KEY`).

### Optional Variables

| Variable | Description | Default |
|---|---|---|
| `ES_HOST` | Elasticsearch URL | — |
| `ES_USERNAME` | Elasticsearch username | — |
| `ES_PASSWORD` | Elasticsearch password | — |
| `KIBANA_BASE_URL`, `KIBANA_API_KEY`, `KIBANA_USERNAME`, `KIBANA_PASSWORD`, `KIBANA_SPACE` | Kibana Detection Engine access | empty; space `default` |
| `PREFECT_API_URL` | Prefect Server API endpoint (Prefect runs outside this stack) | `http://127.0.0.1:4200/api` |
| `PREFECT_API_KEY` | Optional key for Prefect Cloud or an authenticated server | empty |
| `OTP_AUTH_ENABLED` | Enable email OTP login for guests | `true` |
| `ADMIN_REGISTRATION_EMAILS` | Recipients of new registration request notices | empty |
| `DJANGO_DEPLOY_CHECK` | `1` runs `manage.py check --deploy` at container start and fails on warnings | `0` |
| `DJANGO_COLLECTSTATIC` | `0` skips `collectstatic` at container start | `1` |

> `REDIS_ENABLED` and `REDIS_URL` from older versions of this guide are not read by the backend code and can be omitted.

### HTTPS and Cookie Settings

| Variable | Description | Default |
|---|---|---|
| `SECURE_SSL_REDIRECT` | Redirect HTTP to HTTPS | `false` |
| `SECURE_HSTS_SECONDS` | HSTS max age; `0` disables | `0` |
| `SECURE_HSTS_INCLUDE_SUBDOMAINS` | Add `includeSubDomains` to HSTS | `false` |
| `SECURE_HSTS_PRELOAD` | Add `preload` to HSTS | `false` |
| `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE` | Send cookies only over HTTPS | `true` when `DEBUG=False`, otherwise `false` |
| `SECURE_PROXY_SSL_HEADER` | Two comma-separated values when TLS ends at a trusted proxy, for example `HTTP_X_FORWARDED_PROTO,https` | unset |

### Email / SMTP

Used for OTP and notification emails.

| Variable | Description | Example |
|---|---|---|
| `EMAIL_HOST` | SMTP server | `smtp.example.com` |
| `EMAIL_PORT` | SMTP port | `587` |
| `EMAIL_HOST_USER` | SMTP username | `noreply@example.com` |
| `EMAIL_HOST_PASSWORD` | SMTP password | — |
| `EMAIL_USE_TLS` | Use TLS | `true` |
| `EMAIL_USE_SSL` | Use SSL | `false` |
| `DEFAULT_FROM_EMAIL` | Default sender address | `noreply@example.com` |
| `EMAIL_TIMEOUT` | SMTP timeout in seconds | `15` |

## Services and Ports (Development)

| Service | Container | Host Port | Container Port |
|---|---|---|---|
| Frontend (Next.js) | `frontend` | 3000 | 3000 |
| Backend (Django) | `backend` | 8000 | 8000 |
| PostgreSQL | `postgres` | 5432 | 5432 |
| `backend-app-init` | — | — | — *(runs once, then exits)* |

## Verifying the Deployment

### 1. Check container status

```bash
docker ps
```

You should see three running containers: `frontend`, `backend`, and `postgres`. The `backend-app-init` container is expected to be absent here; `docker ps -a` shows it as exited with code 0.

### 2. Check backend startup

```bash
docker logs backend
```

The log shows the entrypoint running migrations and static collection, then the server start. A traceback mentioning `ImproperlyConfigured` names the setting to fix (see the required variables above).

### 3. Check database connectivity

```bash
docker exec -it postgres psql -U <POSTGRES_USER> -d <POSTGRES_DB> -c "SELECT 1;"
```

### 4. View logs

```bash
# All services
docker-compose -f docker-compose.dev.yml logs -f

# Single service
docker logs backend
```

### 5. Create an administrator

```bash
docker exec -it backend python manage.py createsuperuser
```

## Common Makefile Commands

| Command | Description |
|---|---|
| `make build-dev` | Build images, run `backend-app-init`, start db, backend, frontend |
| `make redeploy-dev` | `down`, then rebuild and start |
| `make logs-dev` | Tail development logs |
| `make stop-dev` / `make start-dev` | Stop or resume db, backend, frontend (never re-runs the initializer) |
| `make restart-dev` | Restart all dev containers |
| `make clean-dev` | Remove dev containers, **volumes**, and images |

> Each target has a `-prod` twin. For production deployment (Gunicorn, port 80, hardened settings) and the full target list, see [Docker Deployment]({{ '/en/docker-deployment/' | relative_url }}).
