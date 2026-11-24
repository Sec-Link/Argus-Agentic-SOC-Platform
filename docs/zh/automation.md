---
layout: default
title: "自动化"
lang: zh
lang_ref: automation
---

# 自动化

自动化模块让响应流程无需人工逐步操作。**工作流（Workflow）** 是由多个步骤组成的流程图（发送通知、调用 API、更新工单、查询 IP、封禁地址等），由触发器启动。工作流在可视化编辑器中构建，以带编号的版本发布，并由 Prefect Worker 执行。**接口（Interface）** 是对外部开放的 HTTP 入站端点，外部系统可通过它启动工作流。

**导航路径：** `Automation → Workflows`、`Automation → Executions`、`Automation → Interfaces`

<!-- TODO screenshot: assets/images/automation/workflows-list.png (Workflows list with the four summary cards, filters and table) -->

---

## 工作流列表

打开 `Automation → Workflows`。顶部四张卡片显示 **Total Workflows**、**Active**、**Total Executions** 和 **Success Rate**。浏览器标签页可见时，列表和卡片每 5 秒自动刷新。

### 顶部控件

| 控件 | 说明 |
|---|---|
| **Search workflows...** | 匹配工作流名称和描述 |
| **Status** 过滤 | `Active`、`Inactive` 或 `Draft` |
| **Trigger Type** 过滤 | Manual、On Alert、On Ticket Created、On Ticket Status、Scheduled、Webhook |
| **Refresh** | 重新加载列表 |
| **Import JSON** | 导入工作流文件（见下文“导入与导出”） |
| **View Executions** | 打开 `Automation → Executions` |
| **Create Visual Workflow** | 打开可视化编辑器并新建空工作流 |

### 表格列说明

| 列 | 说明 |
|---|---|
| **Name** | 点击打开编辑器。第二行显示 `draft vN`，发布后追加 `published vM` |
| **Trigger** | 触发类型标签 |
| **Steps** | 步骤数量 |
| **Status** | 运行状态标签和生命周期标签（见下） |
| **Ticket Labels** | 绑定到该工作流的标签过滤条件，未绑定显示 `Not bound` |
| **Last Execution** | 最近一次运行的状态和开始时间，从未运行显示 `Never` |
| **Executions** | 运行总次数 |
| **Actions** | 行操作按钮（见下） |

**状态标签**

| 工作流 | 未发布 | 已发布且启用 | 已发布但未启用 |
|---|---|---|---|
| Manual | `Manual Run`（灰色） | `Manual Run`（蓝色） | `Manual Run · Inactive` |
| Scheduled | `Schedule Disabled` | `Scheduled · Enabled`（附带 cron 表达式） | `Scheduled · Disabled` |
| On Alert / Ticket / Webhook | `Event Trigger` | `Listening · Enabled` | `Listening · Disabled` |

生命周期标签：`Draft`（橙色）、`Published vN`（蓝色）、`Unpublished`（从未发布）、`Changes`（红色，自上次发布后已修改）。`Legacy Local / unavailable` 标签表示在 Prefect 引擎之前创建的旧工作流，需要重新发布后才能使用。

### 行操作

| 按钮 | 说明 |
|---|---|
| 计划开关 | 仅用于 **Scheduled** 工作流，取代 Execute 和 Stop 按钮，用于开启或关闭计划 |
| Execute | 启动一次运行 |
| Stop | 最近一次运行处于 `pending`、`running` 或 `paused` 时取代 Execute，用于请求取消 |
| Visual Editor | 打开编辑器 |
| Clone | 创建未启用的草稿副本 |
| Export published version | 以 JSON 下载最近发布的版本（首次发布前不可用） |
| Publish to Prefect | 将当前草稿发布为新版本（有运行进行中时不可用） |
| Delete | 确认后删除工作流 |

**Execute** 规则：

- 工作流必须处于 **Active** 状态且**至少发布过一次**，否则按钮置灰，悬停提示会说明缺少什么。
- 运行始终使用**最近发布的版本**，即使草稿存在未发布的修改。提示文字为 `Execute the last published version (vN)`。

**计划开关**规则（开启计划时）：

