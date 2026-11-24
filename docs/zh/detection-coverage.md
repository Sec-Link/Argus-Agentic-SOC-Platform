---
layout: default
title: "检测覆盖"
lang: zh
lang_ref: detection-coverage
---

# 检测覆盖

检测覆盖用于回答：应当监控的系统是否真的在发送日志，已启用的检测规则是否覆盖这些系统以及你关心的 MITRE ATT&CK 技术。它从 Elasticsearch 中发现日志源，将其归入不同类别（Endpoint、Firewall、Identity 等），再与规则库进行对照。

**导航路径：** `Monitoring → Overview → Coverage settings 标签页`

Overview 标签页上的只读 **Detection coverage** 卡片展示相同的核心数字。本页介绍的所有配置与说明均位于 **Coverage settings** 标签页（`/dashboard?tab=coverage`）。

<!-- TODO screenshot: assets/images/detection-coverage/coverage-settings-tab.png (Coverage settings tab: Detection Log Source Coverage card above MITRE ATT&CK Coverage card) -->

## 能回答什么问题

| 问题 | 在何处回答 |
|---|---|
| 预期的各类系统（终端、防火墙、身份、云等）是否在发送日志？ | **Detection Log Source Coverage** 卡片 |
| 收到的日志是否有已启用的规则覆盖，这些规则能否真正触发？ | 同一卡片中的规则计数和日志源状态标签 |
| 哪些 ATT&CK 技术至少被一条已启用规则覆盖？ | **MITRE ATT&CK Coverage** 卡片 |

## 首次配置

**前提：** 已启用的 Elasticsearch 集成（`Data Pipeline → Integrations`）。没有它就无法发现日志源，覆盖率只能退回到仅基于告警来源推断。

1. 打开 `Monitoring → Overview`，选择 **Coverage settings** 标签页。在已启用 Elasticsearch 的情况下，首次访问时平台会自动扫描一次。若尚未扫描（或需要最新数据），由管理员点击 **Rescan**。
2. 点击 **Configure**，打开 **Discovered sources**。检查自动分类结果，修正错误或缺失的归类（见下文“归类未知日志源”）。
3. 在 **Configure → Categories** 中，确认类别、可选的 CMDB 资产类型以及主机字段符合你的环境。
4. 在 **MITRE ATT&CK Coverage** 卡片中点击一次 **Sync ATT&CK catalog**，使覆盖率基于完整技术列表计算。
5. 为检测规则打标签、启用并发布（见下文“提升覆盖率”）。

扫描、**Configure** 和目录同步按钮仅对管理员可见（见下文“权限”）。

## 日志源发现

*日志源* 是承载同一类日志的一组 Elasticsearch 索引或数据流的逻辑分组。发现机制如下：

- **已保存的扫描结果。** 一次扫描会读取 Elasticsearch 最近 7 天的数据并保存结果。Coverage settings 页面和仪表盘读取的是已保存的扫描结果；打开页面不会重新扫描。唯一的自动扫描是尚无任何扫描结果时的首次扫描。
- **重新扫描。** 管理员可随时点击 **Rescan**（卡片）或 **Re-scan**（抽屉）。扫描失败时会保留上一次成功的快照，并通过 *Re-scan failed: …* 提示原因。
- **最多 300 个日志源**，按数据量从高到低。超出时抽屉会显示 *Only the busiest sources are listed.*
- **跳过项。** 以点开头的隐藏索引（如 `.kibana`、`.alerts-*`）不属于日志源，平台自身读取告警的索引同样不计入。
- **名称归一化。** 具体索引名会通过去除日期、滚动序号和版本号折叠为一个日志源键，因此一组按天滚动的索引只算一个日志源。例如 `winlogbeat-8.11.0-2026.10.27` 会变为 `winlogbeat-*`，数据流后备索引 `.ds-logs-okta.system-default-2026.10.01-000001` 会变为 `logs-okta.system-*`。
- **自动分类。** 平台依据日志源名称、`event.module` / `event.dataset` 取值，以及作为较弱线索的 ECS `event.category`（例如 `authentication` 建议归入 Identity，`process` 建议归入 Endpoint，`network` 建议归入 Firewall）为每个日志源给出建议类别。建议会映射到*同名*类别；如果你重命名或删除了该类别，该日志源将保持未分类。建议可能有误。
- **手动设置优先。** 你手动指定的类别或忽略操作会取代自动建议，并在之后的扫描中保留。**Reset to automatic** 可将其移除。已从 Elasticsearch 中消失的日志源如果存在手动设置，仍会保留在列表中，以便你重置。

