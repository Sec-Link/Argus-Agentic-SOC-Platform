---
layout: default
title: "告警管理"
lang: zh
lang_ref: alerts
---

# 告警管理

Alerts 页面是平台接入的所有安全事件的中央列表。它以一张可搜索、可过滤的表格展示从已连接数据源收集的每条告警，并为每条告警提供详情视图。

**导航路径：** `Monitoring → Alerts`

<!-- TODO screenshot: assets/images/alerts/alerts-list.png (Alerts page: search box, Severity filter, Reset, table with the six columns) -->

## 告警列表

列表显示当前 Elasticsearch 集成所用索引中的告警，以及从 Splunk 拉取的告警。默认按时间倒序排列，修改过滤条件或 Elasticsearch 连接器时会重新加载。底部显示总数（`N alerts`）。

### 过滤与搜索

| 控件 | 说明 |
|---|---|
| **搜索框** | 占位提示为 `Filter by id / message / details / rule / host / ip`。输入时列表实时更新，匹配告警 ID、消息、描述、标题、规则 ID、来源索引和原始告警内容 |
| **Severity** | `Critical`、`High`、`Medium`、`Low` 或 `Unknown`。来源中的取值会被归一化：例如 `fatal` 视为 Critical，`error` 视为 High，`warning` 视为 Medium，`info` 视为 Low |
| **Reset** | 清除搜索和严重级别过滤，并恢复默认排序（按时间倒序） |

**进入本页的链接：** 其他页面通过地址参数打开预先过滤的列表：

| 链接 | 效果 |
|---|---|
| `/alerts?q=<文本>` | 填入搜索框 |
| `/alerts?severity=critical` | 设置 Severity 过滤 |
| `/alerts?q=<文本>&severity=high` | 两者同时设置 |

### 表格列说明

| 列 | 说明 |
|---|---|
| **Severity** | 颜色编码的标签；可排序 |
| **ID** | 告警标识符，带复制图标（提示 `Alert ID copied`）；可排序 |
| **Time** | 以本地时区显示的事件时间，无法解析时显示 `Unknown Time`；可排序（默认倒序） |
| **Message** | 告警描述或标题；悬停可查看完整文本；可排序 |
| **Detection Rule** | 产生该告警的检测规则名称，链接到该规则；未关联规则时显示 `—` |
| **Risk Objects** | 最多两个实体（IP、用户、主机、哈希）的彩色标签，其余以 `+N` 表示（悬停查看）；没有时显示 `—` |

拖动表头边缘可调整列宽。通过底部可翻页，并选择每页 10、20（默认）、50 或 100 条。

**Risk Objects（风险对象）** 是告警所涉及的实体：从告警字段中提取的 IP、用户、主机和文件哈希。哪些字段被视为风险对象按检测规则配置（并有平台默认值）。同样的实体也驱动 Correlation 的 **Risk Entities** 标签页。

## 告警详情

点击任意一行打开 **Alert Details** 对话框。

| 部分 | 内容 |
|---|---|
| 页头 | 严重级别标签、来源索引、时间和告警 ID |
| **Message** | 告警消息 |
| **Details** | 事件的描述或详情 |
| **Host Name** / **Source IP** | 告警中存在时显示的主机和源地址 |
| **Risk Objects** | 所有提取的实体及其来源字段（存在时显示） |
| **Detection Rule** | 指向检测规则的链接 |
| **Raw Context** | 完整的告警记录（JSON） |

该对话框是只读的：列表中的告警没有状态、分配或确认操作。

## 从告警到工单

告警通过数据管道变为工单，而不是在本页操作：

- **Elasticsearch 告警：** 每次 Orchestrator 运行都会存储新告警，并为每条新增或变更的告警创建工单。启用 Correlation 策略后，在时间窗口内匹配到 In Progress 工单的告警会附加到该工单，而不是新建工单。参阅[数据接入]({{ '/zh/data-onboarding/' | relative_url }})。
- **Splunk 告警：** 通过 Splunk 集成中的 **Fetch Data** 拉取。它们会显示在这里，但不会自动生成工单。

工单列在 `Investigation → Tickets` 下；参阅[工单处理]({{ '/zh/ticket-handling/' | relative_url }})。

## 告警去重

告警由其来源 ID（Elasticsearch 文档的 `alert_id`、`event_id` 或 `es_id`）和来源索引共同标识。相同 ID 再次到达时，会更新已有告警，不会产生重复。Splunk 告警使用由事件 ID、集成和索引哈希得到的 ID，效果相同。

## 故障排查

| 问题 | 检查项 |
|---|---|
| 配置完成后没有告警 | 确认 Orchestrator 任务已成功运行；打开 **View Runs** 并检查日志 |
| 预期时间范围内缺少告警 | 确认 Orchestrator 任务中的 `Timestamp field` 与 ES 文档结构一致；没有可用时间的告警显示 `Unknown Time` |
| 其他索引的告警没有列出 | 列表跟随当前 Elasticsearch 集成所用的索引；Splunk 告警始终列出 |
| 出现重复告警 | 确保源文档的唯一 ID 字段始终有值 |
| 告警没有生成工单 | Elasticsearch：检查 Orchestrator 运行计数，以及该告警是否为新增或变更；Correlation 可能已将其附加到已有工单。Splunk 告警不会自动生成工单 |
| **Detection Rule** 显示 `—` | 该告警的规则 ID 与平台中的任何检测规则都不匹配 |
