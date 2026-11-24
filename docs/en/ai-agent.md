---
layout: default
title: "AI Agent"
lang: en
lang_ref: ai-agent
---

# AI Agent

The AI Agent is an integrated intelligence layer that assists SOC analysts during incident investigation. It can explain alerts, assess risk, extract IOCs, suggest remediation steps, apply investigation skills, and invoke security tools via the Model Context Protocol (MCP).

> **Security note:** Never share API keys, passwords, tokens, or other sensitive credentials in screenshots, documents, or chat messages.

---

## Configuration

**Navigation:** `Administration → AI Assistant`

The page has five tabs: **General**, **MCP Status Monitor**, **Skill Monitor**, **MCP Management**, and **Skills Management**. General settings are stored in the browser's local storage; MCP servers and skills are stored on the server.

> **Read-only view:** guest accounts see a banner stating they cannot view stored API keys or tokens and cannot modify AI Assistant settings. The forms are disabled and the **Add MCP** / **Add Skill** buttons are hidden.

### General

![AI Assistant General Settings]({{ '/assets/images/ai-agent/general-configured-n.png' | relative_url }})

| Setting | Description |
|---|---|
| **Enable AI Assistant** | Master toggle — must be on for AI features to appear in ticket detail views |
| **OpenAI API Key** | An OpenAI-compatible API key provided by your administrator |
| **Model** | Model identifier supported by your endpoint |
| **Base URL** | API endpoint URL (for example `https://api.openai.com/v1`) |
| **Timeout (seconds)** | Request timeout in seconds — increase for slower models |

After filling in the fields:
1. Click **Test Connectivity** to verify the model endpoint is reachable and the key is valid. A success message shows the connected model name.
2. Click **Save General** to store the settings in this browser ("General settings saved").

Because General settings live in the browser, each analyst's browser needs them configured. If the connectivity test fails, check the Base URL, API key, model name, and network access from the platform to the endpoint.

---

## MCP Status Monitor

The MCP Status Monitor tracks the operational health of all MCP tool invocations.

![MCP Status Monitor]({{ '/assets/images/ai-agent/mcp-status-monitor-n.png' | relative_url }})

**Execution Statistics** shows:

| Metric | Description |
|---|---|
| **Total Calls** | Cumulative MCP tool invocation count, with success and failed counts |
| **Success Rate** | Percentage of successful calls across all MCP tools |
| **Last Invocation** | Timestamp of the most recent invocation (current filter scope) |
| Per-tool cards | Total calls with success and failed counts for each tool |

**Recent Executions** lists individual calls. Use the **Search tool name** box and the status filter (**All Status**, **Completed**, **Failed**, **Running**) to narrow the list. Columns: **Tool**, **Source**, **Status**, **Start Time**, **Duration**, **Action**.

Click **Details** on a row to open **Tool call details**: execution info (tool, status, time, execution ID, endpoint), **Request params**, **Response**, and an **Error** card for failed calls. The request and response blocks each have a copy button.

Use this view to diagnose whether the AI Agent is successfully invoking context tools during analysis.

---

## Skill Monitor

The Skill Monitor displays usage statistics for skills.

![Skill Monitor]({{ '/assets/images/ai-agent/skill-monitor-n.png' | relative_url }})

**Skill Execution Statistics** shows the total number of skill calls. The **Skill Usage** table has the columns **Skill**, **Total**, **Success**, **Failed**, and **Last Call**.

