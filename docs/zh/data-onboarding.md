---
layout: default
title: "数据接入"
lang: zh
lang_ref: data-onboarding
---

# 数据接入

数据接入涵盖从连接外部数据源、调度告警采集，到配置关联策略并将收到的告警转换为事件工单的完整流程。

## 数据流架构

```
Elasticsearch（外部）
        │
        ▼  [Data Pipeline → Integrations]
   Elastic Stack 连接器（主机、凭据、索引）
        │
        ▼  [Data Pipeline → Orchestrator]
   定时任务（es_to_db）
   将 ES 文档写入内部告警表，
   然后为每条新增或变更的告警创建工单
        │
        ▼  [Data Pipeline → Correlation]
   关联策略：在时间窗口内匹配到处理中
   （In Progress）工单的告警会附加到该工单
        │
        ▼
   Monitoring → Overview / Alerts，Investigation → Tickets
```

Splunk 的路径更短：**Splunk Alerts** 集成 → 手动 **Fetch Data** → `Monitoring → Alerts`。Splunk 告警只会被存储，**不会**自动转换为工单。

**工作原理：**
- **Orchestrator** 定期从配置的 ES 索引拉取文档，并写入内部告警表（`alerts_alert`）。
- 对每条新告警（或内容发生变化的告警），同一次运行会创建工单。启用 **Correlation** 后，如果告警的关联键在时间窗口内匹配到一张处理中（In Progress）的工单，则该告警会附加到这张工单，而不是新建工单。
- **Monitoring** 读取内部数据库，显示仪表盘统计和告警列表；**Investigation → Tickets** 列出工单。

---

## 步骤 1：登录

打开浏览器访问 `https://siem.seclink.info`，输入管理员凭据登录。

登录后系统默认进入 **Dashboard Overview** 页面（`Monitoring → Overview`）。如果尚未配置数据源，所有统计数据均为零。

![Dashboard Overview — 初始状态]({{ '/assets/images/data-onboarding/dashboard-overview.png' | relative_url }})

**仪表盘统计项说明：**
- **Alerts in…** — 按时间窗口统计的近期告警数量
- **Total Alerts** — 累计接入的告警数量
- **Data Sources** — 已配置的集成数量

---

## 步骤 2：配置 Elasticsearch 集成

**导航路径：** `Data Pipeline → Integrations`

Integrations 页面为每个连接器显示一张卡片：**Elastic Stack**、**Kibana**、**Splunk**（Alerts）和 **Splunk Rule Publisher**。每张卡片标记为 **Available** 或 **Installed**。找到 **Elastic Stack (ELK Connector)** 并点击 **Setup Integration**。已安装的卡片显示 **Configure** 和 **Delete**。

![Integrations 页面 — Elastic Stack 可用]({{ '/assets/images/data-onboarding/integrations-page.png' | relative_url }})
<!-- TODO screenshot: assets/images/data-onboarding/integrations-page.png (recapture: page now has four cards, Elastic Stack, Kibana, Splunk, Splunk Rule Publisher) -->

> 只读（访客）账号会看到 **Read-only view** 提示，无法编辑凭据。

### 填写连接参数

在 **Configure Elasticsearch** 对话框中填写以下字段：

| 字段 | 默认值 / 选项 | 说明 |
|---|---|---|
| Integration Name | `Elastic Stack (ELK)` | 可自定义 |
| Connection Protocol | `HTTPS`（默认）或 `HTTP` | 与 ES 集群保持一致。选择 HTTPS 时会校验证书 |
| Host | *（空）* | 主机名或 IPv4 地址，不含协议前缀和端口，例如 `localhost` 或 `10.0.0.1` |
| Port | `9200` | 1 到 65535 |
| Authentication Type | `No Authentication`（默认）、`Basic Authentication` 或 `API Key` | |
| Username / Password | | Basic Authentication 必填 |
| API Key Token | | API Key 认证必填 |
| Target Index / Index Pattern | `alerts` | 要接入的 ES 索引；支持通配符，如 `alerts-linux-*` |

表单下方的 **Preview endpoint** 行显示将要调用的 URL（`<协议>://<主机>:<端口>/_cluster/health`）。

> **提示：** 填写 Host 和认证信息后，点击索引字段旁边的 **Fetch Indices**，即可从实际的 ES 集群加载索引列表；也可以手动输入自定义值。

> **安全提示：** ES 用户名、密码和 API Key 属于敏感凭据，请勿记录在截图、文档或聊天消息中。

---

## 步骤 3：测试连接并保存

### 测试连接

