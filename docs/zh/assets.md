---
layout: default
title: "资产管理"
lang: zh
lang_ref: assets
---

# 资产管理

资产模块是一个轻量级 CMDB，用于维护主机和设备清单（主机名、IP 地址、类型、重要级别以及自由定义的自定义属性），分析人员可以搜索、通过表格文件批量导入以及导出。

**导航路径：** `Investigation → Assets`

<!-- TODO screenshot: assets/images/assets/assets-list.png (Assets page with toolbar, search box and table) -->

---

## 资产列表

每个资产在创建时会自动生成形如 `ASSET-YYYYMMDD-NNNN` 的 **Asset #**，该编号不可修改。

| 列 | 说明 |
|---|---|
| **Asset #** | 系统生成的标识符（固定在左侧，可排序） |
| **Hostname** | 可选主机名（可排序） |
| **IP Address** | IPv4 或 IPv6 地址（可排序） |
| **Type** | 自由文本资产类型，例如 `Server`、`Switch`（可排序） |
| **Level** | 重要级别：Critical（红色加粗）、High（橙色）、Medium、Low（可排序） |
| **Alive** | `Yes` 或 `No` |
| **Description** | 自由文本，表格中超长内容会被截断 |
| *自定义列* | 在 **Columns** 中定义的每个自定义列对应一列（见下文） |
| **Actions** | 编辑（铅笔图标）和删除（垃圾桶图标，需确认） |

在点击可排序表头之前，列表按最近更新时间倒序排列。排序和分页均由服务端完成；拖动表头边缘可调整列宽。

### 工具栏

| 控件 | 说明 |
|---|---|
| **Add Asset** | 打开 **Create Asset** 对话框 |
| **Import Excel** | 上传文件批量创建资产 |
| **Export** | 菜单，包含 **Export Excel (.xlsx)** 和 **Export CSV (.csv)** |
| 刷新图标 | 重新加载表格和自定义列定义 |
| **Search...** | 输入时实时过滤，匹配 Asset #、主机名、IP 地址和描述 |
| **Columns** | 打开 **Manage Custom Columns** 抽屉 |

---

## 创建与编辑资产

点击 **Add Asset**，或点击行上的铅笔图标（此时对话框标题为 **Edit Asset**）。

| 字段 | 说明 |
|---|---|
| **Hostname** | 可选 |
| **IP Address** | 可选；必须是有效的 IP 地址 |
| **Type** | 自由文本；留空时默认为 `Unknown` |
| **Level** | `Critical`、`High`、`Medium` 或 `Low`；默认 `Medium` |
| **Is Alive** | 复选框 |
| **Description** | 自由文本 |
| **Custom Attributes** | 每个自定义列对应一个输入项（文本、数字，布尔列为 Yes/No） |

> 其他功能使用资产时会对资产类型和主机名进行精确匹配（见下文“资产的用途”），因此请保持类型名称一致，例如始终使用 `Server`，而不是 `server` 或 `Servers`。

页面上无法撤销资产删除。创建、更新、删除和导入操作会记录在服务端的资产审计日志中。

---

## 自定义列

点击 **Columns** 打开 **Manage Custom Columns**。

| 字段 | 说明 |
|---|---|
| **Field Key** | 仅限小写字母、数字和下划线（例如 `location`）；必须唯一 |
| **Display Label** | 在表格和编辑对话框中显示的列标题 |
| **Data Type** | `Text`、`Number` 或 `Boolean` |

点击 **Add Column** 创建。**Existing Columns** 列出所有列并提供删除按钮。删除列定义会从表格和对话框中移除该列；已保存在资产上的值会保留，但不再显示。

---

## 导入资产

点击 **Import Excel** 并选择文件。文件会按**带表头行的逗号分隔文本**读取；导入前请先将表格另存为 CSV（UTF-8）。导入程序不会解析二进制 `.xlsx` 工作簿。

| 表头（两种写法均可） | 对应字段 |
|---|---|
| `hostname` / `Hostname` | Hostname |
| `ip_address` / `IP Address` | IP Address |
| `asset_type` / `Asset Type` | Type（默认 `Unknown`） |
| `asset_level` / `Asset Level` | Level（默认 `Medium`） |
| `description` / `Description` | Description |
| `is_alive` / `Is Alive` | Alive：`true`、`yes`、`1` 或 `alive`（不区分大小写）表示存活；其他任何值（包括空单元格或没有该列）均视为不存活 |

- 其他任何列在单元格非空时会以其表头名称成为**自定义属性**。若要在表格中显示，请创建 **Field Key** 与表头完全一致的自定义列。
- 每一行都会创建一个**新**资产并生成新的 Asset #。导入不会更新已有资产，因此同一文件导入两次会产生重复资产。
- 整个文件在一个事务中导入：任意一行无效（例如 IP 地址格式错误）时，所有行都不会导入，请求失败。
- 结果提示：`Imported: N created, 0 updated`，updated 数始终为 0。

---

## 导出资产

点击 **Export** 并选择格式。文件名为 `cmdb_assets_<时间戳>`，由浏览器下载。

- 导出内容为匹配当前 **Search** 文本的全部资产，而不仅是当前页。
- 列包括：Asset Number、Hostname、IP Address、Asset Type、Asset Level、Description、Is Alive、Created At、Updated At、Created By、Updated By，之后是已配置的自定义列，以及导出资产上出现的其他自定义属性键。

---

## 资产的用途

- **Detection Coverage：** 日志源类别可以关联 **CMDB asset types**。具有这些类型的资产的主机名（不区分大小写，忽略空主机名）被视为应当上报日志的主机；页面将其与 Elasticsearch 中实际出现的主机比较，计算每个类别的主机覆盖率。参见[检测覆盖]({{ '/zh/detection-coverage/' | relative_url }})。

资产列表不会与单条告警或工单关联；调查中遇到的主机或 IP 可通过搜索查询。

---

## 权限

拥有 `cmdb.view_asset` 权限的用户才会在侧边栏看到 **Assets** 入口。资产 API 本身只要求用户已登录，页面也不会单独隐藏 Add、Import、Export、Edit 或 Delete 控件，因此请通过角色分配来限制对该页面的访问。

---

## 故障排查

| 问题 | 检查项 |
|---|---|
| 导入报错 | 将文件另存为带表头行的 UTF-8 CSV；检查 IP 地址值是否有效 |
| 导入的资产 **Alive** 全为 No | 添加 `is_alive` 列并填写 `true` / `yes` / `1` |
| 导入的自定义值未显示在表格中 | 创建 Field Key 与文件表头完全一致的自定义列 |
| 导入后资产出现重复 | 导入始终创建新资产；请删除重复项 |
| 搜索无结果 | 搜索仅覆盖 Asset #、主机名、IP 地址和描述，不包含自定义属性 |

## 相关页面

- [检测覆盖]({{ '/zh/detection-coverage/' | relative_url }})
- [工单处理]({{ '/zh/ticket-handling/' | relative_url }})