*Last scanned …* 状态行显示扫描距今的时间；超过 24 小时会变为警告色，尚无扫描时显示 *Never scanned*。

## Configure 抽屉

点击 **Detection Log Source Coverage** 卡片右上角的 **Configure**，会打开 **Log source coverage settings** 抽屉，包含两个标签页。

<!-- TODO screenshot: assets/images/detection-coverage/configure-drawer-sources.png (Configure drawer, Discovered sources tab) -->

### Discovered sources 标签页

| 元素 | 说明 |
|---|---|
| 筛选 | **All**、**Unclassified**、**Manual**、**Ignored** |
| **Search sources** | 按日志源名称过滤 |
| **Re-scan** | 执行新的扫描；旁边显示扫描时间 |
| 列 | **Source**、**Docs**（窗口内文档数）、**Last seen**、**Suggested**（自动建议类别，按置信度着色，悬停显示依据）、**Category** |
| **Category** 选择器 | **Auto (suggested)**、任一类别、**Unclassified** 或 **Ignore** |
| 重置图标 | **Reset to automatic**；仅在存在手动设置的日志源上显示 |
| **Assign to…** + **Apply** | 勾选多行，选择目标后统一应用 |

出现 *Elasticsearch is not available* 提示表示集成已停用或无法连接。

### Categories 标签页

当某个类别下任一日志源在扫描窗口内收到数据时，该类别即视为已覆盖。每个类别在各自的卡片中编辑：

| 字段 | 说明 |
|---|---|
| **Name** | 必填，最长 100 个字符，不可重复 |
| **Enabled** | 仅启用的类别会被评估并显示在卡片上 |
| **Icon** | 自定义图标（见下文） |
| **Advanced: extra index patterns** | 可选的通配符模式（如 `winlogbeat-*`），用于把更多日志源纳入该类别。仅用于发现机制遗漏的索引。**Test match** 会列出匹配的索引及其最近 7 天的文档数 |
| **CMDB asset types (optional)** | 预期会发送日志的资产类型，用于 **Hosts reporting** 进度条 |
| **Host field in logs** | 日志中存放主机名的 Elasticsearch 字段，默认 `host.name` |

点击 **Save** 保存；新建类别请点击 **Add category**。垃圾桶图标在确认（**Delete this category?**）后删除类别，其下日志源的手动归类也会一并移除。平台预置七个类别：**Endpoint**、**EDR**、**Firewall**、**Identity**、**Cloud**、**DNS** 和 **Email**。

### 自定义类别图标

图标显示在仪表盘的 Events flow 图中；未设置图标的类别使用默认图标。

1. 先保存类别（新类别在创建前不能设置图标）。
2. 在 **Configure → Categories** 中展开该类别，点击 **Icon** 旁的 **Upload**。
3. 如需恢复默认，点击 **Use default**。

| 规则 | 限制 |
|---|---|
| 文件类型 | PNG、JPEG、WebP（SVG 和 GIF 会被拒绝） |
| 文件大小 | 最大 256 KB |
| 尺寸 | 最多 400 万像素 |
| 处理方式 | 重新编码为缩放至 96 × 96 以内的 PNG，不保存原始文件及其元数据 |
| 权限 | 仅管理员 |

## 归类未知日志源

没有匹配任何类别的日志源会显示在类别卡片上方的 **Unclassified sources (n)** 面板中。管理员可以：

