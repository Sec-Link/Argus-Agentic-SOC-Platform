---
layout: default
title: "Dashboard"
lang: en
lang_ref: dashboard
---

# Dashboard

The Dashboard is the default landing page after login. It combines a real-time operational view of the security environment (alert volumes, severity and score trends, top talkers, the flow from raw events to tickets) with a detection coverage summary, and a second tab for configuring that coverage.

**Navigation:** `Monitoring → Overview`

![Dashboard Overview]({{ '/assets/images/dashboard/dashboard-overview.png' | relative_url }})
<!-- TODO screenshot: assets/images/dashboard/dashboard-overview.png is outdated; it predates the new KPI cards (Enabled SIEM Rules, Detections (Last Hour)), the Detection coverage card and the Events flow panel. Recapture the full Overview tab. -->

## Tabs and Header Controls

The page has two tabs. The active tab is kept in the URL, so the browser Back and Forward buttons move between them.

| Tab | URL | Purpose |
|---|---|---|
| **Overview** | `/dashboard` | KPI cards, charts, tables, Events flow and the correlation pipeline |
| **Coverage settings** | `/dashboard?tab=coverage` | Log source scanning, classification and ATT&CK catalog sync — see [Detection Coverage]({{ '/en/detection-coverage/' | relative_url }}) |

On the **Overview** tab, the controls at the right of the tab bar are:

| Control | Description |
|---|---|
| **Customize layout** / **Done** | Turn drag-to-reorder on and off (see [Customizing the Layout](#customizing-the-layout)) |
| **Reset layout** | Appears while customizing, only if the order differs from the default |
| Time picker | Shows the active range (for example `All Time`); click to open the range menu |

The **Guide** button in the page header is described under [Page Guide](#page-guide).

<!-- TODO screenshot: assets/images/dashboard/header-controls.png (tab bar with Customize layout and the time picker closed) -->

## Time Range

The time picker controls which alerts and tickets the Overview tab counts. The default is **ALL TIME**.

### Presets

| Preset | Range |
|---|---|
| **1H** | Last 1 hour |
| **24H** | Last 24 hours |
| **7D** | Last 7 days |
| **ALL TIME** | No time limit |
| **CUSTOM** | A start and end that you enter |

1H, 24H, 7D and ALL TIME apply as soon as you click them.

### Custom Range

1. Click **CUSTOM**.
2. Pick a date and enter a time (`HH:mm:ss`) for **Start** and **End**. **Now** sets the end to the current time.
3. Click **Apply Custom**.

Invalid input (a missing date, a malformed time, or a start later than the end) is reported under the fields and blocks **Apply Custom**. While a custom range is active, the picker shows *Custom window locked for auto-refresh*: automatic refreshes keep re-reading exactly that window.

<!-- TODO screenshot: assets/images/dashboard/time-picker.png (time range menu with CUSTOM selected) -->

### Default Time Range

Click **Set as Default** to store the active range as your default. The default is saved in this browser only, and is used the next time you open the Dashboard. Without a saved default, the page restores the range you last used in the current browser session, otherwise ALL TIME.

## Auto-Refresh

The Overview data reloads every 10 seconds while the browser tab is visible, and once more when you switch back to the tab. Each KPI card, chart and table also has its own refresh icon that reloads that panel on demand. Alert statistics reflect data already written to the platform database, so newly ingested alerts appear after the next Orchestrator run completes (see [Data Onboarding]({{ '/en/data-onboarding/' | relative_url }})).

## KPI Cards

All five cards follow the selected time range.

| Card | What it counts |
|---|---|
| **Alerts in Last Hour** | Alerts in the final hour of the selected range |
| **Total Alerts** | Alerts in the selected range |
| **Data Sources** | Distinct source indices seen on those alerts |
| **Enabled SIEM Rules** | Distinct detection rules that appear on those alerts |
| **Detections (Last Hour)** | Distinct detection rules that produced alerts in the final hour of the range |

> If every card shows zero after login, no alerts have been ingested yet. Go to [Data Onboarding]({{ '/en/data-onboarding/' | relative_url }}) to configure your first integration.

## Panels

| Panel | Description |
|---|---|
| **Detection coverage** | Log source and ATT&CK coverage summary (see [below](#detection-coverage-card)) |
| **Alert Category Breakdown** | Pie chart of alerts by category |
| **Alert Trend** | Alert volume over time; **Group by** `1 hour` or `1 day` |
| **Alert Severity Distribution** | Pie chart of alerts by severity |
| **Alert Score Trend** | Alert score over time; **Group by** `1 hour` or `1 day` |
| **Top Source 10 IP** | Source IPs with the most alerts (columns IP, Count) |
| **Top 10 Users** | Users with the most alerts (User, Count) |
| **Top 10 Sources** | Alert sources with the most alerts (Source, Count) |
| **Top 10 Rules** | Detection rules that fired most (Rule, Count) |
| **Events flow** | Log volume flowing into alerts and tickets (see [below](#events-flow)) |
| **Alert Correlation — 5-Stage Detection Pipeline** | Sankey diagram from ATT&CK tactics to event level (see [below](#alert-correlation-pipeline)) |

The Top-10 tables show five rows per page. Empty panels show a "No data" placeholder. Monitoring the severity and trend panels over time helps detect detection drift — a sudden increase in Critical alerts may indicate a new active threat or a rule generating false positives.

## Detection Coverage Card

The **Detection coverage** card answers two questions: are the systems we should monitor sending logs, and which attacker techniques do the enabled rules cover?

- **Log source coverage** — four numbers: **Coverage** (%), **Receiving logs** (receiving / configured categories), **Enabled rules** (enabled / all rules) and **Unmonitored sources**.
- **Category tiles** — one per configured category, with a green or red bar (logs received or not), the number of sources, and `n/m rules on`. Clicking a tile opens **Coverage settings**.
- **Scan age** — *Last scanned …* (turns to a warning after 24 hours) or *Never scanned*.
- **MITRE ATT&CK coverage heatmap** — **Coverage**, **Techniques covered** and a tactic-by-technique matrix. Clicking a tactic or technique opens the Detection rule list filtered to it.

Hover the **?** next to a label for a one-line definition; click it for a longer explanation (what it is, how it is calculated, why it matters, how to improve). Click a number to open a detail table of the categories, rules or sources behind it.

The card has a **Coverage settings** button. Until coverage is set up, it shows *Coverage is not set up yet* with a **Set up coverage** button; if the data cannot be loaded it offers **Retry**. How each number is computed, and how to set coverage up, is described in [Detection Coverage]({{ '/en/detection-coverage/' | relative_url }}).

<!-- TODO screenshot: assets/images/dashboard/detection-coverage-card.png (Detection coverage card with stats, category tiles and ATT&CK heatmap) -->

## Events Flow

**Events flow** shows how much log data each source category produces and how much of it ends up as alerts and tickets. Read it left to right:

1. **Log source categories** (EDR, Firewall, Identity, …), each with its top sources.
2. **Events** — the total across all categories, in the centre.
3. **Alerts** — alerts in the selected time range.
4. **Open tickets** — tickets that are not resolved or closed.
5. **Incidents** — tickets whose result is `true_positive`.

### How the Numbers Are Built

- **Events** come from the latest log source scan (the last 7 days by default), not from the time picker. The card subtitle states the window.
- **Alerts**, **Open tickets** and **Incidents** follow the time picker.
- Sources you marked as ignored are excluded. Sources that are not assigned to any category form an **Unclassified** branch, which is always drawn last (even when it has the most events), starts collapsed, and still counts toward the Events total.
- Each category shows its top 5 sources; the rest are grouped as **+N more**, and **Show less** collapses them again.

If no log source scan exists yet, the card shows *No log source scan yet, so event volume is unknown* and a **Set up coverage** button.

### Interacting with the Chart

| Click target | Opens |
|---|---|
| A category, or the **Events** total | The **Coverage settings** tab (also the **Coverage settings** link on the card) |
| **Alerts** | `/alerts` |
| **Open tickets** | `/tickets?status=open` |
| **Incidents** | `/tickets?result=true_positive` |

Hover a source, category or node for a tooltip (event count and share of the total, last seen, how the source was classified, approximate hosts and index count). Flow animation is turned off when the operating system requests reduced motion. The chart has a minimum width; on narrower screens the card scrolls horizontally.

<!-- TODO screenshot: assets/images/dashboard/events-flow.png (Events flow with categories, sources, Events total, Alerts, Open tickets and Incidents) -->

## Alert Correlation Pipeline

**Alert Correlation — 5-Stage Detection Pipeline** is a Sankey diagram built from the tickets created in the selected time range. Its stages are **MITRE ATT&CK Framework**, **Developed Use Cases**, **Alerts**, **Resolution** and **Event Level**. ATT&CK tactics and use-case groups are derived from the ATT&CK tags of the rules behind each ticket's alerts. If there are no tickets with a category, resolution and priority in the range, the panel shows *No correlation data available*.

## Customizing the Layout

1. Click **Customize layout**.
2. Drag KPI cards among themselves, and panels among themselves, into the order you want.
3. Click **Done**. **Reset layout** restores the default order.

The order is saved in your browser; other users and other browsers are not affected.

## Page Guide

The **Guide** button in the page header (shown on the Dashboard only) starts a step-by-step tour of the current tab: the Overview tab or the Coverage settings tab. The tour never starts by itself; click **Guide** whenever you want it.

## Navigation Structure

The left sidebar organizes the platform into five groups:

| Group | Items |
|---|---|
| **Monitoring** | Overview (Dashboard), Alerts, Reports |
| **Investigation** | Tickets, Assets |
| **Data Pipeline** | Detection, Integrations, Orchestrator, Correlation |
| **Automation** | Interfaces, Workflows, Executions |
| **Administration** | Access Management, AI Assistant, Approvals, Audit Logs, System Settings |

## Initial State

On a fresh installation with no data sources configured:

- All KPI cards read `0` and the trend panels are empty.
- The Detection coverage card shows *Coverage is not set up yet*, and Events flow shows *No log source scan yet*.

**Recommended first steps:**

1. Go to [Data Onboarding]({{ '/en/data-onboarding/' | relative_url }}) and configure an Elasticsearch integration.
2. Set up an Orchestrator task to begin ingesting alerts.
3. Configure a Correlation policy to generate tickets from incoming alerts.
4. Open the **Coverage settings** tab and set up coverage ([Detection Coverage]({{ '/en/detection-coverage/' | relative_url }})).
5. Return to the Overview tab to confirm data is flowing.
