---
layout: default
title: "Data Onboarding"
lang: en
lang_ref: data-onboarding
---

# Data Onboarding

Data Onboarding covers the end-to-end pipeline for connecting an external data source, scheduling alert collection, and configuring correlation so that incoming alerts become incident tickets.

## Data Flow Architecture

```
Elasticsearch (external)
        │
        ▼  [Data Pipeline → Integrations]
   Elastic Stack connector (host, credentials, index)
        │
        ▼  [Data Pipeline → Orchestrator]
   Scheduled task (es_to_db)
   writes ES documents into the internal alerts table,
   then creates a ticket for each new or changed alert
        │
        ▼  [Data Pipeline → Correlation]
   Correlation policy: an alert that matches an In Progress
   ticket inside the time window is attached to it
        │
        ▼
   Monitoring → Overview / Alerts,  Investigation → Tickets
```

Splunk takes a shorter path: **Splunk Alerts** integration → manual **Fetch Data** → `Monitoring → Alerts`. Splunk alerts are stored but are **not** turned into tickets automatically.

**How it works:**
- The **Orchestrator** periodically pulls documents from the configured ES index and writes them to the internal alerts table (`alerts_alert`).
- For every new alert (or an alert whose content changed) the same run opens a ticket. With **Correlation** enabled, an alert whose correlation key matches an In Progress ticket inside the window is attached to that ticket instead.
- **Monitoring** reads the internal database to show dashboard statistics and the Alerts list; **Investigation → Tickets** lists the tickets.

---

## Step 1: Login

Open your browser and navigate to `https://siem.seclink.info`. Enter your administrator credentials and log in.

After login, the system defaults to the **Dashboard Overview** page (`Monitoring → Overview`). If no data source is configured, all statistics show zero.

![Dashboard Overview — initial state]({{ '/assets/images/data-onboarding/dashboard-overview.png' | relative_url }})

**Dashboard statistics explained:**
- **Alerts in…** — recent alert counts by time window
- **Total Alerts** — cumulative ingested alert count
- **Data Sources** — number of configured integrations

---

## Step 2: Configure the Elasticsearch Integration

**Navigation:** `Data Pipeline → Integrations`

The Integrations page shows one card per connector: **Elastic Stack**, **Kibana**, **Splunk** (Alerts) and **Splunk Rule Publisher**. Each card is tagged **Available** or **Installed**. Locate **Elastic Stack (ELK Connector)** and click **Setup Integration**. An installed card shows **Configure** and **Delete**.

![Integrations page — Elastic Stack available]({{ '/assets/images/data-onboarding/integrations-page.png' | relative_url }})
<!-- TODO screenshot: assets/images/data-onboarding/integrations-page.png (recapture: page now has four cards, Elastic Stack, Kibana, Splunk, Splunk Rule Publisher) -->

> Accounts with a read-only (guest) profile see the banner **Read-only view** and cannot edit credentials.

### Fill in Connection Parameters

In the **Configure Elasticsearch** dialog, complete the following fields:

| Field | Default / options | Notes |
|---|---|---|
| Integration Name | `Elastic Stack (ELK)` | Customizable |
| Connection Protocol | `HTTPS` (default) or `HTTP` | Match your ES cluster. Certificate verification is on when HTTPS is selected |
| Host | *(empty)* | Host name or IPv4 address without protocol prefix or port; for example `localhost` or `10.0.0.1` |
| Port | `9200` | 1 to 65535 |
| Authentication Type | `No Authentication` (default), `Basic Authentication` or `API Key` | |
| Username / Password | | Required for Basic Authentication |
| API Key Token | | Required for API Key authentication |
| Target Index / Index Pattern | `alerts` | The ES index to ingest from; wildcard patterns such as `alerts-linux-*` are accepted |

A **Preview endpoint** line under the form shows the URL that will be called (`<protocol>://<host>:<port>/_cluster/health`).

> **Tip:** After entering Host and authentication details, click **Fetch Indices** next to the index field to load the index list from your live ES cluster; you can still type a custom value.

> **Security:** The ES username, password and API key are sensitive credentials. Do not record them in screenshots, documents, or chat messages.

