---
layout: default
title: "仪表盘"
lang: zh
lang_ref: dashboard
---

# 仪表盘

仪表盘是登录后的默认落地页。它在一个页面内呈现安全运营环境的实时全貌（告警量、严重级别与评分趋势、Top 榜单、从原始事件到工单的流转），并提供检测覆盖率摘要，另有一个标签页用于配置该覆盖率。

**导航路径：** `Monitoring → Overview`

![Dashboard Overview]({{ '/assets/images/dashboard/dashboard-overview.png' | relative_url }})
<!-- TODO screenshot: assets/images/dashboard/dashboard-overview.png is outdated; it predates the new KPI cards (Enabled SIEM Rules, Detections (Last Hour)), the Detection coverage card and the Events flow panel. Recapture the full Overview tab. -->

## 标签页与顶部控件

页面包含两个标签页。当前标签页记录在 URL 中，因此浏览器的后退与前进按钮可在两者之间切换。

| 标签页 | URL | 用途 |
|---|---|---|
| **Overview** | `/dashboard` | KPI 卡片、图表、表格、Events flow 以及关联分析流水线 |
| **Coverage settings** | `/dashboard?tab=coverage` | 日志源扫描、分类与 ATT&CK 目录同步，详见[检测覆盖]({{ '/zh/detection-coverage/' | relative_url }}) |

在 **Overview** 标签页中，标签栏右侧的控件如下：

| 控件 | 说明 |
|---|---|
| **Customize layout** / **Done** | 开启或关闭拖拽排序（见自定义布局） |
| **Reset layout** | 仅在自定义布局状态下且顺序与默认不同时出现 |
| 时间选择器 | 显示当前范围（如 `All Time`），点击展开范围菜单 |

页面顶部的 **Guide** 按钮见页面引导。

<!-- TODO screenshot: assets/images/dashboard/header-controls.png (tab bar with Customize layout and the time picker closed) -->

## 时间范围

时间选择器决定 Overview 标签页统计哪一段时间内的告警和工单，默认值为 **ALL TIME**。

### 预设范围

| 预设 | 范围 |
|---|---|
| **1H** | 最近 1 小时 |
| **24H** | 最近 24 小时 |
| **7D** | 最近 7 天 |
| **ALL TIME** | 不限时间 |
| **CUSTOM** | 自行输入的起止时间 |

1H、24H、7D 和 ALL TIME 在点击后立即生效。

### 自定义范围

1. 点击 **CUSTOM**。
2. 为 **Start** 和 **End** 分别选择日期并输入时间（`HH:mm:ss`）。**Now** 会把结束时间设为当前时刻。
3. 点击 **Apply Custom**。

输入无效（缺少日期、时间格式错误或起始时间晚于结束时间）时，字段下方会给出提示，且 **Apply Custom** 不可用。启用自定义范围后，选择器会显示 *Custom window locked for auto-refresh*：自动刷新会始终重新读取该固定窗口。

<!-- TODO screenshot: assets/images/dashboard/time-picker.png (time range menu with CUSTOM selected) -->

### 默认时间范围

点击 **Set as Default** 可把当前范围保存为默认值。默认值仅保存在当前浏览器中，下次打开仪表盘时生效。未保存默认值时，页面会恢复当前浏览器会话中最后使用的范围，否则使用 ALL TIME。

## 自动刷新

浏览器标签页可见时，Overview 数据每 10 秒重新加载一次，切回该标签页时也会再加载一次。每个 KPI 卡片、图表和表格还带有各自的刷新图标，可单独刷新该面板。告警统计反映的是已写入平台数据库的数据，因此新接入的告警会在下一次 Orchestrator 任务完成后显示（参见[数据接入]({{ '/zh/data-onboarding/' | relative_url }})）。

## KPI 卡片

五张卡片均遵循所选时间范围。

