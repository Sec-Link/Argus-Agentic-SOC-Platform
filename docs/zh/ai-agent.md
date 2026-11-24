---
layout: default
title: "AI 智能体"
lang: zh
lang_ref: ai-agent
---

# AI 智能体

AI 智能体是协助 SOC 分析员进行事件调查的集成智能层。它能解释告警、评估风险、提取 IOC、建议修复步骤、应用调查技能，并通过模型上下文协议（MCP）调用安全工具。

> **安全提示：** 请勿在截图、文档或聊天中分享 API Key、密码、令牌或其他敏感凭证。

---

## 配置

**导航路径：** `Administration → AI Assistant`

页面包含五个标签页：**General**、**MCP Status Monitor**、**Skill Monitor**、**MCP Management** 和 **Skills Management**。General 设置存储在浏览器本地存储中；MCP 服务器和技能存储在服务端。

> **只读视图：** 访客账号会看到横幅提示：无法查看已存储的 API Key 或令牌，也无法修改 AI Assistant 设置。表单被禁用，**Add MCP** / **Add Skill** 按钮被隐藏。

### General

![AI Assistant 通用设置]({{ '/assets/images/ai-agent/general-configured-n.png' | relative_url }})

| 设置项 | 说明 |
|---|---|
| **Enable AI Assistant** | 总开关 — 必须开启，工单详情页才会显示 AI 功能 |
| **OpenAI API Key** | 管理员提供的 OpenAI 兼容 API Key |
| **Model** | 端点支持的模型标识符 |
| **Base URL** | API 端点地址（如 `https://api.openai.com/v1`） |
| **Timeout (seconds)** | 请求超时时间，单位秒——对响应较慢的模型可适当调大 |

填写完字段后：
1. 点击 **Test Connectivity** 验证模型端点可达且 Key 有效。成功时会提示已连接的模型名称。
2. 点击 **Save General** 将设置保存到当前浏览器（提示 "General settings saved"）。

由于 General 设置保存在浏览器中，每位分析员的浏览器都需要各自配置。若连通性测试失败，请检查 Base URL、API Key、模型名称，以及平台到端点的网络访问。

---

## MCP Status Monitor

MCP Status Monitor 跟踪所有 MCP 工具调用的运行健康状态。

![MCP 状态监控]({{ '/assets/images/ai-agent/mcp-status-monitor-n.png' | relative_url }})

**Execution Statistics** 显示：

| 指标 | 说明 |
|---|---|
| **Total Calls** | 累计 MCP 工具调用次数，以及成功与失败次数 |
| **Success Rate** | 所有 MCP 工具的调用成功百分比 |
| **Last Invocation** | 最近一次调用的时间戳（当前筛选范围） |
| 各工具卡片 | 每个工具的总调用数及成功、失败次数 |

**Recent Executions** 列出单次调用。可使用 **Search tool name** 搜索框和状态筛选（**All Status**、**Completed**、**Failed**、**Running**）缩小范围。列：**Tool**、**Source**、**Status**、**Start Time**、**Duration**、**Action**。

点击某行的 **Details** 打开 **Tool call details**：执行信息（工具、状态、时间、执行 ID、端点）、**Request params**、**Response**，以及失败调用的 **Error** 卡片。请求和响应区块都带有复制按钮。

通过此视图可诊断 AI 智能体在分析过程中是否成功调用了上下文工具。

---

## Skill Monitor

Skill Monitor 展示技能的使用统计。

![Skill 监控]({{ '/assets/images/ai-agent/skill-monitor-n.png' | relative_url }})

**Skill Execution Statistics** 显示技能调用总数。**Skill Usage** 表的列为 **Skill**、**Total**、**Success**、**Failed**、**Last Call**。

当某技能的说明被载入一次 AI 分析或对话时计一次调用；失败次数表示未能找到该技能文档。没有对应行或调用次数为 0，说明尚无 AI 会话选用过该技能，参见“技能如何被使用”一节。

---

## MCP Management

MCP（模型上下文协议）工具通过允许 AI 在分析过程中调用服务、获取结构化上下文，扩展 AI 智能体的能力。

![MCP 管理页面]({{ '/assets/images/ai-agent/mcp-management-n.png' | relative_url }})

### Added MCP Servers

**Added MCP Servers** 表列出已注册的外部 MCP 服务器，列为 **Name**、**Title**、**Endpoint**、**Enabled** 和 **Action**（**Edit**、**Delete**）。可使用 **Refresh** 重新加载列表。

