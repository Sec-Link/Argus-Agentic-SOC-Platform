---
layout: default
title: "工单处理"
lang: zh
lang_ref: ticket-handling
---

# 工单处理

工单模块是 Argus 的核心事件管理组件，提供从创建到关闭的完整事件生命周期管理，内置 SLA 监控、AI 辅助分析和协作调查。自动化响应由自动化模块负责，本页末尾提供概览。

**导航路径：** `Investigation → Tickets`

---

## 工单管理

### 导航

点击左侧边栏 **Investigation** 下的 **Tickets**。页面标题为 **Incidents**。

![Tickets 导航]({{ '/assets/images/ticket-handling/tickets-nav.png' | relative_url }})
<!-- TODO screenshot: assets/images/ticket-handling/tickets-nav.png (sidebar now groups Tickets under Investigation; recapture) -->

### 工单列表视图

列表提供统一的事件视图，支持过滤、搜索和图表可视化。标题处显示 `Showing N of M incidents`。

![工单列表]({{ '/assets/images/ticket-handling/tickets-list.png' | relative_url }})
<!-- TODO screenshot: assets/images/ticket-handling/tickets-list.png (recapture if the filter bar, charts or batch toolbar differ) -->

#### 核心功能

| 功能 | 说明 |
|---|---|
| **New Incident** / **Refresh** | 右上角按钮：创建工单、重新加载列表 |
| **Severity**、**Status**、**Owner**、**SLA** 过滤器 | 多选下拉框，每个选项显示数量，例如 `High (12)`。同一过滤器内的选项为“或”关系，不同过滤器之间为“且”关系 |
| **搜索** | 占位提示为 `Search in Incidents (e.g. status:pending owner:alice)`。自由文本匹配工单编号、标题、状态、优先级和负责人；`status:`、`priority:`、`owner:` 条件按精确值过滤；其他 `key:value` 形式按自由文本处理 |
| **Time Range** | `Last 15 Mins`、`Last 1 Hour`、`Last 24 Hours`、`Last 7 Days`、`Last 30 Days` 或 `Custom Range` |
| **Refresh every** | `Off`（默认）、`1m`、`5m` 或 `10m` 自动刷新 |
| **Table View** / **Summary View** | 在表格和仅图表的摘要之间切换 |
| **图表卡片** | **Severity**、**Status**、**SLA**、**Owner** 饼图，中心显示 **Total**；图表随搜索和时间范围变化 |

**仪表盘链接：** 仪表盘等页面通过地址打开预先过滤的列表：

| 链接 | 效果 |
|---|---|
| `/tickets?status=open` | 状态过滤为 New、Acknowledged、Triaged 和 Contained |
| `/tickets?status=new,resolved` | 状态过滤为所列的值 |
| `/tickets?priority=critical,high` | 严重级别过滤为所列的值 |
| `/tickets?result=true_positive` | 仅显示 Event Result 为 `true_positive` 的工单 |

#### 表格列说明

| 列 | 说明 |
|---|---|
| **ID** | 唯一工单编号（`SECYYYYMMDDNNNNN`）；点击打开详情视图 |
| **Name** | 事件简短摘要 |
| **Severity** | Critical / High / Medium / Low |
| **Status** | 当前生命周期状态（颜色编码） |
| **Owner** | 负责分析员，未分配显示 `Unassigned` |
| **SLA** | `TTA:<确认耗时> / TTR:<解决耗时>` |
| **MITRE ATT&CK** | 来自触发检测规则的最多三个战术标签，加上 `+N` 计数；没有时显示 `—` |
| **Created** | 创建时间戳 |

#### 批量操作

勾选一行或多行即可启用表格上方的工具栏，并显示 `N selected`。

| 操作 | 说明 |
|---|---|
| **Assign** | 将所选工单分配给一名用户 |
| **Edit** | 同时为所选工单设置 Owner、Severity（priority）和 Status 中的任意项 |
| **Export** | 将所选工单下载为 CSV（编号、标题、状态、优先级、负责人、创建和更新时间，以及以秒为单位的 MTTA、MTTI、MTTC、MTTR） |
| **Close** | 确认后将所选工单设为 Closed |
| **Delete** | 确认后软删除所选工单（记录保留用于审计） |

