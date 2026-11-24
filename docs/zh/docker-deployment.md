---
layout: default
title: "Docker 部署"
lang: zh
lang_ref: docker-deployment
---

# Docker 部署

本指南涵盖 Argus Agentic SOC Platform 的生产级 Docker Compose 部署，包括服务架构、生产加固、运维管理、Kubernetes 说明和故障排查。

> 如需最简快速启动，请参阅[安装部署]({{ '/zh/installation/' | relative_url }})。

## 服务架构

Compose 栈运行四个服务，其中一个是一次性的初始化容器：

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    前端      │────▶│    后端      │────▶│  PostgreSQL  │
│  (Next.js)   │     │  (Django)    │     │   数据库     │
│  Port 3000   │     │  Port 8000   │     │  Port 5432   │
└──────────────┘     └──────▲───────┘     └──────────────┘
                            │ 将应用复制到卷中，随后退出
                     ┌──────┴───────┐
                     │ backend-app- │
                     │     init     │
                     └──────────────┘
```

| 服务 | 技术栈 | 职责 |
|---|---|---|
| **前端** | Next.js 16（独立 Node.js 服务器，基于 Alpine 的 Node 24） | UI 渲染与客户端交互；将 `/api/v1` 代理到后端 |
| **后端** | Python 3.13 上的 Django 6；生产使用 Gunicorn | REST API、业务逻辑、后台任务 |
| **数据库** | PostgreSQL 16 | 持久化数据存储 |
| **backend-app-init** | 后端镜像，以 root 运行 | 清空并重新填充共享卷 `argus_backend_app`，随后退出 |

Prefect Server 和 Prefect Worker **不在**本栈内。它们运行在其他位置，后端通过 `PREFECT_API_URL` 访问 Prefect。

### `argus_backend_app` 卷

后端容器从具名卷 `argus_backend_app`（挂载到 `/app`）运行，而不是从镜像文件系统运行。每次执行 `make build-*` 时，`backend-app-init` 容器会清空该卷并把新构建的应用复制进去。需要同一份应用代码的 Prefect Worker 可以挂载此卷。

> **警告：** Makefile 会打印 "argus_backend_app will be cleared and replaced. Pause all Prefect workers using it first."。执行 `build-*` 目标前，请先暂停所有挂载该卷的 Worker。

---

## 开发环境 vs. 生产环境

| 方面 | 开发环境 | 生产环境 |
|---|---|---|
| Compose 文件 | `docker-compose.dev.yml` | `docker-compose.prod.yml` |
| 后端服务器 | Django 开发服务器（镜像默认命令） | Gunicorn：4 个 worker，`gthread` worker 类型，8 个线程 |
| 前端主机端口 | 3000 | 80（容器端口 3000） |
| `DEBUG` | 在 `.env` 中设置 | `False`（生产必须） |
| 后端代码 | 来自 `argus_backend_app` 卷；需重新构建才会更新（没有源码绑定挂载） | 相同 |
| 额外的卷 | — | `static_volume`（`/app/staticfiles`）和 `media_volume`（`/app/media`） |
| 重启策略 | `unless-stopped` | `always` |

---

## 生产部署

### 启动服务

```bash
make build-prod
# 不使用 Make 时，首次启动可以用：
# docker-compose -f docker-compose.prod.yml up --build -d
```

### 服务端口（生产）

| 服务 | 主机端口 | 容器端口 | 说明 |
|---|---|---|---|
| 前端 | 80 | 3000 | 直接 HTTP 访问 |
| 后端 | 8000 | 8000 | Gunicorn，4 个 worker x 8 个线程 |
| PostgreSQL | 5432 | 5432 | 建议移除对外暴露 |

### 查看日志

```bash
make logs-prod
```

### 停止与恢复

```bash
make stop-prod     # 停止容器
make start-prod    # 重新启动 db、backend、frontend（不会重新运行初始化容器）
```

---

## 生产加固检查清单

在向生产流量开放平台之前：

- [ ] 在 `.env` 中设置 `DEBUG=False`
- [ ] 设置生成的 `SECRET_KEY`（`DEBUG=False` 时占位值会导致启动失败）：
  ```bash
  python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
  ```
- [ ] 将 `WORKFLOW_ENCRYPTION_KEYS` 设置为一个或多个 Fernet 密钥（`DEBUG=False` 时必填）：
  ```bash
  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
  ```
- [ ] 将 `ALLOWED_HOSTS` 限制为实际域名；`DEBUG=False` 时 `*` 会被拒绝
- [ ] 将 `CSRF_TRUSTED_ORIGINS` 设置为生产来源，需包含协议
- [ ] 将 `OTP_HASH_SECRET` 设为随机值或删除（占位值会导致启动失败）
- [ ] 在 HTTPS 之后，设置 `SECURE_SSL_REDIRECT`、`SECURE_HSTS_SECONDS`（视情况加上 `SECURE_HSTS_INCLUDE_SUBDOMAINS` / `SECURE_HSTS_PRELOAD`），并保持 `SESSION_COOKIE_SECURE` / `CSRF_COOKIE_SECURE` 为 `true`
- [ ] 若 TLS 在代理或负载均衡器处终止，设置 `SECURE_PROXY_SSL_HEADER=HTTP_X_FORWARDED_PROTO,https`
- [ ] 设置 `DJANGO_DEPLOY_CHECK=1`，在每次容器启动时运行 `manage.py check --deploy`
- [ ] 若无需外部访问数据库，从 `docker-compose.prod.yml` 中移除 `5432` 端口暴露
- [ ] 在前端容器前放置终止 TLS 的反向代理（Nginx、Traefik）
- [ ] 首次部署前替换 `.env` 中所有示例密码
- [ ] 确认 `.env` 未提交到版本控制（检查 `.gitignore`）

---

## 环境变量配置

所有运行时设置均通过 `.env` 控制。复制示例文件并填写你的值：

```bash
cp env.example .env
```

### 必需变量

| 变量 | 生产值 |
|---|---|
| `SECRET_KEY` | 生成的随机字符串 |
| `DEBUG` | `False` |
| `WORKFLOW_ENCRYPTION_KEYS` | Fernet 密钥环，逗号分隔；第一个密钥用于加密新值，其余仅用于解密（密钥轮换） |
| `ALLOWED_HOSTS` | `yourdomain.com,www.yourdomain.com`（若其他容器通过 `backend` 名称访问，请一并加入） |
| `CSRF_TRUSTED_ORIGINS` | `https://yourdomain.com` |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | 数据库名、用户名和强密码 |
| `POSTGRES_HOST` | `db` |
| `BACKEND_ORIGIN` | `http://backend:8000` |

