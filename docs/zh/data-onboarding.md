---
layout: default
title: "数据接入"
lang: zh
lang_ref: data-onboarding
---

# 数据接入

数据接入覆盖完整的数据管道配置：连接外部数据源、调度告警采集、配置关联策略，将原始告警自动转化为事件工单。

## 数据流架构

```
Elasticsearch（外部）
        │
        ▼  [Data Pipeline → Integrations]
   ELK Connector（凭证认证 + Index 映射）
        │
        ▼  [Data Pipeline → Orchestrator]
   定时采集任务（Cron Job）
   es_to_db：将 ES 数据写入内部数据库
        │
        ▼  [Data Pipeline → Correlation]
   关联分析引擎（时间窗口 + 排序字段）
        │
        ▼  [Monitor]
   Overview 统计仪表板 + Alerts 告警列表
```

**工作原理：**
- **Orchestrator** 定期（默认每 60 分钟）从配置的 ES 索引拉取告警数据，写入内部 `alerts_alert` 表。
- **Correlation** 引擎在时间窗口内对告警进行排序和关联，生成关联活动记录和工单。
- **Monitor** 模块从内部数据库读取数据，展示实时仪表盘统计和告警列表。

---

## 第一步：登录系统

使用浏览器访问 `https://siem.seclink.info`，输入管理员账号密码登录。

登录后，系统默认显示 **Dashboard Overview** 页面。若未配置数据源，所有统计指标均为零。

![Dashboard Overview — 登录后初始状态]({{ '/assets/images/data-onboarding/dashboard-overview.png' | relative_url }})

**Dashboard 统计说明：**
- **Alerts in…** — 各时间窗口内的告警数
- **Total Alerts** — 累计接入告警数
- **Data Sources** — 已配置的集成数量

---

## 第二步：配置 Elasticsearch 集成

**导航路径：** `Data Pipeline → Integrations`

集成管理页面列出所有可用的数据连接器。找到 **Elastic Stack（ELK Connector）**，点击 **Setup Integration**。

![Integrations 页面 — Elastic Stack 可用]({{ '/assets/images/data-onboarding/integrations-page.png' | relative_url }})

### 填写连接参数

在 **Configure Elasticsearch** 对话框中填写以下字段：

| 字段 | 填写内容 | 说明 |
|---|---|---|
| Integration Name | `Elastic Stack (ELK)` | 可自定义 |
| Connection Protocol | `HTTP` 或 `HTTPS` | 根据 ES 集群协议选择 |
| Host | `<ES 主机 IP>` | 不含协议前缀 |
| Port | `9200` | ES 默认端口 |
| Authentication Type | `Basic Authentication` | 如需 API Key 认证，选对应选项 |
| Username | `<ES 用户名>` | Basic Auth 凭证 |
| Password | `<ES 密码>` | Basic Auth 凭证 |
| Target Index / Index Pattern | `alerts` | 需要接入的 ES 索引名称 |

> **提示：** 填写主机和认证信息后，点击 **Fetch Indices** 可自动从 ES 集群拉取可用索引列表，然后从下拉菜单选择目标索引。

> **安全提示：** ES 用户名和密码为敏感凭证，请勿在截图、文档或聊天中明文记录。

---

## 第三步：测试连接并保存

### 测试连接

点击 **Test Connection**。连接成功时，弹窗显示 **"Connection OK"** 和 **"Connection succeeded"**，并展示 ES 集群健康信息（状态 200、集群名称、节点数）。

![测试连接成功]({{ '/assets/images/data-onboarding/test-connection-ok.png' | relative_url }})

若连接失败，请检查：
- 主机和端口是否正确
- 平台服务器到 ES 集群的网络连通性
- 认证凭证是否有效
- ES 集群是否正常运行

### 保存配置

点击 **Save Configuration**。Integrations 页面的 Elastic Stack 卡片状态将变为 **Installed**，并出现 **Configure** 和 **Delete** 按钮。

![集成 — Installed 状态]({{ '/assets/images/data-onboarding/integration-installed.png' | relative_url }})

---

## 第四步：配置 Orchestrator（数据采集调度）

**导航路径：** `Data Pipeline → Orchestrator`

Orchestrator 管理定时数据采集任务。点击 **New Task**。

### 任务参数

| 字段 | 推荐填写内容 | 说明 |
|---|---|---|
| Name | `job` | 描述性任务名称 |
| Cron | `*/60 * * * *` | 每 60 分钟执行一次（可调整） |
| Source Integration (Elasticsearch) | `Elastic Stack (ELK)` | 选择第二步配置好的集成 |
| Index (Elasticsearch) | `alerts` | 源 ES 索引 |
| Timestamp field | `date` | ES 文档中用于增量采集的时间戳字段 |
| Time range | （留空或按需选择） | 限制采集时间范围 |
| Destination Integration (Database) | `Current DB (Django default)` | 写入内部数据库 |
| Destination table | `alerts_alert` | 自动填充 |
| Limit | `1000` | 每次运行最多采集条数 |

![新建 Orchestrator 任务]({{ '/assets/images/data-onboarding/orchestrator-new-task.png' | relative_url }})

点击 **OK** 保存任务。

![Orchestrator — 任务创建成功]({{ '/assets/images/data-onboarding/orchestrator-task-created.png' | relative_url }})

### Cron 表达式参考

| 表达式 | 调度说明 |
|---|---|
| `*/60 * * * *` | 每 60 分钟 |
| `*/5 * * * *` | 每 5 分钟 |
| `* * * * *` | 每分钟 |
| `0 * * * *` | 每小时整点 |

**手动运行：** 点击任务的 **Run** 按钮立即触发一次采集。点击 **View Runs** 查看历史执行记录和导入统计。

---

## 第五步：配置关联策略（Correlation）

**导航路径：** `Data Pipeline → Correlation`

关联引擎根据时间窗口和排序字段，将相关告警归组为事件记录。

### 关联策略配置

| 字段 | 推荐值 | 说明 |
|---|---|---|
| Enabled | **开启** | 必须启用才能从告警自动生成工单 |
| Window (minutes) | `30` | 30 分钟内的告警视为相关 |
| Order By Fields | `severity`（降序）、`timestamp`（升序） | 确定关联窗口内的告警排序方式 |
| Auto-create Tickets | **开启** | 为每个关联告警组自动创建工单 |

> **重要：** 启用自动创建工单后，每个匹配关联窗口的告警组都会生成一个新事件工单。建议先在测试环境验证策略配置后，再在生产环境启用。

---

## 第六步：验证数据接入

完成上述步骤后：

1. **手动触发 Orchestrator 任务** — 进入 `Data Pipeline → Orchestrator`，点击任务的 **Run**。
2. **查看仪表盘**（`Monitor → Overview`）— 告警计数应显示非零值。
3. **查看告警列表**（`Monitor → Alerts`）— 已接入的告警应出现在列表中。
4. **查看工单**（`Investigation → Tickets`）— 若已启用关联自动创建，应看到由关联告警组生成的工单。

---

## 常见问题排查

| 问题 | 检查项 |
|---|---|
| 测试连接失败 | 主机/端口是否正确？网络是否可达？凭证是否有效？ES 集群是否运行？ |
| Orchestrator 运行后无告警 | 目标索引名是否正确？时间戳字段是否存在于文档中？ |
| 告警重复出现 | 源文档的唯一 ID 字段在所有文档中是否一致 |
| 未自动生成工单 | 关联策略是否已启用？是否开启了自动创建工单？ |
| Orchestrator 未按计划运行 | Cron 表达式是否有效？是否有任务排队中未释放？ |