- 将标签**拖拽**到某个类别卡片上完成归类（拖回该面板则取消归类）。
- 点击标签上的 **×** 将其**忽略**，例如指标类或内部索引。被忽略的日志源不计入覆盖率。
- 标签超过六个时，使用 **Show all (n)** / **Collapse** 展开或收起。
- 如需恢复已忽略的日志源，点击卡片下方的 **Show ignored sources (n)**，再点击对应标签。

非管理员可以看到该面板，但需联系管理员进行归类。

<!-- TODO screenshot: assets/images/detection-coverage/classify-sources.png (Unclassified sources panel with a chip being dragged onto a category card) -->

## 解读日志源覆盖

### 日志源状态与边框

每个日志源标签按**告警状态**着色。点击卡片右上角的 **?**（**Colour legend**）可在页面中查看该图例。

| 状态 | 含义 |
|---|---|
| **Alerting** | 正在接收日志，且至少有一条已启用规则使用它 |
| **Unmonitored** | 正在接收日志，但没有已启用规则使用它——存在检测缺口 |
| **Blind** | 有已启用规则使用它，但窗口内没有日志到达，规则无法触发 |
| **Silent** | 窗口内没有日志，也没有已启用规则 |

标签的边框或标记表示分类方式：

| 标记 | 含义 |
|---|---|
| 实线边框 | 自动分类 |
| 图钉图标 | 管理员手动指定 |
| 虚线边框 | 尚未归入任何类别 |
| 已忽略（恢复列表） | 已忽略，不计入覆盖率 |

悬停在标签上可查看其状态、文档数、使用它的已启用规则数与规则总数，以及分类方式。

### 指标

卡片顶部的数字均针对扫描窗口（默认 7 天）。点击任一数字可打开明细表，每个标签旁的 **?** 会在页面中给出解释。

| 指标 | 计算方式 |
|---|---|
| **Log source coverage** | 有日志的类别数 ÷ 已配置类别数，以百分比表示。首次扫描后，每个已启用的类别都算作*已配置*；某类别下至少有一个日志源在窗口内有文档，即算作*有日志*。因此没有任何日志源的类别会拉低百分比。60% 及以上为绿色，30% 及以上为橙色，其余为红色 |
| **Receiving logs (last 7d)** | `有日志 / 已配置` 的类别数 |
| **Enabled rules / total** | 已启用规则 ÷ 规则库中所有未删除的规则，并附百分比。“已启用”取自平台中保存的状态，该状态会在规则发布到 Kibana 或从 Kibana 同步时更新 |
| **Rules with live data** | 至少映射到一个正在接收日志的类别的已启用规则，即能够触发的规则 |
| **Rules without data** | 已映射到类别，但这些类别在窗口内均无日志的已启用规则；在日志恢复前属于盲区 |
| **Rules, source unknown** | 无法关联到任何类别的已启用规则（见下文） |
| **Unmonitored sources** | 窗口内有文档，但没有已启用规则归属的日志源 |

> **“Alerting” 是下限值。** 没有索引模式，或只有 `logs-*` 这类过于宽泛的模式的规则，不会被归属到任何单一日志源。因此即使某条宽泛规则确实覆盖了某个日志源，该日志源仍可能显示为 Unmonitored。

### 规则如何映射到类别

对每条未删除的规则，平台首先读取其索引模式（规则上保存的 Elastic index patterns，以及随 Kibana 定义保存的 `index` 列表）。

- **类别。** 将模式与每个日志源键用通配符进行双向匹配，命中的日志源决定其所属类别。若某个模式命中了超过两个不同类别下的日志源（如 `logs-*`），则视为过于宽泛而被忽略。
- **日志源。** 同样的模式用于把规则归属到具体日志源，但命中超过八个日志源的模式在此处会被忽略。
- **回退。** 如果模式未得出任何类别，平台会对规则的索引模式及其 Sigma 日志源字段（`product`、`service`、`category`）应用与日志源相同的名称启发式，并把推测结果映射到同名类别。
- 仍无结果的规则计入 **Rules, source unknown**。为规则添加具体的索引模式即可解决。

