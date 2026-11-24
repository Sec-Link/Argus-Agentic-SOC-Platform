---
layout: default
title: "Reports"
lang: en
lang_ref: reports
---

# Reports

The Reports module is a Report Designer for security operations reports. It generates a Markdown report from live SOC data (alerts, tickets, risk entities, and detection coverage), lets you edit the template with placeholders and your own branding, previews it live, and exports it as Markdown or PDF.

**Navigation:** `Monitoring → Reports`

<!-- TODO screenshot: assets/images/reports/report-designer.png (full Report Designer page: toolbar, Template data panel, Markdown Editor and Live Preview) -->

## Page Layout

The page header reads **REPORT DESIGNER — Security report workspace**: "Compose a reusable Markdown template with live SOC metrics and your organization branding."

| Area | Purpose |
|---|---|
| **Toolbar** | Time range selector, **Regenerate**, **Copy Template**, **Export Resolved Markdown**, **Download PDF** |
| **Template data** | Company branding and the placeholder library (collapsible side panel) |
| **Markdown Editor** | The report template; edits update the preview immediately |
| **Live Preview** | The rendered report with all placeholders resolved; scrolling is linked to the editor by section |

---

## Time Range

| Option | Window |
|---|---|
| **24 Hours** | Last 24 hours |
| **7 Days** | Last 7 days (default when the page opens) |
| **30 Days** | Last 30 days |
| **All Time** | From the earliest stored alert (or ticket) to the latest telemetry |

Selecting a range generates the report for it; **Regenerate** fetches fresh data for the current range.

The reporting window **ends at the latest telemetry time** found in the platform (newest alert, correlation event, ticket, or risk event), not at the current clock time. This keeps imported or older data useful and makes the 24-hour, 7-day, and 30-day windows nested.

If no alert falls inside the window, the executive summary adds the note: "No alert events fall within this real-time window; the newest stored alert is ...".

---

## Template Data Panel

### Brand

| Field | Description |
|---|---|
| **Company name** | Up to 80 characters; replaces `{{company.name}}` (defaults to `Company` if empty) |
| **Upload logo** | PNG, JPEG, or WebP, **maximum 1 MB**; used for `{{company.logo}}` in the preview and PDF |
| **Use default** | Appears after a logo is uploaded; restores the default logo |

The company name and logo are **saved in this browser only** (local storage). They are not stored on the server and do not follow you to another browser.

### Placeholder Library

Use the **Search fields** box to filter placeholders. Each entry shows its token and the value currently resolved for it. Two buttons per entry:

- **Copy placeholder** — copies the token (for example `{{metrics.total_alerts}}`) to the clipboard.
- **Insert at cursor** — inserts the token into the Markdown Editor at the cursor position.

---

## Placeholders

A placeholder is written as `{{key}}`. Unknown keys are left as written.

| Group | Placeholders |
|---|---|
| **Brand** | `{{company.name}}`, `{{company.logo}}` |
| **Report** | `{{report.title}}`, `{{report.window}}` (resolved start and end of the range), `{{report.generated_at}}` |
| **Metrics** | `{{metrics.posture}}`, `{{metrics.total_alerts}}`, `{{metrics.critical_high_alerts}}`, `{{metrics.total_tickets}}`, `{{metrics.resolved_tickets}}`, `{{metrics.resolution_rate}}`, `{{metrics.mttd}}`, `{{metrics.mttr}}`, `{{metrics.open_priority_incidents}}`, `{{metrics.log_source_coverage}}`, `{{metrics.attack_coverage}}` |
| **Charts** | `{{charts.category}}`, `{{charts.severity}}`, `{{charts.alert_trend}}`, `{{charts.score_trend}}`, `{{charts.funnel}}`, `{{charts.sankey}}`, `{{charts.attack_heatmap}}` |

Notes:

