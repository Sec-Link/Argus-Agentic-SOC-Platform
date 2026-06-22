# Alerts & Correlation Setup Guide

This guide walks through the end-to-end configuration required to ingest alerts from an Elasticsearch/OpenSearch cluster, schedule the ingestion job, and define correlation rules that automatically merge related alerts into Tickets.

---

## Overview

```
Elasticsearch / OpenSearch
        │
        │  (Orchestrator Task – es_to_db)
        ▼
   Alert (DB)  ──────────────────────────────────────────────────────┐
        │                                                              │
        │  (Correlation Engine – run on each ingested batch)          │
        ▼                                                              │
CorrelationPolicy                                                      │
  match_keys + window_minutes                                          │
        │                                                              │
        ├── New cluster detected  ──►  EventTicket (created)          │
        └── Existing cluster     ──►  EventTicket (updated) ◄─────────┘
                                            │
                                    CorrelationEvent
                                   (links Alert → Ticket)
```

**Key objects**

| Object | Purpose |
|---|---|
| `Integration` | Stores connection credentials for an ELK data source |
| `OrchestratorTask` | A scheduled job that pulls alerts from an Integration into the DB |
| `CorrelationPolicy` | Defines which alert fields to group on and over what time window |
| `CorrelationEvent` | Join record between an `Alert` and the `EventTicket` it belongs to |
| `EventTicket` | A de-duplicated, auto-numbered incident ticket (`SEC20240501NNNNN`) |

---

## Step 1: SIEM Integration (ELK Setup)

Navigate to **Data Pipeline → Integrations** and click **+ Add Integration**, then select **Elasticsearch**.

### Required fields

| Field | Description | Example |
|---|---|---|
| **Name** | Human-readable label shown in the UI | `Production ELK Cluster` |
| **Protocol** | `http` or `https` | `https` |
| **Host** | Hostname or IP of the ES node | `elk.corp.example.com` |
| **Port** | ES HTTP port | `9200` |
| **Path** *(optional)* | URL prefix if ES is behind a reverse proxy | `/elastic` |
| **Auth Type** | `none`, `basic`, or `api_key` | `basic` |
| **Username** | Required when Auth Type is `basic` | `elastic` |
| **Password** | Required when Auth Type is `basic` | *(vault secret)* |
| **API Key** | Required when Auth Type is `api_key` | `VnVhQ2ZHY0JDZ...` |
| **Target Index** | ES index or index pattern to query | `siem-alerts-*` |
| **Use SSL** | Enable TLS verification | `true` |
| **Verify Certs** | Verify the server certificate chain | `true` (disable only for self-signed dev certs) |

> The credentials are stored in the `Integration.config` JSON field on the backend. Never commit integration credentials to source control; use the UI or the REST API.

### Verify connectivity

After saving, the integration card will display a **Test Connection** button. A green badge confirms the cluster is reachable and the credentials are accepted.

---

## Step 2: Automation Orchestrator (Scheduling)

Navigate to **Data Pipeline → Orchestrator** and click **+ New Task**.

### Task configuration

| Field | Description | Example |
|---|---|---|
| **Name** | Descriptive label | `Ingest ELK Alerts – Hourly` |
| **Task Type** | Must be `es_to_db` for ELK ingestion | `es_to_db` |
| **Schedule** | Standard 5-field cron expression | `0 * * * *` |
| **Source Integration** | Select the Integration created in Step 1 | `Production ELK Cluster` |
| **Index** | Override the index (leave blank to use the Integration default) | `siem-alerts-2024.*` |
| **Limit** | Max alerts fetched per run | `5000` |
| **Timestamp Relative** | Look-back window per run (`Xm`, `Xh`, `Xd`) | `1h` |
| **Query** | Optional Lucene/KQL filter applied before ingestion | `severity:HIGH` |

### Recommended cron schedules

| Use case | Schedule | Description |
|---|---|---|
| Near-real-time (high volume) | `*/5 * * * *` | Every 5 minutes |
| Standard SOC cadence | `0 * * * *` | Every hour |
| Low-volume / overnight | `0 6 * * *` | Once daily at 06:00 UTC |

> **Overlap prevention**: The engine skips a run if the previous execution for the same task is still in progress, preventing duplicate ingestion.

### `timestamp_relative` vs. a fixed range