完整的变量表（HTTPS 与 Cookie、SMTP、Elasticsearch、OTP）请参阅[安装部署]({{ '/zh/installation/' | relative_url }})。

### Prefect 工作流引擎

| 变量 | 说明 |
|---|---|
| `PREFECT_API_URL` | Prefect Server API 端点，例如 `http://<prefect-host>:4200/api` |
| `PREFECT_API_KEY` | Prefect Cloud 或带认证服务器的可选密钥 |
| `BACKEND_ORIGIN` | Worker 也用它回调后端；缺少时 Worker 会报 "BACKEND_ORIGIN is required by the workflow worker." |
| `WORKFLOW_ENCRYPTION_KEYS` | Worker 需要相同的密钥环来解密工作流密钥 |

Worker 必须能通过 `BACKEND_ORIGIN` 地址访问后端，因此运行在 Compose 网络之外的 Worker 需要使用在其自身网络中可解析的后端地址。

### Kibana Detection Engine

可选。设置 `KIBANA_BASE_URL`，以及 `KIBANA_API_KEY` 或 `KIBANA_USERNAME` / `KIBANA_PASSWORD`；`KIBANA_SPACE` 默认为 `default`。

---

## 运维管理

### Makefile 速查

每个目标都有 `-dev` 和 `-prod` 两个版本（下表以 `<target>-prod` 为例）。

