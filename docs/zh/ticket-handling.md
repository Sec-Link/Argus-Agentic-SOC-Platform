---
layout: default
title: "工单处理"
lang: zh
lang_ref: ticket-handling
---

# 工单处理

工单模块是 Argus 的核心事件管理组件，提供从创建到关闭的完整事件生命周期管理，内置 SLA 监控、AI 辅助分析、协作调查和 SOAR 工作流引擎。

---

## 工单管理

### 导航

点击左侧边栏的 **Tickets** 进入工单模块。

![Tickets 导航]({{ '/assets/images/ticket-handling/tickets-nav.png' | relative_url }})

### 工单列表视图

列表提供所有活跃事件的统一视图，支持过滤、排序和图表可视化。

![工单列表]({{ '/assets/images/ticket-handling/tickets-list.png' | relative_url }})

#### 核心功能

| 功能 | 说明 |
|---|---|
| **搜索栏** | 跨工单编号、标题、状态、优先级和负责人的全文搜索，支持结构化查询：`status:new priority:high owner:admin` |
| **时间范围过滤** | 快速预设（15m、1h、24h、7d、30d）或自定义时间范围 |
| **图表面板** | 按严重级别、状态、SLA 合规情况可视化分布 |
| **自动刷新** | 可配置刷新间隔（1m、5m、10m） |
| **多选过滤器** | 按严重级别、状态、负责人、SLA 段过滤 |
| **视图模式** | 切换表格视图和摘要视图 |

#### 表格列说明

| 列 | 说明 |
|---|---|
| **Ticket Number** | 唯一标识符（`SEC20260702NNNNN`） |
| **Title** | 事件简短摘要 |
| **Priority** | Critical / High / Medium / Low |
| **Status** | 当前生命周期状态（颜色编码） |
| **Owner** | 负责分析员 |
| **Created** | 创建时间戳 |
| **SLA** | MTTR 分段：`<=1h` / `1–4h` / `>4h` |

### 创建工单

![创建工单]({{ '/assets/images/ticket-handling/tickets-create.png' | relative_url }})

1. 点击列表右上角的 **Create Ticket**。
2. 填写必填字段：
   - **Title** — 事件简短摘要
   - **Priority** — Critical、High、Medium 或 Low
   - **Description** — 详细描述
   - **Assigned User** — 负责分析员
3. 按需填写可选字段：
   - **Event Category** — 如 Malware、Denial of Service、Account Anomalies
   - **Event Sources** — SIEM、EDR、Firewall
   - **Event Platform** — Windows、Linux、AWS
   - **Labels** — 用于分类和自动化的键值对
4. 点击 **Submit**。

系统自动生成唯一工单编号并开始 SLA 计时。

### 工单详情视图

点击任意工单行进入详情视图。

![工单详情]({{ '/assets/images/ticket-handling/tickets-detail.png' | relative_url }})

#### 标签页结构

| 标签页 | 内容 |
|---|---|
| **Incident** | 时间线、AI 助手面板、决策按钮栏、工单详情、标签 |
| **War Room** | 工作日志、处理日志、文件附件、证据 |
| **Evidence** | 提取的可观测指标（IP、域名、哈希） |
| **Raw Message** | 带语法高亮的原始告警 JSON |

### 工单生命周期

```
New → Acknowledged → Triaged → Contained → Resolved → Closed
```

| 状态 | 说明 |
|---|---|
| **New** | 新建，等待首次响应 |
| **Acknowledged** | 分析员已开始审阅 |
| **Triaged** | 已分类和定级 |
| **Contained** | 即时威胁已缓解 |
| **Resolved** | 根因已处理，事件完全处置 |
| **Closed** | 行政关闭 |

**更新状态 — 方式一（推荐）：决策按钮**

Incident 标签页顶部显示上下文相关的操作按钮：
- **Acknowledge** — 状态为 `New` 时可用
- **Triage** — 状态为 `Acknowledged` 时可用
- **Contain** — 状态为 `Triaged` 时可用
- **Resolve** — 状态为 `Triaged` 或 `Contained` 时可用（打开解决弹窗）

**更新状态 — 方式二：状态下拉菜单**

使用状态下拉菜单并点击 **Update Status** 手动设置任意有效状态。

**解决弹窗字段：**
- **Event Category** — 根因分类
- **Event Result** — True Positive / False Positive / True Positive - Benign
- **Notes** — 处置摘要

**待定状态（Pending）：** 切换 **Pending** 可临时暂停 SLA 计时。待定时长将从 SLA 计算中扣除。

### SLA 跟踪

| 指标 | 计算公式 | 说明 |
|---|---|---|
| **MTTA** | T3 − T2 | 平均确认时间 |
| **MTTI** | T4 − T3 | 平均调查时间 |
| **MTTC** | T5 − T2 | 平均遏制时间 |
| **MTTR** | T6 − T2 | 平均恢复时间 |

列表视图中的 SLA 颜色分段：
- **绿色** `<=1h` — 在目标范围内
- **黄色** `1–4h` — 接近违约
- **红色** `>4h` — SLA 已违约

### 战情室（War Room）

战情室整合了工单的所有调查工件。

![战情室]({{ '/assets/images/ticket-handling/tickets-warroom.png' | relative_url }})

| 区域 | 内容 |
|---|---|
| **All** | 工作日志和处理日志的合并视图 |
| **Work Logs** | 分析员注记、AI 响应、评论 |
| **Handle Logs** | 系统条目（状态变更、标签更新） |
| **Files** | 上传的文件附件 |
| **Evidence** | 收集的可观测指标和证据 |