---

## Step 3: Test Connection and Save

### Test the Connection

Click **Test Connection**. On success, a dialog titled **Connection OK** shows **Connection succeeded** together with the raw response of the cluster health call (HTTP status, response body and headers). On failure the title is **Connection failed** and the dialog shows the error returned.

![Test Connection — success]({{ '/assets/images/data-onboarding/test-connection-ok.png' | relative_url }})

If the test fails, check:
- Host and Port are correct
- Network connectivity from the platform server to the ES cluster
- Credentials are valid
- The ES cluster is running and healthy

### Save the Configuration

Click **Save Configuration** (the message `Integration saved.` appears). Saving also makes this Elasticsearch connection the active alert source and starts an initial alert synchronization from the configured index. The Integrations page shows the Elastic Stack card as **Installed**, with **Configure** and **Delete** buttons.

![Integration — Installed status]({{ '/assets/images/data-onboarding/integration-installed.png' | relative_url }})

---

## Step 4: Configure the Orchestrator (Data Collection Schedule)

**Navigation:** `Data Pipeline → Orchestrator`

The Orchestrator manages scheduled data collection tasks. The page has a **Orchestrator** card listing the tasks and a **Task Runs** card with the run history. Click **New Task**.

### New Task Parameters

| Field | Value | Notes |
|---|---|---|
| Name | `job` | Required, unique task name |
| Cron (e.g. 0 0 * * *) | `*/60 * * * *` | Required; default `0 0 * * *` (daily at midnight) |
| Source Integration (Elasticsearch) | `Elastic Stack (ELK)` | Lists Elasticsearch integrations only (select the one from Step 2) |
| Index (Elasticsearch) | `alerts` | Required. **Preview Data** shows sample documents from the index |
| Timestamp field (optional) | `date` | ES field used to restrict the query to a time window; the **Time range** only takes effect when this field is set |
| Time range | *(leave blank or set as needed)* | `Last 1 hour`, `Last 6 hours`, `Last 24 hours`, `Last 7 days`, `Custom relative` or `Absolute (pick a timestamp)` with **From** / **To** |
| Destination Integration (Database) | `Current DB (Django default)` | Write to the internal database |
| Destination table | `alerts_alert` | Fixed, shown disabled |
| Limit | `1000` | Maximum documents fetched per run (minimum 1; 1000 when left empty) |

![New Orchestrator Task]({{ '/assets/images/data-onboarding/orchestrator-new-task.png' | relative_url }})

Click **OK** to save the task.

![Orchestrator — Task Created]({{ '/assets/images/data-onboarding/orchestrator-task-created.png' | relative_url }})

### Cron Expression Reference

| Expression | Schedule |
|---|---|
| `*/60 * * * *` | Every 60 minutes |
| `*/5 * * * *` | Every 5 minutes |
| `* * * * *` | Every minute |
| `0 * * * *` | Every hour on the hour |

By default the platform checks for due tasks in the background every 30 seconds.

### Running and Managing Tasks

Each task row shows `Type`, `Schedule` and the latest run with its status.

| Button | Action |
|---|---|
| **Run** | Starts an immediate run |
| **View Runs** | Opens the run list of the task. **Clear Runs** removes all run history of the task after confirmation; **View Logs** on a run shows its log |
| **Edit** | Opens the task in the **Edit Task** dialog (the task name is also a link) |
| **Delete** | Deletes the task after confirmation |

The **Task Runs** card has a task selector and one row per run:

| Column | Description |
|---|---|
| **Time** | Run start time |
| **Matched** | Alerts evaluated for ticket creation |
| **Created** | New tickets created |
| **Appended** | Alerts attached to an existing ticket (correlation match, or a ticket that already exists for the same SIEM event) |
| **Skipped** | Alerts that could not be ticketed |
| **Imported** | Documents fetched from Elasticsearch |
| **Status** | `success`, `partial` (finished with non-fatal errors, see the log), `failed`, `running` or `pending` |

The Orchestrator reads from Elasticsearch only; Splunk alerts use their own **Fetch Data** button (see below).

---

