---
layout: default
title: "项目总览"
lang: zh
lang_ref: overview
---

# Argus — 智能 SOC 平台

Argus 是一款 AI 原生的安全运营中心（SOC）平台，将告警接入、事件调查、检测工程与自动化响应整合在统一的操作界面中。平台面向现代安全团队设计，以 AI 智能体和灵活的 SOAR 引擎为驱动，取代碎片化工具链，构建以证据为核心的连贯工作流。

## 核心能力

| 能力模块 | 说明 |
|---|---|
| **统一告警接入** | 通过可配置的数据管道连接 Elasticsearch（ELK）、Splunk 及其他告警源 |
| **AI 辅助调查** | 每个工单内置 AI 助手，提供告警解释、风险评估、IOC 提取和建议处置步骤 |
| **AI 技能（Skills）** | Markdown 技能（SKILL.md），AI 助手在告警或对话内容匹配时自动选用；技能库内置十个调查类技能 |
| **检测工程管理** | Sigma 规则库，含字段映射管理、多后端发布（Splunk、Elastic）及发布历史审计 |
| **检测覆盖** | 日志源覆盖与 MITRE ATT&CK 技术覆盖，在仪表盘中配置与查看 |
| **自动化响应（SOAR）** | 可视化工作流编辑器，支持无代码剧本构建、定时调度、Webhook 触发及 Prefect 编排 |
| **接口（Interfaces）** | 供工作流使用的受管端点，提供调用日志与手动测试调用 |
| **SLA 跟踪** | 自动计算 MTTA / MTTI / MTTC / MTTR，以颜色编码形式直观展示合规状态 |
| **协作战情室** | 每个工单均有独立的分析师注记、文件证据、处理日志及 AI 任务区域 |
| **报告** | Report Designer：实时 SOC 指标、图表、基于占位符的 Markdown 模板，支持 Markdown / PDF 导出 |
| **MCP 工具框架** | 基于模型上下文协议（MCP）的可扩展工具层，支持 AI 智能体在运行时调用外部安全工具 |
| **访问控制与审计** | 用户、用户组、按权限的 RBAC、访客（只读）账号、注册审批与审计日志 |

## 平台架构

```
┌─────────────────────────────────────────────────────────┐
│                      Argus 平台架构                      │
├──────────────┬──────────────────┬───────────────────────┤
│    前端      │      后端        │       数据管道         │
│  (Next.js)   │  (Django REST)   │  ES → Orchestrator →  │
│  Port 3000   │   Port 8000      │  Correlation → 告警    │
└──────────────┴────────┬─────────┴───────────────────────┘
                        │
            ┌───────────┼───────────┐
            │           │           │
        PostgreSQL    AI 层       Prefect
        (数据持久化) (OpenAI     (工作流
                     兼容接口)   编排引擎)
```

平台通过 Docker Compose 部署。Compose 栈包含前端、后端、PostgreSQL，以及一个短生命周期的 `backend-app-init` 容器：它把后端应用复制到共享卷 `argus_backend_app` 后即退出。Prefect Server 与 Prefect Worker **不在** Compose 栈内，属于外部服务，后端通过 `PREFECT_API_URL` 访问。详见 [Docker 部署]({{ '/zh/docker-deployment/' | relative_url }})。

## 模块索引

| 编号 | 模块 | 用途 |
|---|---|---|
| 1 | **项目总览** | 平台介绍与导航指引（本页） |
| 2 | **安装部署** | 基于 Docker 的快速启动部署 |
| 3 | **仪表盘** | 实时监控概览与告警统计 |
| 4 | **检测覆盖** | 日志源与 MITRE ATT&CK 覆盖 |
| 5 | **工单处理** | 事件生命周期管理、SLA 跟踪、战情室、工作流 |
| 6 | **告警管理** | 告警接入、列表查看、分类处理与关联分析 |
| 7 | **资产管理** | 资产清单与资产关联 |
| 8 | **用例管理** | Sigma 规则库、字段映射、发布历史 |
| 9 | **数据接入** | ELK 集成配置、Orchestrator 调度、关联策略 |
| 10 | **自动化** | Interfaces、Workflows 与工作流 Executions |
| 11 | **报告** | Report Designer、占位符、Markdown 与 PDF 导出 |
| 12 | **AI 智能体** | AI 助手配置、MCP 工具管理、技能管理 |
| 13 | **Docker 部署** | Docker Compose 编排、生产配置、Kubernetes 说明 |

## 快速参考

| 项目 | 说明 |
|---|---|
| 平台地址 | `https://siem.seclink.info/` |
| 登录方式 | **Internal Login**（用户名或邮箱 + 密码）或 **Guest Login**（邮箱 OTP，只读） |
| 默认登陆页 | `Monitoring → Overview`（仪表盘） |
| 适用对象 | SOC 分析员、检测工程师、SIEM 管理员 |

> 登录后系统默认进入 **Dashboard Overview** 页面。若尚未配置数据源，所有统计指标将显示为零。请前往[数据接入]({{ '/zh/data-onboarding/' | relative_url }})完成首个数据源的接入配置。
