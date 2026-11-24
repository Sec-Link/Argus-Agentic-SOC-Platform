---
layout: default
title: "Alerts"
lang: en
lang_ref: alerts
---

# Alerts

The Alerts page is the central list of security events ingested into the platform. It provides one searchable, filterable table of every alert collected from the connected data sources, with a detail view for each alert.

**Navigation:** `Monitoring → Alerts`

<!-- TODO screenshot: assets/images/alerts/alerts-list.png (Alerts page: search box, Severity filter, Reset, table with the six columns) -->

## Alert List

The list shows alerts from the Elasticsearch index of the active Elasticsearch integration, plus alerts fetched from Splunk. It is sorted by time, newest first, and reloads when you change a filter or the Elasticsearch connector. The footer shows the total (`N alerts`).

### Filtering and Search

| Control | Description |
|---|---|
| **Search box** | Placeholder `Filter by id / message / details / rule / host / ip`. The list updates as you type and matches alert ID, message, description, title, rule ID, source index and the raw alert content |
| **Severity** | `Critical`, `High`, `Medium`, `Low` or `Unknown`. Source values are normalized: for example `fatal` counts as Critical, `error` as High, `warning` as Medium, `info` as Low |
| **Reset** | Clears the search and severity filter and restores the default sort (time, newest first) |

**Links into this page.** Other pages open the list pre-filtered with address parameters:

| Link | Effect |
|---|---|
| `/alerts?q=<text>` | Fills the search box |
| `/alerts?severity=critical` | Sets the Severity filter |
| `/alerts?q=<text>&severity=high` | Both |

### Table Columns

| Column | Description |
|---|---|
| **Severity** | Color-coded tag; sortable |
| **ID** | Alert identifier with a copy icon (`Alert ID copied`); sortable |
| **Time** | Event time in your local time zone, or `Unknown Time`; sortable (default, descending) |
| **Message** | Alert description or title; hover for the full text; sortable |
| **Detection Rule** | Name of the detection rule that produced the alert, as a link to the rule; `—` when no rule is linked |
| **Risk Objects** | Up to two entities (IP, user, host, hash) as colored tags, plus `+N` for the rest (hover to see them); `—` when none |

Drag a column header edge to resize it. Use the footer to move between pages and to choose a page size of 10, 20 (default), 50 or 100.

**Risk Objects** are the entities an alert is about: the IPs, users, hosts and file hashes extracted from alert fields. Which fields count as risk objects is configured per detection rule (with a platform default). The same entities drive the **Risk Entities** tab of Correlation.

## Alert Details

Click any row to open the **Alert Details** dialog.

| Section | Contents |
|---|---|
| Header | Severity tag, source index, time and alert ID |
| **Message** | Alert message |
| **Details** | Description or details of the event |
| **Host Name** / **Source IP** | Host and source address when present in the alert |
| **Risk Objects** | All extracted entities with the field they came from (shown when present) |
| **Detection Rule** | Link to the detection rule |
| **Raw Context** | The full alert record as JSON |

The dialog is read-only: alerts have no status, assignment or acknowledgment in the list.

## From Alert to Ticket

Alerts become tickets through the data pipeline, not from this page:

- **Elasticsearch alerts.** Each Orchestrator run stores new alerts and opens a ticket for every new or changed alert. With the Correlation policy enabled, an alert that matches an In Progress ticket inside the time window is attached to that ticket instead. See [Data Onboarding]({{ '/en/data-onboarding/' | relative_url }}).
- **Splunk alerts.** Fetched with **Fetch Data** in the Splunk integration. They are listed here but are not ticketed automatically.

Tickets are listed under `Investigation → Tickets`; see [Ticket Handling]({{ '/en/ticket-handling/' | relative_url }}).

## Alert Deduplication

An alert is identified by its source ID (`alert_id`, `event_id` or `es_id` for Elasticsearch documents) together with its source index. When the same ID arrives again, the existing alert is updated and no duplicate is created. Splunk alerts get a hashed ID built from the event ID, the integration and the index, with the same effect.

## Troubleshooting

| Issue | Check |
|---|---|
| No alerts appear after setup | Verify the Orchestrator task ran successfully; open **View Runs** and check the log |
| Alerts missing from the expected time range | Confirm the `Timestamp field` in the Orchestrator task matches your ES document schema; alerts without a usable time show `Unknown Time` |
| Alerts from another index are not listed | The list follows the index of the active Elasticsearch integration; Splunk alerts are always listed |
| Duplicate alerts appearing | Ensure the source document's unique ID field is consistently populated |
| Alerts not generating tickets | Elasticsearch: check the Orchestrator run counters and that the alert is new or changed; Correlation may have attached it to an existing ticket. Splunk alerts are never ticketed automatically |
| **Detection Rule** shows `—` | The alert's rule ID does not match a detection rule in the platform |
