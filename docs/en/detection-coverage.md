---
layout: default
title: "Detection Coverage"
lang: en
lang_ref: detection-coverage
---

# Detection Coverage

Detection Coverage tells you whether the systems you should be monitoring are actually sending logs, and whether your enabled detection rules cover those systems and the MITRE ATT&CK techniques you care about. It discovers log sources from Elasticsearch, groups them into categories (Endpoint, Firewall, Identity, …), and compares that picture with the rule library.

**Navigation:** `Monitoring → Overview → Coverage settings tab`

The Overview tab also carries a read-only **Detection coverage** card with the same headline numbers. Everything on this page is configured and explained on the **Coverage settings** tab (`/dashboard?tab=coverage`).

<!-- TODO screenshot: assets/images/detection-coverage/coverage-settings-tab.png (Coverage settings tab: Detection Log Source Coverage card above MITRE ATT&CK Coverage card) -->

## What It Tells You

| Question | Where it is answered |
|---|---|
| Is each kind of system we expect (endpoints, firewalls, identity, cloud, …) sending logs? | **Detection Log Source Coverage** card |
| Do enabled rules exist for the logs we receive, and can those rules actually fire? | Rule counts and source status chips in the same card |
| Which ATT&CK techniques are covered by at least one enabled rule? | **MITRE ATT&CK Coverage** card |

## First-Time Setup

**Prerequisite:** an enabled Elasticsearch integration (`Data Pipeline → Integrations`). Without it, log sources cannot be discovered and coverage falls back to alert sources only.

