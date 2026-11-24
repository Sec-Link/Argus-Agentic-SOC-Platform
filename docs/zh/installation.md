---
layout: default
title: "安装部署"
lang: zh
lang_ref: installation
---

# 安装部署

本指南介绍如何通过 Docker Compose 部署 Argus Agentic SOC Platform——这是从零到运行系统的最快路径。

## 前置条件

| 软件 | 最低版本 | 说明 |
|---|---|---|
| Docker | 24.0+ | 容器运行时 |
| Docker Compose | 2.20+ | Docker Desktop 已内置；Makefile 调用的是 `docker-compose` |
| Git | 2.30+ | 克隆仓库 |
| Make（可选） | 4.0+ | 快捷命令；Windows 可通过 `choco install make` 安装 |

## 快速启动

```bash
# 1. 克隆仓库
git clone <repository-url>
cd <cloned-folder>          # git clone 创建的目录

# 2. 创建环境变量文件
cp env.example .env

# 3. 编辑 .env — 填写必需变量（见下文）

# 4. 以开发模式构建并启动所有服务
make build-dev
# 不使用 Make 时：
# docker-compose -f docker-compose.dev.yml up --build -d

# 5. 打开应用
#    前端：     http://localhost:3000
#    后端 API： http://localhost:8000
```

`make build-dev` 会构建镜像、运行一次性的 `backend-app-init` 容器，然后启动 `backend` 和 `frontend`。它会提示共享卷 `argus_backend_app` 将被清空并替换；首次安装时没有需要保留的内容。

## 环境变量配置

复制示例文件，并在启动容器前设置所有必需变量。`env.example` 默认 `DEBUG=False`，因此除非为本地试验设置 `DEBUG=True`，否则从首次启动起就会执行下列生产安全检查。

### 必需变量

| 变量 | 说明 | 示例 |
|---|---|---|
| `SECRET_KEY` | Django 密钥；`DEBUG=False` 时不能为空或占位值（如 `env.example` 中的值） | `<随机 50+ 字符串>` |
| `DEBUG` | 调试模式；任何共享或生产环境请使用 `False` | `False` |
| `WORKFLOW_ENCRYPTION_KEYS` | 工作流密钥使用的 Fernet 密钥环，逗号分隔，第一个密钥用于加密新值。**`DEBUG=False` 时必填**，且每个密钥都必须是有效的 Fernet 密钥 | `<生成的 Fernet 密钥>` |
| `ALLOWED_HOSTS` | 逗号分隔的允许主机名；`DEBUG=False` 时不能包含 `*` | `localhost,127.0.0.1,backend` |
| `CSRF_TRUSTED_ORIGINS` | 逗号分隔的来源，不含空格，需带协议 | `http://localhost:3000` |
| `POSTGRES_DB` | PostgreSQL 数据库名 | `siem_db` |
| `POSTGRES_USER` | PostgreSQL 用户名 | `siem_user` |
| `POSTGRES_PASSWORD` | PostgreSQL 密码——请替换示例值 | `<强密码>` |
| `POSTGRES_HOST` | 数据库主机名 | `db`（Docker 服务名） |
| `POSTGRES_PORT` | 数据库端口 | `5432` |
| `BACKEND_ORIGIN` | 前端代理使用的后端地址（Prefect Worker 回调也使用） | `http://backend:8000` |

生成密钥：

```bash
# SECRET_KEY
python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"

# WORKFLOW_ENCRYPTION_KEYS（一个 Fernet 密钥）
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

> **Docker 网络：** 请设置 `POSTGRES_HOST=db`，而不是 `env.example` 中的 `localhost`。各服务通过 Compose 服务名互相解析。

> **OTP 密钥：** `env.example` 将 `OTP_HASH_SECRET` 设为占位值。`DEBUG=False` 时占位值会导致启动失败；请设置随机值，或删除该行（此时回退为 `SECRET_KEY`）。

### 可选变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `ES_HOST` | Elasticsearch 地址 | — |
| `ES_USERNAME` | Elasticsearch 用户名 | — |
| `ES_PASSWORD` | Elasticsearch 密码 | — |
| `KIBANA_BASE_URL`、`KIBANA_API_KEY`、`KIBANA_USERNAME`、`KIBANA_PASSWORD`、`KIBANA_SPACE` | Kibana Detection Engine 访问配置 | 空；space 为 `default` |
| `PREFECT_API_URL` | Prefect Server API 端点（Prefect 运行在本栈之外） | `http://127.0.0.1:4200/api` |
| `PREFECT_API_KEY` | Prefect Cloud 或带认证服务器的可选密钥 | 空 |
| `OTP_AUTH_ENABLED` | 为访客启用邮箱 OTP 登录 | `true` |
| `ADMIN_REGISTRATION_EMAILS` | 接收新注册请求通知的邮箱，逗号分隔 | 空 |
| `DJANGO_DEPLOY_CHECK` | 设为 `1` 时容器启动会运行 `manage.py check --deploy`，出现警告即失败 | `0` |
| `DJANGO_COLLECTSTATIC` | 设为 `0` 时容器启动跳过 `collectstatic` | `1` |