| 卡片 | 统计内容 |
|---|---|
| **Alerts in Last Hour** | 所选范围最后 1 小时内的告警数 |
| **Total Alerts** | 所选范围内的告警数 |
| **Data Sources** | 这些告警涉及的不同来源索引数 |
| **Enabled SIEM Rules** | 这些告警涉及的不同检测规则数 |
| **Detections (Last Hour)** | 所选范围最后 1 小时内产生告警的不同检测规则数 |

> 若登录后所有卡片均为零，说明尚未接入任何告警。请前往[数据接入]({{ '/zh/data-onboarding/' | relative_url }})配置首个集成。

## 面板

| 面板 | 说明 |
|---|---|
| **Detection coverage** | 日志源与 ATT&CK 覆盖率摘要（见下文） |
| **Alert Category Breakdown** | 按类别统计告警的饼图 |
| **Alert Trend** | 告警量随时间变化；**Group by** 可选 `1 hour` 或 `1 day` |
| **Alert Severity Distribution** | 按严重级别统计告警的饼图 |
| **Alert Score Trend** | 告警评分随时间变化；**Group by** 可选 `1 hour` 或 `1 day` |
| **Top Source 10 IP** | 告警最多的源 IP（列：IP、Count） |
| **Top 10 Users** | 告警最多的用户（User、Count） |
| **Top 10 Sources** | 告警最多的告警来源（Source、Count） |
| **Top 10 Rules** | 触发最多的检测规则（Rule、Count） |
| **Events flow** | 日志量流向告警和工单的过程（见下文） |
| **Alert Correlation — 5-Stage Detection Pipeline** | 从 ATT&CK 战术到事件级别的桑基图（见下文） |

Top 10 表格每页显示五行。没有数据的面板会显示 “No data” 占位。持续观察严重级别和趋势面板有助于发现检测漂移——例如 Critical 告警突然增多，可能意味着出现新的活跃威胁，或某条规则产生了误报。

## 检测覆盖卡片

**Detection coverage** 卡片回答两个问题：应当监控的系统是否在发送日志，以及已启用的规则覆盖了哪些攻击技术。

- **日志源覆盖** — 四个数字：**Coverage**（百分比）、**Receiving logs**（有日志的类别数 / 已配置类别数）、**Enabled rules**（已启用规则 / 全部规则）以及 **Unmonitored sources**。
- **类别磁贴** — 每个已配置类别一张，含绿色或红色进度条（是否收到日志）、来源数量以及 `n/m rules on`。点击磁贴会打开 **Coverage settings**。
- **扫描时间** — *Last scanned …*（超过 24 小时后变为警告色）或 *Never scanned*。
- **MITRE ATT&CK 覆盖热力图** — **Coverage**、**Techniques covered** 以及战术-技术矩阵。点击战术或技术会打开按其过滤的 Detection 规则列表。

将鼠标悬停在标签旁的 **?** 上可查看一句话定义；点击它可查看详细说明（是什么、如何计算、为何重要、如何改进）。点击数字可打开明细表，查看对应的类别、规则或来源。

卡片上有 **Coverage settings** 按钮。尚未配置覆盖率时，卡片显示 *Coverage is not set up yet* 和 **Set up coverage** 按钮；数据加载失败时提供 **Retry**。各数字的计算方式以及如何完成配置，请参见[检测覆盖]({{ '/zh/detection-coverage/' | relative_url }})。

<!-- TODO screenshot: assets/images/dashboard/detection-coverage-card.png (Detection coverage card with stats, category tiles and ATT&CK heatmap) -->

## Events flow（事件流）

**Events flow** 展示各日志源类别产生了多少日志，以及其中有多少最终变成告警和工单。从左向右阅读：

1. **日志源类别**（EDR、Firewall、Identity 等），每个类别下列出其主要来源。
2. **Events** — 所有类别的总量，位于中央。
3. **Alerts** — 所选时间范围内的告警。
4. **Open tickets** — 尚未 resolved 或 closed 的工单。
5. **Incidents** — 结果为 `true_positive` 的工单。

