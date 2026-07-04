---
layout: default
title: "Docker 部署"
lang: zh
lang_ref: docker-deployment
---

# Docker 部署

本指南涵盖 Argus Agentic SOC Platform 的生产级 Docker Compose 部署，包括服务架构、生产加固、运维管理和故障排查。

> 如需最简快速启动，请参阅[安装部署]({{ '/zh/installation/' | relative_url }})。

## 服务架构

平台由三个容器化服务组成：

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    前端      │────▶│    后端      │────▶│  PostgreSQL  │
│  (Next.js)   │     │  (Django)    │     │   数据库     │
│  Port 3000   │     │  Port 8000   │     │  Port 5432   │
└──────────────┘     └──────────────┘     └──────────────┘
```

| 服务 | 技术栈 | 职责 |
|---|---|---|
| **前端** | Next.js 16（独立 Node.js 服务器） | UI 渲染与客户端交互 |
| **后端** | Django 6 + Gunicorn（生产 4 工作进程） | REST API、业务逻辑、后台任务 |
| **数据库** | PostgreSQL 16 | 持久化数据存储 |

---

## 开发环境 vs. 生产环境

| 方面 | 开发环境 | 生产环境 |
|---|---|---|
| 后端服务器 | Django 开发服务器 | Gunicorn（4 工作进程） |
| 前端端口 | 3000 | 80 |
| `DEBUG` | `True` | `False`（必须） |
| 卷挂载 | 挂载后端源码（热重载） | 无（不可变镜像） |
| Compose 文件 | `docker-compose.dev.yml` | `docker-compose.prod.yml` |

---

## 生产环境部署

### 启动服务

```bash
docker-compose -f docker-compose.prod.yml up --build -d
```

### 服务端口（生产环境）

| 服务 | 主机端口 | 容器端口 | 说明 |
|---|---|---|---|
| 前端 | 80 | 3000 | 直接 HTTP 访问 |
| 后端 | 8000 | 8000 | Gunicorn，4 工作进程 |
| PostgreSQL | 5432 | 5432 | 建议移除对外暴露 |

### 查看日志

```bash
docker-compose -f docker-compose.prod.yml logs -f
```

### 停止服务

```bash
docker-compose -f docker-compose.prod.yml down
```

---

## 生产加固检查清单

在将平台暴露给生产流量之前：

- [ ] 在 `.env` 中设置 `DEBUG=False`
- [ ] 生成强随机 `SECRET_KEY`：
  ```bash
  python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
  ```
- [ ] 将 `ALLOWED_HOSTS` 限制为实际域名（如 `siem.example.com`）
- [ ] 设置 `CSRF_TRUSTED_ORIGINS` 为生产域名
- [ ] 如不需要外部数据库访问，从 `docker-compose.prod.yml` 中移除端口 `5432` 的对外暴露
- [ ] 在前端容器前部署 TLS 终止反向代理（Nginx、Traefik）
- [ ] 首次部署前轮换 `.env` 中的所有默认密码
- [ ] 确认 `.env` 未被提交到版本控制（检查 `.gitignore`）

---

## 环境变量配置

所有运行时配置均通过 `.env` 文件控制。复制示例文件并填写：

```bash
cp env.example .env
```

### 生产环境必填变量

| 变量 | 生产推荐值 |
|---|---|
| `SECRET_KEY` | 50 位以上的随机字符串 |
| `DEBUG` | `False` |
| `ALLOWED_HOSTS` | `yourdomain.com,www.yourdomain.com` |
| `POSTGRES_DB` | `siem_db` |
| `POSTGRES_USER` | `siem_user` |
| `POSTGRES_PASSWORD` | 强密码 |
| `POSTGRES_HOST` | `db` |
| `BACKEND_ORIGIN` | `http://backend:8000` |

---

## 运维管理

### Makefile 快速参考

| 命令 | 说明 |
|---|---|
| `make build-prod` | 构建并启动生产容器 |
| `make redeploy-prod` | 停止、重建并重启 |
| `make logs-prod` | 跟踪生产日志 |
| `make restart-prod` | 重启所有生产容器 |
| `make clean-prod` | 删除所有容器、卷和镜像 |
| `make clean-rebuild-prod` | 完整清理 + 重建 |

### 重启单个服务

```bash
docker-compose -f docker-compose.prod.yml restart backend
```

### 重建单个服务

```bash
docker-compose -f docker-compose.prod.yml up --build -d backend
```

### 执行 Django 管理命令

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
docker exec postgres pg_dump -U siem_user siem_db > backup_$(date +%Y%m%d).sql
```

### 恢复

```bash
docker exec -i postgres psql -U siem_user siem_db < backup_20260704.sql
```

### 数据持久化

PostgreSQL 数据存储在名为 `postgres_data` 的 Docker 卷中。执行 `docker-compose down` 后数据持久保留，但执行 `docker-compose down --volumes` 时数据会**被删除**。

> 在执行任何 `down --volumes` 或 `clean` 命令前，请务必完成非宿主机外部备份。

---

## 自动启动行为

每次容器启动时，后端入口脚本自动执行：
1. 运行 `makemigrations` 和 `migrate` 以应用待处理的 schema 变更
2. 运行 `collectstatic --noinput` 以收集前端静态资源

如需禁用静态文件收集，在 `.env` 中设置 `DJANGO_COLLECTSTATIC=0`。

---

## 反向代理（HTTPS）

生产 HTTPS 配置需在前端容器前部署反向代理。Nginx 配置示例：

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

## 故障排查

### 容器启动失败

```bash
docker logs <容器名称>
```

检查：`.env` 是否存在且包含所有必填变量；主机端口是否被占用。

### 数据库连接拒绝

- 确认 `.env` 中 `POSTGRES_HOST=db`（不是 `localhost`）
- PostgreSQL 容器可能仍在初始化——等待几秒后重试，或在 `docker-compose.yml` 中添加健康检查

### 前端无法连接后端

- 确认 `BACKEND_ORIGIN=http://backend:8000`
- 确认两个容器在同一 Docker 网络（Compose 自动处理）

### 端口被占用

```bash
# macOS / Linux
lsof -i :8000

# Windows
netstat -ano | findstr :8000
```

### 完整清理重建

```bash
make clean-rebuild-prod
# 或手动执行：
docker-compose -f docker-compose.prod.yml down --volumes --rmi all
docker-compose -f docker-compose.prod.yml up --build -d
```
