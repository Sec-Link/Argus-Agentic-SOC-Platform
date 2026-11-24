---
layout: default
title: "Automation"
lang: en
lang_ref: automation
---

# Automation

The Automation module runs response procedures without manual effort. A **workflow** is a graph of steps (send a notification, call an API, update a ticket, look up an IP, block an address) that starts from a trigger. Workflows are built in a visual editor, published as numbered versions, and executed by a Prefect worker. **Interfaces** are inbound HTTP endpoints that let external systems start workflows.

**Navigation:** `Automation → Workflows`, `Automation → Executions`, `Automation → Interfaces`

<!-- TODO screenshot: assets/images/automation/workflows-list.png (Workflows list with the four summary cards, filters and table) -->

---

## Workflows List

Open `Automation → Workflows`. Four cards at the top show **Total Workflows**, **Active**, **Total Executions** and **Success Rate**. The list and cards refresh automatically every 5 seconds while the browser tab is visible.

### Header Controls

| Control | Description |
|---|---|
| **Search workflows...** | Matches workflow name and description |
| **Status** filter | `Active`, `Inactive` or `Draft` |
| **Trigger Type** filter | Manual, On Alert, On Ticket Created, On Ticket Status, Scheduled, Webhook |
| **Refresh** | Reloads the list |
| **Import JSON** | Imports a workflow file (see Import and Export) |
| **View Executions** | Opens `Automation → Executions` |
| **Create Visual Workflow** | Opens the visual editor with an empty workflow |

### Table Columns

| Column | Description |
|---|---|
| **Name** | Click to open the editor. The second line shows `draft vN`, plus `published vM` once the workflow has been published |
| **Trigger** | Trigger type tag |
| **Steps** | Number of steps |
| **Status** | Run-status tag plus lifecycle tags (below) |
| **Ticket Labels** | Label filters bound to the workflow, or `Not bound` |
| **Last Execution** | Status and start time of the most recent run, or `Never` |
| **Executions** | Total number of runs |
| **Actions** | Row buttons (below) |

**Status tags**

| Workflow | Not published | Published and active | Published and inactive |
|---|---|---|---|
| Manual | `Manual Run` (grey) | `Manual Run` (blue) | `Manual Run · Inactive` |
| Scheduled | `Schedule Disabled` | `Scheduled · Enabled` (shows the cron expression) | `Scheduled · Disabled` |
| On Alert / Ticket / Webhook | `Event Trigger` | `Listening · Enabled` | `Listening · Disabled` |

Lifecycle tags: `Draft` (orange), `Published vN` (blue), `Unpublished` (workflow was never published) and `Changes` (red, edited since the last publish). A `Legacy Local / unavailable` tag marks old workflows created before the Prefect engine; publish them again to use them.

### Row Actions

| Button | Description |
|---|---|
| Schedule switch | For **Scheduled** workflows only; replaces the Execute and Stop buttons. Turns the schedule on or off |
| Execute | Starts a run |
| Stop | Replaces Execute while the latest run is `pending`, `running` or `paused`; requests cancellation |
| Visual Editor | Opens the editor |
| Clone | Creates an inactive draft copy |
| Export published version | Downloads the last published version as JSON (disabled until the first publish) |
| Publish to Prefect | Publishes the current draft as a new version (disabled while a run is in progress) |
| Delete | Deletes the workflow after confirmation |

**Execute** rules:

- The workflow must be **Active** and have been **published at least once**; otherwise the button is disabled and the tooltip says what is missing.
- A run always uses the **last published version**, even when the draft has unpublished changes. The tooltip shows `Execute the last published version (vN)`.

**Schedule switch** rules (turning a schedule on):

- The workflow must have been published at least once.
- An execution deployment must be selected in the editor (see Deployments).
- At least one enabled schedule must exist, either the **Cron** field of the workflow or an active schedule.
- A workflow that is switched on but never published can still be switched off.

If a request is refused, the reason is shown as an error message.

---

## Publishing and Versions

Editing and running are separate on purpose.

- **Save Draft** in the editor changes only the working copy (`draft vN`).
- **Publish to Prefect** in the list takes a snapshot of the active steps, variables, trigger and schedule settings and stores it as a new numbered version. Snapshots are stored in the platform database and are never changed afterwards.
- **Execute**, schedules, webhooks and event triggers always run the **published version**. Each execution records the version it started with, so editing or republishing never alters a run in progress or the history of earlier runs.
- The editor header shows `vN`, `Published vM` or `Unpublished`, and a red `Unpublished Changes` tag when the draft differs from the published version.