### 数字的构成

- **Events** 来自最近一次日志源扫描（默认最近 7 天），不受时间选择器影响。卡片副标题会注明该窗口。
- **Alerts**、**Open tickets** 和 **Incidents** 遵循时间选择器。
- 被标记为忽略的来源不计入。未分配到任何类别的来源会组成 **Unclassified** 分支：它始终绘制在最后（即使事件最多），默认折叠，并且仍计入 Events 总数。
- 每个类别显示前 5 个来源，其余合并为 **+N more**，点击 **Show less** 可再次折叠。

如果尚无日志源扫描，卡片会显示 *No log source scan yet, so event volume is unknown* 和 **Set up coverage** 按钮。

### 图表交互

| 点击目标 | 打开 |
|---|---|
| 某个类别，或 **Events** 总数 | **Coverage settings** 标签页（卡片上的 **Coverage settings** 链接同样如此） |
| **Alerts** | `/alerts` |
| **Open tickets** | `/tickets?status=open` |
| **Incidents** | `/tickets?result=true_positive` |

将鼠标悬停在来源、类别或节点上可查看提示（事件数及占总量比例、最近出现时间、分类方式、大致主机数和索引数）。当操作系统设置为减少动态效果时，流动动画会关闭。图表有最小宽度，屏幕更窄时卡片会横向滚动。

<!-- TODO screenshot: assets/images/dashboard/events-flow.png (Events flow with categories, sources, Events total, Alerts, Open tickets and Incidents) -->

## 告警关联流水线

**Alert Correlation — 5-Stage Detection Pipeline** 是基于所选时间范围内创建的工单生成的桑基图，共五个阶段：**MITRE ATT&CK Framework**、**Developed Use Cases**、**Alerts**、**Resolution** 和 **Event Level**。ATT&CK 战术与用例分组由各工单关联告警所对应规则的 ATT&CK 标签推导而来。若所选范围内没有同时具备类别、处理结果和优先级的工单，面板会显示 *No correlation data available*。

## 自定义布局

1. 点击 **Customize layout**。
2. 将 KPI 卡片在其自身之间、面板在面板之间拖拽到期望的顺序。
3. 点击 **Done**。**Reset layout** 可恢复默认顺序。

顺序保存在当前浏览器中，不影响其他用户或其他浏览器。

## 页面引导

页面顶部的 **Guide** 按钮（仅仪表盘页面提供）会启动当前标签页（Overview 或 Coverage settings）的分步引导。引导不会自动开始，需要时手动点击 **Guide** 即可。

## 导航结构

左侧边栏将平台划分为五个功能组：

| 功能组 | 包含项 |
|---|---|
| **Monitoring** | Overview（仪表盘）、Alerts、Reports |
| **Investigation** | Tickets、Assets |
| **Data Pipeline** | Detection、Integrations、Orchestrator、Correlation |
| **Automation** | Interfaces、Workflows、Executions |
| **Administration** | Access Management、AI Assistant、Approvals、Audit Logs、System Settings |

## 初始状态

全新安装且未配置数据源时：

- 所有 KPI 卡片显示 `0`，趋势类面板为空。
- Detection coverage 卡片显示 *Coverage is not set up yet*，Events flow 显示 *No log source scan yet*。

**建议首要操作步骤：**

1. 前往[数据接入]({{ '/zh/data-onboarding/' | relative_url }})，配置 Elasticsearch 集成。
2. 创建 Orchestrator 任务以开始采集告警数据。
3. 配置 Correlation 关联策略，自动从告警生成工单。
4. 打开 **Coverage settings** 标签页并完成覆盖率配置（[检测覆盖]({{ '/zh/detection-coverage/' | relative_url }})）。
5. 返回 Overview 标签页，确认数据流转正常。