- 工作流必须至少发布过一次。
- 必须在编辑器中选择执行部署（见下文“部署”）。
- 必须至少存在一个已启用的计划，可以是工作流的 **Cron** 字段，也可以是一个激活的计划。
- 已开启但从未发布的工作流仍可关闭。

请求被拒绝时，原因会以错误消息显示。

---

## 发布与版本

编辑和运行是刻意分开的。

- 编辑器中的 **Save Draft** 只修改工作副本（`draft vN`）。
- 列表中的 **Publish to Prefect** 会对启用的步骤、变量、触发器和计划设置做快照，保存为新的编号版本。快照存放在平台数据库中，此后不会再被修改。
- **Execute**、计划、Webhook 和事件触发器始终运行**已发布的版本**。每次执行都会记录启动时所用的版本，因此编辑或重新发布不会影响进行中的运行和历史运行。
- 编辑器顶部显示 `vN`、`Published vM` 或 `Unpublished`，当草稿与已发布版本不同时显示红色 `Unpublished Changes` 标签。

以下情况发布会被拒绝：

- 工作流没有启用的步骤（`Cannot publish a workflow with no active steps.`）；
- 工作流处于启用状态，但执行部署为空或已不可用；
- 某个步骤使用了未知的动作类型，或动作缺少必需的凭据。

发布成功后，平台会将工作流的计划重新同步到 Prefect。若同步失败，工作流仍已发布，并显示警告 `manifest published, but schedule synchronization failed: ...`；请检查编辑器中的计划列表并再次发布。

---

## 可视化编辑器

点击工作流名称、Visual Editor 按钮或 **Create Visual Workflow**。

<!-- TODO screenshot: assets/images/automation/workflow-editor.png (visual editor: settings sidebar, canvas with Start/Action/End nodes) -->

### 顶部栏

| 控件 | 说明 |
|---|---|
| **Back** | 返回列表 |
| 标题和标签 | `Create Visual Workflow` 或 `Edit: <名称>`、`vN`、`Published vM` / `Unpublished`、`Unpublished Changes` |
| **Execute** | 运行最近发布的版本（仅限已有的非 Scheduled 工作流；规则与列表相同） |
| **Save Draft** | 保存但不启用 |
| **Save & Activate** | 保存并启用工作流（Scheduled 工作流不显示，使用列表中的开关启用）。需要先选择执行部署 |

保存不会发布。保存后请在列表中发布。

### 工作流设置

| 字段 | 说明 |
|---|---|
| **Name** | 必填 |
| **Description** | 可选 |
| **Execution deployment** | 运行该工作流的 Prefect 部署。草稿可在未选择时保存 |
| **Schedules** | 存在计划时显示（见下） |
| **Trigger** | 触发类型之一（见下文“触发器”） |
| **Cron** | Scheduled 工作流显示，例如 `0 */4 * * *` |
| **Active** / **Draft** | 开关。Scheduled 工作流不显示 Active |
| **Variables** | 工作流变量和密钥（见下文“变量与密钥”） |

触发器的详细配置（Webhook 来源、条件）在 Start 节点中编辑：选中该节点并点击 **Configure Node**。

**计划（Schedules）：** 列表显示每个计划的名称、`Active` 或 `Paused` 标签，以及 cron 表达式或间隔。设置了 Cron 的 Scheduled 工作流会得到名为 `default` 的计划。点击垃圾桶图标并确认即可删除；删除 `default` 同时会清除工作流的 Cron 设置。若要更换执行部署，必须先删除**所有**计划（包括已暂停的）；只要存在计划，部署选择器就处于禁用状态。

### Ticket Labels

适用于已保存的工作流。通过标签选择该工作流绑定哪些工单。

| 字段 | 说明 |
|---|---|
| **Binding Name** | 必填，例如 `Critical ticket routing` |
| **Label Logic** | `AND`（所有标签行都必须匹配）或 `OR`（任一行匹配即可） |
| 标签行 | `label_name`（必填）和 `label_value`；**Add Label** 添加一行，**Remove** 删除一行 |

点击 **Save Labels** 保存绑定，点击 **Delete Binding** 删除绑定。已绑定的标签显示在列表的 **Ticket Labels** 列。

### 节点面板

**Workflow Nodes** 面板按类别列出节点。将节点拖到画布上，并通过从一个连接点拖到另一个连接点来连线。