### 创建工单

大多数工单由告警自动创建（见本页末尾）。手动创建：

![创建工单]({{ '/assets/images/ticket-handling/tickets-create.png' | relative_url }})
<!-- TODO screenshot: assets/images/ticket-handling/tickets-create.png (outdated: the dialog is now titled New Incident with the fields below) -->

1. 点击列表右上角的 **New Incident**。
2. 填写 **New Incident** 对话框：

| 字段 | 说明 |
|---|---|
| **Created By** | 必填；默认为你的用户名 |
| **SIEM Event ID (optional)** | 来源事件的标识符 |
| **Title** | 必填 |
| **Description** | 可选 |
| **Priority** | `Critical`、`High`、`Medium`（默认）或 `Low` |

3. 确认。页面显示 `Incident created`，并打开工单详情。

工单以 **New** 状态创建，SLA 计时随即开始。事件类别和标签在详情视图中设置。

### 工单详情视图

点击任意工单 ID 进入详情视图；**Back to List** 返回列表。

![工单详情]({{ '/assets/images/ticket-handling/tickets-detail.png' | relative_url }})
<!-- TODO screenshot: assets/images/ticket-handling/tickets-detail.png (recapture: tabs are Incident Info, War Room, Work Plan, Evidence, Related Incidents) -->

#### 标签页结构

| 标签页 | 内容 |
|---|---|
| **Incident Info** | 子标签页 **Timeline**、**Alerts**、**Raw Message**（带语法高亮的原始告警 JSON）和 **Tasks**；证据、列出该工单工作流运行的 **Work Plan** 卡片以及评论框；右侧栏包含 **Case Details**、**Decision Actions**、**Resolution Summary**、**Labels**、**AI Summary**、**SOC AI Assistant** 和 **AI Tasks** |
| **War Room** | 工作日志、处理日志、文件和证据 |
| **Work Plan** | 占位页（`No work plan items yet`）；该工单的工作流运行显示在 **Incident Info** 的 **Work Plan** 卡片中 |
| **Evidence** | 附件，以及由 AI 分析提取的可观测指标（IP、域名、哈希） |
| **Related Incidents** | 占位页（`No related incidents yet`） |

页头还有 **Pending**（见下文）和 **Refresh** 按钮。

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

右侧栏的 **Decision Actions** 推进工单状态，每个按钮仅在对应状态下可用：

- **Acknowledge** — 状态为 `New` 时可用
- **Triaged** — 状态为 `Acknowledged` 时可用
- **Contained** — 状态为 `Triaged` 时可用
- **Resolved** — 状态为 `Triaged` 或 `Contained` 时可用；打开 **Resolve Ticket** 对话框

工单通过列表中的批量 **Close** 操作变为 **Closed**，批量 **Edit** 操作可设置任意状态。

**Resolve Ticket 对话框字段：**
- **Event Category** — 根因分类
- **Event Result** — 研判结论，例如 True Positive 或 False Positive
- **Notes** — 可选的处置摘要

所选类别和结论随后会在 **Resolution Summary** 中显示为 **Ticket Category** 和 **Ticket Verdict**。

**待定状态（Pending）：** **Pending** 按钮（工单被确认后、关闭前可用）可暂停 SLA 计时；此时按钮显示为 **In Progress**，再次点击可切换回来。待定时长将从 SLA 计算中扣除。工单处于待定状态时，无法添加 War Room 记录。

### SLA 跟踪

| 指标 | 计算公式 | 说明 |
|---|---|---|
| **MTTA** | T3 − T2 | 平均确认时间 |
| **MTTI** | T4 − T3 | 平均调查时间 |
| **MTTC** | T5 − T2 | 平均遏制时间 |
| **MTTR** | T6 − T2 | 平均恢复时间 |

