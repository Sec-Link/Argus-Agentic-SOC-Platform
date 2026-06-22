# Argus — ELK Alert Ingestion User Guide

**Version:** 1.0 · **Audience:** SOC Analysts, Platform Administrators

---

## Table of Contents

1. [Data Flow Overview](#1-data-flow-overview)
2. [Prerequisites](#2-prerequisites)
3. [Step 1 — Log In](#3-step-1--log-in)
4. [Step 2 — Register the Elasticsearch Integration](#4-step-2--register-the-elasticsearch-integration)
5. [Step 3 — Configure the Orchestrator Ingestion Task](#5-step-3--configure-the-orchestrator-ingestion-task)
6. [Step 4 — Configure the Correlation Policy](#6-step-4--configure-the-correlation-policy)
7. [Step 5 — Verify Data in Overview & Alerts](#7-step-5--verify-data-in-overview--alerts)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Data Flow Overview

Understanding where data enters the platform and how it is consumed helps you configure each component correctly.

```
┌──────────────────────────────────────────────────────────────────┐
│  Elasticsearch / OpenSearch Cluster                              │
│  Index: alerts (or any target index)                             │
└───────────────────────┬──────────────────────────────────────────┘
                        │  HTTP  (Basic Auth / API Key)
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│  Data Pipeline › Integrations                                    │
│  Stores connection credentials for the cluster                   │
└───────────────────────┬──────────────────────────────────────────┘
                        │  referenced by
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│  Data Pipeline › Orchestrator                                    │
│  Scheduled task (es_to_db) pulls raw documents on a cron         │
│  and writes them into the Argus Alerts table                     │
└───────────────────────┬──────────────────────────────────────────┘
                        │  triggers
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│  Data Pipeline › Correlation                                     │
│  Groups related alerts by configurable fields within a time      │
│  window and creates or updates an EventTicket                    │
└───────────┬───────────────────────────┬──────────────────────────┘
            │                           │
            ▼                           ▼
  Monitoring › Overview          Investigation › Tickets
  (KPI dashboards,               (Correlated incidents
   alert counts, charts)          ready for analyst triage)
```

**Key concepts**

| Concept | Description |
|---|---|
| **Integration** | Persists the cluster URL, auth credentials, and default index |
| **Orchestrator Task** | A cron job that calls the Integration and bulk-imports alerts into the DB |
| **Correlation Policy** | Groups alerts that share the same field values within a sliding time window into a single Ticket |
| **Alert** | A raw event record imported from Elasticsearch |
| **EventTicket** | A de-duplicated incident (`SEC20240601NNNNN`) created by the Correlation engine |

---

## 2. Prerequisites

| Requirement | Notes |
|---|---|
| Argus platform running | Accessible at `http://<host>:3000` |
| Elasticsearch / OpenSearch reachable | The Argus backend must be able to reach the cluster over HTTP/HTTPS |
| Admin or operator account | Guest (readonly) users cannot create integrations or tasks |
| Target index exists | The index must already exist in Elasticsearch with ingested alert documents |

---

## 3. Step 1 — Log In

1. Open a browser and navigate to `http://<argus-host>:3000`.
2. Enter your **Username** and **Password**, then click **Login**.

> **Screenshot 1 — Login page**
> *(Insert screenshot of the Argus login screen with credentials filled in)*

After a successful login you are redirected to **Monitoring › Overview**.

---

## 4. Step 2 — Register the Elasticsearch Integration

The Integration stores all connection details for your Elasticsearch cluster. This record is referenced by the Orchestrator and Correlation engine.

### 4.1 Open the Integrations page

In the left sidebar navigate to **Data Pipeline › Integrations**.

> **Screenshot 2 — Integrations list (empty or existing entries)**
> *(Insert screenshot of the Integrations page)*

### 4.2 Add a new Elasticsearch integration

Click **+ Add Integration** and select **Elasticsearch** from the integration type picker.

> **Screenshot 3 — Integration type picker**
> *(Insert screenshot showing the Elasticsearch option selected)*

### 4.3 Fill in the connection form

| Field | Example value | Notes |
|---|---|---|
| **Name** | `Elastic Stack (ELK)` | Used to identify this source in Orchestrator and Correlation dropdowns |
| **Protocol** | `http` | Use `https` if TLS is enabled on your cluster |
| **Host** | `<your-es-host>` | Hostname or IP of the Elasticsearch node — **do not include the port here** |
| **Port** | `9200` | Default Elasticsearch HTTP port |
| **Auth Type** | `basic` | Select `api_key` if your cluster uses API key auth |
| **Username** | `<es-username>` | Required when Auth Type is `basic` |
| **Password** | `••••••••••••••••` | Required when Auth Type is `basic`; stored encrypted |
| **Target Index** | `alerts` | The index (or index pattern) containing your alert documents |
| **Use SSL** | off | Enable if the cluster uses HTTPS |
| **Verify Certs** | on | Disable only for self-signed certificates in test environments |

> **Screenshot 4 — Completed integration form**
> *(Insert screenshot with the form filled in — credentials should be redacted in the screenshot or the password field will show `••••••`)*

### 4.4 Test the connection

Click **Test Connection**. A green success badge confirms:

- The host and port are reachable from the Argus backend.
- The supplied credentials are accepted by Elasticsearch.
- The target index exists.

> **Screenshot 5 — Successful connection test**
> *(Insert screenshot showing the green "Connection successful" badge)*

### 4.5 Browse available indices

After a successful connection test you can click **View Indices** to see all indices available on the cluster. Choose the index that contains your alert data (e.g., `alerts`).

> **Screenshot 6 — Index browser**
> *(Insert screenshot showing the available indices list)*

Click **Save** to persist the integration.

---

## 5. Step 3 — Configure the Orchestrator Ingestion Task

The Orchestrator runs a scheduled job that pulls documents from Elasticsearch into the Argus Alerts table.

### 5.1 Open the Orchestrator page

Navigate to **Data Pipeline › Orchestrator** and click **New Task**.

> **Screenshot 7 — Orchestrator task list**
> *(Insert screenshot of the Orchestrator page)*

### 5.2 Configure the task

Fill in the **Edit Task** form with the values below. These match the recommended production settings shown in the reference screenshot.

| Field | Recommended value | Description |
|---|---|---|
| **Name** | `job` | Human-readable label for this ingestion task |
| **Cron** | `*/60 * * * *` | Run every 60 minutes. Adjust to `*/5 * * * *` for near-real-time ingestion |
| **Source Integration (Elasticsearch)** | `Elastic Stack (ELK)` | Select the integration created in Step 2 |
| **Index (Elasticsearch)** | `alerts` | The index to query; overrides the Integration default if specified |
| **Timestamp field** | `date` | The ES field used for time-range filtering |
| **Time range** | *(leave blank)* | Leave empty to import all documents; or set to `1h` to limit each run to the last hour |
| **Destination Integration (Database)** | `Current DB (Django default)` | Write to the Argus platform database |
| **Destination table** | `alerts_alert` | Auto-populated; do not change |
| **Limit** | `1000` | Maximum documents per run. Increase to `5000` for high-volume clusters |

> **Screenshot 8 — Completed Orchestrator task form**
> *(Insert screenshot matching Image #6 from the reference, with Name=job, Cron=*/60 * * * *, Index=alerts, Limit=1000)*

Click **OK** to save the task.

### 5.3 Run the task manually (first-time verification)

Back on the Orchestrator list, locate the task and click **Run** to trigger an immediate execution without waiting for the next cron interval.

> **Screenshot 9 — Task run result showing SUCCESS status**
> *(Insert screenshot of the Task Runs table showing green SUCCESS badges and Imported count > 0)*

A **SUCCESS** status with `Imported: N` (where N > 0) confirms that alert documents are being pulled from Elasticsearch and stored in the platform.

---

## 6. Step 4 — Configure the Correlation Policy

The Correlation engine groups incoming alerts that share the same field values within a configurable time window and creates a single **EventTicket** to represent the incident.

### 6.1 Open the Correlation page

Navigate to **Data Pipeline › Correlation**. The **Correlation Policy** tab is selected by default.

> **Screenshot 10 — Correlation Policy page (before configuration)**
> *(Insert screenshot of the empty/default Correlation Policy form)*

### 6.2 Configure the policy

Set the following values. These match the recommended configuration shown in the reference screenshot.

| Field | Recommended value | Description |
|---|---|---|
| **Enabled** | ON | Activate the policy immediately after saving |
| **Window (minutes)** | `30` | Alerts with the same correlation key within 30 minutes are merged into one Ticket |
| **ES Integration** | `Elastic Stack (ELK)` | The Integration this policy reads from |
| **ES Index** | `alerts` | The Elasticsearch index to monitor |
| **Order By Fields** | `threat_object`, `alert_type` | The alert fields used to build the grouping key; alerts with the same values for all listed fields are treated as the same incident |

> **Screenshot 11 — Completed Correlation Policy form**
> *(Insert screenshot matching Image #7 from the reference, showing Enabled=ON, Window=30, Order By Fields=threat_object + alert_type)*

**Choosing `Order By Fields`**

| Goal | Recommended fields |
|---|---|
| Cluster by attacker IP | `threat_object` |
| Cluster by attack type | `alert_type` |
| Cluster by attacker + attack type (recommended) | `threat_object`, `alert_type` |
| Cluster by attack type + target asset | `alert_type`, `asset_id` |

Click **Load ES Fields** to verify that your chosen fields exist in the index, then click **Save**.

> **Screenshot 12 — Fields loaded and policy saved**
> *(Insert screenshot showing fields loaded and Save confirmation)*

---

## 7. Step 5 — Verify Data in Overview & Alerts

After at least one successful Orchestrator task run and Correlation execution, data will appear across the platform.

### 7.1 Monitoring › Overview

Navigate to **Monitoring › Overview** to see the KPI dashboard:

- Total alert counts
- Severity distribution charts
- Alert trend over time

> **Screenshot 13 — Overview dashboard with ingested alert data**
> *(Insert screenshot of the Overview/Dashboard page showing populated charts and counts)*

### 7.2 Monitoring › Alerts

Navigate to **Monitoring › Alerts** to see the individual alert records imported from Elasticsearch. Each row corresponds to a document from the `alerts` index.

> **Screenshot 14 — Alerts list showing imported records**
> *(Insert screenshot of the Alerts page with alert rows visible)*

### 7.3 Investigation › Tickets

Navigate to **Investigation › Tickets** to see the correlated incident tickets created by the Correlation engine. Related alerts are grouped into a single ticket (e.g., `SEC20240618000001`) and link back to all contributing alerts via the **Correlated Events** tab.

> **Screenshot 15 — Tickets list showing correlated incidents**
> *(Insert screenshot of the Tickets page with auto-generated ticket numbers)*

---

## 8. Troubleshooting

| Symptom | Likely cause | Resolution |
|---|---|---|
| Test Connection fails | Wrong host, port, or credentials | Verify the Elasticsearch URL is reachable from the Argus host; re-enter credentials |
| Test Connection fails (SSL error) | TLS mismatch or self-signed cert | Disable **Verify Certs** for internal clusters; ensure Protocol matches (`http` vs `https`) |
| Orchestrator task stays **PENDING** | Celery worker or beat scheduler not running | Run `docker compose up worker beat` or check the worker logs |
| Task runs with `Imported: 0` | Index is empty or the timestamp field filter excludes all docs | Remove the **Timestamp field** or widen the **Time range**; verify the index has data |
| Alerts appear but no Tickets created | Correlation policy disabled or `Order By Fields` not matching actual document fields | Ensure **Enabled** is ON; click **Load ES Fields** to verify field names |
| Too many separate Tickets per incident | `Window (minutes)` too small or `Order By Fields` too specific | Increase the window to `60` min; reduce the number of grouping fields |
| All alerts merged into one Ticket | `Order By Fields` too broad | Add a more specific field such as `asset_id` to narrow the grouping |
| Duplicate alerts on each task run | `Timestamp field` not set; task is re-importing the same documents | Set the **Timestamp field** to the date field in your index (e.g., `date` or `@timestamp`) and configure **Time range** to match your cron interval (e.g., `1h` for hourly runs) |