Publishing is refused when:

- the workflow has no active step (`Cannot publish a workflow with no active steps.`);
- the workflow is active and its execution deployment is empty or no longer available;
- a step uses an unknown action type, or a required credential is missing from an action.

After a successful publish the platform re-synchronizes the workflow's schedules with Prefect. If that step fails, the workflow is still published and a warning reads `manifest published, but schedule synchronization failed: ...`; check the schedule list in the editor and publish again.

---

## Visual Editor

Click a workflow name, the Visual Editor button, or **Create Visual Workflow**.

<!-- TODO screenshot: assets/images/automation/workflow-editor.png (visual editor: settings sidebar, canvas with Start/Action/End nodes) -->

### Top Bar

| Control | Description |
|---|---|
| **Back** | Returns to the list |
| Title and tags | `Create Visual Workflow` or `Edit: <name>`, `vN`, `Published vM` / `Unpublished`, `Unpublished Changes` |
| **Execute** | Runs the last published version (existing workflows, not Scheduled; same rules as in the list) |
| **Save Draft** | Saves without activating |
| **Save & Activate** | Saves and turns the workflow on (hidden for Scheduled workflows, which are turned on with the list switch). Requires an execution deployment |

Saving never publishes. Publish from the list after you save.

### Workflow Settings

| Field | Description |
|---|---|
| **Name** | Required |
| **Description** | Optional |
| **Execution deployment** | The Prefect deployment that runs the workflow. Drafts may be saved without one |
| **Schedules** | Appears when schedules exist (see below) |
| **Trigger** | One of the trigger types (see Triggers) |
| **Cron** | Shown for Scheduled workflows, for example `0 */4 * * *` |
| **Active** / **Draft** | Switches. Active is hidden for Scheduled workflows |
| **Variables** | Workflow variables and secrets (see Variables and Secrets) |

Trigger details (webhook source, conditions) are edited in the Start node: select it and click **Configure Node**.

**Schedules.** The list shows each schedule with its name, an `Active` or `Paused` tag, and its cron expression or interval. A Scheduled workflow with a Cron value gets a schedule named `default`. To remove one, click its trash icon and confirm. Deleting `default` also clears the workflow's Cron setting. To change the execution deployment you must first delete **all** schedules, including paused ones; the deployment selector is disabled while any schedule exists.

### Ticket Labels

Available for saved workflows. Choose which tickets the workflow is bound to by label.

| Field | Description |
|---|---|
| **Binding Name** | Required, for example `Critical ticket routing` |
| **Label Logic** | `AND` (all label rows must match) or `OR` (any row may match) |
| Label rows | `label_name` (required) and `label_value`; **Add Label** adds a row and **Remove** deletes one |

Click **Save Labels** to store the binding, or **Delete Binding** to remove it. Bound labels appear in the **Ticket Labels** column of the list.

### Node Palette

The **Workflow Nodes** panel lists nodes by category. Drag a node onto the canvas and connect nodes by dragging from one handle to another.

| Category | Nodes |
|---|---|
| Control Flow | **Start** (entry point), **End** (termination point), **Condition** (branches into two paths) |
| Action categories | Every available action grouped by category, such as Actions, Enrichment, Tickets, Utility (see Actions) |
| Saved nodes | Reusable nodes you saved with **Save As**; manage them with the edit button of the panel |

### Node Settings

Click a node to open **Configure Node**. Buttons at the top: **Delete**, **Save As** (action and condition nodes; stores the node for reuse; Start and End nodes cannot be saved), **Save**.

| Field | Applies to | Description |
|---|---|---|
| **Node Name** | All | Required |
| **Category** | Action, Condition | Palette category |
| **Action Configuration** | Action | Fields of the action (see Actions); a collapsible **Available context** list shows variable references you can paste |
| **Timeout (s)** | Action | Maximum run time of the step |
| **On Failure** | Action | `Stop Workflow`, `Continue to Next Step`, `Retry Step` or `Skip to Next Step` |
| **Retry Count** | Action | 0 to 5 |
| **Retry Delay (s)** | Action | 0 to 3600 |
| **Current Condition** / **Edit Condition** | Condition | Opens the condition builder: one or more rules joined by AND or OR, using operators such as Equals, Not Equals, Contains, Starts With, Greater Than, In List, Is Empty and Matches Regex |
| **Active** | All | A step switched off is left out of the published version |

