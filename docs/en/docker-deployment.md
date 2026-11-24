---
layout: default
title: "Docker Deployment"
lang: en
lang_ref: docker-deployment
---

# Docker Deployment

This guide covers production-grade deployment of the Argus Agentic SOC Platform using Docker Compose, including service architecture, production hardening, operational management, Kubernetes notes, and troubleshooting.

> For a minimal quick-start, see [Installation]({{ '/en/installation/' | relative_url }}).

## Service Architecture

The compose stack runs four services, one of which is a one-shot initializer:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │────▶│   Backend    │────▶│  PostgreSQL  │
│  (Next.js)   │     │  (Django)    │     │   Database   │
│  Port 3000   │     │  Port 8000   │     │  Port 5432   │
└──────────────┘     └──────▲───────┘     └──────────────┘
                            │ copies app into volume, then exits
                     ┌──────┴───────┐
                     │ backend-app- │
                     │     init     │
                     └──────────────┘
```

| Service | Stack | Role |
|---|---|---|
| **Frontend** | Next.js 16 (standalone Node.js server, Node 24 on Alpine) | UI and client-side rendering; proxies `/api/v1` to the backend |
| **Backend** | Django 6 on Python 3.13; Gunicorn in production | REST API, business logic, background tasks |
| **Database** | PostgreSQL 16 | Persistent data storage |
| **backend-app-init** | Backend image, runs as root | Clears and refills the shared `argus_backend_app` volume with the application, then exits |

The Prefect server and Prefect worker are **not** part of this stack. They run elsewhere; the backend reaches Prefect through `PREFECT_API_URL`.

### The `argus_backend_app` Volume

The backend container runs from the named volume `argus_backend_app` (mounted at `/app`), not from the image filesystem. On every `make build-*` the `backend-app-init` container empties the volume and copies the freshly built application into it. A Prefect worker that needs the same application code can mount this volume.

> **Warning:** the Makefile prints "argus_backend_app will be cleared and replaced. Pause all Prefect workers using it first." Pause any worker that mounts the volume before running a `build-*` target.

---

## Development vs. Production

| Concern | Development | Production |
|---|---|---|
| Compose file | `docker-compose.dev.yml` | `docker-compose.prod.yml` |
| Backend server | Django dev server (image default command) | Gunicorn: 4 workers, `gthread` worker class, 8 threads |
| Frontend host port | 3000 | 80 (container port 3000) |
| `DEBUG` | Set in `.env` | `False` (required for production) |
| Backend code | From the `argus_backend_app` volume; rebuild to update (no source bind mount) | Same |
| Extra volumes | — | `static_volume` (`/app/staticfiles`) and `media_volume` (`/app/media`) |
| Restart policy | `unless-stopped` | `always` |

---

## Production Deployment

### Start Services

```bash
make build-prod
# without Make, the first start can be:
# docker-compose -f docker-compose.prod.yml up --build -d
```

### Service Ports (Production)

| Service | Host Port | Container Port | Notes |
|---|---|---|---|
| Frontend | 80 | 3000 | Direct HTTP access |
| Backend | 8000 | 8000 | Gunicorn, 4 workers x 8 threads |
| PostgreSQL | 5432 | 5432 | Consider removing external exposure |

### View Logs

```bash
make logs-prod
```

### Stop and Resume

```bash
make stop-prod     # stop containers
make start-prod    # start db, backend, frontend again (does not re-run the initializer)
```

---

## Production Hardening Checklist

Before exposing the platform to production traffic:

- [ ] Set `DEBUG=False` in `.env`
- [ ] Set a generated `SECRET_KEY` (a placeholder value stops startup when `DEBUG=False`):
  ```bash
  python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
  ```
- [ ] Set `WORKFLOW_ENCRYPTION_KEYS` to one or more Fernet keys (required when `DEBUG=False`):
  ```bash
  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
  ```
- [ ] Restrict `ALLOWED_HOSTS` to your actual domain names; `*` is rejected when `DEBUG=False`
- [ ] Set `CSRF_TRUSTED_ORIGINS` to your production origins, including the scheme
- [ ] Set `OTP_HASH_SECRET` to a random value or remove it (a placeholder stops startup)
- [ ] Behind HTTPS, set `SECURE_SSL_REDIRECT`, `SECURE_HSTS_SECONDS` (with `SECURE_HSTS_INCLUDE_SUBDOMAINS` / `SECURE_HSTS_PRELOAD` if appropriate), and keep `SESSION_COOKIE_SECURE` / `CSRF_COOKIE_SECURE` at `true`
- [ ] If TLS ends at a proxy or load balancer, set `SECURE_PROXY_SSL_HEADER=HTTP_X_FORWARDED_PROTO,https`
- [ ] Set `DJANGO_DEPLOY_CHECK=1` to run `manage.py check --deploy` at every container start
- [ ] Remove port `5432` exposure from `docker-compose.prod.yml` if external DB access is not required
- [ ] Place a TLS-terminating reverse proxy (Nginx, Traefik) in front of the frontend container
- [ ] Replace all example passwords in `.env` before first deployment
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
| `SECRET_KEY` | A generated random string |
| `DEBUG` | `False` |
| `WORKFLOW_ENCRYPTION_KEYS` | Fernet key ring, comma-separated; the first key encrypts new values and the others only decrypt (key rotation) |
| `ALLOWED_HOSTS` | `yourdomain.com,www.yourdomain.com` (include `backend` if other containers call it by that name) |
| `CSRF_TRUSTED_ORIGINS` | `https://yourdomain.com` |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | Database name, user, and a strong password |
| `POSTGRES_HOST` | `db` |
| `BACKEND_ORIGIN` | `http://backend:8000` |