点击 **Test Connection**。成功时弹出标题为 **Connection OK** 的对话框，显示 **Connection succeeded** 以及集群健康检查调用的原始响应（HTTP 状态、响应体和响应头）。失败时标题为 **Connection failed**，并显示返回的错误信息。

![Test Connection — 成功]({{ '/assets/images/data-onboarding/test-connection-ok.png' | relative_url }})

如果测试失败，请检查：
- Host 和 Port 是否正确
- 平台服务器到 ES 集群的网络连通性
- 凭据是否有效
- ES 集群是否正在运行且状态健康

### 保存配置

点击 **Save Configuration**（提示 `Integration saved.`）。保存同时会将该 Elasticsearch 连接设为当前活动的告警源，并从所配置的索引开始首次告警同步。Integrations 页面中的 Elastic Stack 卡片显示为 **Installed**，并带有 **Configure** 和 **Delete** 按钮。

![集成 — Installed 状态]({{ '/assets/images/data-onboarding/integration-installed.png' | relative_url }})

---

## 步骤 4：配置 Orchestrator（数据采集计划）

**导航路径：** `Data Pipeline → Orchestrator`

Orchestrator 管理定时数据采集任务。页面包含列出任务的 **Orchestrator** 卡片和显示运行历史的 **Task Runs** 卡片。点击 **New Task**。

### 新建任务参数

| 字段 | 值 | 说明 |
|---|---|---|
| Name | `job` | 必填，任务名称唯一 |
| Cron (e.g. 0 0 * * *) | `*/60 * * * *` | 必填；默认 `0 0 * * *`（每天午夜） |
| Source Integration (Elasticsearch) | `Elastic Stack (ELK)` | 仅列出 Elasticsearch 集成（选择步骤 2 中创建的集成） |
| Index (Elasticsearch) | `alerts` | 必填。**Preview Data** 显示索引中的示例文档 |
| Timestamp field (optional) | `date` | 用于将查询限制在时间窗口内的 ES 字段；只有设置了该字段，**Time range** 才会生效 |
| Time range | *（留空或按需设置）* | `Last 1 hour`、`Last 6 hours`、`Last 24 hours`、`Last 7 days`、`Custom relative` 或带 **From** / **To** 的 `Absolute (pick a timestamp)` |
| Destination Integration (Database) | `Current DB (Django default)` | 写入内部数据库 |
| Destination table | `alerts_alert` | 固定值，置灰显示 |
| Limit | `1000` | 每次运行最多拉取的文档数（最小 1；留空时为 1000） |

![新建 Orchestrator 任务]({{ '/assets/images/data-onboarding/orchestrator-new-task.png' | relative_url }})

点击 **OK** 保存任务。

![Orchestrator — 任务已创建]({{ '/assets/images/data-onboarding/orchestrator-task-created.png' | relative_url }})

### Cron 表达式参考

| 表达式 | 调度 |
|---|---|
| `*/60 * * * *` | 每 60 分钟 |
| `*/5 * * * *` | 每 5 分钟 |
| `* * * * *` | 每分钟 |
| `0 * * * *` | 每小时整点 |

默认情况下，平台在后台每 30 秒检查一次到期任务。

### 运行与管理任务

每个任务行显示 `Type`、`Schedule` 以及最近一次运行及其状态。

| 按钮 | 操作 |
|---|---|
| **Run** | 立即启动一次运行 |
| **View Runs** | 打开该任务的运行列表。**Clear Runs** 在确认后清除该任务的全部运行历史；运行上的 **View Logs** 显示其日志 |
| **Edit** | 在 **Edit Task** 对话框中打开任务（任务名称同样是链接） |
| **Delete** | 确认后删除任务 |

**Task Runs** 卡片带有任务选择器，每次运行一行：

| 列 | 说明 |
|---|---|
| **Time** | 运行开始时间 |
| **Matched** | 参与工单创建判断的告警数 |
| **Created** | 新创建的工单数 |
| **Appended** | 附加到已有工单的告警数（关联命中，或同一 SIEM 事件已存在工单） |
| **Skipped** | 未能生成工单的告警数 |
| **Imported** | 从 Elasticsearch 拉取的文档数 |
| **Status** | `success`、`partial`（已完成但存在非致命错误，请查看日志）、`failed`、`running` 或 `pending` |

Orchestrator 仅从 Elasticsearch 读取数据；Splunk 告警使用各自的 **Fetch Data** 按钮（见下文）。

---

## 步骤 5：配置 Correlation 策略

**导航路径：** `Data Pipeline → Correlation`