### 添加 MCP Server

![添加 MCP 弹窗]({{ '/assets/images/ai-agent/add-mcp-modal-n.png' | relative_url }})

1. 点击 **Add MCP**。
2. 在 **Add MCP Server** 中填写：
   - **Name** — 唯一的服务器标识（必填；编辑时不可修改）
   - **Title** — 可选的显示标题
   - **Endpoint** — MCP 服务器地址（必填）
   - **Token** — 可选的访问令牌
   - **Enabled** — 启用或停用该服务器
3. 点击 **Create**（编辑时为 **Save**）。

### 内置 MCP 工具

平台内置以下工具，列于 **Built-in MCP Tools** 表：

| 工具 | 说明 | `/api/v1/ai-assistant/mcp/` 下的端点 |
|---|---|---|
| `ticket_context` | 按工单号获取工单上下文及近期时间线 | `ticket-context/<ticket_number>/` |
| `ticket_search_similar_cases` | 按 IOC 关键词搜索历史相似工单 | `ticket-search/similar-cases/` |
| `cmdb_asset_lookup` | 按指标（IP、主机名、资产编号）查询 CMDB 资产 | `cmdb/asset-lookup/` |
| `observables_extract` | 从原始消息、文本或告警 JSON 中提取可观测指标 | `observables/extract/` |

MCP JSON-RPC 端点为 `/api/v1/ai-assistant/mcp/`，工具清单位于 `/api/v1/ai-assistant/mcp/tools/`。

### Skill MCP 工具

**Skill MCP Tools** 表列出用于访问技能库的两个工具：

| 工具 | 说明 |
|---|---|
| `list_skills` | 列出技能库中的技能 |
| `read_skill` | 按名称读取技能文档 |

---

## Skills Management

技能（Skills）是 Markdown 指令文档（`SKILL.md`），指导 AI 如何处理某类案件，例如钓鱼邮件研判或勒索软件响应。技能适用时，其文本会被加入 AI 提示词。

![Skills 管理页面]({{ '/assets/images/ai-agent/skills-management-n.png' | relative_url }})

### Configured Skills

**Configured Skills** 表显示本平台已注册的技能：**Name**、**Version**、**Route**、**Enabled** 开关，以及 **Edit** / **Delete** 操作。只有启用的技能才会提供给 AI。**Name**（设置了时还包括 **Route**）是将技能与其文档匹配的键，因此应与技能库中该技能的目录名保持一致。

### 添加技能

![添加 Skill 弹窗]({{ '/assets/images/ai-agent/add-skill-modal-n.png' | relative_url }})

1. 点击 **Add Skill**。
2. 在 **Add Skill** 中填写：
   - **Name** — 技能标识符（必填；编辑时不可修改）
   - **Version** — 版本字符串，例如 `v1`
   - **Route** — 可选的备用匹配键
   - **Description** — 技能涵盖的内容；AI 据此判断该技能是否相关
   - **Content (SKILL.md)** — Markdown 格式的技能指令；字段下方显示 **Preview**
   - **Enabled** — 启用或停用该技能
3. 点击 **Create**（编辑时为 **Save**）。

### Available Skills (Library)

**Available Skills (Library)** 表是技能库中现有技能的只读列表，包含 **Name**、**Title**、**Description** 和 **Status** 标签：

| 状态 | 含义 |
|---|---|
| **Enabled** | 已添加并启用；AI 可用 |
| **Disabled** | 已添加但已关闭 |
| **Not Added** | 存在于技能库中但尚未添加 |

页面没有“从技能库添加”按钮。要使用某个库技能，请创建同名（**Name** 相同）的 Configured Skill（必要时将其内容粘贴到 **Content (SKILL.md)**）并启用。**库技能在添加并启用之前不会生效。**

技能库内置十个技能：

| 技能 | 关注点 |
|---|---|
| `cloud-iam-anomaly` | 云身份与访问异常 |
| `data-exfiltration-detection` | 数据外泄迹象 |
| `dns-c2-investigation` | 基于 DNS 的命令与控制 |
| `incident-containment-planning` | 遏制方案规划 |
| `insider-threat-assessment` | 内部威胁评估 |
| `malware-execution-analysis` | 恶意软件执行分析 |
| `phishing-triage` | 钓鱼邮件研判 |
| `ransomware-response` | 勒索软件响应 |
| `suspicious-login-investigation` | 可疑登录调查 |
| `vulnerability-prioritization` | 漏洞优先级排序 |