See [Installation]({{ '/en/installation/' | relative_url }}) for the complete variable tables (HTTPS and cookies, SMTP, Elasticsearch, OTP).

### Prefect Workflow Engine

| Variable | Description |
|---|---|
| `PREFECT_API_URL` | Prefect Server API endpoint, for example `http://<prefect-host>:4200/api` |
| `PREFECT_API_KEY` | Optional key for Prefect Cloud or an authenticated server |
| `BACKEND_ORIGIN` | Also used by the worker to call back into the backend; a worker without it fails with "BACKEND_ORIGIN is required by the workflow worker." |
| `WORKFLOW_ENCRYPTION_KEYS` | The worker needs the same key ring to decrypt workflow secrets |

The worker must be able to reach the backend at the `BACKEND_ORIGIN` URL, so a worker running outside the compose network needs a backend address that resolves from its own network.

### Kibana Detection Engine

Optional. Set `KIBANA_BASE_URL` and either `KIBANA_API_KEY` or `KIBANA_USERNAME` / `KIBANA_PASSWORD`; `KIBANA_SPACE` defaults to `default`.

---

## Operational Management

### Makefile Quick Reference

Every target exists in a `-dev` and a `-prod` variant (`<target>-prod` shown).

| Command | Description |
|---|---|
| `make build-prod` | Build images, clear and refill `argus_backend_app`, start db, backend, frontend |
| `make build-backend-prod` | Rebuild and recreate only the backend (other services must already be running) |
| `make build-frontend-prod` | Rebuild and recreate only the frontend |
| `make redeploy-prod` | `down`, then rebuild and start |
| `make stop-prod` / `make start-prod` | Stop, or resume db, backend, frontend |
| `make restart-prod` | Restart all containers |
| `make logs-prod` | Tail logs |
| `make clean-prod` | Remove containers, **volumes**, and images |
| `make clean-rebuild-prod` | `clean`, then rebuild and start |

The registry used for base images is set with `IMAGE_REGISTRY` (default `docker.io/library`), for example `make build-prod IMAGE_REGISTRY=<registry>/<namespace>`; do not include a URL scheme.

> `clean-*` removes volumes, including `postgres_data` and `argus_backend_app`. Take a database backup first.

### Restart a Single Service

```bash
docker-compose -f docker-compose.prod.yml restart backend
```

### Rebuild a Single Service

Use the Makefile targets so the backend volume is refreshed correctly:

```bash
make build-backend-prod
make build-frontend-prod
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
docker exec postgres pg_dump -U <POSTGRES_USER> <POSTGRES_DB> > backup_$(date +%Y%m%d).sql
```

### Restore

```bash
docker exec -i postgres psql -U <POSTGRES_USER> <POSTGRES_DB> < backup_YYYYMMDD.sql
```

### Data Persistence

PostgreSQL data is stored in a named Docker volume (`postgres_data`). It persists across `docker-compose down` and restarts but is **removed** with `docker-compose down --volumes` and by every `clean-*` target.

> Maintain regular off-host backups before running any `down --volumes` or `clean` commands.

---

## Automatic Startup Behavior

On every backend container start, the entrypoint script:
1. If `DJANGO_DEPLOY_CHECK=1`, runs `manage.py check --deploy --fail-level WARNING`
2. Runs `makemigrations --noinput` and `migrate --noinput`
3. Runs `collectstatic --noinput` unless `DJANGO_COLLECTSTATIC=0`
4. Starts the container command (Gunicorn in production)

Static files are served by WhiteNoise; the frontend also rewrites `/admin`, `/static`, and `/media` to the backend.

---

## Reverse Proxy (HTTPS)