- `{{metrics.log_source_coverage}}` and `{{metrics.attack_coverage}}` show a percentage, or `N/A` when coverage is not configured.
- Chart placeholders resolve to generated PNG images and are meant for use as image sources, for example `<img src="{{charts.severity}}" alt="Severity" />`. `{{charts.attack_heatmap}}` shows a "NO COVERAGE DATA" image when no ATT&CK coverage is available.
- All text values are **HTML-escaped** before they are inserted, so a value cannot inject markup. Only the logo and chart images are inserted as image data.

---

## Editing and Exporting

The template is Markdown with GitHub-style tables, and raw HTML is allowed (the default template uses it for the header and charts). Edit freely in **Markdown Editor**; **Live Preview** updates as you type. Clicking a heading line in the editor scrolls the preview to the matching section.

| Button | Result |
|---|---|
| **Copy Template** | Copies the Markdown source, with placeholders unresolved, to the clipboard |
| **Export Resolved Markdown** | Downloads `soc-security-operations-report-<range>.md` with every placeholder replaced by its value |
| **Download PDF** | Renders the preview to an A4 PDF named `soc-report-<range>.pdf` |

Edits are not saved on the server. Use **Copy Template** to keep your customized template, and note that **Regenerate** or changing the range replaces the editor content with a freshly generated default template.

---

## Default Report Sections

| Section | Content |
|---|---|
| Header | Logo, company name, and report title; classification, reporting window, and generation time |
| **1. Executive Summary** | Posture, alert totals, critical + high share, ticket resolution, MTTD / MTTR, open priority incidents |
| **2. Core Metrics & Alert Severity** | Category breakdown and severity distribution charts, severity table, top 5 triggered detection rules |
| **3. Alert Trend & Incident Response** | Alert trend, score trend, conversion funnel, detection pipeline, response performance, open critical and high-priority tickets |
| **4. Detection Coverage** | Log source coverage and MITRE ATT&CK coverage (see below) |
| **5. Top RBA Risk Entities** | Highest-scoring risk entities with type, score, and tier |
| **6. SOC Operational Recommendations** | Recommendations derived from the figures above, including coverage gaps |

### Detection Coverage Section

- **Log Source Coverage** — how many configured log source categories are currently receiving logs, how many detection rules are enabled, and a per-category table (Category, Sources, Receiving Logs, Enabled Rules).
- **MITRE ATT&CK Coverage** — how many ATT&CK techniques are covered by enabled rules, the coverage heatmap, and a per-tactic table (Tactic, Covered Techniques, Total Techniques).

This section reads only the **stored** coverage scan and never triggers an Elasticsearch scan. Each half degrades independently: if one is unavailable, the other is still shown. When neither is configured, the section shows "Detection coverage has not been configured." To populate it, classify log sources and sync the ATT&CK catalog in **Dashboard → Coverage settings**.

---

## Access and Availability

The report-generation API accepts guest and anonymous calls. If the report service returns no content or cannot be reached, the page shows a built-in sample **SOC baseline template** with a warning ("Report service is unavailable; showing the SOC baseline template." or "Report service returned no content; showing the SOC baseline template."). The sample figures in that template are illustrative, not live data.

---

## Troubleshooting

| Issue | Check |
|---|---|
| Warning about the baseline template | The backend report endpoint is unreachable or returned nothing; check the backend container logs and click **Regenerate** |
| All metrics show zero | No alerts or tickets exist yet; connect a data source first |
| "No alert events fall within this real-time window" | The window ends at the latest telemetry; choose **30 Days** or **All Time**, or check that ingestion is running |
| Detection Coverage says it has not been configured | Configure coverage in **Dashboard → Coverage settings** |
| Coverage shows `N/A` | The corresponding coverage data is not available yet |
| Logo upload rejected | Use PNG, JPEG, or WebP of 1 MB or less |
| Branding disappeared | Company name and logo are stored per browser; re-enter them in the new browser |
| Edits lost after changing range | Changing the range or clicking **Regenerate** reloads the default template; copy your template first |

---

## See Also

- [Dashboard]({{ '/en/dashboard/' | relative_url }}) — Coverage settings and live statistics
- [Detection Coverage]({{ '/en/detection-coverage/' | relative_url }})