每个技能是一个包含 `SKILL.md` 文件的目录。技能库目录默认为后端应用下的 `skills`，若定义了 Django 设置 `AI_SKILLS_DIR` 则读取该设置。

---

## 技能如何被使用

只有**已启用**的技能才会被应用。

- **Run AI Assistant** — 将工单证据（包括告警 JSON）和已启用技能列表交给 AI 模型，由其返回相关技能。若该选择调用失败，则回退到文本匹配：将技能名称与工单证据比对。每个被选中技能的正文（最多 12,000 个字符）会加入分析提示词，结果中会列出所用技能（`skills_used`）。
- **Chat** — 已启用技能作为候选。平台先针对你的消息选出相关技能，并在模型回答之前自动执行 `list_skills` 和 `read_skill`，然后将所选技能文本注入提示词。模型仍可调用 `read_skill` 读取其他技能，但已预加载的技能不会被重复读取。

在聊天面板中，带有工具活动的助手回复会显示一个 trace，并带有 **Expand** / **Collapse** 按钮；自动执行的 `list_skills` / `read_skill` 步骤会出现在其中。

---

## 在工单中使用 AI 智能体

AI 智能体在工单详情视图中使用。

**导航路径：** `Investigation → Tickets → [任意工单] → Incident 标签页`

![工单详情 — AI Assistant 面板]({{ '/assets/images/ai-agent/ticket-detail-n.png' | relative_url }})

### 一键分析

点击 **Run AI Assistant** 触发自动分析。AI 读取工单的告警数据、关联可观测指标和历史记录后生成：

- **告警解释** — 通俗语言的告警含义摘要
- **风险级别建议** — 带理由的严重级别建议
- **已完成任务** — AI 已执行的操作
- **下一步任务** — 建议分析员跟进的事项

### AI Chat

![AI Chat 面板]({{ '/assets/images/ai-agent/ai-chat-panel-n.png' | relative_url }})

点击 **Chat** 打开针对当前工单的交互式对话：

1. 聊天上下文自动包含工单元数据和关联告警。
2. 在输入框输入问题或指令。
3. AI 返回分析结果、建议或结构化输出。
4. 聊天历史按工单持久化保存。

**Chat 提示示例：**
- "从这条告警中提取所有 IOC，格式化为列表。"
- "分析这批告警隐含的攻击链。"
- "我应该优先执行哪些遏制步骤？"
- "这是真阳性还是误报？请给出理由。"

### @ai 提及

在工作日志评论框输入 `@ai <问题>`，AI 响应将直接发布至工作日志线程。

### @playbook 提及

输入 `@playbook <名称>` 以当前工单为上下文调用可执行工作流剧本，系统执行后将结果发布至工作日志。

---

## 建议工作流

1. 从工单列表打开目标工单。
2. **先**人工查看 **Case Details**、**Timeline**、**Alerts**、**Raw Message** 和 **Evidence**。
3. 点击 **Run AI Assistant** 获取初步自动评估。
4. 通过 **Chat** 追问：提取 IOC、解释告警逻辑、请求响应步骤。
5. 对所有 AI 输出进行批判性审查后再采取行动。
6. 只将经过确认的信息写入评论、任务或处置结论。

---

## 故障排查

| 问题 | 检查项 |
|---|---|
| AI 不响应 | 检查 Enable AI Assistant 开关；验证 API Key、Model、Base URL、Timeout；运行 Test Connectivity；注意 General 设置按浏览器保存 |
| 无法编辑设置 | 访客账号为只读视图；请使用内部账号 |
| MCP 工具无调用 | 查看 MCP Status Monitor 排查失败原因；确认工单场景是否触发工具使用 |
| 某个库技能始终未被使用 | 其状态必须为 **Enabled**：在 Configured Skills 中以相同的 **Name** 添加并打开 **Enabled** 开关 |
| Skill Usage 为空或某技能调用次数为 0 | 尚无 AI 分析或对话选用过该技能；确认技能已启用，且其 **Description** 和名称准确描述了应处理的场景 |
| 技能出现失败调用 | 技能库中找不到该技能文档；检查 **Name** 是否与技能目录名一致 |
| Chat 分析不准确 | AI 仅使用当前工单上下文——在战情室中补充更多证据可提升分析质量 |