| 类别 | 节点 |
|---|---|
| Control Flow | **Start**（入口）、**End**（终点）、**Condition**（分为两条路径） |
| 动作类别 | 所有可用动作按类别分组，如 Actions、Enrichment、Tickets、Utility（见下文“动作”） |
| 已保存节点 | 通过 **Save As** 保存的可复用节点；使用面板的编辑按钮管理 |

### 节点设置

点击节点打开 **Configure Node**。顶部按钮：**Delete**、**Save As**（动作和条件节点；保存为可复用节点，Start 和 End 节点不能保存）、**Save**。

| 字段 | 适用于 | 说明 |
|---|---|---|
| **Node Name** | 全部 | 必填 |
| **Category** | Action、Condition | 面板类别 |
| **Action Configuration** | Action | 动作字段（见下文“动作”）；可折叠的 **Available context** 列表提供可粘贴的变量引用 |
| **Timeout (s)** | Action | 步骤最长运行时间 |
| **On Failure** | Action | `Stop Workflow`、`Continue to Next Step`、`Retry Step` 或 `Skip to Next Step` |
| **Retry Count** | Action | 0 到 5 |
| **Retry Delay (s)** | Action | 0 到 3600 |
| **Current Condition** / **Edit Condition** | Condition | 打开条件构建器：由 AND 或 OR 连接的一条或多条规则，运算符包括 Equals、Not Equals、Contains、Starts With、Greater Than、In List、Is Empty 和 Matches Regex 等 |
| **Active** | 全部 | 关闭的步骤不会包含在发布版本中 |

动作表单提供 **Visual Editor** / **JSON** 切换。已保存的凭据不会再次显示：已配置的字段带有绿色 `Configured` 标签，留空表示保留现有值。

---

## 触发器

在 **Workflow Settings** 或 Start 节点中选择触发器。

| 触发器 | 触发运行的时机 | 配置 |
|---|---|---|
| **Manual Execution** | 用户点击 Execute | 无 |
| **On Alert Created** | 告警事件被分发给工作流时 | 条件构建器（告警字段） |
| **On Ticket Created** | 新工单被保存时 | 条件构建器（工单字段） |
| **On Ticket Status Change** | 已有工单再次被保存时 | 编辑器中无配置 |
| **Scheduled** | cron 计划触发时 | **Cron** 字段和计划 |
| **External Webhook** | 外部系统调用某个接口时 | **Webhook Source** |

> **说明：** 事件触发器（告警、工单）只会运行处于**启用**状态、**非 Draft** 且已发布的工作流。请使用 **Save & Activate**，然后发布。**On Ticket Status Change** 会在已有工单被保存时触发，无论修改了哪个字段。在当前版本中，告警入库不会向工作流分发事件，因此 **On Alert Created** 可以配置，但不会被新入库的告警启动；请改用工单触发器或计划任务。

### 条件构建器（Start 节点）

对于 **On Alert Created** 和 **On Ticket Created**，Start 节点的 **Configure Node** 抽屉会显示 **Condition Logic** 选择器（`AND (all conditions match)` 或 `OR (any condition matches)`）以及由 **Field**、**Operator**、**Value** 组成的规则行。没有规则行时，所有事件都匹配。点击 **Add Alert Condition** 或 **Add Ticket Condition** 添加规则行。

| 触发器 | 字段 |
|---|---|
| On Alert Created | Alert ID、Severity、Rule ID、Title、Category、Source Index、Message |
| On Ticket Created | Ticket Number、Title、Creator、Status、Priority、Event Category、Event Result、`Label (name:value)` |

运算符：**Equals**（`==`）、**Not Equals**（`!=`）、**Contains**。Status、Priority、Event Category 和 Event Result 提供可选值列表。Label 请输入 `name:value`，例如 `env:prod`，其运算符固定为 Contains。

### Webhook 触发器

选择 **External Webhook**，然后选择 **Webhook Source**。列表中只包含已启用的 **Webhook** 类型接口，请先创建接口（见下文“接口”）。当该接口收到有效请求时，工作流启动，请求体成为 `trigger_data`。

### 定时触发器

在 **Cron** 中输入五段式 cron 表达式。cron 计划按 UTC 时区创建。