## Step 5: Configure Correlation Policy

**Navigation:** `Data Pipeline → Correlation`

The page has three tabs: **Correlation Policy**, **Correlation Activity** and **Risk Entities**.

### Correlation Policy Tab

| Field | Recommended Value | Notes |
|---|---|---|
| Enabled | **On** | Correlation only applies while enabled |
| Window (minutes) | `30` | 1 to 1440. Alerts with the same correlation key within this window are related |
| ES Integration / ES Index | `Elastic Stack (ELK)` / `alerts` | Source used to list the available fields |
| Load ES Fields | Click once | Loads the field names of the index (`N fields loaded`) |
| Order By Fields | e.g. `rule_id`, `host.name` | Required multi-select, enabled after fields are loaded. The values of the selected fields are combined into the correlation key |

Click **Save** to store the policy (`Policy saved`); **Reset** restores the form.

**How correlation works.** Each Orchestrator run creates a ticket for every new alert. When the policy is enabled, the run first looks for a ticket that was opened for an alert with the same correlation key within the last *window* minutes **and whose progress state is still In Progress** (not set to Pending on the ticket). If one exists, the alert is attached to it (a work-log entry is added and the alert shows that ticket) instead of opening a new ticket.

### Correlation Activity Tab

A time-series chart and a table of correlated tickets (**Ticket**, **Alerts**, **Last Alert**, **Risk Objects**, **Rule**, **Alert IDs**). Controls: range (`Last 1 hour`, `Last 6 hours`, `Last 24 hours`, `Last 7 days`), bucket size, **Refresh**, **Export CSV**. **Seed Data** inserts demonstration correlation events for existing tickets; do not use it on a production system.

### Risk Entities Tab

**Entity-Centric Correlation** lists risk objects (IP, user, host, hash) that link several alerts or rules in the selected range, with the **Min alerts** filter (`≥ 1`, `2`, `3`, `5`) and the columns **Risk Entity**, **Type**, **Alerts**, **Rules**, **Tickets**, **Severities** and **Last Seen**.

> **Important:** There is no switch that disables ticket creation. Every alert that the Orchestrator ingests produces a ticket unless it is attached to an existing In Progress ticket by correlation. Confirm the task limit and query in a test environment before scheduling on production data.

---

## Step 6: Verify Data Ingestion

After completing the above steps:

1. **Trigger a manual Orchestrator run** — go to `Data Pipeline → Orchestrator`, click **Run** on your task, then **View Runs** to check the counters and log.
2. **Check the Dashboard** (`Monitoring → Overview`) — the alert counters should now show non-zero values.
3. **Check the Alerts list** (`Monitoring → Alerts`) — ingested alerts should appear.
4. **Check Tickets** (`Investigation → Tickets`) — a ticket should exist for each new alert, or alerts should be attached to an In Progress ticket when Correlation is enabled.

---

## Other Integrations

### Kibana

Used to publish detection rules and their actions through the Kibana APIs; it does not ingest data and has no index field. Click **Setup Integration** on the **Kibana** card to open **Configure Kibana**.

| Field | Default / options |
|---|---|
| Integration Name | `Kibana` |
| Connection Protocol | `HTTPS` (default) or `HTTP` |
| Host / Port | *(empty)* / `5601` |
| Authentication Type | `No Authentication` (default), `Basic Authentication` or `API Key` |

**Test Connection** calls `/api/status` on the Kibana host. See [Use Case Management]({{ '/en/use-case-management/' | relative_url }}) for publishing rules.

### Splunk Alerts

Pulls events from a Splunk index into the Alerts list. Click **Setup Integration** on the **Splunk** card (**Splunk Alerts** dialog).

| Field | Description |
|---|---|
| **Integration name** | Default `Splunk Alerts` |
| **Management API URL** | Splunk management origin, for example `https://splunk.example.com:8089`; no path or query |
| **Authentication** | `Username / Password` or `Splunk management token` |
| **Token type** | For tokens: `Authentication token (Bearer)` or `Session key (Splunk)` |
| **Verify TLS certificate** | On by default; turning it off shows a warning |
| **Alert index** | One literal index name (letters, digits, `_`, `.`, `-`; up to 64 characters). Default `main` |
| **Lookback (hours)** | 1 to 168, default 24 |
| **Batch size** | 1 to 1000, default 500; used by **Fetch Data** only and not saved |

