---
layout: default
title: "用例管理"
lang: zh
lang_ref: use-case-management
---

# 用例管理

用例管理是 Argus 的检测工程中心，提供 Sigma 检测规则的集中化导入、创建与发布管理，同时包含字段映射配置和发布历史审计记录。

**导航路径：** `Data Pipeline → Detection`

> **本指南范围：** 规则管理与字段映射配置。涉及批量上传、规则删除、发布等会改变系统数据的操作，应按团队变更管理流程执行。

![Detection / Rule Library 页面]({{ '/assets/images/use-case-management/detection-list.png' | relative_url }})

## 快速导航

| 页面 | 路径 |
|---|---|
| Rule Library | Data Pipeline → Detection → Rule Library 标签页 |
| Field Mappings | Data Pipeline → Detection → Field Mappings 标签页 |
| Publish History | Data Pipeline → Detection → Publish History 标签页 |

---

## Rule Library（规则库）

规则库是管理 Sigma 检测规则的主界面，支持搜索、过滤、批量导入和手工创建。

### 搜索与过滤

- **搜索框** — 按规则名称、标签或数据源过滤
- **Product 过滤器** — 缩小到特定产品的规则
- **Severity 过滤器** — Critical、High、Medium、Low
- **Status 过滤器** — Active、Draft、Disabled

### 导入规则

| 方式 | 说明 |
|---|---|
| **GitHub Rule URL** | 提供 GitHub 上 Sigma 规则 YAML 的 URL，平台自动抓取并导入 |
| **Upload Files** | 上传一个或多个本地 `.yml` Sigma 规则文件 |
| **Upload Folder** | 以 zip 压缩包形式上传规则文件夹 |

使用 **Export** 导出当前规则库。**Delete Selected** 删除已勾选规则（需确认）。

### 手工创建规则

![New Rule 弹窗]({{ '/assets/images/use-case-management/new-rule-modal.png' | relative_url }})

1. 点击 **New Rule**。
2. 填写必填字段：
   - **Rule ID** — 唯一标识符（如 `aws_cloudtrail_root_login`）
   - **Sigma YAML** — 完整 Sigma 规则定义
3. 点击 **Submit**。

> **提交前建议：** 由检测工程师复核 YAML 语法、字段引用和严重级别。规则错误往往在发布时而非创建时暴露。

### 规则命名规范

遵循包含数据源、检测行为和实体的命名方案：

```
<数据源>_<行为>_<实体>
```

示例：
- `aws_cloudtrail_root_login`
- `windows_defender_malware_detected`
- `linux_sudo_privilege_escalation`

---

## Field Mappings（字段映射）

字段映射将 Sigma 的标准字段名转换为查询后端（Splunk、Elasticsearch）实际使用的字段名。映射质量直接决定规则能否命中正确日志。

**导航路径：** `Data Pipeline → Detection → Field Mappings`

![字段映射列表]({{ '/assets/images/use-case-management/field-mappings.png' | relative_url }})

### 映射结构

| 列 | 说明 |
|---|---|
| **Profile** | 映射配置分组，如 `aws_cloudtrail` 或 `windows_sysmon` |
| **Sigma Field** | Sigma 规则中使用的规范字段名 |
| **Splunk Field** | Splunk 中对应的字段名 |
| **Elastic ECS Field** | Elasticsearch ECS 中对应的字段名 |
| **Elastic Index Patterns** | 该映射适用的 Elasticsearch 索引范围 |

### 创建字段映射

![New Mapping 弹窗]({{ '/assets/images/use-case-management/new-mapping-modal.png' | relative_url }})

1. 点击 **New Mapping**（或 **Download CSV Template** 通过 CSV 批量导入）。
2. 选择或输入 **Profile**。
3. 输入 **Sigma Field** 名称。
4. 填写对应的 Splunk 和/或 Elastic 字段名。
5. 指定 Elastic Index Patterns（如 `logs-*`、`alerts`）。
6. 点击 **Save**。

### 映射最佳实践

- 为每个数据源创建独立的 Profile（`aws_cloudtrail`、`windows_sysmon`、`linux_auditd`）。
- 在发布规则前，对照实际索引模板验证字段名。
- 确认 Elastic Index Pattern 覆盖实际存储数据的索引。
- 新增映射后，重新发布受影响的规则以应用更新后的字段转换。

---

## Publish History（发布历史）

发布历史提供每次规则发布操作的完整审计记录。

**导航路径：** `Data Pipeline → Detection → Publish History`

![发布历史页面]({{ '/assets/images/use-case-management/publish-history.png' | relative_url }})

### 列说明

| 列 | 说明 |
|---|---|
| **Rule** | 已发布规则的名称 |
| **Target** | 发布目标（如 Elastic 部署、Splunk 实例） |
| **Action** | 执行的操作（Publish、Update、Delete） |
| **Status** | 成功 / 失败 |
| **Message** | 详细结果信息；发布失败时优先查看此列 |
| **Time** | 发布时间戳 |

### 发布失败诊断

当发布状态显示 **Failed** 时：

1. 阅读 **Message** 列——通常会指明具体错误（YAML 无效、字段映射缺失、目标不可达）。
2. 检查规则的 Sigma YAML 语法是否正确。
3. 确认规则中引用的所有字段在对应 Profile 中均有映射。
4. 确认目标后端（Elastic / Splunk）可达，且集成配置正确。

---

## 用例管理检查清单

在发布新检测规则前，请逐项核对：

- [ ] 数据源已接入并正在采集数据（Data Pipeline → Integrations）
- [ ] 规则使用的每个 Sigma 字段均有对应的字段映射
- [ ] 规则名称遵循 `数据源_行为_实体` 命名规范
- [ ] 严重级别设置合理——避免将所有规则默认设为 Critical
- [ ] 规则已在测试/预发布索引上验证误报率
- [ ] 批量操作（删除、批量上传、发布）已获得变更管理审批