| 表达式 | 含义 |
|---|---|
| `*/15 * * * *` | 每 15 分钟 |
| `0 */4 * * *` | 每 4 小时 |
| `0 8 * * 1-5` | 工作日 08:00（UTC） |
| `0 0 * * *` | 每天午夜（UTC） |

新建的 Scheduled 工作流默认处于关闭状态。请先发布，选择执行部署，然后在列表中打开开关。

---

## 变量与密钥

在 **Workflow Settings → Variables** 中声明一次值，之后可在步骤字段中通过 `{% raw %}{{variables.name}}{% endraw %}` 复用。

| 类型 | 存储方式 | 值格式 |
|---|---|---|
| **Text** | 明文 | 任意字符串 |
| **JSON** | 明文 JSON | 有效的 JSON，如 `123`、`true`、`["a"]`、`{"key":"value"}` |
| **Secret** | 加密、只写 | 任意非空字符串 |

规则：

- 名称以字母或下划线开头，后接字母、数字或下划线；名称必须唯一，普通变量和密钥不能重名。
- 点击 **Add variable** 添加一行；该行会显示可复制的 `{% raw %}{{variables.name}}{% endraw %}` 引用。
- 已保存的密钥不会再次显示。该行显示 `Secret · Configured`；留空表示保留已存储的值，输入新值则替换。
- 密钥只能在动作的凭据字段（存放 API Key、令牌或 Webhook URL 的字段）以及标记为 **Sensitive** 的 API Call 请求头或查询参数中引用。在条件和普通文本字段中引用会被拒绝。
- 删除或重命名密钥之前，请先移除对它的引用。
- 步骤输出可以在运行期间覆盖同名的普通变量。

**上下文变量：** 编辑器中可折叠的 **Available context** 列表显示可引用的内容：

| 引用 | 内容 |
|---|---|
| `{% raw %}{{workflow_id}}{% endraw %}`、`{% raw %}{{workflow_name}}{% endraw %}`、`{% raw %}{{workflow_version}}{% endraw %}`、`{% raw %}{{execution_id}}{% endraw %}`、`{% raw %}{{trigger_source}}{% endraw %}` | 运行元数据 |
| `{% raw %}{{trigger_data}}{% endraw %}` | 启动本次运行的数据（工单字段、Webhook 请求体等） |
| `{% raw %}{{trigger_data.<field>}}{% endraw %}`、`{% raw %}{{ticket.<field>}}{% endraw %}` | 工单触发器可用：`ticket_number`、`title`、`status`、`priority`、`description`、`create_uid`、`event_category`、`event_result`、`labels`、`current_assign_group`、`current_assign_owner` |
| `{% raw %}{{previous_step.output}}{% endraw %}`、`{% raw %}{{previous_step.success}}{% endraw %}`、`{% raw %}{{previous_step.step_id}}{% endraw %}` | 上一步的结果（该步运行之后可用）；追加字段路径可访问嵌套数据 |

**加密密钥：** 密钥和动作凭据使用环境变量 `WORKFLOW_ENCRYPTION_KEYS` 中列出的 Fernet 密钥加密（以逗号分隔）。后端和工作流 Worker 必须使用**相同**的值；`DEBUG` 关闭时，没有有效密钥后端将拒绝启动，Worker 没有它也无法解密密钥。请妥善保管密钥：用其他密钥加密的内容无法读取，必须重新输入。

---

## 导入与导出

**导出：** 行内的下载按钮会将**最近发布的版本**导出为 `<工作流名称>-published-vN.json`。工作流发布之前该按钮不可用。文件中的密钥仍保持加密。

**导入：** 点击 **Import JSON** 并选择文件。

- 工作流会作为**未启用的草稿**创建；请检查内容、选择部署，然后发布并启用。
- 如果已存在**同名**工作流，导入会更新该工作流的草稿，而不是创建第二个。
- 当前环境无法解密的加密凭据（例如文件来自使用其他加密密钥的环境）会被移除，并通过警告列出每个步骤和字段：`Some encrypted credentials could not be validated and were removed. Re-enter them before publishing.` 请在编辑器中重新输入凭据和密钥变量。

