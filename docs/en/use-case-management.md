---
layout: default
title: "Use Case Management"
lang: en
lang_ref: use-case-management
---

# Use Case Management

Use Case Management is the detection engineering hub of Argus. It provides a centralized library for importing, creating, and publishing Sigma detection rules to Kibana (Elastic) and Splunk, along with field mapping management, a Kibana synchronization tool, and a publish history audit trail.

**Navigation:** `Data Pipeline → Detection`

> **Scope of this guide:** Rule management, publishing and field mapping configuration. Operations that modify system data — bulk uploads, rule deletions, publishing, synchronization — should follow your team's change management process. The Detection page also contains **Notable Events** and **Risk Config** tabs, which are not covered here.

![Detection / Rule Library]({{ '/assets/images/use-case-management/detection-list.png' | relative_url }})

## Quick Navigation

| Page | Path |
|---|---|
| Rule Library | Data Pipeline → Detection → Rule Library tab |
| Field Mappings | Data Pipeline → Detection → Field Mappings tab |
| Publish History | Data Pipeline → Detection → Publish History tab |

To see how enabled rules translate into log source and ATT&CK coverage, see [Detection Coverage]({{ '/en/detection-coverage/' | relative_url }}).

---

## Rule Library

The Rule Library is the primary interface for managing Sigma detection rules. It supports search, filtering, bulk import, manual creation, synchronization with Kibana, and export.

### Searching and Filtering

