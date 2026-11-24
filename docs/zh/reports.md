---
layout: default
title: "报告"
lang: zh
lang_ref: reports
---

# 报告

报告模块是面向安全运营报告的 Report Designer。它基于实时 SOC 数据（告警、工单、风险实体和检测覆盖）生成 Markdown 报告，支持使用占位符和自有品牌信息编辑模板、实时预览，并可导出为 Markdown 或 PDF。

**导航路径：** `Monitoring → Reports`

<!-- TODO screenshot: assets/images/reports/report-designer.png (full Report Designer page: toolbar, Template data panel, Markdown Editor and Live Preview) -->

## 页面布局

页面标题为 **REPORT DESIGNER — Security report workspace**，副标题："Compose a reusable Markdown template with live SOC metrics and your organization branding."

| 区域 | 用途 |
|---|---|
| **工具栏** | 时间范围选择、**Regenerate**、**Copy Template**、**Export Resolved Markdown**、**Download PDF** |
| **Template data** | 公司品牌信息与占位符库（可折叠侧边面板） |
| **Markdown Editor** | 报告模板；编辑后预览立即更新 |
| **Live Preview** | 所有占位符解析后的渲染结果；滚动按章节与编辑器联动 |

---

## 时间范围

| 选项 | 时间窗口 |
|---|---|
| **24 Hours** | 最近 24 小时 |
| **7 Days** | 最近 7 天（打开页面时的默认值） |
| **30 Days** | 最近 30 天 |
| **All Time** | 从最早的已存储告警（或工单）到最新遥测数据 |

选择某个范围即会为其生成报告；**Regenerate** 会重新获取当前范围的最新数据。

报告窗口**结束于平台中最新的遥测时间**（最新的告警、关联事件、工单或风险事件），而不是当前时钟时间。这样导入的或较旧的数据仍然可用，并使 24 小时、7 天、30 天窗口相互嵌套。

若窗口内没有任何告警，执行摘要会追加提示："No alert events fall within this real-time window; the newest stored alert is ..."。

---

## Template data 面板

### Brand

| 字段 | 说明 |
|---|---|
| **Company name** | 最多 80 个字符；替换 `{{company.name}}`（为空时默认为 `Company`） |
| **Upload logo** | PNG、JPEG 或 WebP，**最大 1 MB**；用于预览和 PDF 中的 `{{company.logo}}` |
| **Use default** | 上传 Logo 后出现；恢复默认 Logo |

公司名称和 Logo **仅保存在当前浏览器中**（本地存储），不会保存到服务器，更换浏览器后不会同步。

### 占位符库

通过 **Search fields** 搜索框筛选占位符。每个条目显示其标记及当前解析出的值，并提供两个按钮：

- **Copy placeholder**：将标记（如 `{{metrics.total_alerts}}`）复制到剪贴板。
- **Insert at cursor**：将标记插入 Markdown Editor 的光标位置。

---

## 占位符

占位符写作 `{{key}}`。未知的 key 会原样保留。

| 分组 | 占位符 |
|---|---|
| **Brand** | `{{company.name}}`、`{{company.logo}}` |
| **Report** | `{{report.title}}`、`{{report.window}}`（范围的起止时间）、`{{report.generated_at}}` |
| **Metrics** | `{{metrics.posture}}`、`{{metrics.total_alerts}}`、`{{metrics.critical_high_alerts}}`、`{{metrics.total_tickets}}`、`{{metrics.resolved_tickets}}`、`{{metrics.resolution_rate}}`、`{{metrics.mttd}}`、`{{metrics.mttr}}`、`{{metrics.open_priority_incidents}}`、`{{metrics.log_source_coverage}}`、`{{metrics.attack_coverage}}` |
| **Charts** | `{{charts.category}}`、`{{charts.severity}}`、`{{charts.alert_trend}}`、`{{charts.score_trend}}`、`{{charts.funnel}}`、`{{charts.sankey}}`、`{{charts.attack_heatmap}}` |

说明：

- `{{metrics.log_source_coverage}}` 和 `{{metrics.attack_coverage}}` 显示百分比；未配置覆盖时显示 `N/A`。
- 图表占位符解析为生成的 PNG 图片，应作为图片地址使用，例如 `<img src="{{charts.severity}}" alt="Severity" />`。没有 ATT&CK 覆盖数据时，`{{charts.attack_heatmap}}` 显示 "NO COVERAGE DATA" 图片。
- 所有文本值在插入前都会进行 **HTML 转义**，因此值无法注入标记。只有 Logo 和图表图片以图片数据形式插入。