**克隆：** 创建名为 `<名称> (Copy)` 的未启用草稿，版本为 1，沿用相同的触发器、变量、密钥、步骤和部署。计划和工单标签绑定不会被复制。

---

## 部署

工作流运行在 **Prefect 部署**上。平台会自动维护部署列表：它登记带有 `soar` 标签并使用 SOAR 流程入口的 Prefect 部署，并将已消失的部署标记为不可用。不会因此导入任何工作流。

- 每个工作流在 **Execution deployment** 中选择自己的部署。**没有默认值**：未选择部署的工作流不能被启用、不能在启用状态下发布，也不能被调度。
- 部署决定运行由哪个 **work pool** 和 **work queue** 领取，因此请选择其 Worker 具备所需访问权限的部署（例如能访问你的防火墙网络）。
- 部署不可用时，选择器下方会显示警告，并阻止执行。

---

## 动作

动作节点是工作流的步骤。除非另有说明，字段均支持 `{% raw %}{{variable.path}}{% endraw %}` 占位符。

| 动作 | 类别 | 作用 |
|---|---|---|
| **Log Message** | Utility | 以 info、warning 或 error 级别向运行日志写入一条消息 |
| **Delay** | Utility | 等待 1 到 3600 秒（默认 5） |
| **Send Email** | Actions | 向收件人列表发送邮件，包含主题和正文，可选 HTML |
| **Send Notification** | Actions | 向 Slack、Feishu 或 Wecom 发送消息（见下） |
| **API Call** | Actions | 调用 HTTP API（见下） |
| **Create Ticket** | Tickets | 创建工单，包含标题、描述、优先级（默认 `medium`）、状态（默认 `new`）、事件类别和分派信息 |
| **Update Ticket** | Tickets | 更新按工单编号、标题或匹配字段选定的工单：状态、优先级、分派、事件结果、事件类别、记录、评论 |
| **IP Lookup** | Enrichment | 通过威胁情报 API（URL 和 API Key）查询 IP 信誉 |
| **Hash Lookup** | Enrichment | 通过威胁情报 API 查询 MD5、SHA-1 或 SHA-256 的信誉 |
| **Block IP** | Containment | 通过安全设备 API 封禁 IP；提供方为 `generic` 或 `opnsense`，可设置别名、清除连接状态和时长 |
| **Disable User** | Containment | 通过安全设备或目录 API 禁用用户账号 |
| **Release IP** | Release | 将 IP 从封禁列表中移除（提供方与 Block IP 相同） |
| **Enable User** | Release | 重新启用用户账号 |

这些动作的凭据（API Key、密钥、Webhook URL）以加密形式保存，不会再次显示。凭据与保存时的目标绑定：如果修改了 API URL（对于 Send Notification 和 OPNsense 动作，还包括提供方或别名），需要重新输入凭据。

### Send Notification

通过所选提供方的**传入 Webhook**向聊天群发送消息。

| 字段 | 说明 |
|---|---|
| **Provider** | `Slack`、`Feishu`（默认）或 `Wecom` |
| **Webhook Url** | 提供方的传入 Webhook URL（必填）。必须是绝对的 HTTP 或 HTTPS URL，不能包含内嵌凭据或片段。加密存储。更换提供方后需要重新输入 |
| **Title** | 可选；支持占位符 |
| **Message** | 必填；支持占位符。替换后消息为空会导致步骤失败 |
| **Format** | `Markdown`（默认）或 `Text` |
| **Mention All** | 在提供方支持时通知所有人（Slack `@channel`、Feishu `@all`、Wecom `@all`） |
| **Include Context Payload** | 在消息后追加一段工作流数据的 JSON |
| **Context Source** | `Previous Step Output`（默认）、`Trigger Data` 或 `Workflow Variables` |
| **Timeout** | 1 到 60 秒，默认 15 |

行为与限制：请求只发送一次且不跟随重定向；对于 Feishu 和 Wecom，若提供方返回非零错误码则步骤失败；保存的响应内容截断为 16 KB。使用 Markdown 时，Slack 以粗体显示标题，Feishu 发送交互式卡片。

### API Call