- **Search box** (`Search rules, tags, or data sources`) — filter by rule name, tags, or data source. Press Enter to reload.
- **Product filter** — narrow to rules for one product (taken from the rule's log source). Default `All Products`.
- **Severity filter** — the severities present in the library, typically critical, high, medium, low. Default `All Severities`.
- **Status filter** — the statuses present in the library (for example draft). Default `All Statuses`.
- **Reset** — clears the search, filters, sorting and paging.

Filters, sorting and paging are remembered for the browser session, so they survive opening a rule and coming back. The ATT&CK heatmap on the Dashboard uses the same mechanism to open the list pre-filtered by a technique or tactic.

The table lists the rule count (`Showing n / m rules`) and these columns:

| Column | Description |
|---|---|
| **Rule Name** | Rule title; click a row to open the rule |
| **Severity** | critical / high / medium / low |
| **Status** | Sigma rule status, such as draft |
| **Log Source** | Product, service and category from the Sigma `logsource` |
| **Profile** | Field mapping profile used to compile the rule |
| **Tags** | Sigma tags, including `attack.*` tags |
| **Elastic** | `Kibana Enabled` (published and enabled), `Published` (published but disabled) or `Not Published` |
| **Splunk** | One tag per Splunk publisher: `<publisher>: Enabled` / `Disabled`, the publication status if not synced, or `Not Published` |

### Importing Rules

| Method | Description |
|---|---|
| **GitHub URL** | Paste the URL of a raw Sigma rule YAML (for example `https://raw.githubusercontent.com/.../rule.yml`) and click **Import**; the rule is fetched and imported, then opened |
| **Upload → Upload Files** | Select one or more local `.yml` / `.yaml` Sigma rule files |
| **Upload → Upload Folder** | Select a folder; every `.yml` / `.yaml` file in it is uploaded |

After an upload, a message reports how many rules were created, updated and skipped.

Other toolbar actions:

| Button | Description |
|---|---|
| **Delete (n)** | Deletes the checked rules after a confirmation (`Delete n selected rules?`) |
| **Sync with Kibana** | Pulls the enabled state of published rules from Kibana (see [Sync with Kibana](#sync-with-kibana)) |
| **Export** | Downloads the rule library |
| **New Rule** | Opens the rule editor |

### Creating a Rule Manually

![New Rule Modal]({{ '/assets/images/use-case-management/new-rule-modal.png' | relative_url }})

1. Click **New Rule**.
2. Fill in the fields:
   - **Rule ID** — unique identifier (for example `aws_cloudtrail_root_login`)
   - **Tags** — optional; type a tag and press Enter (for example `attack.execution`, `attack.t1059.001`). Tags edit the `tags:` list of the YAML below
   - **Sigma YAML** — the full Sigma rule definition
3. Click **OK**.

> **Before saving:** Have a detection engineer review the YAML syntax, field references, and severity level. A malformed rule may fail at publish time rather than at creation.

### Rule Naming Conventions

Follow a consistent naming scheme that includes the data source, detected behavior, and relevant entity:

```
<datasource>_<behavior>_<entity>
```

Examples:
- `aws_cloudtrail_root_login`
- `windows_defender_malware_detected`
- `linux_sudo_privilege_escalation`

### Rule Detail

Click a rule to open its detail page. **Back to List** returns to the library; **Edit** reopens the YAML editor.

<!-- TODO screenshot: assets/images/use-case-management/rule-detail-elastic.png (rule detail page with Kibana Detection Rule card and Tags card) -->

The header shows the rule title, severity, status, version and description, with a selector to choose the publishing target: **Elastic** or **Splunk**.

| Area | Description |
|---|---|
| **Log Source**, **Mapping Profile** | Where the rule applies and which field mapping profile compiles it |
| **Tags** card | Edit the rule's tags; **Save** and **Reset** appear once you change them |
| **Kibana Detection Rule** card (Elastic target) | Publication state and Kibana actions (below) |
| **Cron Job / Schedule** card (Elastic target) | **Run every** (`1m` to `1h`) and **Lookback** (for example `now-16m`) for the Kibana rule |
| **Detection** tabs | **Sigma**, **ES|QL** (or **Lucene** when ES|QL cannot be generated), and **Versions** |

On the **ES|QL** tab you can set the rule's index patterns, edit the query (**Save ES|QL** marks it `manual`; **Regenerate from Sigma** returns to `autogenerated`), and configure **Kibana Detection Actions** (connector templates and action parameters; **Save Configuration**). On **Versions**, choose a version and click **Roll Back Selected Version** to restore it; each version lists its change type and a change summary.

#### Tags and ATT&CK

The **Tags** card drives [Detection Coverage]({{ '/en/detection-coverage/' | relative_url }}). Add an `attack.<tactic>` tag (for example `attack.execution`) followed by technique tags such as `attack.t1059.001`. After you save tag changes, a warning appears:

> Tag changes are saved locally (ATT&CK coverage already uses them) but not yet published to Kibana. Click Publish to Kibana to sync.

### Publishing to Kibana

Select the **Elastic** target. The platform's Kibana connection must be configured.

1. **Preview in Kibana** (or **Rule Preview** in the Kibana card) runs a preview of the rule and shows the result.
2. **Publish to Kibana** creates the rule in Kibana, or updates it if it already exists, and records a `publish` entry in Publish History.
3. If the rule is published disabled, a dialog appears: **Rule published but not enabled** — *This rule is saved in Kibana as disabled, so it will not run or count toward detection coverage. Enable it now?* Choose **Enable now** or **Later**.

The **Kibana Detection Rule** card shows the state (`Enabled`, `Published but Disabled` or `Not Published`), the Sigma Rule ID and the Kibana Rule ID, and offers:

| Button | Action |
|---|---|
| **Rule Preview** | Preview the rule in Kibana |
| **Enable** / **Disable** | Change the rule's enabled state in Kibana (available when published) |
| **Delete Kibana Rule** | Deletes the rule from Kibana after a confirmation; the Sigma rule stays in the library |

> Only enabled rules run in Kibana and count toward detection coverage.

### Sync with Kibana

If someone enables, disables or deletes rules directly in Kibana, the library can drift. **Sync with Kibana** (Rule Library toolbar) aligns it.

1. Click **Sync with Kibana**.
2. Confirm the dialog: *Kibana is treated as the source of truth. Enabled state of published rules is overwritten, and rules no longer found in Kibana are marked unpublished and disabled (not deleted). Each change is recorded in the rule's version history.*
3. Read the result message: `Synced with Kibana: n state change(s), n no longer in Kibana, n unchanged`.

Behaviour:

- Only rules that were published are checked; each is matched to its Kibana rule by rule ID.
- If the enabled state differs, the library takes the Kibana value.
- A published rule that Kibana no longer has is marked **unpublished and disabled**. It is not deleted.
- Each change is saved as a `kibana_sync` entry in the rule's **Versions** history.
- **Safety check:** if Kibana returns no rules at all but the library has published rules, the sync stops with an error (`Kibana returned no rules; refusing to unpublish n published rule(s). Check the Kibana space and API key permissions.`) and nothing is changed.
- You need permission to change integrations; otherwise the request is rejected.

Run it when the **Elastic** column or the coverage numbers disagree with Kibana.

### Publishing to Splunk

Select the **Splunk** target on a rule to publish it as a scheduled Splunk saved search (alert).

**Prerequisite:** a Splunk Rule Publisher integration under `Data Pipeline → Integrations`. If none exists, the panel shows *No Splunk Rule Publisher configured* with an **Integrations** button. Saving, publishing and enabling require permission to change integrations; deleting requires permission to delete them.

**Flow:** **Save Configuration** → **Compile SPL** → **Publish to Splunk**.

1. Choose the **Splunk publisher** and fill in the configuration (below). Click **Save Configuration**.
2. Click **Compile SPL** to preview the generated query on the **SPL** tab.
3. Click **Publish to Splunk**. Confirm *Publish this rule to Splunk in disabled state?*. Publishing is available once the configuration is saved and has no unsaved edits.
4. After checking the saved search in Splunk, click **Enable** (confirm *Enable this scheduled Splunk alert and its actions?*).

> **Rules are always published disabled.** **Enable** is available only when the publication is `synced`, the Sigma rule and the configuration have not changed since publishing, there are no unsaved edits, and the rule is not already enabled.

| Field | Rules |
|---|---|
| **Source index** | Required; letters, digits, `_`, `.`, `-`; up to 64 characters (default `main`) |
| **Sourcetype** | Optional; letters, digits, `_`, `:`, `.`, `-`; up to 100 characters |
| **Cron schedule** | Required; a valid five-field cron expression (default `*/5 * * * *`) |
| **Lookback (minutes)** | 1 to 10080 (default 15) |
| **Trigger comparison** | `greater than`, `less than` or `equal to` |
| **Result count** | 0 to 1,000,000 (default 0) |
| **Once per search** | On by default; required if **Suppression** is used |
| **Suppression (seconds)** | 0 to 86400 |
| **Webhook URL** | Optional; `https` only, without credentials, query string or fragment |
| **Email recipients** | Optional; up to 10 valid addresses |

Other buttons:

| Button | Action |
|---|---|
| **Disable** | Disables the saved search in Splunk |
| **Refresh Status** | Re-reads the saved search from Splunk and updates the status |
| **Delete Remote Rule** | Deletes the Splunk saved search and the binding (*The Sigma rule will be kept*) |

Publication state:

| Status | Meaning |
|---|---|
| `draft` / *Not configured* | Configuration saved but not published, or no configuration yet |
| `synced` | The Splunk saved search matches what was published |
| `drifted` | The saved search was changed outside Argus or differs from the published configuration |
| `missing` | The saved search no longer exists in Splunk |
| `pending` / `pending_sync` | An operation is in progress or its outcome is uncertain; click **Refresh Status** before changing anything |

A tag shows `Enabled` / `Disabled` with the published version, and an **Unpublished changes** tag appears when the rule or the configuration changed since publishing. The panel's **SPL** (last compiled or last published query), **Sigma** and **Versions** tabs are read-only.

> A publisher's host, app and owner cannot be changed, and the publisher cannot be deleted, while rules are bound to it. Delete the remote rules first.

---

## Field Mappings

Field Mappings translate Sigma's canonical field names into the actual field names used by your query backends (Splunk, Elasticsearch). Mapping quality directly determines whether a rule produces accurate results.

**Navigation:** `Data Pipeline → Detection → Field Mappings`

![Field Mappings]({{ '/assets/images/use-case-management/field-mappings.png' | relative_url }})

### Mapping Structure

| Column | Description |
|---|---|
| **Profile** | A named mapping group, e.g., `aws_cloudtrail` or `windows_sysmon` |
| **Sigma** | The canonical field name used in Sigma rules |
| **Splunk** | The corresponding field name in Splunk |
| **Elastic ECS** | The corresponding ECS field name in Elasticsearch |
| **Multivalue** | `Yes` if the Elastic field can hold several values |
| **Elastic Index Patterns** | Which Elasticsearch indices this mapping applies to |
| **Actions** | **Edit** |

The toolbar offers **Search mappings**, **Upload Mapping Files**, **Upload Mapping Folder**, **Download CSV Template**, **Export**, **Delete Selected**, **New Mapping** and **Refresh**.

### Creating a Field Mapping

![New Mapping Modal]({{ '/assets/images/use-case-management/new-mapping-modal.png' | relative_url }})

1. Click **New Mapping** (or **Download CSV Template** and upload a filled-in file to bulk-import).
2. Enter the **Mapping Profile**.
3. Enter the **Sigma Field** name.
4. Fill in the corresponding **Elastic ECS Field** and/or **Splunk Field**.
5. Tick **Elastic field is multivalue** if applicable (below).
6. Specify the **Elastic Index Patterns**, one per line or comma separated (for example `logs-*`, `winlogbeat-*`). The optional **Category**, **Data Source** and **Event Category** fields classify the mapping.
7. Click **OK**.

### Multivalue Fields

Some ECS fields are arrays (for example `process.args` or `host.ip`). Tick **Elastic field is multivalue** on such a mapping (CSV column `elastic_is_multivalue`, values `true` / `false`). When the rule is compiled to ES|QL, a comparison such as `field == "value"` on a multivalue field is rewritten to `MATCH(field, "value")`, so it matches any element of the field. Fields not marked multivalue are compared with `==` as usual.

### Mapping Best Practices

- Create a separate profile per data source (`aws_cloudtrail`, `windows_sysmon`, `linux_auditd`).
- Verify field names against your actual index template before publishing rules.
- Confirm that the Elastic Index Pattern covers the indices that actually hold your data.
- Mark array fields as multivalue so equality checks match any element.
- After adding a new mapping, re-publish affected rules to apply the updated field translations.

---

## Publish History

The Publish History provides an audit trail of every rule publication action, for both Kibana and Splunk.

**Navigation:** `Data Pipeline → Detection → Publish History`

![Publish History]({{ '/assets/images/use-case-management/publish-history.png' | relative_url }})

### Column Reference

| Column | Description |
|---|---|
| **Rule** | Name of the rule |
| **Target** | Publication target: `elastic-dev` for Kibana, `splunk:<publisher id>` for a Splunk publisher |
| **Action** | Operation performed: `publish`, `enable`, `disable` or `delete`; Splunk status refreshes are recorded as `refresh` |
| **Status** | `success` or a failure value such as `failed`, `pending` or `pending_sync` |
| **Message** | Detailed result message; check here first when a publish fails |
| **Time** | Publication timestamp |

Use **Refresh** to reload the list. **Sync with Kibana** changes are not listed here; they appear in the affected rule's **Versions** tab as `kibana_sync`.

### Diagnosing Publish Failures

When a publication shows a failure:

1. Read the **Message** column — it typically identifies the exact error (invalid YAML, missing field mapping, target unreachable).
2. Check that the rule's Sigma YAML is syntactically valid.
3. Verify that all fields referenced in the rule have mappings in the correct profile.
4. Confirm the target backend (Kibana or Splunk) is reachable and the integration is configured correctly.
5. For Splunk, open the rule's Splunk panel and click **Refresh Status** if the state is `pending` or `pending_sync`.

---

## Use Case Management Checklist

Before publishing a new detection rule, verify:

- [ ] Data source is connected and ingesting (Data Pipeline → Integrations)
- [ ] Field mappings exist for every Sigma field used in the rule, with array fields marked multivalue
- [ ] Rule name follows the `datasource_behavior_entity` convention
- [ ] Rule carries `attack.<tactic>` and `attack.t…` tags so it counts toward ATT&CK coverage
- [ ] Severity level is appropriate — avoid defaulting all rules to Critical
- [ ] Rule has been tested on a dev/staging index to measure false positive rate
- [ ] After publishing to Kibana, the rule is enabled (or you chose **Later** deliberately)
- [ ] Bulk operations (delete, bulk upload, publish, Sync with Kibana) have change management approval
