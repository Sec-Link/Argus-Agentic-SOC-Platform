---
layout: default
title: "Ticket Handling"
lang: en
lang_ref: ticket-handling
---

# Ticket Handling

The Tickets module is the core incident management component of Argus. It provides a full lifecycle system for tracking security incidents from creation through resolution, with built-in SLA monitoring, AI-assisted analysis and collaborative investigation. Automated response is handled by the Automation module, summarized at the end of this page.

**Navigation:** `Investigation → Tickets`

---

## Tickets

### Navigation

Click **Tickets** under **Investigation** in the left sidebar. The page heading is **Incidents**.

![Tickets Navigation]({{ '/assets/images/ticket-handling/tickets-nav.png' | relative_url }})
<!-- TODO screenshot: assets/images/ticket-handling/tickets-nav.png (sidebar now groups Tickets under Investigation; recapture) -->

### Ticket List View

The list provides a unified view of incidents with filtering, search and chart visualization. The header shows `Showing N of M incidents`.

![Ticket List]({{ '/assets/images/ticket-handling/tickets-list.png' | relative_url }})
<!-- TODO screenshot: assets/images/ticket-handling/tickets-list.png (recapture if the filter bar, charts or batch toolbar differ) -->

#### Key Features

| Feature | Description |
|---|---|
| **New Incident** / **Refresh** | Top-right buttons: create a ticket, reload the list |
| **Severity**, **Status**, **Owner**, **SLA** filters | Multi-select dropdowns. Each option shows its count, for example `High (12)`. Options within one filter are OR-ed, different filters are AND-ed |
| **Search** | Placeholder `Search in Incidents (e.g. status:pending owner:alice)`. Free text matches ticket number, title, status, priority and owner. `status:`, `priority:` and `owner:` terms filter on an exact value; other `key:value` terms are treated as free text |
| **Time Range** | `Last 15 Mins`, `Last 1 Hour`, `Last 24 Hours`, `Last 7 Days`, `Last 30 Days` or `Custom Range` |
| **Refresh every** | `Off` (default), `1m`, `5m` or `10m` automatic reload |
| **Table View** / **Summary View** | Switch between the table and the chart-only summary |
| **Chart cards** | **Severity**, **Status**, **SLA** and **Owner** pie charts with a **Total** in the center; they follow the search and time range |

**Dashboard links.** Pages such as the dashboard open the list pre-filtered through the address:

| Link | Effect |
|---|---|
| `/tickets?status=open` | Status filter set to New, Acknowledged, Triaged and Contained |
| `/tickets?status=new,resolved` | Status filter set to the listed values |
| `/tickets?priority=critical,high` | Severity filter set to the listed values |
| `/tickets?result=true_positive` | Only tickets whose Event Result is `true_positive` |

#### Table Columns

| Column | Description |
|---|---|
| **ID** | Unique ticket number (`SECYYYYMMDDNNNNN`); click to open the detail view |
| **Name** | Short incident summary |
| **Severity** | Critical / High / Medium / Low |
| **Status** | Current lifecycle state (color-coded) |
| **Owner** | Assigned analyst, or `Unassigned` |
| **SLA** | `TTA:<time to acknowledge> / TTR:<time to resolve>` |
| **MITRE ATT&CK** | Up to three tactic tags from the originating detection rule, plus a `+N` counter; `—` when none |
| **Created** | Creation timestamp |

#### Batch Operations

Tick one or more rows to enable the toolbar above the table; it shows `N selected`.

| Action | Description |
|---|---|
| **Assign** | Assigns the selected tickets to one user |
| **Edit** | Sets any of Owner, Severity (priority) and Status on all selected tickets |
| **Export** | Downloads the selected tickets as CSV (number, title, status, priority, assigned user, created and updated time, MTTA, MTTI, MTTC, MTTR in seconds) |
| **Close** | Sets the selected tickets to Closed after confirmation |
| **Delete** | Soft-deletes the selected tickets after confirmation (records are retained for audit) |

### Creating a Ticket

Most tickets are created automatically from alerts (see the end of this page). To open one by hand:

![Create Ticket]({{ '/assets/images/ticket-handling/tickets-create.png' | relative_url }})
<!-- TODO screenshot: assets/images/ticket-handling/tickets-create.png (outdated: the dialog is now titled New Incident with the fields below) -->

1. Click **New Incident** in the top-right of the list.
2. Fill in the **New Incident** dialog:

| Field | Description |
|---|---|
| **Created By** | Required; defaults to your username |
| **SIEM Event ID (optional)** | Identifier of the originating event |
| **Title** | Required |
| **Description** | Optional |
| **Priority** | `Critical`, `High`, `Medium` (default) or `Low` |

3. Confirm. The message `Incident created` appears and the ticket detail opens.

The ticket starts in the **New** status with SLA tracking running. Event category and labels are set later from the detail view.

### Ticket Detail View

Click any ticket ID to open the detail view; **Back to List** returns to the list.

![Ticket Detail]({{ '/assets/images/ticket-handling/tickets-detail.png' | relative_url }})
<!-- TODO screenshot: assets/images/ticket-handling/tickets-detail.png (recapture: tabs are Incident Info, War Room, Work Plan, Evidence, Related Incidents) -->

#### Tabs

| Tab | Contents |
|---|---|
| **Incident Info** | Sub-tabs **Timeline**, **Alerts**, **Raw Message** (original alert JSON with syntax highlighting) and **Tasks**; evidence, a **Work Plan** card listing workflow runs for the ticket, and the comment box; right column with **Case Details**, **Decision Actions**, **Resolution Summary**, **Labels**, **AI Summary**, **SOC AI Assistant** and **AI Tasks** |
| **War Room** | Work logs, handle logs, files and evidence |
| **Work Plan** | Placeholder (`No work plan items yet`); the ticket's workflow runs are shown in the **Work Plan** card of **Incident Info** |
| **Evidence** | Attachments and observables (IPs, domains, hashes) extracted by AI analysis |
| **Related Incidents** | Placeholder (`No related incidents yet`) |