---

## 编辑与导出

模板为 Markdown，支持 GitHub 风格表格，并允许原始 HTML（默认模板用 HTML 实现页眉和图表）。在 **Markdown Editor** 中自由编辑，**Live Preview** 随输入更新。点击编辑器中的标题行，预览会滚动到对应章节。

| 按钮 | 结果 |
|---|---|
| **Copy Template** | 将 Markdown 源码（占位符保持未解析）复制到剪贴板 |
| **Export Resolved Markdown** | 下载 `soc-security-operations-report-<range>.md`，其中所有占位符已替换为实际值 |
| **Download PDF** | 将预览渲染为 A4 PDF，文件名为 `soc-report-<range>.pdf` |

编辑内容不会保存到服务器。请使用 **Copy Template** 保存自定义模板；注意点击 **Regenerate** 或切换时间范围会用新生成的默认模板替换编辑器内容。

---

## 默认报告章节

| 章节 | 内容 |
|---|---|
| 页眉 | Logo、公司名称和报告标题；密级、报告窗口和生成时间 |
| **1. Executive Summary** | 安全态势、告警总数、Critical + High 占比、工单处置情况、MTTD / MTTR、未关闭的高优先级事件 |
| **2. Core Metrics & Alert Severity** | 类别分布与严重级别分布图表、严重级别表、触发次数前 5 的检测规则 |
| **3. Alert Trend & Incident Response** | 告警趋势、评分趋势、转化漏斗、检测管道、响应表现、未关闭的 Critical 与 High 工单 |
| **4. Detection Coverage** | 日志源覆盖与 MITRE ATT&CK 覆盖（见下文） |
| **5. Top RBA Risk Entities** | 得分最高的风险实体及其类型、分数和等级 |
| **6. SOC Operational Recommendations** | 基于以上数据生成的建议，包括覆盖缺口 |

### Detection Coverage 章节

- **Log Source Coverage**：已配置的日志源类别中有多少正在接收日志、启用了多少检测规则，以及按类别的表格（Category、Sources、Receiving Logs、Enabled Rules）。
- **MITRE ATT&CK Coverage**：已启用规则覆盖了多少 ATT&CK 技术、覆盖热力图，以及按战术的表格（Tactic、Covered Techniques、Total Techniques）。

该章节只读取**已存储**的覆盖扫描结果，不会触发 Elasticsearch 扫描。两部分相互独立降级：一部分不可用时，另一部分仍会显示。两者都未配置时，章节显示 "Detection coverage has not been configured."。请在 **Dashboard → Coverage settings** 中对日志源分类并同步 ATT&CK 目录以填充该章节。

---

## 访问与可用性

报告生成 API 接受访客和匿名调用。若报告服务返回空内容或无法访问，页面会显示内置的示例 **SOC baseline template** 并给出警告（"Report service is unavailable; showing the SOC baseline template." 或 "Report service returned no content; showing the SOC baseline template."）。该模板中的示例数字仅作示意，并非实时数据。

---

## 故障排查

| 问题 | 检查项 |
|---|---|
| 出现 baseline template 警告 | 后端报告接口不可达或无返回；检查后端容器日志并点击 **Regenerate** |
| 所有指标均为零 | 尚无告警或工单；请先接入数据源 |
| "No alert events fall within this real-time window" | 窗口结束于最新遥测时间；选择 **30 Days** 或 **All Time**，或确认数据接入正在运行 |
| Detection Coverage 提示尚未配置 | 在 **Dashboard → Coverage settings** 中配置覆盖 |
| 覆盖显示 `N/A` | 对应的覆盖数据尚不可用 |
| Logo 上传被拒绝 | 使用不超过 1 MB 的 PNG、JPEG 或 WebP |
| 品牌信息消失 | 公司名称和 Logo 按浏览器保存；请在新浏览器中重新填写 |
| 切换范围后编辑内容丢失 | 切换范围或点击 **Regenerate** 会重新加载默认模板；请先复制你的模板 |

---

## 相关页面

- [仪表盘]({{ '/zh/dashboard/' | relative_url }})：Coverage settings 与实时统计
- [检测覆盖]({{ '/zh/detection-coverage/' | relative_url }})