Passwords and tokens are stored securely and are not shown again: leave the field empty to keep the saved credential, and re-enter it when you change the URL, authentication method or username.

Buttons:
- **Test Connection** — contacts the management API and reports HTTP status, version, build and product.
- **Save Configuration** — stores the integration (`Splunk configuration saved.`).
- **Fetch Data** — enabled only after the configuration is saved with no unsaved edits. It runs a fixed search on the alert index (`index="<name>"`, limited to the batch size and the lookback window); free-form search commands are not supported. It is **manual**: there is no schedule.

**Result.** The dialog lists **Fetched**, **Inserted**, **Updated** and **Skipped**. `Batch limit reached.` means more events may exist; run it again or raise the batch size.

**Field mapping.** Each event becomes an alert: severity from `severity`, `level` or `urgency`; time from the event time fields (or `_time`); title from `title`, `rule_name` or the saved search name; message from `message`, `title` or the raw event; rule ID from `rule_id` or the saved search name; category from `category` or `sourcetype`. If the raw event is a JSON object, its keys fill fields that are missing.

**Deduplication.** An alert ID is derived by hashing the event's own ID (`alert_id` or `event_id` when present, otherwise the Splunk record identity) together with the integration and index, so fetching again updates existing alerts instead of duplicating them.

Splunk alerts appear in `Monitoring → Alerts` and are **not** turned into tickets automatically. Testing needs the *change* permission on integrations; **Fetch Data** also needs permission to add and change alerts, and fetches are written to the audit log.

### Splunk Rule Publisher

Publishes detection rules to Splunk Enterprise as saved searches. Click **Setup Integration** on the **Splunk Rule Publisher** card. A selector at the top of the dialog switches between configured publishers or creates a **New publisher**.

It has the same connection fields as Splunk Alerts (name default `Splunk Rule Publisher`, authentication default `Splunk management token`), with these differences:

| Field | Description |
|---|---|
| **Management API URL** | Must use **HTTPS** |
| **Splunk app** | Required; letters, digits, `_` and `-`; default `search` |
| **Saved search owner** | Required Splunk user that owns the saved searches |
| No index, lookback or **Fetch Data** | Not applicable |

A publisher whose URL, app or owner has rules bound to it cannot be changed, and it **cannot be deleted while rules are bound**: remove the bindings first.

---

## Troubleshooting

| Issue | Check |
|---|---|
| Test Connection fails | Host/Port correct? Protocol matches the cluster? Network accessible? Credentials valid? ES cluster running? |
| No alerts after Orchestrator run | Is the index name correct? Does the Timestamp field exist in documents? Documents without an `alert_id`, `event_id` or `es_id` field are skipped. Check **View Logs** of the run |
| Alerts imported but list is empty | `Monitoring → Alerts` shows alerts from the index of the active Elasticsearch integration plus Splunk alerts; alerts from another index are hidden |
| Duplicate alerts appearing | The source document's unique ID (`alert_id` / `event_id`) must be consistent across documents; the same ID in the same index updates the existing alert |
| Run status is `partial` | Open **View Logs**: some tickets failed validation or creation |
| Tickets not created | Tickets are created for **new or changed** alerts only; already-imported unchanged alerts are not re-ticketed. Check **Matched / Created / Skipped** in **Task Runs** |
| Alerts not attached by Correlation | Policy **Enabled**? Window long enough? **Order By Fields** present in the documents? The earlier ticket must not be in the Pending state |
| Orchestrator task not running on schedule | Check that the cron expression is valid and the task exists in the list; use **Run** to test |
| Splunk **Fetch Data** disabled | Save the configuration first and discard unsaved edits |
| Splunk errors | TLS verification (trust the certificate or review **Verify TLS certificate**), user rights on the index, correct management port |
| Cannot delete Splunk Rule Publisher | Rules are still bound to it; remove the bindings first |