1. Open `Monitoring → Overview` and select the **Coverage settings** tab. On the first visit with Elasticsearch enabled, the platform scans once automatically. If it has not (or you want fresh data), an administrator clicks **Rescan**.
2. Click **Configure** and open **Discovered sources**. Review the automatic classification and fix wrong or missing assignments (see [Classifying Unknown Sources](#classifying-unknown-sources)).
3. In **Configure → Categories**, check that the categories, optional CMDB asset types and host field suit your environment.
4. In the **MITRE ATT&CK Coverage** card, click **Sync ATT&CK catalog** once, so coverage is measured against the full technique list.
5. Tag, enable and publish your detection rules (see [Raising Coverage](#raising-coverage)).

The scan, **Configure**, and catalog sync buttons are visible to administrators only (see [Permissions](#permissions)).

## Log Source Discovery

A *log source* is a logical group of Elasticsearch indices or data streams that carry one kind of log. Discovery works as follows:

- **Stored scan.** A scan reads Elasticsearch for the last 7 days and stores the result. The Coverage settings page and the Dashboard read the stored scan; opening the page never re-scans. The only automatic scan is the first one, when no scan exists yet.
- **Rescan.** An administrator can click **Rescan** (card) or **Re-scan** (drawer) at any time. If a scan fails, the previous successful snapshot is kept and the message *Re-scan failed: …* explains why.
- **Up to 300 sources**, busiest first. When more exist, the drawer shows *Only the busiest sources are listed.*
- **Skipped.** Hidden indices whose names start with a dot (such as `.kibana` or `.alerts-*`) are never log sources, and neither is the index the platform itself reads alerts from.
- **Name normalisation.** Concrete index names are collapsed to one source key by removing dates, rollover numbers and versions, so a family of daily indices is a single source. For example `winlogbeat-8.11.0-2026.10.27` becomes `winlogbeat-*`, and a data stream backing index such as `.ds-logs-okta.system-default-2026.10.01-000001` becomes `logs-okta.system-*`.
- **Automatic classification.** Each source is suggested a category from its name, its `event.module` / `event.dataset` values and, as a weaker hint, its ECS `event.category` (for example `authentication` suggests Identity, `process` suggests Endpoint, `network` suggests Firewall). A suggestion is mapped to the category *of the same name*; if you renamed or deleted that category, the source stays unclassified. Suggestions can be wrong.
- **Manual override wins.** A category you assign by hand, or an ignore, replaces the suggestion and survives later scans. **Reset to automatic** removes it. A manual choice for a source that has disappeared from Elasticsearch stays listed so you can reset it.

The status line *Last scanned …* shows the age of the scan; it turns into a warning after 24 hours, and reads *Never scanned* if no scan exists.

## Configure Drawer

**Configure** (top right of the **Detection Log Source Coverage** card) opens the **Log source coverage settings** drawer with two tabs.

<!-- TODO screenshot: assets/images/detection-coverage/configure-drawer-sources.png (Configure drawer, Discovered sources tab) -->

### Discovered Sources Tab

| Element | Description |
|---|---|
| Filter | **All**, **Unclassified**, **Manual**, **Ignored** |
| **Search sources** | Filter by source name |
| **Re-scan** | Run a new scan; shows the scan age next to it |
| Columns | **Source**, **Docs** (documents in the window), **Last seen**, **Suggested** (automatic category, coloured by confidence; tooltip shows the reason), **Category** |
| **Category** selector | **Auto (suggested)**, any category, **Unclassified**, or **Ignore** |
| Reset icon | **Reset to automatic**; shown for sources with a manual choice |
| **Assign to…** + **Apply** | Select several rows, choose a target and apply to all of them |

An alert reading *Elasticsearch is not available* means the integration is disabled or unreachable.

### Categories Tab

A category counts as covered when any source mapped to it received data within the scan window. Each category is edited in its own card:

| Field | Description |
|---|---|
| **Name** | Required, up to 100 characters, unique |
| **Enabled** | Only enabled categories are evaluated and shown on the cards |
| **Icon** | Custom icon (see below) |
| **Advanced: extra index patterns** | Optional wildcard patterns (for example `winlogbeat-*`) that pull additional sources into the category. Use only for indices that discovery misses. **Test match** lists the indices that match and their document counts for the last 7 days |
| **CMDB asset types (optional)** | Asset types whose hosts are expected to send logs; used for the **Hosts reporting** bar |
| **Host field in logs** | Elasticsearch field holding the host name; default `host.name` |

Click **Save**, or **Add category** for a new one. The trash icon deletes a category after a confirmation (**Delete this category?**); the manual assignments of its sources are removed with it. The platform ships with seven categories: **Endpoint**, **EDR**, **Firewall**, **Identity**, **Cloud**, **DNS** and **Email**.

### Custom Category Icons

Icons appear in the Dashboard's Events flow chart; categories without one use a default icon.

1. Save the category first (a new category cannot take an icon until it exists).
2. In **Configure → Categories**, open the category, and next to **Icon** click **Upload**.
3. To go back to the default, click **Use default**.

| Rule | Limit |
|---|---|
| File types | PNG, JPEG, WebP (SVG and GIF are rejected) |
| File size | 256 KB maximum |
| Dimensions | 4 million pixels maximum |
| Processing | Re-encoded as a PNG scaled to fit 96 × 96, so the original file and its metadata are not stored |
| Who | Administrators only |

## Classifying Unknown Sources

Sources that no category matched appear in the **Unclassified sources (n)** panel above the category cards. For administrators:

- **Drag** a chip onto a category card to assign it (dragging it back to the panel unassigns it).
- Click **×** on a chip to **ignore** it, for example for metrics or internal indices. Ignored sources are excluded from coverage.
- Use **Show all (n)** / **Collapse** when there are more than six chips.
- To restore an ignored source, click **Show ignored sources (n)** below the cards and click the chip.

Non-administrators see the panel but are asked to contact an administrator.

<!-- TODO screenshot: assets/images/detection-coverage/classify-sources.png (Unclassified sources panel with a chip being dragged onto a category card) -->

## Reading Log Source Coverage

### Source Status and Borders

Every source chip is coloured by its **alerting status**. Click the **?** at the top right of the card (**Colour legend**) to see this key in the page.

| Status | Meaning |
|---|---|
| **Alerting** | Receiving logs and at least one enabled rule uses it |
| **Unmonitored** | Receiving logs but no enabled rule uses it — a detection gap |
| **Blind** | An enabled rule uses it but no logs arrived in the window, so the rule cannot fire |
| **Silent** | No logs in the window and no enabled rule |

The chip border or marker shows how the source was classified:

| Marker | Meaning |
|---|---|
| Plain border | Classified automatically |
| Pin icon | Assigned manually by an administrator |
| Dashed border | Not assigned to any category yet |
| Ignored (restore list) | Ignored; excluded from coverage |

Hovering a chip shows its status, document count, how many enabled and total rules use it, and how it was classified.

### Metrics

The numbers at the top of the card refer to the scan window (7 days by default). Click any number to open a table of what is behind it. The **?** beside each label explains it in the page.

| Metric | How it is computed |
|---|---|
| **Log source coverage** | Receiving categories ÷ configured categories, as a percentage. After the first scan, every enabled category is *configured*; a category is *receiving* when at least one of its sources had documents in the window. A category with no sources therefore lowers the percentage. Green at 60% or more, amber at 30% or more, red below |
| **Receiving logs (last 7d)** | `receiving / configured` categories |
| **Enabled rules / total** | Enabled rules ÷ all non-deleted rules in the Rule Library, with the percentage. "Enabled" is the state stored in the platform, which changes when a rule is published to or synced from Kibana |
| **Rules with live data** | Enabled rules that map to at least one category that is receiving logs, so they can fire |
| **Rules without data** | Enabled rules that map to categories, none of which received logs in the window; blind spots until logs arrive |
| **Rules, source unknown** | Enabled rules that cannot be tied to any category (see below) |
| **Unmonitored sources** | Sources that have documents in the window but no enabled rule attributed to them |

> **"Alerting" is a lower bound.** Rules without index patterns, or with very generic ones such as `logs-*`, are not credited to any single source. A source can therefore be shown as Unmonitored although a broad rule does cover it.

### How Rules Are Mapped to Categories

For each non-deleted rule the platform first reads the rule's index patterns (the Elastic index patterns saved on the rule, and the `index` list stored with its Kibana definition).

- **Categories.** A pattern is matched against every source key, in both directions, using wildcards. The sources it hits determine the categories. A pattern that hits sources in more than two different categories (for example `logs-*`) is considered too broad and ignored.
- **Sources.** The same patterns attribute the rule to individual sources, but a pattern that hits more than eight sources is ignored for this purpose.
- **Fallback.** If the patterns yield no category, the platform applies the same name heuristic that is used for log sources to the rule's index patterns and to its Sigma log source fields (`product`, `service`, `category`), and maps the guess to the category of that name.
- A rule with no result is counted under **Rules, source unknown**. Adding a specific index pattern to the rule fixes it.

The rule detail tables show up to 1,000 rules.

### Category Cards

Each enabled category appears as a card:

| Element | Description |
|---|---|
| Status dot | Green when receiving logs, red when not, grey when not configured |
| Tags | **Not configured** (no scan yet and no index patterns), **No sources** (red; scan available but nothing assigned), **alerts only** (orange; Elasticsearch unavailable, coverage inferred from alert source indices and likely understated) |
| Last seen | Latest document time, or *No data in the last 7 days* |
| **Rules on** bar | Enabled rules / total rules attributed to the category |
| Source chips | The first six sources, then `+N` / `less` |
| **Hosts reporting** bar | Hosts seen in the logs (by **Host field in logs**) ÷ hosts of the linked **CMDB asset types**. Shown only when the category has asset types and Elasticsearch is reachable. Host names are compared case-insensitively |

If a category has no sources at all, assign some in **Configure**.

## MITRE ATT&CK Coverage

The **MITRE ATT&CK Coverage** card measures how many ATT&CK techniques are covered by enabled rules.

### Reading the Cards and Heatmap

- **Coverage (%)** = parent techniques with at least one enabled rule ÷ parent techniques in the synced catalog. Sub-techniques (for example `T1059.001`) count toward their parent technique (`T1059`). Colour: green at 60% or more, amber at 30% or more, red below.
- **Techniques covered** `x / y` — click it to open the **Covered techniques** modal: each covered technique with its name, tactics and rule count. Click a technique ID to open the rule list filtered to it.
- **Enabled rules** — enabled rules considered for coverage; click to open the rule list.
- **Coverage by tactic** — one bar per tactic with `covered / total` techniques; hover for the covered techniques, click to open the rule list filtered to that tactic.
- **Technique matrix** — one small square per technique, grouped by tactic (a technique that belongs to several tactics appears under each). Colour follows the number of enabled rules: grey 0, light blue 1, blue 2–3, dark blue 4 or more. Hover for the technique and rule count; click to open the **Detection** rule list pre-filtered by that technique (`attack.<technique>`) or tactic.

Two warnings can appear: *ATT&CK catalog is not loaded* (sync it, see below) and *No ATT&CK techniques found on enabled rules* (enabled rules exist but none carries ATT&CK tags). Until the catalog is loaded, the matrix only lists the techniques already seen on rules and totals show `?`.

<!-- TODO screenshot: assets/images/detection-coverage/attack-coverage.png (MITRE ATT&CK Coverage card with tactic bars and technique matrix) -->

### Syncing the ATT&CK Catalog

Click **Sync ATT&CK catalog** (administrators), leave the link empty to use the official latest MITRE ATT&CK Enterprise data, or enter your own, and click **Sync**.

| Requirement | Detail |
|---|---|
| URL | `https` only, and it must resolve to a public address (private addresses are rejected). Up to 3 redirects, 60-second timeout |
| Content | A STIX 2.1 JSON bundle of the ATT&CK **Enterprise** matrix (tactic objects with a `TA####` id and technique objects with a `T####` / `T####.###` id). Do not mix Mobile or ICS bundles |
| Size | Up to 100 MB |
| Effect | **Replaces the whole catalog** (revoked and deprecated entries are skipped) and **re-maps every rule's ATT&CK tags**. The result is reported as *Synced ATT&CK <version>: n techniques, m rules re-mapped* |

A bundle without tactics and techniques is refused and the existing catalog is kept. The last custom URL you used is remembered in your browser.

## Raising Coverage

**ATT&CK coverage**

1. Open the rule in `Data Pipeline → Detection` and, in the **Tags** card, add an `attack.<tactic>` tag (for example `attack.execution`) followed by technique tags such as `attack.t1059.001`. A technique tag is attached to the closest tactic tag above it; with no tactic tag before it, the tactic is taken from the synced catalog.
2. Save the tags, then **enable and publish** the rule to Kibana.
3. Check the card again.

Only rules that are **enabled and not deleted** count. Tag edits count toward coverage as soon as they are saved, even before publishing to Kibana. Techniques declared in a rule's Kibana threat fields are counted as well.

**Log source and rule coverage**

- Assign or classify missing sources, and restore silent log feeds for categories shown in red.
- Add or enable rules for **Unmonitored** sources.
- Give rules a specific index pattern so they map to a source instead of **Rules, source unknown**.
- If the enabled state in Kibana differs from the platform, run **Sync with Kibana** in the Rule Library (see [Use Case Management]({{ '/en/use-case-management/' | relative_url }})); coverage reads the enabled flag stored in the platform.

## Permissions

| Action | Who |
|---|---|
| View the cards, tooltips and detail tables | Any signed-in user |
| **Rescan**, **Configure**, classify, ignore and restore sources, add/edit/delete categories, upload or reset icons, **Test match**, **Sync ATT&CK catalog** | Administrators (staff users) |

Users without that permission do not see those buttons, and the API rejects the requests.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| *Log sources have not been scanned yet* | No stored scan. An administrator clicks **Rescan** |
| *Log sources could not be scanned* with a reason | Elasticsearch is disabled, unreachable, or the credentials lack index permissions. Fix the integration; meanwhile coverage uses alert sources only (**alerts only** tags) |
| *Re-scan failed: …* | The previous scan is still in use. Fix the cause and rescan |
| A source is missing | Dot-prefixed indices and the platform's alert index are skipped; beyond 300 sources only the busiest are kept; the scan is up to 7 days old, so rescan after new indices appear |
| A category shows **No sources** | Nothing is assigned. Assign sources in **Configure → Discovered sources**, or add index patterns to the category |
| A suggestion points to no category | The category with the suggested name was renamed or deleted. Assign the source manually |
| Many **Rules, source unknown** | Rules lack specific index patterns. Add them to the rule |
| **Rules without data** is high | The category has no recent logs. Restore the feed, or disable or retarget the rule |
| *ATT&CK catalog is not loaded* | Click **Sync ATT&CK catalog** |
| *No ATT&CK techniques found on enabled rules* | Add `attack.*` tags to the rules and enable them |
| Coverage did not change after enabling a rule in Kibana | The platform still has the old flag. Run **Sync with Kibana** |
| Icon upload fails | Check the type (PNG/JPEG/WebP), size (256 KB) and dimensions (4 million pixels), and that the category was saved first |
| Catalog sync reports *Only https URLs are allowed.* or a non-public address error | Use a public `https` URL |

## See Also

- [Dashboard]({{ '/en/dashboard/' | relative_url }}) — the Overview tab, including the Detection coverage card and Events flow
- [Use Case Management]({{ '/en/use-case-management/' | relative_url }}) — tagging, publishing and syncing detection rules
- [Data Onboarding]({{ '/en/data-onboarding/' | relative_url }}) — connecting Elasticsearch