Action forms have a **Visual Editor** / **JSON** toggle. Saved credentials are never displayed again: a configured field shows a green `Configured` tag, and leaving it empty keeps the existing value.

---

## Triggers

Choose the trigger in **Workflow Settings** or in the Start node.

| Trigger | Starts a run when | Configuration |
|---|---|---|
| **Manual Execution** | A user clicks Execute | None |
| **On Alert Created** | An alert event is dispatched to workflows | Condition builder (alert fields) |
| **On Ticket Created** | A new ticket is saved | Condition builder (ticket fields) |
| **On Ticket Status Change** | An existing ticket is saved again | None in the editor |
| **Scheduled** | The cron schedule fires | **Cron** field and schedules |
| **External Webhook** | An external system calls an Interface | **Webhook Source** |

> **Notes.** Event triggers (alert, ticket) only run workflows that are **active**, not in **Draft**, and published. Use **Save & Activate**, then publish. **On Ticket Status Change** runs whenever an existing ticket is saved, whatever field changed. In the current release, alert ingestion does not dispatch events to workflows, so **On Alert Created** can be configured but is not started by newly ingested alerts; use ticket triggers or the scheduler instead.

### Condition Builder (Start Node)

For **On Alert Created** and **On Ticket Created**, the Start node's **Configure Node** drawer shows a **Condition Logic** selector (`AND (all conditions match)` or `OR (any condition matches)`) and rows of **Field**, **Operator**, **Value**. Without rows, every event matches. Click **Add Alert Condition** or **Add Ticket Condition** to add a row.

| Trigger | Fields |
|---|---|
| On Alert Created | Alert ID, Severity, Rule ID, Title, Category, Source Index, Message |
| On Ticket Created | Ticket Number, Title, Creator, Status, Priority, Event Category, Event Result, `Label (name:value)` |

Operators: **Equals** (`==`), **Not Equals** (`!=`), **Contains**. Status, Priority, Event Category and Event Result offer a list of allowed values. For Label, enter `name:value` such as `env:prod`; the operator is always Contains.

### Webhook Trigger

Select **External Webhook**, then choose a **Webhook Source**. The list contains only enabled Interfaces of type **Webhook**. Create one first (see Interfaces). The workflow starts when that Interface receives a valid request; the request body becomes `trigger_data`.

### Scheduled Trigger

Enter a five-field cron expression in **Cron**. Cron schedules are created with the UTC time zone.

| Expression | Meaning |
|---|---|
| `*/15 * * * *` | Every 15 minutes |
| `0 */4 * * *` | Every 4 hours |
| `0 8 * * 1-5` | Weekdays at 08:00 UTC |
| `0 0 * * *` | Daily at midnight UTC |

A new Scheduled workflow is saved switched off. Publish it, choose an execution deployment, then turn on the switch in the list.

---

## Variables and Secrets

Declare values once in **Workflow Settings → Variables** and reuse them in step fields with `{% raw %}{{variables.name}}{% endraw %}`.

| Type | Stored as | Value format |
|---|---|---|
| **Text** | Plain text | Any string |
| **JSON** | Plain JSON | Valid JSON such as `123`, `true`, `["a"]`, `{"key":"value"}` |
| **Secret** | Encrypted, write-only | Any non-empty string |

Rules:

- A name starts with a letter or underscore and continues with letters, digits or underscores; names must be unique and cannot be shared between an ordinary variable and a secret.
- Click **Add variable** to add a row; the row shows a copyable `{% raw %}{{variables.name}}{% endraw %}` reference.
- A saved secret is never shown again. The row shows `Secret · Configured`; leave the field blank to keep the stored value, or type a new one to replace it.
- Secrets can only be referenced in credential fields of actions (fields that hold an API key, token or webhook URL) and in API Call headers or query parameters marked **Sensitive**. They are rejected in conditions and ordinary text fields.
- Remove references to a secret before deleting or renaming it.
- Outputs of steps can overwrite ordinary variables of the same name during a run.

**Context variables.** The collapsible **Available context** list in the editor shows what can be referenced:

| Reference | Content |
|---|---|
| `{% raw %}{{workflow_id}}{% endraw %}`, `{% raw %}{{workflow_name}}{% endraw %}`, `{% raw %}{{workflow_version}}{% endraw %}`, `{% raw %}{{execution_id}}{% endraw %}`, `{% raw %}{{trigger_source}}{% endraw %}` | Run metadata |
| `{% raw %}{{trigger_data}}{% endraw %}` | Data that started the run (ticket fields, webhook body, and so on) |
| `{% raw %}{{trigger_data.<field>}}{% endraw %}`, `{% raw %}{{ticket.<field>}}{% endraw %}` | For ticket triggers: `ticket_number`, `title`, `status`, `priority`, `description`, `create_uid`, `event_category`, `event_result`, `labels`, `current_assign_group`, `current_assign_owner` |
| `{% raw %}{{previous_step.output}}{% endraw %}`, `{% raw %}{{previous_step.success}}{% endraw %}`, `{% raw %}{{previous_step.step_id}}{% endraw %}` | Result of the step before (after it has run); append a field path for nested data |

**Encryption key.** Secrets and action credentials are encrypted with Fernet keys listed in the `WORKFLOW_ENCRYPTION_KEYS` environment variable (comma-separated). The backend and the workflow worker must use the **same** value; the backend refuses to start without a valid key when `DEBUG` is off, and the worker cannot decrypt secrets without it. Keep the key: a secret encrypted with a different key cannot be read and must be re-entered.

---

## Import and Export

**Export.** The download button in the row exports the **last published version** as `<workflow-name>-published-vN.json`. It is disabled until the workflow has been published. Secrets stay encrypted in the file.

**Import.** Click **Import JSON** and choose a file.

- The workflow is created as an **inactive draft**; review it, select a deployment, then publish and activate it.
- If a workflow with the **same name** already exists, the import updates that workflow's draft instead of creating a second one.
- Encrypted credentials that this environment cannot decrypt (for example, a file exported from an environment with another encryption key) are removed, and a warning lists each step and field: `Some encrypted credentials could not be validated and were removed. Re-enter them before publishing.` Re-enter the credentials and secret variables in the editor.

**Clone.** Creates `<name> (Copy)` as an inactive draft at version 1 with the same trigger, variables, secrets, steps and deployment. Schedules and ticket label bindings are not copied.

---

## Deployments

A workflow runs on a **Prefect deployment**. The platform maintains a list of deployments automatically: it registers Prefect deployments that carry the tag `soar` and use the SOAR flow entry point, and marks deployments that disappear as unavailable. Nothing is imported as a workflow.

- Each workflow selects its own deployment in **Execution deployment**. There is **no default**: a workflow without one cannot be activated, published while active, or scheduled.
- The deployment decides the **work pool** and **work queue** where the run is picked up, so choose the deployment whose worker has the access the workflow needs (network reach to your firewalls, for example).
- An unavailable deployment shows a warning under the selector and blocks execution.

---

## Actions

Action nodes are the steps of a workflow. Fields support `{% raw %}{{variable.path}}{% endraw %}` placeholders unless stated otherwise.

| Action | Category | What it does |
|---|---|---|
| **Log Message** | Utility | Writes a message at info, warning or error level to the run log |
| **Delay** | Utility | Waits 1 to 3600 seconds (default 5) |
| **Send Email** | Actions | Sends an email to a list of recipients with subject and body; optional HTML |
| **Send Notification** | Actions | Posts a message to Slack, Feishu or Wecom (see below) |
| **API Call** | Actions | Calls an HTTP API (see below) |
| **Create Ticket** | Tickets | Creates a ticket with title, description, priority (default `medium`), status (default `new`), event category and assignment |
| **Update Ticket** | Tickets | Updates tickets selected by ticket number, title or match fields: status, priority, assignment, event result, event category, records, comment |
| **IP Lookup** | Enrichment | Checks IP reputation against a threat-intelligence API (URL and API key) |
| **Hash Lookup** | Enrichment | Checks MD5, SHA-1 or SHA-256 reputation against a threat-intelligence API |
| **Block IP** | Containment | Blocks an IP through a security-device API; provider `generic` or `opnsense`, alias name, optional kill states and duration |
| **Disable User** | Containment | Disables a user account through a security-device or directory API |
| **Release IP** | Release | Removes an IP from the block list (same providers as Block IP) |
| **Enable User** | Release | Re-enables a user account |

Credentials of these actions (API key, secret, webhook URL) are stored encrypted and never displayed again. They are bound to the target they were saved for: if you change the API URL (or, for Send Notification and the OPNsense actions, the provider or alias), re-enter the credential.