规则明细表最多显示 1,000 条规则。

### 类别卡片

每个已启用的类别显示为一张卡片：

| 元素 | 说明 |
|---|---|
| 状态圆点 | 绿色表示有日志，红色表示无日志，灰色表示未配置 |
| 标签 | **Not configured**（尚未扫描且无索引模式）、**No sources**（红色；已有扫描但未分配任何日志源）、**alerts only**（橙色；Elasticsearch 不可用，覆盖情况由告警来源索引推断，通常偏低） |
| Last seen | 最近一条文档的时间，或 *No data in the last 7 days* |
| **Rules on** 进度条 | 归属该类别的已启用规则 / 规则总数 |
| 日志源标签 | 前六个日志源，其后为 `+N` / `less` |
| **Hosts reporting** 进度条 | 日志中出现的主机（按 **Host field in logs**）÷ 关联的 **CMDB asset types** 所含主机。仅当类别设置了资产类型且 Elasticsearch 可达时显示。主机名比较不区分大小写 |

如果某个类别完全没有日志源，请在 **Configure** 中为其分配。

## MITRE ATT&CK 覆盖

**MITRE ATT&CK Coverage** 卡片衡量已启用规则覆盖了多少 ATT&CK 技术。

### 解读卡片与热力图

- **Coverage (%)** = 至少有一条已启用规则的父技术数 ÷ 已同步目录中的父技术数。子技术（如 `T1059.001`）计入其父技术（`T1059`）。颜色：60% 及以上为绿色，30% 及以上为橙色，其余为红色。
- **Techniques covered** `x / y` — 点击可打开 **Covered techniques** 弹窗，列出每个已覆盖技术的名称、所属战术和规则数。点击技术 ID 会打开按该技术过滤的规则列表。
- **Enabled rules** — 参与覆盖率计算的已启用规则；点击可打开规则列表。
- **Coverage by tactic** — 每个战术一条进度条，显示 `已覆盖 / 总数` 技术；悬停可查看已覆盖技术，点击会打开按该战术过滤的规则列表。
- **Technique matrix** — 每个技术一个小方块，按战术分组（属于多个战术的技术会在每个战术下各出现一次）。颜色按已启用规则数区分：灰色 0 条，浅蓝 1 条，蓝色 2–3 条，深蓝 4 条及以上。悬停可查看技术和规则数；点击会打开按该技术（`attack.<technique>`）或战术预先过滤的 **Detection** 规则列表。

可能出现两种警告：*ATT&CK catalog is not loaded*（请同步目录，见下文）和 *No ATT&CK techniques found on enabled rules*（存在已启用规则，但没有任何规则带有 ATT&CK 标签）。目录加载之前，矩阵只列出规则上已出现的技术，总数显示为 `?`。

<!-- TODO screenshot: assets/images/detection-coverage/attack-coverage.png (MITRE ATT&CK Coverage card with tactic bars and technique matrix) -->

### 同步 ATT&CK 目录

点击 **Sync ATT&CK catalog**（管理员）；链接留空则使用 MITRE 官方最新的 ATT&CK Enterprise 数据，也可填写自己的链接，然后点击 **Sync**。

| 要求 | 说明 |
|---|---|
| URL | 仅限 `https`，且必须解析到公网地址（私有地址会被拒绝）。最多 3 次重定向，60 秒超时 |
| 内容 | ATT&CK **Enterprise** 矩阵的 STIX 2.1 JSON 包（含 `TA####` 编号的战术对象和 `T####` / `T####.###` 编号的技术对象）。请勿混用 Mobile 或 ICS 数据包 |
| 大小 | 最大 100 MB |
| 影响 | **替换整个目录**（已撤销和已弃用的条目会被跳过），并**重建所有规则的 ATT&CK 映射**。完成后提示 *Synced ATT&CK <version>: n techniques, m rules re-mapped* |

