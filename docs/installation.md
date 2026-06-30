---
layout: default
title: "Installation"
---

# Installation

This guide covers three deployment modes: local development, production Docker Compose, and Kubernetes.

---

## Requirements

| Component | Minimum version |
|-----------|----------------|
| Docker | 24.x |
| Docker Compose | 2.20 |
| GNU Make | 3.8 |
| PostgreSQL | 16 (included in compose) |
| Node.js (manual only) | 20 LTS |
| Python (manual only) | 3.11+ |

---

## Docker Compose — Development

### 1. Clone & configure

```bash
git clone https://github.com/Sec-Link/ECHO-Agentic-SOC-Platform.git
cd ECHO-Agentic-SOC-Platform
cp env.example .env
# Edit .env — see Configuration reference for all variables
```

### 2. Build and start

```bash
make build-dev
```

### 3. Apply migrations and create admin

```bash
docker compose -f docker-compose.dev.yml exec backend python manage.py migrate
docker compose -f docker-compose.dev.yml exec backend python manage.py createsuperuser
```

### 4. Verify

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:8000/api/v1/`
- Admin: `http://localhost:8000/admin/`

---

## Docker Compose — Production

### 1. Configure production env

```bash
cp env.example .env
```

Key differences from dev:

```env
DEBUG=False
SECRET_KEY=<generate with: python -c "import secrets; print(secrets.token_urlsafe(64))">
ALLOWED_HOSTS=yourdomain.com,www.yourdomain.com
CSRF_TRUSTED_ORIGINS=https://yourdomain.com
```

### 2. Build and start

```bash
make build-prod
```

- Frontend: `http://localhost` (port 80)
- Backend API: `http://localhost:8000`

### 3. Run migrations

```bash
docker compose -f docker-compose.prod.yml exec backend python manage.py migrate
docker compose -f docker-compose.prod.yml exec backend python manage.py createsuperuser
```

---

## Kubernetes

The `k8s/` directory contains base manifests:

```
k8s/
├── backend-deploy.yaml    # Django backend Deployment + Service
├── frontend-deploy.yaml   # Next.js frontend Deployment + Service
└── postgres-deploy.yaml   # PostgreSQL StatefulSet + PVC
```

### Apply manifests

```bash
kubectl apply -f k8s/postgres-deploy.yaml
kubectl apply -f k8s/backend-deploy.yaml
kubectl apply -f k8s/frontend-deploy.yaml
```

> **TODO**: Add your image registry paths and secret references to the manifests before applying.
> The manifests are provided as a starting point and require environment-specific customization.

---

## Elasticsearch (optional)

Argus can ingest alerts directly from an Elasticsearch index. To enable:

### 1. Add ES variables to `.env`

```env
ES_HOST=http://your-es-host:9200
ES_USERNAME=elastic
ES_PASSWORD=your-password
ES_INDEX=your-alert-index
```

### 2. Configure via UI

Go to **Integrations → Elastic Stack → Configure** and enter connection details.
Use the **Test Connection** button to validate before saving.

### 3. Trigger sync

Alerts are fetched automatically on the configured sync schedule, or manually via:

```bash
curl -X POST http://localhost:8000/api/v1/alerts/sync/ \
  -H "Authorization: Token <your-token>"
```

---

## Manual setup (without Docker)

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Set env variables (copy from env.example)
export SECRET_KEY=...
export POSTGRES_HOST=localhost
# ... other vars

python manage.py migrate
python manage.py createsuperuser
python manage.py runserver 8000
```

### Frontend

```bash
cd frontend
npm install
# Set NEXT_PUBLIC_API_BASE or configure .env.local
npm run dev    # development
npm run build && npm start  # production
```

---

## Upgrading

```bash
git pull origin main
make redeploy-prod   # rebuilds images, restarts, runs migrations
```

Always review `CHANGELOG.md` (if present) and run `python manage.py showmigrations` before upgrading a production database.