> 本指南旧版本中的 `REDIS_ENABLED` 和 `REDIS_URL` 不会被后端代码读取，可以省略。

### HTTPS 与 Cookie 设置

| 变量 | 说明 | 默认值 |
|---|---|---|
| `SECURE_SSL_REDIRECT` | 将 HTTP 重定向到 HTTPS | `false` |
| `SECURE_HSTS_SECONDS` | HSTS 有效期；`0` 表示禁用 | `0` |
| `SECURE_HSTS_INCLUDE_SUBDOMAINS` | HSTS 添加 `includeSubDomains` | `false` |
| `SECURE_HSTS_PRELOAD` | HSTS 添加 `preload` | `false` |
| `SESSION_COOKIE_SECURE`、`CSRF_COOKIE_SECURE` | 仅通过 HTTPS 发送 Cookie | `DEBUG=False` 时为 `true`，否则为 `false` |
| `SECURE_PROXY_SSL_HEADER` | TLS 在受信代理处终止时使用，两个逗号分隔的值，例如 `HTTP_X_FORWARDED_PROTO,https` | 未设置 |

### 邮件 / SMTP

用于 OTP 和通知邮件。

| 变量 | 说明 | 示例 |
|---|---|---|
| `EMAIL_HOST` | SMTP 服务器 | `smtp.example.com` |
| `EMAIL_PORT` | SMTP 端口 | `587` |
| `EMAIL_HOST_USER` | SMTP 用户名 | `noreply@example.com` |
| `EMAIL_HOST_PASSWORD` | SMTP 密码 | — |
| `EMAIL_USE_TLS` | 使用 TLS | `true` |
| `EMAIL_USE_SSL` | 使用 SSL | `false` |
| `DEFAULT_FROM_EMAIL` | 默认发件人地址 | `noreply@example.com` |
| `EMAIL_TIMEOUT` | SMTP 超时时间（秒） | `15` |

## 服务与端口（开发环境）

| 服务 | 容器 | 主机端口 | 容器端口 |
|---|---|---|---|
| 前端（Next.js） | `frontend` | 3000 | 3000 |
| 后端（Django） | `backend` | 8000 | 8000 |
| PostgreSQL | `postgres` | 5432 | 5432 |
| `backend-app-init` | — | — | —（运行一次后退出） |

## 验证部署

### 1. 检查容器状态

```bash
docker ps
```

应看到三个运行中的容器：`frontend`、`backend` 和 `postgres`。`backend-app-init` 容器预期不在此列表中；`docker ps -a` 会显示它已以退出码 0 退出。

### 2. 检查后端启动

```bash
docker logs backend
```

日志会显示入口脚本执行迁移和静态文件收集，然后启动服务。若出现包含 `ImproperlyConfigured` 的错误堆栈，其中会指出需要修正的设置（参见上文必需变量）。

### 3. 检查数据库连通性

```bash
docker exec -it postgres psql -U <POSTGRES_USER> -d <POSTGRES_DB> -c "SELECT 1;"
```

### 4. 查看日志

```bash
# 所有服务
docker-compose -f docker-compose.dev.yml logs -f

# 单个服务
docker logs backend
```

### 5. 创建管理员

```bash
docker exec -it backend python manage.py createsuperuser
```

## 常用 Makefile 命令

| 命令 | 说明 |
|---|---|
| `make build-dev` | 构建镜像、运行 `backend-app-init`，启动 db、backend、frontend |
| `make redeploy-dev` | 先 `down`，再重新构建并启动 |
| `make logs-dev` | 跟踪开发环境日志 |
| `make stop-dev` / `make start-dev` | 停止或恢复 db、backend、frontend（不会重新运行初始化容器） |
| `make restart-dev` | 重启所有开发容器 |
| `make clean-dev` | 删除开发容器、**卷**和镜像 |

> 每个目标都有对应的 `-prod` 版本。生产部署（Gunicorn、80 端口、加固配置）及完整目标列表请参阅 [Docker 部署]({{ '/zh/docker-deployment/' | relative_url }})。