A skill is counted when its instructions are loaded for an AI run or chat; a failed count means the skill document could not be found. A skill with no row, or zero calls, has not been selected by any AI session yet — see [How Skills Are Used](#how-skills-are-used).

---

## MCP Management

MCP (Model Context Protocol) tools extend the AI Agent's capabilities by allowing it to call services and retrieve structured context during analysis.

![MCP Management]({{ '/assets/images/ai-agent/mcp-management-n.png' | relative_url }})

### Added MCP Servers

The **Added MCP Servers** table lists registered external MCP servers with the columns **Name**, **Title**, **Endpoint**, **Enabled**, and **Action** (**Edit**, **Delete**). Use **Refresh** to reload the list.

### Adding an MCP Server

![Add MCP Modal]({{ '/assets/images/ai-agent/add-mcp-modal-n.png' | relative_url }})

1. Click **Add MCP**.
2. In **Add MCP Server**, fill in:
   - **Name** — unique server identifier (required; cannot be changed when editing)
   - **Title** — optional display title
   - **Endpoint** — MCP server URL (required)
   - **Token** — optional access token
   - **Enabled** — switch the server on or off
3. Click **Create** (or **Save** when editing).

### Built-in MCP Tools

The platform ships with the following tools, listed in the **Built-in MCP Tools** table:

| Tool | Description | Endpoint under `/api/v1/ai-assistant/mcp/` |
|---|---|---|
| `ticket_context` | Get ticket context and recent timeline by ticket number | `ticket-context/<ticket_number>/` |
| `ticket_search_similar_cases` | Search similar historical tickets by IOC keywords | `ticket-search/similar-cases/` |
| `cmdb_asset_lookup` | Look up CMDB assets by indicators (IPs, hostnames, asset numbers) | `cmdb/asset-lookup/` |
| `observables_extract` | Extract observables from a raw message, text, or alert JSON | `observables/extract/` |

The MCP JSON-RPC endpoint is `/api/v1/ai-assistant/mcp/`, and the tool manifest is at `/api/v1/ai-assistant/mcp/tools/`.

### Skill MCP Tools

The **Skill MCP Tools** table lists the two tools used to access the skill library:

| Tool | Description |
|---|---|
| `list_skills` | List skills from the skill library |
| `read_skill` | Read a skill document by name |

---

## Skills Management

Skills are Markdown instruction documents (`SKILL.md`) that guide the AI on how to handle a specific kind of case, such as phishing triage or ransomware response. When a skill applies, its text is added to the AI prompt.

![Skills Management]({{ '/assets/images/ai-agent/skills-management-n.png' | relative_url }})

### Configured Skills

The **Configured Skills** table shows skills registered on this platform: **Name**, **Version**, **Route**, an **Enabled** switch, and **Edit** / **Delete** actions. Only enabled skills are offered to the AI. **Name** (and **Route**, when set) is the key used to match a skill to its document, so keep it equal to the skill's directory name in the library.

### Adding a Skill

![Add Skill Modal]({{ '/assets/images/ai-agent/add-skill-modal-n.png' | relative_url }})

1. Click **Add Skill**.
2. In **Add Skill**, fill in:
   - **Name** — skill identifier (required; cannot be changed when editing)
   - **Version** — version string, for example `v1`
   - **Route** — optional alternative match key
   - **Description** — what the skill covers; the AI uses it when deciding whether the skill is relevant
   - **Content (SKILL.md)** — the skill instructions in Markdown; a **Preview** is shown below the field
   - **Enabled** — switch the skill on or off
3. Click **Create** (or **Save** when editing).

### Available Skills (Library)

The **Available Skills (Library)** table is a read-only list of the skills found in the skill library, with **Name**, **Title**, **Description**, and a **Status** tag:

| Status | Meaning |
|---|---|
| **Enabled** | Added and enabled; available to the AI |
| **Disabled** | Added but switched off |
| **Not Added** | Present in the library but not yet added |

There is no add-from-library button. To use a library skill, create a configured skill with the same **Name** (paste its content into **Content (SKILL.md)** if needed) and enable it. **Library skills are not active until they are added and enabled.**

The library ships with ten skills:

| Skill | Focus |
|---|---|
| `cloud-iam-anomaly` | Cloud identity and access anomalies |
| `data-exfiltration-detection` | Data exfiltration indicators |
| `dns-c2-investigation` | DNS-based command and control |
| `incident-containment-planning` | Containment planning |
| `insider-threat-assessment` | Insider threat assessment |
| `malware-execution-analysis` | Malware execution analysis |
| `phishing-triage` | Phishing email triage |
| `ransomware-response` | Ransomware response |
| `suspicious-login-investigation` | Suspicious login investigation |
| `vulnerability-prioritization` | Vulnerability prioritization |

Each skill is a directory containing a `SKILL.md` file. The library directory is `skills` in the backend application by default and is read from the Django setting `AI_SKILLS_DIR` when that is defined.

---

## How Skills Are Used

Skills are applied only when they are **enabled**.

- **Run AI Assistant** — the AI model is given the ticket evidence (including the alert JSON) and the list of enabled skills, and returns the relevant ones. If that selection call fails, a text-match fallback compares the skill names with the ticket evidence. The body of each selected skill (up to 12,000 characters) is added to the analysis prompt, and the result lists the skills used (`skills_used`).
- **Chat** — enabled skills are offered as candidates. The platform first selects relevant ones for your message and automatically runs `list_skills` and `read_skill` before the model answers, then injects the selected skill text into the prompt. The model can still call `read_skill` for additional skills, but a skill that was already preloaded is not read twice.

In the chat panel, each assistant reply with tool activity shows a trace with an **Expand** / **Collapse** button; the automatic `list_skills` / `read_skill` steps appear there.

---

## Using the AI Agent in Tickets

The AI Agent is accessed from within the ticket detail view.

**Navigation:** `Investigation → Tickets → [any ticket] → Incident tab`

![Ticket Detail — AI Assistant Panel]({{ '/assets/images/ai-agent/ticket-detail-n.png' | relative_url }})

### One-Click Analysis

Click **Run AI Assistant** to trigger automated analysis. The AI reads the ticket's alert data, linked observables, and history, then generates:

- **Alert Explanation** — plain-language summary of what the alert means
- **Risk Level Recommendation** — suggested severity with rationale
- **Completed Tasks** — actions the AI has already performed
- **Next Tasks** — recommended follow-up for the analyst

### AI Chat

![AI Chat Panel]({{ '/assets/images/ai-agent/ai-chat-panel-n.png' | relative_url }})

Click **Chat** to open an interactive conversation scoped to the current ticket:

1. The chat context automatically includes ticket metadata and linked alerts.
2. Type questions or instructions in the input field.
3. The AI responds with analysis, recommendations, or structured output.
4. Chat history persists per ticket.

**Example chat prompts:**
- "Extract all IOCs from this alert and format them as a list."
- "Explain the attack chain implied by these alerts."
- "What containment steps should I take first?"
- "Is this likely a true positive or false positive? Why?"

### @ai Mention

In the Work Log comment box, type `@ai <your question>` to post an inline AI response directly to the work log thread.

### @playbook Mention

Type `@playbook <name>` to invoke a callable workflow with the current ticket as context. The system executes the selected playbook and posts the result to the work log.

---

## Recommended Workflow

1. Open a ticket from the Tickets list.
2. Manually review **Case Details**, **Timeline**, **Alerts**, **Raw Message**, and **Evidence** first.
3. Click **Run AI Assistant** for an initial automated assessment.
4. Use **Chat** to ask follow-up questions: extract IOCs, clarify alert logic, request response steps.
5. Critically review all AI output before acting on it.
6. Record only confirmed findings in comments, tasks, or resolution notes.

---

## Troubleshooting

| Issue | Check |
|---|---|
| AI not responding | Enable AI Assistant toggle; verify API Key, Model, Base URL, Timeout; run Test Connectivity; remember General settings are per browser |
| Cannot edit settings | Guest accounts have a read-only view; use an internal account |
| MCP tools not invoking | Check MCP Status Monitor for failures; confirm the ticket scenario triggers tool usage |
| A library skill never gets used | Its status must be **Enabled**: add it under Configured Skills with the same **Name** and switch **Enabled** on |
| Skill Usage is empty or a skill shows zero calls | No AI run or chat has selected that skill yet; check that the skill is enabled and that its **Description** and name describe the cases it should handle |
| Skill shows failed calls | The skill document was not found in the library; check that **Name** matches the skill directory name |
| Chat gives inaccurate responses | The AI uses only the current ticket context; add more evidence to the War Room for richer analysis |