不含战术和技术的数据包会被拒绝，现有目录保持不变。你最近使用的自定义 URL 会保存在浏览器中。

## 提升覆盖率

**ATT&CK 覆盖率**

1. 在 `Data Pipeline → Detection` 中打开规则，在 **Tags** 卡片里先添加 `attack.<tactic>` 标签（如 `attack.execution`），再添加技术标签，如 `attack.t1059.001`。技术标签会归属到其上方最近的战术标签；如果之前没有战术标签，则依据已同步的目录推断战术。
2. 保存标签，然后**启用**规则并发布到 Kibana。
3. 重新查看卡片。

只有**已启用且未删除**的规则才会计入。标签保存后即计入覆盖率，无需等到发布到 Kibana。规则的 Kibana threat 字段中声明的技术同样会被统计。

**日志源与规则覆盖率**

- 为缺失的日志源完成归类，并恢复红色类别中沉默的日志采集。
- 为 **Unmonitored** 日志源添加或启用规则。
- 为规则设置具体的索引模式，使其映射到日志源，而不是停留在 **Rules, source unknown**。
- 如果 Kibana 中的启用状态与平台不一致，请在规则库中执行 **Sync with Kibana**（见[用例管理]({{ '/zh/use-case-management/' | relative_url }})）；覆盖率读取的是平台中保存的启用标记。

## 权限

| 操作 | 权限 |
|---|---|
| 查看卡片、提示和明细表 | 任何已登录用户 |
| **Rescan**、**Configure**、归类/忽略/恢复日志源、添加/编辑/删除类别、上传或重置图标、**Test match**、**Sync ATT&CK catalog** | 管理员（staff 用户） |

没有该权限的用户看不到这些按钮，API 也会拒绝相应请求。

## 故障排查

| 现象 | 原因与处理 |
|---|---|
| *Log sources have not been scanned yet* | 没有已保存的扫描结果。由管理员点击 **Rescan** |
| *Log sources could not be scanned* 并附原因 | Elasticsearch 已停用、无法连接，或凭据缺少索引权限。请修复集成；在此期间覆盖率仅基于告警来源（显示 **alerts only** 标签） |
| *Re-scan failed: …* | 仍在使用上一次的扫描结果。排除原因后重新扫描 |
| 某个日志源缺失 | 以点开头的索引和平台自身的告警索引会被跳过；超过 300 个时只保留数据量最大的；扫描最多回溯 7 天，出现新索引后请重新扫描 |
| 某类别显示 **No sources** | 尚未分配日志源。在 **Configure → Discovered sources** 中分配，或为该类别添加索引模式 |
| 建议类别指向不存在的类别 | 同名类别已被重命名或删除。请手动指定 |
| 大量 **Rules, source unknown** | 规则缺少具体的索引模式。请为规则补充 |
| **Rules without data** 偏高 | 该类别近期没有日志。请恢复日志采集，或禁用/调整规则 |
| *ATT&CK catalog is not loaded* | 点击 **Sync ATT&CK catalog** |
| *No ATT&CK techniques found on enabled rules* | 为规则添加 `attack.*` 标签并启用 |
| 在 Kibana 中启用规则后覆盖率没有变化 | 平台中仍是旧标记。请执行 **Sync with Kibana** |
| 图标上传失败 | 检查类型（PNG/JPEG/WebP）、大小（256 KB）、尺寸（400 万像素），并确认类别已先保存 |
| 目录同步提示 *Only https URLs are allowed.* 或非公网地址错误 | 请使用公网可访问的 `https` URL |

## 另请参阅

- [仪表盘]({{ '/zh/dashboard/' | relative_url }}) — Overview 标签页，包括 Detection coverage 卡片和 Events flow
- [用例管理]({{ '/zh/use-case-management/' | relative_url }}) — 检测规则的打标签、发布与同步
- [数据接入]({{ '/zh/data-onboarding/' | relative_url }}) — 接入 Elasticsearch
