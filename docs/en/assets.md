---
layout: default
title: "Assets"
lang: en
lang_ref: assets
---

# Assets

The Assets module is a lightweight CMDB. It keeps an inventory of hosts and devices (hostname, IP address, type, criticality level, free-form custom attributes) that analysts can search, import from a spreadsheet and export.

**Navigation:** `Investigation → Assets`

<!-- TODO screenshot: assets/images/assets/assets-list.png (Assets page with toolbar, search box and table) -->

---

## Asset List

Each asset receives an auto-generated **Asset #** in the form `ASSET-YYYYMMDD-NNNN` when it is created. The number cannot be edited.

| Column | Description |
|---|---|
| **Asset #** | Generated identifier (fixed on the left, sortable) |
| **Hostname** | Optional host name (sortable) |
| **IP Address** | IPv4 or IPv6 address (sortable) |
| **Type** | Free-text asset type, for example `Server`, `Switch` (sortable) |
| **Level** | Criticality: Critical (red, bold), High (orange), Medium, Low (sortable) |
| **Alive** | `Yes` or `No` |
| **Description** | Free text, truncated in the table |
| *Custom columns* | One column per custom column defined in **Columns** (see below) |
| **Actions** | Edit (pencil) and Delete (trash, asks for confirmation) |

The list is sorted by last update (newest first) until you click a sortable header. Sorting and paging are done on the server; column widths can be resized by dragging the header edges.

### Toolbar

| Control | Description |
|---|---|
| **Add Asset** | Opens the **Create Asset** dialog |
| **Import Excel** | Uploads a file to create assets in bulk |
| **Export** | Menu with **Export Excel (.xlsx)** and **Export CSV (.csv)** |
| Refresh icon | Reloads the table and the custom column definitions |
| **Search...** | Filters as you type on Asset #, hostname, IP address and description |
| **Columns** | Opens the **Manage Custom Columns** drawer |

---

## Creating and Editing an Asset

Click **Add Asset**, or the pencil icon on a row (the dialog is then titled **Edit Asset**).

| Field | Description |
|---|---|
| **Hostname** | Optional |
| **IP Address** | Optional; must be a valid IP address |
| **Type** | Free text; defaults to `Unknown` when left empty |
| **Level** | `Critical`, `High`, `Medium` or `Low`; defaults to `Medium` |
| **Is Alive** | Checkbox |
| **Description** | Free text |
| **Custom Attributes** | One input per custom column (text, number, or Yes/No for boolean columns) |

> Asset type, hostname and Alive state are matched exactly when other features use assets (see How Assets Are Used below), so keep type names consistent, for example always `Server` and not `server` / `Servers`.

Deleting an asset cannot be undone from the page. Create, update, delete and import actions are recorded in an asset audit log on the server.

---

## Custom Columns

Click **Columns** to open **Manage Custom Columns**.

| Field | Description |
|---|---|
| **Field Key** | Lowercase letters, digits and underscores only (for example `location`); unique |
| **Display Label** | Column title shown in the table and in the edit dialog |
| **Data Type** | `Text`, `Number` or `Boolean` |

Click **Add Column** to create it. **Existing Columns** lists each column with a delete button. Deleting a column definition removes the column from the table and the dialog; values already stored on assets are kept but no longer displayed.

---

## Importing Assets

Click **Import Excel** and choose a file. The file is read as **comma-separated text with a header row**; save spreadsheets as CSV (UTF-8) before importing. A binary `.xlsx` workbook is not parsed by the importer.

| Header (either spelling) | Maps to |
|---|---|
| `hostname` / `Hostname` | Hostname |
| `ip_address` / `IP Address` | IP Address |
| `asset_type` / `Asset Type` | Type (default `Unknown`) |
| `asset_level` / `Asset Level` | Level (default `Medium`) |
| `description` / `Description` | Description |
| `is_alive` / `Is Alive` | Alive: `true`, `yes`, `1` or `alive` (any case) means alive; anything else, including an empty cell or no such column, means not alive |

- Any other column becomes a **custom attribute** under its header name when the cell is not empty. To show it in the table, create a custom column whose **Field Key** is identical to the header.
- Every row creates a **new** asset with a new Asset #. Import never updates existing assets, so importing the same file twice creates duplicates.
- The whole file is imported in one transaction: if any row is invalid (for example a malformed IP address), nothing is imported and the request fails.
- Result message: `Imported: N created, 0 updated`. The updated count is always 0.

---

## Exporting Assets

Click **Export** and choose a format. The file is named `cmdb_assets_<timestamp>` and downloads in the browser.

- The export contains every asset that matches the current **Search** text, not only the current page.
- Columns: Asset Number, Hostname, IP Address, Asset Type, Asset Level, Description, Is Alive, Created At, Updated At, Created By, Updated By, followed by the configured custom columns and any other custom attribute keys found on the exported assets.

---

## How Assets Are Used

- **Detection Coverage:** a log source category can be linked to **CMDB asset types**. Hostnames of assets with those types (case-insensitive, empty hostnames ignored) are the hosts expected to send logs; the page compares them with the hosts seen in Elasticsearch to compute per-category host coverage. See [Detection Coverage]({{ '/en/detection-coverage/' | relative_url }}).

Assets are not linked to individual alerts or tickets in the list; use search to look up a host or IP seen in an investigation.

---

## Permissions

The **Assets** sidebar entry is shown to users with the `cmdb.view_asset` permission. The Assets API itself only requires a signed-in user, and the page does not hide the Add, Import, Export, Edit or Delete controls individually, so restrict access to the page through role assignment.

---

## Troubleshooting

| Issue | Check |
|---|---|
| Import fails with an error | Save the file as UTF-8 CSV with a header row; check IP address values are valid |
| Imported assets all show **Alive** = No | Add an `is_alive` column with `true` / `yes` / `1` |
| Imported custom values do not appear in the table | Create a custom column whose Field Key equals the file header exactly |
| Assets appear twice after import | Import always creates new assets; delete the duplicates |
| Search finds nothing | Search covers Asset #, hostname, IP address and description only, not custom attributes |

## See Also

- [Detection Coverage]({{ '/en/detection-coverage/' | relative_url }})
- [Ticket Handling]({{ '/en/ticket-handling/' | relative_url }})
