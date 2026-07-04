---
layout: default
title: "Docker Deployment"
lang: en
lang_ref: docker-deployment
---

# Docker Deployment

This guide covers production-grade deployment of the Argus Agentic SOC Platform using Docker Compose, including service architecture, production hardening, operational management, and troubleshooting.

> For a minimal quick-start, see [Installation]({{ '/en/installation/' | relative_url }}).

## Service Architecture

The platform runs as three containerized services:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │────▶│   Backend    │────▶│  PostgreSQL  │
│  (Next.js)   │     │  (Django)    │     │   Database   │
│  Port 3000   │     │  Port 8000   │     │  Port 5432   │
└──────────────┘     └──────────────┘     └──────────────┘
```

| Service | Stack | Role |
|---|---|---|
| **Frontend** | Next.js 16 (standalone Node.js server) | UI and client-side rendering |
| **Backend** | Django 6 + Gunicorn (4 workers in production) | REST API, business logic, background tasks |
| **Database** | PostgreSQL 16 | Persistent data storage |

---

## Development vs. Production

| Concern | Development | Production |
|---|---|---|
| Backend server | Django dev server | Gunicorn (4 workers) |
| Frontend port | 3000 | 80 |
| `DEBUG` | `True` | `False` (required) |
| Volume mounts | Backend source code mounted for hot-reload | None (immutable image) |
| Compose file | `docker-compose.dev.yml` | `docker-compose.prod.yml` |

---

## Production Deployment

### Start Services

```bash
docker-compose -f docker-compose.prod.yml up --build -d
```

### Service Ports (Production)

| Service | Host Port | Container Port | Notes |
|---|---|---|---|
| Frontend | 80 | 3000 | Direct HTTP access |
| Backend | 8000 | 8000 | Gunicorn, 4 workers |
| PostgreSQL | 5432 | 5432 | Consider removing external exposure |

### View Logs

```bash
docker-compose -f docker-compose.prod.yml logs -f
```

### Stop Services

```bash
docker-compose -f docker-compose.prod.yml down
```

---

## Production Hardening Checklist

Before exposing the platform to production traffic:

- [ ] Set `DEBUG=False` in `.env`
- [ ] Generate a strong `SECRET_KEY`:
  ```bash
  python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
  ```
- [ ] Restrict `ALLOWED_HOSTS` to your actual domain names (e.g., `siem.example.com`)
- [ ] Set `CSRF_TRUSTED_ORIGINS` with your production domain
- [ ] Remove port `5432` exposure from `docker-compose.prod.yml` if external DB access is not required
- [ ] Place a TLS-terminating reverse proxy (Nginx, Traefik) in front of the frontend container
- [ ] Rotate all default passwords in `.env` before first deployment
- [ ] Confirm that `.env` is not committed to version control (check `.gitignore`)

---

## Environment Configuration

All runtime settings are controlled via `.env`. Copy the example and fill in your values:

```bash
cp env.example .env
```

### Required Variables

| Variable | Production Value |
|---|---|
| `SECRET_KEY` | A 50+ character random string |
| `DEBUG` | `False` |
| `ALLOWED_HOSTS` | `yourdomain.com,www.yourdomain.com` |
| `POSTGRES_DB` | `siem_db` |
| `POSTGRES_USER` | `siem_user` |
| `POSTGRES_PASSWORD` | Strong password |
| `POSTGRES_HOST` | `db` |
| `BACKEND_ORIGIN` | `http://backend:8000` |

---

## Operational Management

### Makefile Quick Reference

| Command | Description |
|---|---|
| `make build-prod` | Build and start production containers |
| `make redeploy-prod` | Stop, rebuild, and restart |
| `make logs-prod` | Tail production logs |
| `make restart-prod` | Restart all production containers |
| `make clean-prod` | Remove all containers, volumes, images |
| `make clean-rebuild-prod` | Full clean + rebuild |

### Restart a Single Service

```bash
docker-compose -f docker-compose.prod.yml restart backend
```

### Rebuild a Single Service

```bash
docker-compose -f docker-compose.prod.yml up --build -d backend
```

### Run Django Management Commands

```bash
# Create an admin superuser
docker exec -it backend python manage.py createsuperuser

# Apply database migrations manually
docker exec -it backend python manage.py migrate

# Collect static files
docker exec -it backend python manage.py collectstatic --noinput
```

### Access Container Shells

```bash
docker exec -it backend sh
docker exec -it frontend sh
docker exec -it postgres bash
```

---

## Database Management

### Backup

```bash
docker exec postgres pg_dump -U siem_user siem_db > backup_$(date +%Y%m%d).sql
```

### Restore

```bash
docker exec -i postgres psql -U siem_user siem_db < backup_20260704.sql
```

### Data Persistence

PostgreSQL data is stored in a named Docker volume (`postgres_data`). It persists across `docker-compose down` restarts but is **removed** with `docker-compose down --volumes`.

> Maintain regular off-host backups before running any `down --volumes` or `clean` commands.

---

## Automatic Startup Behavior

On every container start, the backend entrypoint script automatically:
1. Runs `makemigrations` and `migrate` to apply any pending schema changes
2. Runs `collectstatic --noinput` to collect frontend static assets

Disable static collection with `DJANGO_COLLECTSTATIC=0` in `.env` if needed.

---

## Reverse Proxy (HTTPS)

For production HTTPS, place a reverse proxy in front of the frontend container. Example Nginx server block:

```nginx
server {
    listen 443 ssl;
    server_name siem.yourdomain.com;

    ssl_certificate     /etc/ssl/certs/yourdomain.crt;
    ssl_certificate_key /etc/ssl/private/yourdomain.key;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Troubleshooting

### Container fails to start

```bash
docker logs <container-name>
```

Check: `.env` exists and contains all required variables; no port conflicts on the host.

### Database connection refused

- Confirm `POSTGRES_HOST=db` in `.env` (not `localhost`)
- PostgreSQL container may still be initializing — wait a few seconds and retry, or add a health check to `docker-compose.yml`

### Frontend cannot reach backend

- Confirm `BACKEND_ORIGIN=http://backend:8000`
- Confirm both containers are on the same Docker network (handled by Compose automatically)

### Port already in use

```bash
# macOS / Linux
lsof -i :8000

# Windows
netstat -ano | findstr :8000
```

### Full clean rebuild

```bash
make clean-rebuild-prod
# or manually:
docker-compose -f docker-compose.prod.yml down --volumes --rmi all
docker-compose -f docker-compose.prod.yml up --build -d
```
