---
layout: default
title: "Configuration"
---

# Configuration Reference

All runtime configuration is driven by environment variables. Copy `env.example` to `.env` and adjust before starting the stack.

---

## Core Django Settings

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SECRET_KEY` | **Yes** | — | Django secret key. Generate with `python -c "import secrets; print(secrets.token_urlsafe(64))"` |
| `DEBUG` | No | `False` | Set `True` for development only. Never `True` in production. |
| `ALLOWED_HOSTS` | **Yes** | — | Comma-separated list: `localhost,127.0.0.1,yourdomain.com` |
| `CSRF_TRUSTED_ORIGINS` | Prod | — | Required when behind a reverse proxy: `https://yourdomain.com` |
| `TIME_ZONE` | No | `UTC` | Django timezone. Keep `UTC` for multi-region deployments. |

---

## Database (PostgreSQL)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POSTGRES_DB` | **Yes** | — | Database name, e.g. `siem_db` |
| `POSTGRES_USER` | **Yes** | — | Database user, e.g. `siem_user` |
| `POSTGRES_PASSWORD` | **Yes** | — | Database password |
| `POSTGRES_HOST` | **Yes** | — | Host: `db` (Docker Compose) or IP/hostname |
| `POSTGRES_PORT` | No | `5432` | PostgreSQL port |

---

## Frontend (Next.js)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BACKEND_ORIGIN` | **Yes** | — | Internal URL the frontend proxy calls: `http://backend:8000` |
| `NEXT_PUBLIC_APP_NAME` | No | `Argus` | Display name shown in the UI |

---

## Elasticsearch (optional alert source)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ES_HOST` | No | — | Elasticsearch URL: `http://your-es:9200` |
| `ES_USERNAME` | No | — | ES username (if security enabled) |
| `ES_PASSWORD` | No | — | ES password |
| `ES_INDEX` | No | — | Default index pattern for alert ingestion |
| `ES_SYNC_INTERVAL_SECONDS` | No | `300` | How often to pull alerts from ES (seconds) |

> These can also be set via **Integrations → Elastic Stack → Configure** in the UI.
> UI settings override environment variables when both are present.

---

## AI Assistant

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | No | — | API key for Claude / Anthropic models |
| `OPENAI_API_KEY` | No | — | API key for OpenAI models (if using GPT-based assistant) |
| `AI_MODEL` | No | — | Model identifier, e.g. `claude-sonnet-4-6` — **TODO: confirm exact variable name** |
| `MCP_TIMEOUT_SECONDS` | No | `30` | Timeout for MCP tool calls — **TODO: confirm variable name** |

---

## Email / Notifications (optional)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EMAIL_HOST` | No | — | SMTP server hostname |
| `EMAIL_PORT` | No | `587` | SMTP port |
| `EMAIL_HOST_USER` | No | — | SMTP username |
| `EMAIL_HOST_PASSWORD` | No | — | SMTP password |
| `EMAIL_USE_TLS` | No | `True` | Use STARTTLS |
| `DEFAULT_FROM_EMAIL` | No | — | Sender address for notifications |

---

## Production Checklist

Before going live, verify:

- [ ] `SECRET_KEY` is a unique, random 64+ character string
- [ ] `DEBUG=False`
- [ ] `ALLOWED_HOSTS` contains only your actual domains
- [ ] `CSRF_TRUSTED_ORIGINS` set if behind a reverse proxy / load balancer
- [ ] `POSTGRES_PASSWORD` is strong and not the example value
- [ ] ES credentials are not stored in VCS (use `.env` or secrets manager)
- [ ] `django-admin migrate` has been run against the production DB
- [ ] At least one superuser account created with a strong password
- [ ] TLS / HTTPS configured at the reverse proxy level

---

## Applying changes

After editing `.env`:

```bash
# Docker Compose (dev)
make restart-dev

# Docker Compose (prod)
make restart-prod

# Kubernetes — update your ConfigMap / Secret and roll the deployment
kubectl rollout restart deployment/argus-backend
kubectl rollout restart deployment/argus-frontend
```