| 字段 | 说明 |
|---|---|
| **URL** | 绝对 HTTP 或 HTTPS URL。主机名必须固定（不能使用变量）；路径和查询部分可使用占位符。不能包含内嵌凭据或片段 |
| **Method** | `GET`、`POST`、`PUT`、`PATCH`、`DELETE` |
| **Timeout (seconds)** | 1 到 120，默认 30 |
| **Verify TLS** | 默认开启；关闭时会记录在步骤日志中 |
| **Authentication type** | `none`、`bearer` 或 `basic`（需 **Username**），并填写 **Authentication secret** |
| **Headers**、**Query parameters** | 键值行；勾选 **Sensitive** 可加密存储该值。内置认证不能与 `Authorization` 请求头同时使用 |
| **JSON body** | 非 GET 方法的模板；替换后必须是有效 JSON |

限制：不跟随重定向；响应截断为 64 KB（此时步骤输出带有 `truncated: true`，且不解析 JSON）。响应状态码不在 200 至 299 范围内时步骤失败。

**允许的 API 目标（管理员）：** API Call 只能访问管理员已批准的目标。打开 `Administration → System Settings` 的 **Allowed API Targets**，**每行填写一个精确的主机名、IP 地址或 CIDR**（例如 `firewall.internal`、`192.168.1.10`、`10.20.0.0/16`）。通配符、URL 和凭据会被拒绝。未列出的目标一律拒绝，无论公网还是内网。已列出的主机名解析出的地址仍必须是被允许且未被封锁的地址。**环回、链路本地、未指定、组播和云元数据地址始终被封锁**，即使已列入名单。被拒绝的调用会失败并提示 `API target is not present in the administrator allowlist.` 该允许列表仅适用于 **API Call** 动作。

---

## 执行记录

打开 `Automation → Executions`（或工作流列表中的 **View Executions**）。

<!-- TODO screenshot: assets/images/automation/executions.png (Executions table with an Execution Details panel open) -->

| 控件 | 说明 |
|---|---|
| **Filter by Workflow** | 仅显示某个工作流的运行 |
| **Filter by Status** | `Completed`、`Running`、`Pending`、`Failed`、`Cancelled` |
| **Refresh** | 重新加载；标签页可见时表格每 5 秒自动刷新 |

| 列 | 说明 |
|---|---|
| **Workflow** | 工作流名称 |
| **Status** | pending、running、paused、completed、failed 或 cancelled |
| **Progress** | 百分比和 `已完成/总步骤数` |
| **Trigger** | 运行来源，如 `manual`、`schedule`、`ticket_created:<id>` 或 `interface:ingest:<id>` |
| **Started** | 开始时间 |
| **Duration** | 已用时间 |
| **Actions** | **View Logs**、**Details**，以及 `running` 或 `pending` 运行的取消按钮（需确认） |

- **Details**（或点击某一行）打开 **Execution Details** 面板：工作流、状态、进度、触发来源、开始时间、时长、执行人、错误信息（如有），以及 **Step Executions** 时间线。每个步骤可展开查看其动作、错误、日志和输出。面板顶部有 **Full Logs** 和 **Close**。
- **View Logs** 打开 **Execution Logs**，包含三个标签页：**Step Timeline**、**Full Log**（可复制或下载）和 **Context Data**（Trigger Data、Execution Context、Result Data）。
- **取消**会停止处于 pending 或 running 的执行，并将其标记为 `cancelled`。

---

## 接口

接口（Interface）是入站 HTTP 端点。平台外部的系统（SIEM 规则、监控工具、脚本）向它发送 JSON，平台随即启动所有触发器为 **External Webhook** 且 **Webhook Source** 为该接口的工作流。**接口本身不会创建告警或工单**，它只负责启动工作流。

**导航路径：** `Automation → Interfaces`

<!-- TODO screenshot: assets/images/automation/interfaces.png (Interface Management table and Request Code Examples) -->

### 接口管理

| 控件 | 说明 |
|---|---|
| **Search keywords** | 匹配名称和描述 |
| **All Types / API / Webhook** | 类型过滤 |
| **Refresh** | 重新加载表格 |
| **Create Interface** | 打开下方的对话框 |

表格只显示**你自己**创建的接口。

| 列 | 说明 |
|---|---|
| **Name / Description** | 接口名称和描述 |
| **Endpoint URL** | 完整 URL，附带复制按钮 |
| **Status** | 启用或禁用接口的开关 |
| **Time** | `Created` 和 `Last event` 时间 |
| **Actions** | **Edit**、**Copy URL**、**Logs**、**Test**、**Delete**（需确认） |