For production HTTPS, place a reverse proxy in front of the frontend container. The production compose file publishes the frontend on host port **80** (container port 3000), so a proxy on the same host cannot also listen on port 80 unless you change the mapping. Two options:

- Keep the mapping and let Nginx listen on 443 only, proxying to `127.0.0.1:80`.
- Change the frontend mapping in `docker-compose.prod.yml` to `"127.0.0.1:3000:3000"`, proxy to `127.0.0.1:3000`, and let Nginx own ports 80 and 443.

Example Nginx server block for the first option:

```nginx
server {
    listen 443 ssl;
    server_name siem.yourdomain.com;

    ssl_certificate     /etc/ssl/certs/yourdomain.crt;
    ssl_certificate_key /etc/ssl/private/yourdomain.key;

    location / {
        proxy_pass http://127.0.0.1:80;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Add your public origin to `CSRF_TRUSTED_ORIGINS` and `ALLOWED_HOSTS`, and set `SECURE_PROXY_SSL_HEADER=HTTP_X_FORWARDED_PROTO,https`.

---

## Kubernetes Notes

The `k8s/` folder contains reference manifests for the `siem-dev` namespace. Adapt names, storage classes, and cloud annotations to your cluster.

| Manifest | Contents |
|---|---|
| `backend-deploy.yaml` | `siem-backend` Deployment (2 replicas), a `backend-app-init` init container, the `siem-backend-app-pvc` PersistentVolumeClaim, and a ClusterIP Service (port 80 to container port 8000) |
| `frontend-deploy.yaml` | `siem-frontend` Deployment (2 replicas) and a `LoadBalancer` Service on ports 80 and 443, targeting container port 3000 |
| `postgres-deploy.yaml` | `siem-db` StatefulSet (PostgreSQL 16) with a 20Gi volume claim and a Service on port 5432 |

Points that differ from Compose:

- Images are tagged by version, for example `<registry>/siem/siem-backend:v0.81` and `<registry>/siem/siem-frontend:v0.81`; change the tag when you publish a new build. The manifests reference an image pull secret; create it for your registry yourself and keep credentials out of version control.
- The init container runs as root and copies the application into the shared PVC **only if `manage.py` is not already there**, then creates the generated-workflows, static, and media directories. The PVC is `ReadWriteMany` (10Gi) so several pods can share it.
- Gunicorn runs with 2 workers and 8 `gthread` threads per pod; scale with replicas.
- Configuration comes from a ConfigMap `siem-config` and Secrets `siem-backend-secret` and `postgres-secret`, which are not part of the repository. The frontend uses `BACKEND_ORIGIN=http://siem-backend:80`, and the backend uses `POSTGRES_HOST=siem-db`.
- The same environment rules apply: `DEBUG=False` needs a real `SECRET_KEY` and `WORKFLOW_ENCRYPTION_KEYS`.

---

## Troubleshooting

### Container fails to start

```bash
docker logs <container-name>
```

Check: `.env` exists and contains all required variables; no port conflicts on the host.

### Backend exits with ImproperlyConfigured

| Message | Fix |
|---|---|
| `SECRET_KEY must be set to a non-placeholder value when DEBUG=False.` | Set a generated `SECRET_KEY` |
| `ALLOWED_HOSTS must not contain "*" when DEBUG=False.` | List explicit hostnames |
| `WORKFLOW_ENCRYPTION_KEYS must contain at least one Fernet key when DEBUG=False.` | Generate and set a Fernet key |
| `WORKFLOW_ENCRYPTION_KEYS contains an invalid Fernet key ...` | Replace the invalid key; each entry must be a valid Fernet key |
| `OTP_HASH_SECRET must be unset or set to a non-placeholder value when DEBUG=False.` | Set a random value or remove the variable |
| `SECURE_PROXY_SSL_HEADER must contain exactly two comma-separated values.` | Use the form `HTTP_X_FORWARDED_PROTO,https` |

### Database connection refused

- Confirm `POSTGRES_HOST=db` in `.env` (not `localhost`)
- The PostgreSQL container may still be initializing; the compose files do not wait for it to accept connections, so wait a few seconds and run `docker-compose -f docker-compose.<env>.yml restart backend`

### Frontend cannot reach backend

- Confirm `BACKEND_ORIGIN=http://backend:8000`
- Confirm both containers are on the same Docker network (handled by Compose automatically)

### Backend files look stale after a rebuild

The backend runs from the `argus_backend_app` volume. Rebuild with `make build-backend-<env>` (or `make build-<env>`), which rebuilds the image and re-runs the initializer so the volume is refreshed.

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

> This deletes all volumes, including the database. Back up first.