`timestamp_relative` is evaluated at runtime relative to the current clock. Setting `1h` on an hourly cron means each run captures a clean 1-hour window with a small overlap margin to avoid gaps at clock boundaries. Use larger windows (`24h`) only for backfill tasks.

---

## Step 3: Correlation Rules & Data Pipeline

Navigate to **Data Pipeline → Correlation** and click **+ New Policy**.

### Policy fields

| Field | Type | Description |
|---|---|---|
| **Name** | string | Human-readable label |
| **Enabled** | bool | Toggle without deleting the policy |
| **Match Keys** | string[] | Alert fields used to build the grouping key |
| **Window (minutes)** | int | Alerts within this many minutes of each other are grouped |
| **Time Window Hours** | int | Lookback used when querying existing `CorrelationEvent` records |
| **Match Action** | string | Action taken when a cluster is found (default: `create_ticket`) |
| **ES Source** | FK | The Integration whose data this policy operates on |

### Choosing `match_keys`

`match_keys` is the most important setting. The engine builds a **correlation key** by concatenating the values of these fields from each alert:

```
correlation_key = join(alert[field] for field in match_keys)
```

Examples:

| Goal | match_keys |
|---|---|
| Group alerts from the same attacker IP | `["threat_object"]` |
| Group same attack type from any source | `["alert_type"]` |
| Group same attack type *and* target asset | `["alert_type", "threat_object"]` |
| Group same rule firing on same host | `["alert_type", "asset_id"]` |

Start narrow (2–3 keys) and widen only if too many distinct tickets are created.

### How the correlation engine runs

1. After each `es_to_db` task batch, the engine iterates over newly ingested `Alert` records.
2. For each alert it computes the `correlation_key`.
3. It queries `CorrelationEvent` for any record with the same `correlation_key` whose linked `EventTicket` was created within `time_window_hours`.
4. **Cluster found** → the alert is attached to the existing `EventTicket` via a new `CorrelationEvent`.
5. **No cluster** → a new `EventTicket` is created and the alert becomes its first `CorrelationEvent`.

### Recommended starting configuration

```json
{
  "name": "High-Severity Threat Clustering",
  "enabled": true,
  "match_keys": ["alert_type", "threat_object"],
  "window_minutes": 30,
  "time_window_hours": 24,
  "match_action": "create_ticket"
}
```

---

## Step 4: Expected Outcome — From Alerts to Tickets

### Normal flow

```
10:00  Alert A  – alert_type=BruteForce, threat_object=192.168.1.5   → NEW Ticket SEC20240601000001
10:12  Alert B  – alert_type=BruteForce, threat_object=192.168.1.5   → MERGED into SEC20240601000001
10:28  Alert C  – alert_type=BruteForce, threat_object=192.168.1.5   → MERGED into SEC20240601000001
10:45  Alert D  – alert_type=BruteForce, threat_object=192.168.1.5   → NEW Ticket SEC20240601000002
        (window_minutes=30 → Alert D is >30 min after Alert A's cluster opened)
```

### Ticket fields set automatically

| Field | Source |
|---|---|
| `ticket_number` | Auto-generated `SEC{YYYYMMDD}{5-digit-seq}` |
| `title` | Derived from the first alert's `alert_type` |
| `status` | `OPEN` on creation |
| `priority` | Mapped from the highest `severity` in the cluster |
| `created_at` | Timestamp of the first correlated alert |

### Verification checklist

- [ ] Integration **Test Connection** returns green
- [ ] Orchestrator task appears in **Running** or **Completed** state after first scheduled run
- [ ] `Alert` count increases in **Monitoring → Alerts** after the run
- [ ] `EventTicket` records appear in **Investigation → Tickets** grouped by the configured `match_keys`
- [ ] Each ticket's **Correlated Events** tab lists the individual alerts that were merged into it

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| No alerts ingested | Integration credentials wrong or index pattern returns 0 hits | Re-test connection; check index name |
| Task stays in **Pending** | Celery workers not running | `docker compose up worker beat` |
| All alerts create separate tickets | `window_minutes` too small or `match_keys` too specific | Increase window or reduce key fields |
| One ticket accumulates hundreds of alerts | `match_keys` too broad | Add a more specific field (e.g., `asset_id`) |
| Tickets created but no `CorrelationEvent` rows | Correlation engine not triggered | Check that `CORRELATION_ENGINE_ENABLED=true` in env |