The header also has **Pending** (see below) and **Refresh**.

### Ticket Lifecycle

```
New → Acknowledged → Triaged → Contained → Resolved → Closed
```

| Status | Description |
|---|---|
| **New** | Freshly created, awaiting first response |
| **Acknowledged** | Analyst has begun reviewing |
| **Triaged** | Classified and prioritized |
| **Contained** | Immediate threat mitigated |
| **Resolved** | Root cause addressed; incident handled |
| **Closed** | Administratively closed |

**Decision Actions** in the right column move the ticket forward; each button is enabled only from the matching status:

- **Acknowledge** — available when `New`
- **Triaged** — available when `Acknowledged`
- **Contained** — available when `Triaged`
- **Resolved** — available when `Triaged` or `Contained`; opens the **Resolve Ticket** dialog

A ticket is moved to **Closed** with the batch **Close** action in the list, and any status can be set with the batch **Edit** action.

**Resolve Ticket dialog fields:**
- **Event Category** — root cause classification
- **Event Result** — verdict, for example True Positive or False Positive
- **Notes** — optional resolution summary

The chosen category and verdict then appear under **Resolution Summary** as **Ticket Category** and **Ticket Verdict**.

**Pending state:** The **Pending** button (available once the ticket is acknowledged and until it is closed) pauses SLA timers; the button then reads **In Progress** and switches back. Pending intervals are subtracted from SLA calculations. While a ticket is pending, adding War Room entries is disabled.

### SLA Tracking

| Metric | Formula | Description |
|---|---|---|
| **MTTA** | T3 − T2 | Mean Time To Acknowledge |
| **MTTI** | T4 − T3 | Mean Time To Investigate |
| **MTTC** | T5 − T2 | Mean Time To Containment |
| **MTTR** | T6 − T2 | Mean Time To Resolution |

The list shows MTTA as `TTA` and MTTR as `TTR`. The **SLA** filter and chart group tickets by MTTR:
- **Green** `<=1h` — within target
- **Yellow** `1-4h` — approaching breach
- **Red** `>4h` — SLA breached
- `n/a` — not resolved yet

### War Room

The War Room consolidates all investigative artifacts for a ticket.

![War Room]({{ '/assets/images/ticket-handling/tickets-warroom.png' | relative_url }})

| Section | Contents |
|---|---|
| **All** | Combined view of work and handle logs |
| **Work Logs** | Analyst notes, AI responses, comments |
| **Handle Logs** | System entries (status changes, label updates) |
| **Files** | Uploaded attachments |
| **Evidence** | Collected observables and evidence |

**Adding a work log:**
1. Type in the text area at the bottom.
2. Paste images directly (Ctrl+V / Cmd+V) — auto-uploaded and embedded.
3. Click **Send**.

### AI Assistant

In the right column, **SOC AI Assistant** offers:
- **Run AI Assistant** — generates an alert interpretation and summary, shown in **AI Summary**, with follow-up items in **AI Tasks** and extracted observables in **Evidence**
- **Chat** — opens an interactive conversation scoped to the current ticket

**@ai mention:** In the comment box, type `@ai <question>` to post an AI response directly to the work log.

**@playbook mention:** Type `@` or `@playbook` to list the workflows that can be invoked from tickets, pick one, and click **Send**. The result is logged in the work log and the run appears in the **Work Plan** card of **Incident Info**. If no workflow is available for tickets, the list shows `No callable playbooks`.

### Labels

**Labels** are name/value pairs used to categorize tickets.

1. Open the **Labels** card in the right column.
2. Enter **Label name** and an optional **Label value (optional)**, then click **Add**.

Labels can also be used by workflows (see below).

---

## Automation Overview

Automation is a separate module, `Automation → Workflows`, with its own page: [Automation]({{ '/en/automation/' | relative_url }}). A **workflow** is a sequence of response steps (notify a channel, call an API, update a ticket, look up an IP, block an address) that starts from a trigger and runs on a Prefect worker.

What a ticket analyst needs to know:

1. **Tickets can start workflows automatically.** The triggers **On Ticket Created** and **On Ticket Status Change** start matching workflows when a ticket is created or an existing ticket is saved. **On Ticket Created** can be restricted with conditions on ticket fields (status, priority, event category, event result, a label as `name:value`).
2. **Ticket Labels bindings.** A workflow can be bound to ticket labels (with AND/OR logic); bound labels appear in the workflow's **Ticket Labels** column.
3. **Workflows can read and change tickets.** The **Create Ticket** and **Update Ticket** actions work on tickets, and steps can use ticket fields such as `{% raw %}{{ticket.priority}}{% endraw %}`.
4. **Invoke from the ticket.** Use `@playbook` in the comment box (see above) to run a workflow for the current ticket; runs started this way are listed in the **Work Plan** card of **Incident Info**.
5. **Only published workflows run.** A workflow must be active and published before it runs; editing alone never changes what runs.
6. **Follow the results** in `Automation → Executions`, which shows each run's steps, logs and errors.

Building, publishing, variables and secrets, notification and API actions, and external webhook interfaces are described in [Automation]({{ '/en/automation/' | relative_url }}).

---

## From Alert to Ticket

Tickets are normally created from alerts by the Orchestrator and the Correlation policy: each new alert gets a ticket, and with Correlation enabled an alert can be attached to a matching in-progress ticket instead. See [Data Onboarding]({{ '/en/data-onboarding/' | relative_url }}) and [Alerts]({{ '/en/alerts/' | relative_url }}).
