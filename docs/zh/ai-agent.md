---
layout: default
title: "AI 智能体"
lang: zh
lang_ref: ai-agent
---

# AI 智能体

AI 智能体是协助 SOC 分析员进行事件调查的集成智能层。它能解释告警、评估风险、提取 IOC、建议修复步骤，并通过模型上下文协议（MCP）调用外部安全工具。

> **安全提示：** 请勿在截图、文档或聊天中分享 API Key、密码、令牌或其他敏感凭证。

---

## 配置

### 导航路径

`Administration → AI Assistant`

通用设置存储在浏览器本地存储中，MCP 工具和技能（Skills）配置存储在服务端。

### 通用设置

![AI Assistant 通用设置]({{ '/assets/images/ai-agent/general-configured.png' | relative_url }})

| 设置项 | 说明 |
|---|---|
| **Enable AI Assistant** | 总开关 — 必须开启，工单详情页才会显示 AI 功能 |
| **OpenAI API Key** | 管理员提供的 OpenAI 兼容 API Key |
| **Model** | 模型标识符（如 `gpt-5.4`） |
| **Base URL** | API 端点地址（如 `https://api.openai.com/v1`） |
| **Timeout** | 请求超时时间，单位秒（默认 45）——对响应较慢的模型可适当调大 |

填写完所有字段后：
1. 点击 **Test Connectivity** 验证模型端点可达且 Key 有效。
2. 点击 **Save General** 将设置持久化到浏览器。

若连通性测试失败，请检查：Base URL、API Key、模型名称，以及浏览器到端点的网络访问。

---

## MCP 管理

MCP（模型上下文协议）工具通过允许 AI 在分析过程中调用外部服务、获取结构化上下文，扩展 AI 智能体的能力。

**导航路径：** `Administration → AI Assistant → MCP Management`

![MCP 管理页面]({{ '/assets/images/ai-agent/mcp-management.png' | relative_url }})

### 内置 MCP 工具

平台内置以下工具：

| 工具 | 说明 |
|---|---|
| `ticket_context` | 获取当前工单的完整上下文（告警、标签、工作日志） |
| `ticket_search_similar_cases` | 按标题和可观测指标搜索历史相似工单 |
| `cmdb_asset_lookup` | 通过 IP、主机名或用户从 CMDB 查询资产元数据 |
| `observables_extract` | 从原始文本中提取并规范化指标（IP、域名、哈希） |

### 添加 MCP Server

![添加 MCP 弹窗]({{ '/assets/images/ai-agent/add-mcp-modal.png' | relative_url }})

1. 点击 MCP 管理区域的 **Add MCP**。
2. 填写服务器信息：
   - **Name** — MCP 服务器的显示名称
   - **URL** — MCP 服务器端点
   - **Description** — 该服务器提供哪些工具
3. 点击 **Save**。

---

## MCP 状态监控

MCP Status Monitor 跟踪所有 MCP 工具调用的运行健康状态。

**导航路径：** `Administration → AI Assistant → MCP Status Monitor`

![MCP 状态监控]({{ '/assets/images/ai-agent/mcp-status-monitor.png' | relative_url }})

| 指标 | 说明 |
|---|---|
| **Total Calls** | 累计 MCP 工具调用次数 |
| **Success Rate** | 成功调用百分比 |
| **Last Called** | 最近一次调用的时间戳 |
| **Recent Executions** | 最近调用的详细日志，含状态和错误信息 |

通过此视图可诊断 AI 智能体在分析过程中是否成功调用了上下文工具。

---

## Skills 管理

技能（Skills）是 AI 智能体可调用的可执行程序，用于执行结构化任务（如情报富化查询、自动报告生成、响应动作）。

**导航路径：** `Administration → AI Assistant → Skills Management`

![Skills 管理页面]({{ '/assets/images/ai-agent/skills-management.png' | relative_url }})

### 添加技能

![添加 Skill 弹窗]({{ '/assets/images/ai-agent/add-skill-modal.png' | relative_url }})

1. 点击 **Add Skill**。
2. 填写必填字段：
   - **Name** — 技能标识符
   - **Version** — 语义化版本号
   - **Route** — 技能暴露的 API 路由
   - **Description** — 技能用途说明（AI 据此判断何时调用）
   - **Content (SKILL.md)** — Markdown 格式的完整技能定义
3. 切换 **Enabled** 开关激活技能。
4. 点击 **Save**。

---

## Skill 监控

Skill Monitor 展示所有已注册技能的执行统计。

![Skill 监控]({{ '/assets/images/ai-agent/skill-monitor.png' | relative_url }})

若某技能的调用次数为 0，说明尚无 AI 智能体会话触发过该技能。这在新增技能后属于正常现象——当 AI 在活跃调查中判断该技能适用时，调用记录才会出现。

---

## 在工单中使用 AI 智能体

AI 智能体在工单详情视图中使用。

**导航路径：** `Investigation → Tickets → [任意工单] → Incident 标签页`

![工单详情 — AI Assistant 面板]({{ '/assets/images/ai-agent/ticket-detail.png' | relative_url }})

### 一键分析

点击 **Run AI Assistant**（或闪电图标）触发自动分析。AI 读取工单的告警数据、关联可观测指标和历史记录后生成：

- **告警解释** — 通俗语言的告警含义摘要
- **风险级别建议** — 带理由的严重级别建议
- **已完成任务** — AI 已执行的操作
- **下一步任务** — 建议分析员跟进的事项

### AI Chat

![AI Chat 面板]({{ '/assets/images/ai-agent/ai-chat-panel.png' | relative_url }})

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
| AI 不响应 | 检查 Enable AI Assistant 开关；验证 API Key、Model、Base URL、Timeout；运行 Test Connectivity |
| MCP 工具无调用 | 查看 MCP Status Monitor 排查失败原因；确认工单场景是否触发工具使用 |
| Skill 调用次数始终为 0 | 技能仅在 AI 认为适用时才调用——可尝试在 Chat 中明确提示 AI 使用特定技能 |
| Chat 分析不准确 | AI 仅使用当前工单上下文——在战情室中补充更多证据可提升分析质量 |