页面包含三个标签页：**Correlation Policy**、**Correlation Activity** 和 **Risk Entities**。

### Correlation Policy 标签页

| 字段 | 推荐值 | 说明 |
|---|---|---|
| Enabled | **开启** | 仅在启用时关联才会生效 |
| Window (minutes) | `30` | 1 到 1440。窗口内关联键相同的告警视为相关 |
| ES Integration / ES Index | `Elastic Stack (ELK)` / `alerts` | 用于列出可用字段的数据源 |
| Load ES Fields | 点击一次 | 加载索引的字段名（`N fields loaded`） |
| Order By Fields | 例如 `rule_id`、`host.name` | 必填多选项，加载字段后可用。所选字段的值会组合成关联键 |

点击 **Save** 保存策略（`Policy saved`）；**Reset** 恢复表单。

**关联的工作方式：** 每次 Orchestrator 运行都会为每条新告警创建工单。启用策略后，运行会先查找在最近 *窗口* 分钟内为相同关联键的告警创建、**且进度状态仍为 In Progress**（工单上未被设为 Pending）的工单。如果存在，则告警附加到该工单（添加一条工作日志，告警显示该工单），而不是新建工单。

### Correlation Activity 标签页

一张时间序列图表和一张关联工单表格（**Ticket**、**Alerts**、**Last Alert**、**Risk Objects**、**Rule**、**Alert IDs**）。控件：时间范围（`Last 1 hour`、`Last 6 hours`、`Last 24 hours`、`Last 7 days`）、时间桶大小、**Refresh**、**Export CSV**。**Seed Data** 会为已有工单插入演示用的关联事件，请勿在生产系统上使用。

### Risk Entities 标签页

**Entity-Centric Correlation** 列出在所选时间范围内关联多条告警或多条规则的风险对象（IP、用户、主机、哈希），带有 **Min alerts** 过滤器（`≥ 1`、`2`、`3`、`5`），列为 **Risk Entity**、**Type**、**Alerts**、**Rules**、**Tickets**、**Severities** 和 **Last Seen**。

> **重要：** 没有可以关闭工单创建的开关。Orchestrator 接入的每条告警都会生成工单，除非它被关联附加到已有的 In Progress 工单。在对生产数据设置定时任务之前，请先在测试环境中确认任务的 Limit 和查询。

---

## 步骤 6：验证数据接入

完成以上步骤后：

1. **手动触发一次 Orchestrator 运行** — 进入 `Data Pipeline → Orchestrator`，点击任务上的 **Run**，再点击 **View Runs** 查看计数和日志。
2. **检查仪表盘**（`Monitoring → Overview`） — 告警计数应显示非零值。
3. **检查告警列表**（`Monitoring → Alerts`） — 应能看到已接入的告警。
4. **检查工单**（`Investigation → Tickets`） — 每条新告警应有一张工单；启用 Correlation 后，告警也可能被附加到某张 In Progress 工单。

---

## 其他集成

### Kibana

用于通过 Kibana API 发布检测规则及其动作；它不接入数据，也没有索引字段。点击 **Kibana** 卡片上的 **Setup Integration** 打开 **Configure Kibana**。

| 字段 | 默认值 / 选项 |
|---|---|
| Integration Name | `Kibana` |
| Connection Protocol | `HTTPS`（默认）或 `HTTP` |
| Host / Port | *（空）* / `5601` |
| Authentication Type | `No Authentication`（默认）、`Basic Authentication` 或 `API Key` |

**Test Connection** 会调用 Kibana 主机上的 `/api/status`。发布规则请参阅[用例管理]({{ '/zh/use-case-management/' | relative_url }})。

### Splunk Alerts

将 Splunk 索引中的事件拉取到告警列表。点击 **Splunk** 卡片上的 **Setup Integration**（**Splunk Alerts** 对话框）。

| 字段 | 说明 |
|---|---|
| **Integration name** | 默认 `Splunk Alerts` |
| **Management API URL** | Splunk 管理端点（origin），例如 `https://splunk.example.com:8089`；不含路径和查询 |
| **Authentication** | `Username / Password` 或 `Splunk management token` |
| **Token type** | 使用令牌时：`Authentication token (Bearer)` 或 `Session key (Splunk)` |
| **Verify TLS certificate** | 默认开启；关闭时会显示警告 |
| **Alert index** | 一个确切的索引名（字母、数字、`_`、`.`、`-`，最长 64 个字符）。默认 `main` |
| **Lookback (hours)** | 1 到 168，默认 24 |
| **Batch size** | 1 到 1000，默认 500；仅用于 **Fetch Data**，不会保存 |