### Send Notification

Posts a message to a chat group through an **incoming webhook** of the selected provider.

| Field | Description |
|---|---|
| **Provider** | `Slack`, `Feishu` (default) or `Wecom` |
| **Webhook Url** | The provider's incoming webhook URL (required). Must be an absolute HTTP or HTTPS URL, without embedded credentials or fragment. Stored encrypted. Changing the provider requires re-entering it |
| **Title** | Optional; supports placeholders |
| **Message** | Required; supports placeholders. An empty message after substitution fails the step |
| **Format** | `Markdown` (default) or `Text` |
| **Mention All** | Notifies everyone where the provider supports it (Slack `@channel`, Feishu `@all`, Wecom `@all`) |
| **Include Context Payload** | Appends a JSON block of workflow data to the message |
| **Context Source** | `Previous Step Output` (default), `Trigger Data` or `Workflow Variables` |
| **Timeout** | 1 to 60 seconds, default 15 |

Behaviour and limits: the request is sent once with no redirects; for Feishu and Wecom the step fails when the provider's reply carries a non-zero error code; the stored response is cut at 16 KB. With Markdown, Slack shows the title in bold and Feishu sends an interactive card.

### API Call

| Field | Description |
|---|---|
| **URL** | Absolute HTTP or HTTPS URL. The hostname must be fixed (no variables); the path and query may use placeholders. No embedded credentials or fragments |
| **Method** | `GET`, `POST`, `PUT`, `PATCH`, `DELETE` |
| **Timeout (seconds)** | 1 to 120, default 30 |
| **Verify TLS** | On by default; turning it off is noted in the step log |
| **Authentication type** | `none`, `bearer` or `basic` (with **Username**) and an **Authentication secret** |
| **Headers**, **Query parameters** | Key and value rows; tick **Sensitive** to store a value encrypted. Authentication cannot be combined with an `Authorization` header |
| **JSON body** | Template for non-GET methods; must be valid JSON after substitution |

Limits: redirects are not followed; the response is cut at 64 KB (the step output then has `truncated: true` and no parsed JSON). A response outside 200 to 299 fails the step.

**Allowed API targets (administrators).** API Call can reach only targets that an administrator has approved. Open `Administration → System Settings`, **Allowed API Targets**, and enter **one exact hostname, IP address or CIDR per line** (for example `firewall.internal`, `192.168.1.10`, `10.20.0.0/16`). Wildcards, URLs and credentials are rejected. Every target that is not listed is denied, public or private. A listed hostname must still resolve to an allowed, non-blocked address. **Loopback, link-local, unspecified, multicast and cloud-metadata addresses are always blocked**, even when listed. A denied call fails with `API target is not present in the administrator allowlist.` The allowlist applies to the **API Call** action only.

---

## Executions

Open `Automation → Executions` (or **View Executions** in the workflow list).

<!-- TODO screenshot: assets/images/automation/executions.png (Executions table with an Execution Details panel open) -->

| Control | Description |
|---|---|
| **Filter by Workflow** | Shows runs of one workflow |
| **Filter by Status** | `Completed`, `Running`, `Pending`, `Failed`, `Cancelled` |
| **Refresh** | Reloads; the table also refreshes every 5 seconds while the tab is visible |

| Column | Description |
|---|---|
| **Workflow** | Workflow name |
| **Status** | Pending, running, paused, completed, failed or cancelled |
| **Progress** | Percentage and `completed/total steps` |
| **Trigger** | Source of the run, such as `manual`, `schedule`, `ticket_created:<id>` or `interface:ingest:<id>` |
| **Started** | Start time |
| **Duration** | Elapsed time |
| **Actions** | **View Logs**, **Details**, and a cancel button for `running` or `pending` runs (asks for confirmation) |

- **Details** (or clicking a row) opens the **Execution Details** panel: workflow, status, progress, trigger, start time, duration, executed by, the error message if any, and a **Step Executions** timeline. Each step expands to show its action, error, logs and output. **Full Logs** and **Close** are at the top of the panel.
- **View Logs** opens **Execution Logs** with three tabs: **Step Timeline**, **Full Log** (copy or download) and **Context Data** (Trigger Data, Execution Context, Result Data).
- **Cancel** stops a pending or running execution and marks it `cancelled`.

---

## Interfaces

