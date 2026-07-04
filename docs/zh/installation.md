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
| Docker Compose | 2.20+ | Docker Desktop 已内置 |
| Git | 2.30+ | 克隆仓库 |
| Make（可选） | 4.0+ | 快捷命令；Windows 可通过 `choco install make` 安装 |

## 快速启动

```bash
# 1. 克隆仓库
git clone <repository-url>
cd ECHO-SOC-Platform

# 2. 创建环境变量文件
cp env.example .env

# 3. 编辑 .env，填写必填变量（见下文）

# 4. 以开发模式构建并启动所有服务
docker-compose -f docker-compose.dev.yml up --build -d

# 5. 打开应用
#    前端：    http://localhost:3000
#    后端 API：http://localhost:8000
```

## 环境变量配置

启动容器前，请复制示例文件并填写所有必填变量。

### 必填变量

| 变量 | 说明 | 示例值 |
|---|---|---|
| `SECRET_KEY` | Django 密钥（强随机字符串） | `change-me-in-production` |
| `DEBUG` | 是否启用调试模式 | `False` |
| `ALLOWED_HOSTS` | 逗号分隔的允许主机名 | `localhost,127.0.0.1` |
| `POSTGRES_DB` | PostgreSQL 数据库名 | `siem_db` |
| `POSTGRES_USER` | PostgreSQL 用户名 | `siem_user` |
| `POSTGRES_PASSWORD` | PostgreSQL 密码 | `siem_password` |
| `POSTGRES_HOST` | 数据库主机名 | `db`（Docker 服务名） |
| `POSTGRES_PORT` | 数据库端口 | `5432` |
| `BACKEND_ORIGIN` | 前端调用后端 API 的 URL | `http://backend:8000` |

> **Docker 网络说明：** 必须设置 `POSTGRES_HOST=db`，而非 `localhost`。两个服务共享同一 Docker Compose 网络，通过服务名互相解析。

### 可选变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `ES_HOST` | Elasticsearch 地址 | `http://localhost:9200` |
| `ES_USERNAME` | Elasticsearch 用户名 | `elastic` |
| `ES_PASSWORD` | Elasticsearch 密码 | — |
| `PREFECT_API_URL` | Prefect Server API 端点 | `http://127.0.0.1:4200/api` |
| `REDIS_ENABLED` | 是否启用 Redis 缓存 | `false` |
| `REDIS_URL` | Redis 连接 URL | `redis://localhost:6379/0` |

### 邮件 / SMTP 配置

| 变量 | 说明 | 示例值 |
|---|---|---|
| `EMAIL_HOST` | SMTP 服务器 | `smtp.gmail.com` |
| `EMAIL_PORT` | SMTP 端口 | `587` |
| `EMAIL_HOST_USER` | SMTP 用户名 | `noreply@example.com` |
| `EMAIL_HOST_PASSWORD` | SMTP 密码 | — |
| `EMAIL_USE_TLS` | 是否启用 TLS | `true` |
| `DEFAULT_FROM_EMAIL` | 默认发件人地址 | `noreply@example.com` |

## 服务端口（开发模式）

| 服务 | 主机端口 | 容器端口 |
|---|---|---|
| 前端（Next.js） | 3000 | 3000 |
| 后端（Django） | 8000 | 8000 |
| PostgreSQL | 5432 | 5432 |

## 验证部署

### 1. 检查容器状态

```bash
docker ps
```

应看到三个运行中的容器：`frontend`、`backend`、`postgres`。

### 2. 检查后端健康状态

```bash
curl http://localhost:8000/api/
```

### 3. 检查数据库连接

```bash
docker exec -it postgres psql -U siem_user -d siem_db -c "SELECT 1;"
```

### 4. 查看日志

```bash
# 所有服务
docker-compose -f docker-compose.dev.yml logs -f

# 单个服务
docker logs backend
```

## 常用 Makefile 命令

| 命令 | 说明 |
|---|---|
| `make build-dev` | 构建并启动开发容器 |
| `make redeploy-dev` | 停止、重建并重启 |
| `make logs-dev` | 跟踪开发日志 |
| `make clean-dev` | 删除所有开发容器、卷和镜像 |

> 如需生产环境部署（Gunicorn、端口 80、加固配置），请参阅 [Docker 部署]({{ '/zh/docker-deployment/' | relative_url }})。
