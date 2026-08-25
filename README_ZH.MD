<div align="center">

### Argus - 开源 Agentic SOC 平台

[🚀在线演示](https://siem.seclink.info) · [📖 文档](https://sec-link.github.io/Argus-Agentic-SOC-Platform/) · [⭐ GitHub](https://github.com/Sec-Link/Argus-Agentic-SOC-Platform)
</div>

<p align="center">
    <a href="https://github.com/Sec-Link/Argus-Agentic-SOC-Platform/releases" target="_blank">
        <img alt="Release" src="https://img.shields.io/github/v/release/Sec-Link/Argus-Agentic-SOC-Platform"></a>
    <a href="https://github.com/Sec-Link/Argus-Agentic-SOC-Platform/graphs/commit-activity" target="_blank">
        <img alt="commit activity " src="https://img.shields.io/github/commit-activity/m/Sec-Link/Argus-Agentic-SOC-Platform?style=flat-square"></a>
    <a href="https://github.com/Sec-Link/Argus-Agentic-SOC-Platform/" target="_blank">
        <img alt="Issues closed" src="https://img.shields.io/github/issues-closed/Sec-Link/Argus-Agentic-SOC-Platform"></a>
</p>

<p align="center">
  <a href="./README.md"><img alt="English" src="https://img.shields.io/badge/English-d9d9d9"></a>
  <a href="./README_ZH.MD"><img alt="Chinese" src="https://img.shields.io/badge/中文-d9d9d9"></a>
</p>



## 概述

**Argus** 是一个面向现代安全运营的开源 **AI 原生 Agentic SOC 平台**。
你可以将其作为完整 SOC 平台部署，也可以集成到现有的安全生态中。

它提供了完整的安全运营基础能力：

- ✅AI 驱动调查分析
- ✅安全工作流自动化
- ✅告警与事件管理
- ✅威胁情报增强
- ✅资产上下文管理

同时，Argus 采用 **松耦合且 API-First 的架构**，支持组织：

- ✅通过自定义安全能力扩展 Argus
- ✅将 Argus 集成进现有 SOC 生态

---
## 1. 产品组件

该平台将 SOC 核心对象整合到一个产品中，并结合开源方案：
<img width="1677" height="1677" alt="Argus Framework" src="https://github.com/user-attachments/assets/c355fbd7-f2a4-496b-9724-7c61b2826c3c" />


- **Alerts**：告警接入、缓存、检索与展示
- **Tickets**：事件/工单管理与协作
- **CMDB**：资产清单与上下文关联
- **Dashboards**：运营看板与可视化
- **Correlation**：关联规则与分析
- **Workflows / Orchestrator**：自动化与调度
- **AI Assistant**：面向安全的智能分析与 MCP 工具集成

---

## 2. 核心能力

### 安全运营
- 统一告警接入与分页列表
- 工单全生命周期与活动历史
- 基于看板的运营视图
<img width="1898" height="906" alt="Tickets" src="https://github.com/user-attachments/assets/459b590c-48b4-4217-b6f7-bbe865677378" />


### 检测
- 开箱即用的检测用例与关联规则
- Detection-as-code 与规则版本化
- 基于 Sigma 规则的一次编写、处处运行检测
<img width="1880" height="866" alt="detection" src="https://github.com/user-attachments/assets/aec94f40-24ff-4b4e-9c2f-e4e9889555b2" />

### 自动化
- 工作流编排与 API 驱动调用
- 定时任务执行与审计日志
- 面向工单/告警的自动化链路
<img width="947" height="450" alt="workflow" src="https://github.com/user-attachments/assets/feb61467-63f2-46d2-812e-69e19b032074" />

### AI 功能
- 内置 AI Assistant 对话式界面
- MCP 风格工具注册表与 JSON-RPC 连接器
- 基于工单上下文的查询、相似案例检索、CMDB 查询与可观测对象提取

<img width="527" height="413" alt="AI Features" src="https://github.com/user-attachments/assets/9ee9875d-e410-4afb-806d-661041df6d2f" />

---

## 3. 系统架构图

### 架构说明

1. 前端层：基于 Next.js App Router 构建；负责页面、UI 组合与 API 代理。
2. API 层：Django + DRF 提供统一业务 API（认证、告警、工单、CMDB、工作流、AI）。
3. 业务层：领域能力按 Django apps 组织，支持独立演进与 RBAC。
4. 数据层：PostgreSQL 为主存储；Elasticsearch 可作为可选告警源。
5. 智能层：AI Assistant 提供对话与工具调用能力，暴露 MCP 风格接口。
6. 自动化层：Orchestrator 与 Workflows 提供定时执行、编排与审计追踪。

**更多信息：**
https://github.com/Sec-Link/Argus-Agentic-SOC-Platform/blob/main/docs/architecture.md

---

## 4. 技术栈

### 前端
- Next.js 15
- React 18
- Ant Design 5

### 后端
- Django 6
- Django REST Framework
- DRF Token Authentication

### 数据 / 基础设施
- PostgreSQL 16（可选）
- Elasticsearch（可选）

---

## 5. 仓库结构

```text
Argus-Agentic-SOC-Platform/
├── backend/                  # Django 后端
│   ├── accounts/
│   ├── alerts/
│   ├── ai_assistant/
│   ├── cmdb/
│   ├── correlation/
│   ├── dashboards/
│   ├── integrations/
│   ├── orchestrator/
│   ├── tickets/
│   ├── workflow_interfaces/
│   ├── workflows/
│   └── siem_project/         # Django 项目 settings / urls
├── frontend/                 # Next.js 前端
│   └── src/
│       ├── app/
│       ├── components/
│       ├── modules/
│       ├── services/
│       └── lib/
├── k8s/                      # Kubernetes 清单
├── docker-compose.dev.yml    # 开发环境 compose
├── docker-compose.prod.yml   # 生产环境 compose
├── env.example               # 环境变量模板
└── makefile                  # 辅助命令
```

---

## 6. 用户手册
https://sec-link.github.io/Argus-Agentic-SOC-Platform/zh/overview/

## 7. API 与访问

后端使用 `/api/v1/` 作为 API 前缀，主要模块包括：

- `/api/v1/auth/`：登录、登出、注册、OTP
- `/api/v1/alerts/`：告警能力
- `/api/v1/tickets/`：工单能力
- `/api/v1/cmdb/`：资产管理
- `/api/v1/workflows/`：工作流能力
- `/api/v1/integrations/`：集成配置与测试
- `/api/v1/ai-assistant/`：AI 助手与工具能力
- `/api/v1/mcp/`：MCP JSON-RPC 与工具注册表

前端通过 Next.js route handler 将 `/api/v1/*` 请求代理到后端服务，统一浏览器侧 API 访问入口。

**更多信息：**
https://github.com/Sec-Link/Argus-Agentic-SOC-Platform/blob/main/docs/api-overview.md

---

## 8. 部署

### Docker Compose
- `docker-compose.dev.yml`：本地开发
- `docker-compose.prod.yml`：生产容器部署

### Kubernetes
`k8s/` 目录包含基础部署清单：

- `k8s/backend-deploy.yaml`
- `k8s/frontend-deploy.yaml`
- `k8s/postgres-deploy.yaml`

---

## 9. 安全与加固

生产环境建议：

- 使用安全随机的 `SECRET_KEY`
- 精确设置 `ALLOWED_HOSTS` 与 `CSRF_TRUSTED_ORIGINS`
- 为数据库、对象存储与日志添加备份和监控
- 为 AI/MCP 功能配置访问边界、审计与最小权限

## 10. 贡献
欢迎贡献！请参考我们的 [CONTRIBUTING.md](https://github.com/Sec-Link/Argus-Agentic-SOC-Platform/blob/main/CONTRIBUTING.md) 获取更多信息。

欢迎加入社区，共同让项目更强大、更可靠、更易用。如果 Argus 对你有帮助，欢迎在 GitHub 给我们点个 ⭐ 并分享给更多人。让我们一起构建更安全的数字世界。


**贡献者**


<a href="https://github.com/Sec-Link/Argus-Agentic-SOC-Platform/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Sec-Link/Argus-Agentic-SOC-Platform" />
</a>

---