| 命令 | 说明 |
|---|---|
| `make build-prod` | 构建镜像，清空并重新填充 `argus_backend_app`，启动 db、backend、frontend |
| `make build-backend-prod` | 仅重新构建并重建后端（其他服务必须已在运行） |
| `make build-frontend-prod` | 仅重新构建并重建前端 |
| `make redeploy-prod` | 先 `down`，再重新构建并启动 |
| `make stop-prod` / `make start-prod` | 停止，或恢复 db、backend、frontend |
| `make restart-prod` | 重启所有容器 |
| `make logs-prod` | 跟踪日志 |
| `make clean-prod` | 删除容器、**卷**和镜像 |
| `make clean-rebuild-prod` | 先 `clean`，再重新构建并启动 |

基础镜像所用的仓库通过 `IMAGE_REGISTRY` 设置（默认 `docker.io/library`），例如 `make build-prod IMAGE_REGISTRY=<registry>/<namespace>`；不要包含 URL 协议。

> `clean-*` 会删除卷，包括 `postgres_data` 和 `argus_backend_app`。请先备份数据库。

### 重启单个服务

```bash
docker-compose -f docker-compose.prod.yml restart backend
```

### 重建单个服务

请使用 Makefile 目标，以便正确刷新后端卷：

```bash
make build-backend-prod
make build-frontend-prod
```

### 运行 Django 管理命令

```bash
# 创建管理员超级用户
docker exec -it backend python manage.py createsuperuser

# 手动执行数据库迁移
docker exec -it backend python manage.py migrate

# 收集静态文件
docker exec -it backend python manage.py collectstatic --noinput
```

### 进入容器 Shell

```bash
docker exec -it backend sh
docker exec -it frontend sh
docker exec -it postgres bash
```

---

## 数据库管理

### 备份

```bash
docker exec postgres pg_dump -U <POSTGRES_USER> <POSTGRES_DB> > backup_$(date +%Y%m%d).sql
```

### 恢复

```bash
docker exec -i postgres psql -U <POSTGRES_USER> <POSTGRES_DB> < backup_YYYYMMDD.sql
```

### 数据持久化

PostgreSQL 数据存储在具名 Docker 卷（`postgres_data`）中。它在 `docker-compose down` 和重启后依然保留，但使用 `docker-compose down --volumes` 以及每个 `clean-*` 目标时会被**删除**。

> 在执行任何 `down --volumes` 或 `clean` 命令前，请确保已有定期的异地备份。

---

## 自动启动行为

每次后端容器启动时，入口脚本会：
1. 若 `DJANGO_DEPLOY_CHECK=1`，运行 `manage.py check --deploy --fail-level WARNING`
2. 运行 `makemigrations --noinput` 和 `migrate --noinput`
3. 除非 `DJANGO_COLLECTSTATIC=0`，否则运行 `collectstatic --noinput`
4. 启动容器命令（生产环境为 Gunicorn）

静态文件由 WhiteNoise 提供；前端还会将 `/admin`、`/static` 和 `/media` 重写到后端。

---

## 反向代理（HTTPS）

生产环境启用 HTTPS 时，请在前端容器前放置反向代理。生产 Compose 文件将前端发布在主机 **80** 端口（容器端口 3000），因此同一主机上的代理除非修改映射，否则无法同时监听 80 端口。有两种方案：

- 保持映射不变，让 Nginx 仅监听 443，并代理到 `127.0.0.1:80`。
- 将 `docker-compose.prod.yml` 中的前端映射改为 `"127.0.0.1:3000:3000"`，代理到 `127.0.0.1:3000`，由 Nginx 占用 80 和 443 端口。

第一种方案的 Nginx server 配置示例：

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

请将你的公网来源加入 `CSRF_TRUSTED_ORIGINS` 和 `ALLOWED_HOSTS`，并设置 `SECURE_PROXY_SSL_HEADER=HTTP_X_FORWARDED_PROTO,https`。

---

## Kubernetes 说明

`k8s/` 目录包含面向 `siem-dev` 命名空间的参考清单。请根据你的集群调整名称、存储类和云厂商注解。