列表将 MTTA 显示为 `TTA`，将 MTTR 显示为 `TTR`。**SLA** 过滤器和图表按 MTTR 对工单分组：
- **绿色** `<=1h` — 在目标范围内
- **黄色** `1-4h` — 接近违约
- **红色** `>4h` — SLA 已违约
- `n/a` — 尚未解决

### 战情室（War Room）

战情室整合了工单的所有调查工件。

![战情室]({{ '/assets/images/ticket-handling/tickets-warroom.png' | relative_url }})

| 区域 | 内容 |
|---|---|
| **All** | 工作日志和处理日志的合并视图 |
| **Work Logs** | 分析员笔记、AI 回复、评论 |
| **Handle Logs** | 系统记录（状态变更、标签更新） |
| **Files** | 已上传的附件 |
| **Evidence** | 收集的可观测指标和证据 |

**添加工作日志：**
1. 在底部文本框中输入内容。
2. 直接粘贴图片（Ctrl+V / Cmd+V）——自动上传并嵌入。
3. 点击 **Send**。

### AI 助手

在右侧栏中，**SOC AI Assistant** 提供：
- **Run AI Assistant** — 生成告警解读和摘要，显示在 **AI Summary** 中，后续事项显示在 **AI Tasks** 中，提取的可观测指标显示在 **Evidence** 中
- **Chat** — 打开限定于当前工单的交互式对话

**@ai 提及：** 在评论框中输入 `@ai <问题>`，AI 的回复会直接发布到工作日志。

**@playbook 提及：** 输入 `@` 或 `@playbook` 列出可从工单调用的工作流，选择一个后点击 **Send**。结果会记录到工作日志，运行情况显示在 **Incident Info** 的 **Work Plan** 卡片中。如果没有可用于工单的工作流，列表显示 `No callable playbooks`。

### 标签

**Labels** 是用于对工单分类的名称/值对。

1. 打开右侧栏的 **Labels** 卡片。
2. 输入 **Label name** 和可选的 **Label value (optional)**，然后点击 **Add**。

工作流也可以使用标签（见下文）。

---

## 自动化概览

自动化是独立模块，位于 `Automation → Workflows`，并有专门页面：[自动化]({{ '/zh/automation/' | relative_url }})。**工作流**是一组响应步骤（通知频道、调用 API、更新工单、查询 IP、封禁地址），由触发器启动，并在 Prefect Worker 上运行。

工单分析员需要了解：

1. **工单可以自动启动工作流。**触发器 **On Ticket Created** 和 **On Ticket Status Change** 会在工单创建或已有工单被保存时启动匹配的工作流。**On Ticket Created** 可以按工单字段（状态、优先级、事件类别、事件结果，以及 `name:value` 形式的标签）设置条件。
2. **Ticket Labels 绑定。**工作流可以通过 AND/OR 逻辑绑定到工单标签；已绑定的标签显示在工作流的 **Ticket Labels** 列。
3. **工作流可以读取和修改工单。**动作 **Create Ticket** 和 **Update Ticket** 直接操作工单，步骤中可使用 `{% raw %}{{ticket.priority}}{% endraw %}` 之类的工单字段。
4. **从工单中调用。**在评论框中使用 `@playbook`（见上文）为当前工单运行工作流；以这种方式启动的运行会列在 **Incident Info** 的 **Work Plan** 卡片中。
5. **只有已发布的工作流才会运行。**工作流必须处于启用状态并已发布才会运行；仅编辑不会改变实际运行的内容。
6. **在 `Automation → Executions` 中跟踪结果**，其中显示每次运行的步骤、日志和错误。

构建与发布、变量与密钥、通知与 API 动作以及外部 Webhook 接口，请参阅[自动化]({{ '/zh/automation/' | relative_url }})。

---

## 从告警到工单

工单通常由 Orchestrator 和 Correlation 策略根据告警创建：每条新告警都会生成一张工单，启用 Correlation 后，告警也可以附加到匹配的处理中工单，而不是新建工单。参阅[数据接入]({{ '/zh/data-onboarding/' | relative_url }})和[告警管理]({{ '/zh/alerts/' | relative_url }})。