密码和令牌会被安全保存且不会再次显示：留空表示保留已保存的凭据，修改 URL、认证方式或用户名时需要重新输入。

按钮：
- **Test Connection** — 连接管理 API，并报告 HTTP 状态、版本、构建号和产品类型。
- **Save Configuration** — 保存集成（`Splunk configuration saved.`）。
- **Fetch Data** — 仅在配置已保存且没有未保存修改时可用。它对告警索引执行固定的搜索（`index="<名称>"`，受批量大小和回溯窗口限制）；不支持自定义搜索命令。该操作是**手动**的，没有调度。

**结果：** 对话框列出 **Fetched**、**Inserted**、**Updated** 和 **Skipped**。`Batch limit reached.` 表示可能还有更多事件；请再次运行或调大批量大小。

**字段映射：** 每个事件成为一条告警：严重级别取自 `severity`、`level` 或 `urgency`；时间取自事件时间字段（或 `_time`）；标题取自 `title`、`rule_name` 或已保存搜索的名称；消息取自 `message`、`title` 或原始事件；规则 ID 取自 `rule_id` 或已保存搜索的名称；类别取自 `category` 或 `sourcetype`。如果原始事件是 JSON 对象，其键会补全缺失的字段。

**去重：** 告警 ID 通过对事件自身的 ID（存在时为 `alert_id` 或 `event_id`，否则为 Splunk 记录标识）以及集成和索引一起做哈希得到，因此重复拉取会更新已有告警，而不会产生重复。

Splunk 告警显示在 `Monitoring → Alerts` 中，**不会**自动转换为工单。测试连接需要集成的 *change* 权限；**Fetch Data** 还需要新增和修改告警的权限，并且每次拉取都会写入审计日志。

### Splunk Rule Publisher

将检测规则以已保存搜索的形式发布到 Splunk Enterprise。点击 **Splunk Rule Publisher** 卡片上的 **Setup Integration**。对话框顶部的选择器可在已配置的发布器之间切换，或创建 **New publisher**。

连接字段与 Splunk Alerts 相同（名称默认 `Splunk Rule Publisher`，认证方式默认 `Splunk management token`），区别如下：

| 字段 | 说明 |
|---|---|
| **Management API URL** | 必须使用 **HTTPS** |
| **Splunk app** | 必填；字母、数字、`_` 和 `-`；默认 `search` |
| **Saved search owner** | 必填，拥有已保存搜索的 Splunk 用户 |
| 无索引、回溯和 **Fetch Data** | 不适用 |

已有规则绑定的发布器，其 URL、app 或 owner 不能修改，并且**只要还有规则绑定就不能删除**：请先移除绑定。

---

## 故障排查

| 问题 | 检查项 |
|---|---|
| Test Connection 失败 | Host/Port 是否正确？协议是否与集群一致？网络是否可达？凭据是否有效？ES 集群是否运行？ |
| Orchestrator 运行后没有告警 | 索引名称是否正确？文档中是否存在 Timestamp 字段？缺少 `alert_id`、`event_id` 或 `es_id` 字段的文档会被跳过。查看该次运行的 **View Logs** |
| 告警已导入但列表为空 | `Monitoring → Alerts` 显示当前 Elasticsearch 集成所用索引中的告警以及 Splunk 告警；其他索引的告警不会显示 |
| 出现重复告警 | 源文档的唯一 ID（`alert_id` / `event_id`）必须在各文档间保持一致；同一索引中相同 ID 会更新已有告警 |
| 运行状态为 `partial` | 打开 **View Logs**：部分工单校验或创建失败 |
| 未创建工单 | 仅为**新增或变更**的告警创建工单；已导入且未变化的告警不会重新创建工单。查看 **Task Runs** 中的 **Matched / Created / Skipped** |
| 告警没有被 Correlation 附加 | 策略是否 **Enabled**？窗口是否足够长？文档中是否包含 **Order By Fields**？之前的工单不能处于 Pending 状态 |
| Orchestrator 任务未按计划运行 | 检查 cron 表达式是否有效、任务是否在列表中；使用 **Run** 进行测试 |
| Splunk **Fetch Data** 不可用 | 先保存配置并放弃未保存的修改 |
| Splunk 报错 | TLS 校验（信任证书，或检查 **Verify TLS certificate**）、用户对索引的权限、管理端口是否正确 |
| 无法删除 Splunk Rule Publisher | 仍有规则绑定到该发布器；请先移除绑定 |