**添加工作日志：**
1. 在底部文本区域输入内容。
2. 直接粘贴图片（Ctrl+V / Cmd+V）——自动上传并嵌入。
3. 点击 **Send**。

### AI 助手

点击 **AI Assistant**（或闪电图标）生成：
- **告警解释** — 通俗语言描述告警含义
- **风险级别建议** — 带理由的严重级别建议
- **已完成任务** — AI 已执行的操作
- **下一步任务** — 分析员建议跟进事项

**AI Chat：** 点击 **Chat** 打开针对当前工单的对话窗口，聊天历史按工单持久化保存。

**@ai 提及：** 在评论框输入 `@ai <问题>`，AI 响应将直接发布至工作日志。

**@playbook 提及：** 输入 `@playbook <名称>` 以当前工单为上下文调用工作流剧本。

### 标签与可观测指标

**标签**是用于分类和工作流自动化的键值对：
1. 进入工单详情的 **Labels** 区域。
2. 点击 **Add Label**，填写名称和值，点击 **Save**。

标签可触发工作流自动绑定，并在列表视图中用于过滤工单。

**可观测指标**是调查过程中提取的指标（IP、域名、哈希），出现在 **Evidence** 标签页，由 AI 分析或手工录入填充。

### 批量操作

勾选多个工单后，可执行批量操作：

| 操作 | 说明 |
|---|---|
| **Batch Update Status** | 同时更改所有选中工单的状态 |
| **Batch Assign** | 重新分配给其他分析员 |
| **Batch Delete** | 软删除选中工单（记录保留用于审计） |

---

## 工作流（SOAR）

工作流模块是 SOAR 编排引擎，用于自动化重复性任务、编排多步骤响应流程并与外部工具集成。

**导航路径：** `Settings → Workflows`

![工作流导航]({{ '/assets/images/ticket-handling/workflows-nav.png' | relative_url }})

### 工作流列表视图

![工作流列表]({{ '/assets/images/ticket-handling/workflows-list.png' | relative_url }})

顶部四个汇总卡片：**Total Workflows**、**Active**、**Total Executions**、**Success Rate**。

#### 快捷操作

| 按钮 | 操作 |
|---|---|
| ▶ Execute | 手动触发（仅限活跃工作流） |
| ⏸ Stop | 取消正在运行的执行 |
| 🔀 Visual Editor | 打开拖拽式编辑器 |
| 📋 Clone | 复制工作流 |
| ☁ Publish | 将清单发布到 Prefect |
| 🗑 Delete | 确认后删除 |

### 可视化工作流编辑器

![可视化编辑器]({{ '/assets/images/ticket-handling/workflow-visual-editor.png' | relative_url }})

点击 **Create Visual Workflow** 或已有工作流上的分支图标进入编辑器。

#### 构建工作流

1. 设置工作流名称。
2. 选择触发器类型。
3. 从左侧面板拖拽动作节点到画布。
4. 拖动节点连接点连接各节点。
5. 点击节点并在右侧面板填写配置。
6. 点击 **Save** 保存为草稿。

#### 节点类型

| 类型 | 说明 |
|---|---|
| **Start** | 入口节点 |
| **End** | 出口节点 |
| **Action** | 执行特定动作（封锁 IP、发送邮件等） |
| **Condition** | 评估条件，分叉为 True/False 路径 |

### 触发器类型

| 触发器 | 说明 | 配置项 |
|---|---|---|
| **Manual** | 按需手动执行 | 无需配置 |
| **On Alert Created** | 新告警接入时触发 | JSON 过滤条件 |
| **On Ticket Created** | 新工单创建时触发 | JSON 过滤条件 |
| **On Ticket Status Change** | 工单状态变更时触发 | JSON 过滤条件 |
| **Scheduled** | 按定时计划执行 | Cron 表达式 |
| **Webhook** | 外部 HTTP 调用触发 | 自动提供 Webhook URL |

**过滤条件示例** — 仅针对高优先级恶意软件事件触发：

```json
{
  "priority": ["critical", "high"],
  "event_category": ["malware"]
}
```

### 执行历史

![工作流执行记录]({{ '/assets/images/ticket-handling/workflows-executions.png' | relative_url }})

导航至 `Settings → Workflows → View Executions`。

点击执行记录可查看分步时间线、错误详情、累积上下文变量和完整执行日志。

### Cron 定时示例

| 表达式 | 含义 |
|---|---|
| `*/15 * * * *` | 每 15 分钟 |
| `0 */4 * * *` | 每 4 小时 |
| `0 8 * * 1-5` | 工作日 08:00 |
| `0 0 * * *` | 每天午夜 |

### 工单-工作流绑定

绑定允许工作流根据工单标签自动触发：

1. 在工作流的 **Ticket Labels** 列配置标签过滤器。
2. 选择逻辑：**AND**（所有标签必须匹配）或 **OR**（任意标签匹配即可）。

当工单事件发生时，系统评估所有活跃绑定，以工单为触发上下文分发匹配的工作流。

### 从工单调用剧本

启用了 **Is Callable from Ticket** 的工作流可直接从工单详情触发。

**方式一 — @playbook 命令：** 在评论框输入 `@` 并从下拉列表选择剧本，点击 **Send** 调用。

**方式二 — 剧本面板：** 在工单详情中打开剧本区域，点击 **Invoke**。

每个工单在 **Workplan** 中显示所有关联的工作流执行记录，包含状态、进度和时间戳。