| 清单 | 内容 |
|---|---|
| `backend-deploy.yaml` | `siem-backend` Deployment（2 个副本）、`backend-app-init` 初始化容器、`siem-backend-app-pvc` PersistentVolumeClaim，以及 ClusterIP Service（端口 80 指向容器端口 8000） |
| `frontend-deploy.yaml` | `siem-frontend` Deployment（2 个副本），以及开放 80 和 443 端口、指向容器端口 3000 的 `LoadBalancer` Service |
| `postgres-deploy.yaml` | `siem-db` StatefulSet（PostgreSQL 16），带 20Gi 卷声明和 5432 端口的 Service |

与 Compose 不同的地方：

- 镜像按版本打标签，例如 `<registry>/siem/siem-backend:v0.81` 和 `<registry>/siem/siem-frontend:v0.81`；发布新构建时请修改标签。清单引用了镜像拉取密钥（image pull secret）；请为你的镜像仓库自行创建，并避免将凭证提交到版本控制。
- 初始化容器以 root 运行，**仅当共享 PVC 中还没有 `manage.py` 时**才复制应用，然后创建生成的工作流、静态文件和媒体目录。PVC 为 `ReadWriteMany`（10Gi），以便多个 Pod 共享。
- 每个 Pod 的 Gunicorn 使用 2 个 worker 和 8 个 `gthread` 线程；通过副本数扩展。
- 配置来自 ConfigMap `siem-config` 以及 Secret `siem-backend-secret` 和 `postgres-secret`，它们不在仓库中。前端使用 `BACKEND_ORIGIN=http://siem-backend:80`，后端使用 `POSTGRES_HOST=siem-db`。
- 环境变量规则相同：`DEBUG=False` 需要真实的 `SECRET_KEY` 和 `WORKFLOW_ENCRYPTION_KEYS`。

---

## 故障排查

### 容器启动失败

```bash
docker logs <container-name>
```

检查：`.env` 是否存在且包含所有必需变量；主机上是否有端口冲突。

### 后端因 ImproperlyConfigured 退出

| 错误信息 | 处理方式 |
|---|---|
| `SECRET_KEY must be set to a non-placeholder value when DEBUG=False.` | 设置生成的 `SECRET_KEY` |
| `ALLOWED_HOSTS must not contain "*" when DEBUG=False.` | 列出明确的主机名 |
| `WORKFLOW_ENCRYPTION_KEYS must contain at least one Fernet key when DEBUG=False.` | 生成并设置 Fernet 密钥 |
| `WORKFLOW_ENCRYPTION_KEYS contains an invalid Fernet key ...` | 替换无效密钥；每一项都必须是有效的 Fernet 密钥 |
| `OTP_HASH_SECRET must be unset or set to a non-placeholder value when DEBUG=False.` | 设置随机值或删除该变量 |
| `SECURE_PROXY_SSL_HEADER must contain exactly two comma-separated values.` | 使用 `HTTP_X_FORWARDED_PROTO,https` 的形式 |

### 数据库连接被拒绝

- 确认 `.env` 中 `POSTGRES_HOST=db`（而非 `localhost`）
- PostgreSQL 容器可能仍在初始化；Compose 文件不会等待其接受连接，请等待几秒后执行 `docker-compose -f docker-compose.<env>.yml restart backend`

### 前端无法连接后端

- 确认 `BACKEND_ORIGIN=http://backend:8000`
- 确认两个容器在同一 Docker 网络中（Compose 自动处理）

### 重新构建后后端文件看起来是旧的

后端从 `argus_backend_app` 卷运行。请使用 `make build-backend-<env>`（或 `make build-<env>`）重新构建，它会重建镜像并重新运行初始化容器，从而刷新该卷。

### 端口已被占用

```bash
# macOS / Linux
lsof -i :8000

# Windows
netstat -ano | findstr :8000
```

### 完全清理重建

```bash
make clean-rebuild-prod
# 或手动执行：
docker-compose -f docker-compose.prod.yml down --volumes --rmi all
docker-compose -f docker-compose.prod.yml up --build -d
```

> 这会删除所有卷，包括数据库。请先备份。
