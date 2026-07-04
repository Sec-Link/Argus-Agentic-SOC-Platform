---
layout: default
title: "仪表盘"
lang: zh
lang_ref: dashboard
---

# 仪表盘

仪表盘是登录后的默认落地页，以单一视图实时呈现安全运营环境的全貌：告警量、数据源健康状态、严重级别趋势及关联分析状态。

**导航路径：** `Monitor → Overview`

![Dashboard Overview]({{ '/assets/images/dashboard/dashboard-overview.png' | relative_url }})

## 统计卡片

仪表盘顶部展示以下汇总指标：

| 卡片 | 说明 |
|---|---|
| **Alerts in 15 min** | 最近 15 分钟内接入的告警数 |
| **Alerts in 1 h** | 最近 1 小时内接入的告警数 |
| **Alerts in 24 h** | 最近 24 小时内接入的告警数 |
| **Alerts in 7 days** | 最近 7 天内接入的告警数 |
| **Total Alerts** | 自系统初始化以来的累计告警数 |
| **Data Sources** | 已配置并激活的数据源集成数量 |

> 若登录后所有数值均为零，说明尚未接入任何数据源。请前往[数据接入]({{ '/zh/data-onboarding/' | relative_url }})配置首个集成。

## 告警趋势图

统计卡片下方的时间序列图展示可配置时间窗口内的告警接入量变化，可用于：

- 识别与安全事件关联的接入峰值
- 确认 Orchestrator 定时任务是否按计划执行
- 检测数据源故障（正常情况下持续接入告警时出现平线）

## 严重级别分布

分布图展示按严重级别分类的告警比例：

| 严重级别 | 典型颜色 |
|---|---|
| Critical（严重） | 红色 |
| High（高危） | 橙色 |
| Medium（中危） | 黄色 |
| Low（低危） | 蓝色 / 灰色 |

持续监控严重级别分布变化，有助于发现检测漂移——例如，Critical 告警突然增多可能意味着新的活跃威胁，或检测规则误报增加。

## 导航结构

左侧边栏按功能域组织平台模块：

| 功能域 | 包含模块 |
|---|---|
| **Monitor** | Overview（仪表盘）、Alerts（告警） |
| **Investigation** | Tickets（工单） |
| **Data Pipeline** | Integrations、Orchestrator、Correlation、Detection |
| **Settings** | Workflows、Administration |

## 初始状态

全新安装且未配置数据源时：
- 所有告警计数均显示 `0`
- 趋势图为空
- Data Sources 显示 `0`

**建议首要操作步骤：**

1. 前往[数据接入]({{ '/zh/data-onboarding/' | relative_url }}) → 配置 Elasticsearch 集成
2. 创建 Orchestrator 任务以开始采集告警数据
3. 配置 Correlation 关联策略以自动从告警生成工单
4. 返回仪表盘确认数据流转正常

## 数据刷新

仪表盘会定期自动刷新。如需手动强制刷新，重新加载页面即可。告警统计反映的是已写入内部数据库的数据——新接入的告警将在下一次 Orchestrator 任务完成后显示。