表格下方的 **Request Code Examples** 卡片显示 cURL、Python 和 JavaScript 示例（已填入接口令牌），对应你最近打开日志的接口，或列表中的第一个接口。

### 创建接口

| 字段 | 说明 |
|---|---|
| **Name** | 必填 |
| **Description** | 可选 |
| **Type** | `Webhook`（默认）或 `API`。只有 **Webhook** 类型的接口才能被选为工作流的 Webhook Source |
| **HMAC Secret (optional)** | 开启签名校验（见下） |
| **Enabled** | 开关；已禁用的接口会拒绝请求 |

创建接口时会自动生成一个密钥令牌。

### 调用接口

使用 `POST`、`PUT` 或 `PATCH` 并携带 JSON 请求体，访问以下任一 URL 形式：

```
/api/v1/interfaces/endpoints/<id>/ingest/
/api/v1/interfaces/webhooks/<id>/
```

请在前面加上平台地址。无需登录，由令牌认证请求。

| 项目 | 说明 |
|---|---|
| `X-Interface-Token` | 接口的密钥令牌。也可通过查询参数 `token` 或 JSON 字段传递 |
| `X-Interface-Timestamp` | 设置 HMAC 密钥后必填：以秒为单位的 Unix 时间；与服务器时间相差超过 5 分钟的请求会被拒绝 |
| `X-Interface-Signature` | 设置 HMAC 密钥后必填：使用 HMAC 密钥对 `<timestamp>.<原始请求体>` 计算的十六进制 HMAC-SHA256（允许带 `sha256=` 前缀） |

| 响应 | 含义 |
|---|---|
| `202` | 已接受。响应体列出已启动的执行（没有匹配的工作流时 `execution_count` 可能为 `0`） |
| `401` | 令牌无效，或 HMAC 签名缺失、过期或错误 |
| `400` | 接口已被禁用 |
| `404` | 接口不存在 |

JSON 请求体（去除 `token` 字段）会作为 `trigger_data` 传递给每个被启动的工作流。只有处于 **Active** 状态且已发布的工作流才会被启动。

### 日志与测试

- **Logs** 打开 **Request Logs**，显示最近 100 次请求：时间、方法、状态、来源 IP 和请求体。
- **Test** 通过同一路径发送一个示例请求（`{"event": "ui_test", "source": "interface_page"}`），启动匹配的工作流，并以方法 `TEST` 记入日志。

---

## 故障排查

| 问题 | 检查项 |
|---|---|
| Execute 按钮置灰 | 工作流必须处于 Active 状态且至少发布过一次；悬停查看原因 |
| 编辑后运行仍是旧行为 | 编辑只会修改草稿；请点击 **Publish to Prefect** |
| 发布时提示没有启用的步骤 | 先启用至少一个步骤并保存 |
| 发布或启用时要求选择部署 | 选择 **Execution deployment**；如果列表为空，请联系管理员检查 Prefect 部署 |
| 计划开关不可用 | 先发布一次，选择部署，并确保存在 Cron 值或已激活的计划 |
| 无法更改部署 | 先删除所有计划（包括已暂停的） |
| 工单触发器没有启动运行 | 工作流必须是 Active、非 Draft（使用 **Save & Activate**）且已发布，并且条件必须匹配 |
| 保存或导入时出现密钥错误 | 后端和 Worker 的 `WORKFLOW_ENCRYPTION_KEYS` 必须一致；导入来自其他环境的文件后需重新输入密钥 |
| API Call 因允许列表错误失败 | 在 `Administration → System Settings` 中添加精确的主机名、IP 或 CIDR |
| Webhook 返回 `401` | 令牌错误、HMAC 时间戳超过 5 分钟，或签名所对应的请求体不一致 |
| Webhook 返回 `202` 但 `execution_count` 为 0 | 没有处于 Active 状态且已发布的工作流把该接口作为其 Webhook Source |

## 相关页面

- [工单处理]({{ '/zh/ticket-handling/' | relative_url }})
- [数据接入]({{ '/zh/data-onboarding/' | relative_url }})