An Interface is an inbound HTTP endpoint. A system outside the platform (a SIEM rule, a monitoring tool, a script) posts JSON to it, and the platform starts every workflow whose trigger is **External Webhook** and whose **Webhook Source** is that interface. **An interface does not create alerts or tickets by itself.** It only starts workflows.

**Navigation:** `Automation → Interfaces`

<!-- TODO screenshot: assets/images/automation/interfaces.png (Interface Management table and Request Code Examples) -->

### Interface Management

| Control | Description |
|---|---|
| **Search keywords** | Matches name and description |
| **All Types / API / Webhook** | Type filter |
| **Refresh** | Reloads the table |
| **Create Interface** | Opens the dialog below |

The table shows only interfaces **you** created.

| Column | Description |
|---|---|
| **Name / Description** | Interface name and description |
| **Endpoint URL** | Full URL with a copy button |
| **Status** | Switch to enable or disable the interface |
| **Time** | `Created` and `Last event` time |
| **Actions** | **Edit**, **Copy URL**, **Logs**, **Test**, **Delete** (with confirmation) |

The **Request Code Examples** card below the table shows cURL, Python and JavaScript examples (with the interface token filled in) for the interface whose logs you opened last, or the first one in the list.

### Create Interface

| Field | Description |
|---|---|
| **Name** | Required |
| **Description** | Optional |
| **Type** | `Webhook` (default) or `API`. Only **Webhook** interfaces can be chosen as a workflow's Webhook Source |
| **HMAC Secret (optional)** | Turns on signature verification (see below) |
| **Enabled** | Switch; a disabled interface rejects requests |

A secret token is generated automatically when the interface is created.

### Calling an Interface

Send `POST`, `PUT` or `PATCH` with a JSON body to either URL form:

```
/api/v1/interfaces/endpoints/<id>/ingest/
/api/v1/interfaces/webhooks/<id>/
```

Prefix them with your platform address. No login is needed; the token authenticates the request.

| Item | Description |
|---|---|
| `X-Interface-Token` | The interface's secret token. It is also accepted as a `token` query parameter or JSON field |
| `X-Interface-Timestamp` | Required with an HMAC secret: Unix time in seconds; requests more than 5 minutes away from server time are rejected |
| `X-Interface-Signature` | Required with an HMAC secret: hex HMAC-SHA256 of `<timestamp>.<raw body>` using the HMAC secret (a `sha256=` prefix is accepted) |

| Response | Meaning |
|---|---|
| `202` | Accepted. The body lists the executions that were started (`execution_count` can be `0` when no workflow matches) |
| `401` | Invalid token, or missing, expired or wrong HMAC signature |
| `400` | The interface is disabled |
| `404` | Interface not found |

The JSON body (minus any `token` field) is passed to each started workflow as `trigger_data`. Only workflows that are **Active** and published are started.

### Logs and Test

- **Logs** opens **Request Logs** with the latest 100 requests: time, method, status, source IP and request body.
- **Test** sends a sample request (`{"event": "ui_test", "source": "interface_page"}`) through the same path, starts the matching workflows and records it in the log with method `TEST`.

---

## Troubleshooting

| Issue | Check |
|---|---|
| Execute button is disabled | The workflow must be Active and published at least once; hover to read the reason |
| Run uses old behaviour after an edit | Editing only changes the draft; click **Publish to Prefect** |
| Publish fails with "no active steps" | Switch on at least one step and save first |
| Publish or activate asks for a deployment | Select an **Execution deployment**; if the list is empty, ask an administrator to check the Prefect deployments |
| Schedule switch is disabled | Publish once, select a deployment, and make sure a Cron value or an active schedule exists |
| Cannot change the deployment | Delete all schedules (including paused) first |
| Ticket trigger does not start a run | Workflow must be Active, not Draft (use **Save & Activate**), published, and its conditions must match |
| Secret errors on save or import | Same `WORKFLOW_ENCRYPTION_KEYS` on backend and worker; re-enter secrets after importing a file from another environment |
| API Call fails with allowlist error | Add the exact hostname, IP or CIDR under `Administration → System Settings` |
| Webhook returns `401` | Wrong token, or HMAC timestamp older than 5 minutes, or signature computed over a different body |
| Webhook returns `202` with `execution_count` 0 | No active, published workflow uses this interface as its Webhook Source |

## See Also

- [Ticket Handling]({{ '/en/ticket-handling/' | relative_url }})
- [Data Onboarding]({{ '/en/data-onboarding/' | relative_url }})
