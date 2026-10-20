# API Overview

This document tracks the current code structure, key APIs, database mappings, and schema entrypoints for the SIEM platform.

## Base API Conventions
- Main API prefix: `/api/v1/`
- Authentication: DRF Token Authentication
- Time zone: UTC (`USE_TZ = True`, `TIME_ZONE = UTC`)
- Response style: standard DRF JSON responses
- Pagination/filtering behavior depends on the individual viewset or view implementation

## Schema / API Discovery
- Django admin: `/admin/`
- Current route discovery is primarily through Django router/viewset URL registration

## Backend Apps
- `accounts`: Authentication, user management, group management, RBAC helpers
- `alerts`: Alert list, dashboard metrics, sync, and connector config helpers
- `cmdb`: Asset inventory, asset columns, and audit logs
- `correlation`: Correlation policy and correlation event endpoints
- `integrations`: Integration metadata and external connection utilities
- `dashboards`: Dashboard metadata CRUD
- `tickets`: SLA-aware ticket CRUD, lifecycle actions, and SLA metrics
- `workflows`: Workflow definitions, steps, executions, saved nodes, and workflow stats
- `workflow_interfaces`: External interface endpoints and ingest/webhook entrypoints
- `ai_assistant`: Chat, MCP protocol, skill registry/configuration, and external MCP server management
- `orchestrator`: Tasks, task runs, and task request logs
- `siem_project`: Project settings and top-level URL routing

## Frontend Code Map
| Area | Path | Purpose |
| --- | --- | --- |
| Project URL map | `backend/siem_project/urls.py` | Top-level API routing and app inclusion |
| Auth routes | `backend/accounts/urls.py` | Login/logout/register, users, groups, RBAC |
| Alerts routes | `backend/alerts/urls.py` | Alert list, dashboard, sync, config, diagnostics |
| Tickets routes | `backend/tickets/urls.py` | Ticket CRUD and SLA endpoints |
| CMDB routes | `backend/cmdb/urls.py` | Asset, column, and audit log APIs |
| Correlation routes | `backend/correlation/urls.py` | Correlation policy and events |
| Workflows routes | `backend/workflows/urls.py` | Workflow CRUD, execution, stats, and nodes |
| Interface routes | `backend/workflow_interfaces/urls.py` | Endpoint registration and ingest/webhook ingress |

## API & Key Endpoints

### Authentication
| Area | Endpoint | Method | Purpose | Backend ref |
| --- | --- | --- | --- | --- |
| Auth | `/api/v1/auth/login/` | POST | User login | `backend/accounts/views.py` |
| Auth | `/api/v1/auth/logout/` | POST | User logout | `backend/accounts/views.py` |
| Auth | `/api/v1/auth/register/` | POST | User registration | `backend/accounts/views.py` |
| Auth | `/api/v1/accounts/change-password/` | POST | Change current password | `backend/accounts/urls.py` |

### Accounts / RBAC
| Area | Endpoint | Method | Purpose | Backend ref |
| --- | --- | --- | --- | --- |
| Users | `/api/v1/accounts/users/` | GET/POST | List or create users | `backend/accounts/urls.py` |
| Users | `/api/v1/accounts/users/{id}/` | GET/PUT/PATCH/DELETE | User CRUD | `backend/accounts/urls.py` |
| Groups | `/api/v1/accounts/groups/` | GET/POST | List or create groups | `backend/accounts/urls.py` |
| Groups | `/api/v1/accounts/groups/{id}/` | GET/PUT/PATCH/DELETE | Group CRUD | `backend/accounts/urls.py` |
| RBAC | `/api/v1/accounts/rbac/` | various | RBAC helper routes | `backend/accounts/urls.py` |
| Permissions | `/api/v1/permissions/` | various | Permission-related routes | `backend/siem_project/urls.py` |

### Alerts
| Area | Endpoint | Method | Purpose | Backend ref |
| --- | --- | --- | --- | --- |
| Alerts list | `/api/v1/alerts/list/` | GET | Paginated alert list | `backend/alerts/urls.py` |
| Alerts dashboard | `/api/v1/alerts/dashboard/` | GET | Dashboard metrics and trend data | `backend/alerts/urls.py` |
| Alerts sync | `/api/v1/alerts/sync/` | POST | Trigger alert synchronization | `backend/alerts/urls.py` |
| ES config | `/api/v1/alerts/config/es/` | GET/POST | Elasticsearch connection settings | `backend/alerts/urls.py` |
| Webhook config | `/api/v1/alerts/config/webhook/` | GET/POST | Webhook configuration | `backend/alerts/urls.py` |
| ES diagnostics | `/api/v1/alerts/debug/es_status/` | GET | Elasticsearch status diagnostics | `backend/alerts/urls.py` |

### Tickets
| Area | Endpoint | Method | Purpose | Backend ref |
| --- | --- | --- | --- | --- |
| Tickets | `/api/v1/tickets/` | GET/POST | List or create tickets | `backend/tickets/urls.py` |
| Ticket detail | `/api/v1/tickets/{ticket_number}/` | GET/PUT/PATCH/DELETE | Ticket CRUD by ticket number | `backend/tickets/urls.py` |
| SLA metrics | `/api/v1/tickets/sla/` | GET | SLA metric records | `backend/tickets/urls.py` |
| Ticket choices | `/api/v1/tickets/field_choices/` | GET | Field dropdown values | `backend/tickets/views.py` |
| Status update | `/api/v1/tickets/{ticket_number}/update_status/` | POST | Update ticket status | `backend/tickets/views.py` |
| Resolve | `/api/v1/tickets/{ticket_number}/resolve/` | POST | Resolve a ticket | `backend/tickets/views.py` |

### CMDB
| Area | Endpoint | Method | Purpose | Backend ref |
| --- | --- | --- | --- | --- |
| Assets | `/api/v1/cmdb/assets/` | GET/POST | Asset inventory CRUD | `backend/cmdb/urls.py` |
| Asset detail | `/api/v1/cmdb/assets/{id}/` | GET/PUT/PATCH/DELETE | Asset CRUD | `backend/cmdb/urls.py` |
| Columns | `/api/v1/cmdb/columns/` | GET/POST | Asset column metadata | `backend/cmdb/urls.py` |
| Column detail | `/api/v1/cmdb/columns/{id}/` | GET/PUT/PATCH/DELETE | Asset column CRUD | `backend/cmdb/urls.py` |
| Logs | `/api/v1/cmdb/logs/` | GET | Asset audit logs | `backend/cmdb/urls.py` |
| Log detail | `/api/v1/cmdb/logs/{id}/` | GET/PUT/PATCH/DELETE | Audit log CRUD | `backend/cmdb/urls.py` |

### Correlation
| Area | Endpoint | Method | Purpose | Backend ref |
| --- | --- | --- | --- | --- |
| Policy | `/api/v1/correlation/policy/` | GET/POST | Fetch or update correlation policy | `backend/correlation/urls.py` |
| Events | `/api/v1/correlation/events/` | GET | Correlation event stream / mock series | `backend/correlation/urls.py` |

### Dashboards / Integrations / Orchestrator
These routes are registered in `backend/siem_project/urls.py` via DRF routers, so the exact set of list/detail actions depends on each ViewSet implementation.

| Area | Endpoint | Method | Purpose | Backend ref |
| --- | --- | --- | --- | --- |
| Dashboards | `/api/v1/dashboards/` | GET/POST | Dashboard metadata CRUD | `backend/dashboards/views.py` |
| Integrations | `/api/v1/integrations/` | GET/POST | Integration metadata CRUD | `backend/integrations/views.py` |
| Tasks | `/api/v1/tasks/` | GET/POST | Task definitions | `backend/orchestrator/views.py` |
| Task runs | `/api/v1/task_runs/` | GET/POST | Task run records | `backend/orchestrator/views.py` |
| Task request logs | `/api/v1/task_request_logs/` | GET/POST | Task request logs | `backend/orchestrator/views.py` |

### Special Integration Utilities
| Area | Endpoint | Method | Purpose | Backend ref |
| --- | --- | --- | --- | --- |
| ES test | `/api/v1/integrations/test_es` | GET/POST | Test Elasticsearch connectivity | `backend/siem_project/urls.py` |
| ES preview | `/api/v1/integrations/preview_es` | GET/POST | Preview ES index data | `backend/siem_project/urls.py` |
| ES mapping preview | `/api/v1/integrations/preview_es_mapping` | GET/POST | Preview ES field mappings | `backend/siem_project/urls.py` |

### Workflow Engine
| Area | Endpoint | Method | Purpose | Backend ref |
| --- | --- | --- | --- | --- |
| Action templates | `/api/v1/workflows/action-templates/` | GET/POST | Action template CRUD | `backend/workflows/urls.py` |
| Workflows | `/api/v1/workflows/workflows/` | GET/POST | Workflow CRUD | `backend/workflows/urls.py` |
| Executions | `/api/v1/workflows/executions/` | GET/POST | Workflow execution records | `backend/workflows/urls.py` |
| Steps | `/api/v1/workflows/steps/` | GET/POST | Workflow step CRUD | `backend/workflows/urls.py` |
| Saved nodes | `/api/v1/workflows/saved-nodes/` | GET/POST | Persisted node layouts | `backend/workflows/urls.py` |
| Workflow stats | `/api/v1/workflows/stats/` | GET | Workflow statistics | `backend/workflows/urls.py` |

### Workflow Interfaces
| Area | Endpoint | Method | Purpose | Backend ref |
| --- | --- | --- | --- | --- |
| Interface endpoints | `/api/v1/interfaces/endpoints/` | GET/POST | External endpoint registry | `backend/workflow_interfaces/urls.py` |
| Interface ingest | `/api/v1/interfaces/endpoints/{endpoint_id}/ingest/` | POST | Ingest data for a registered endpoint | `backend/workflow_interfaces/urls.py` |
| Webhook ingest | `/api/v1/interfaces/webhooks/{endpoint_id}/` | POST | Webhook-style ingest endpoint | `backend/workflow_interfaces/urls.py` |

### AI Assistant / MCP
| Area | Endpoint | Method | Purpose | Backend ref |
| --- | --- | --- | --- | --- |
| AI connectivity | `/api/v1/ai-assistant/test-connectivity` | GET/POST | Health/connectivity check | `backend/siem_project/urls.py` |
| MCP monitor | `/api/v1/ai-assistant/mcp-monitor` | GET/POST | MCP monitoring | `backend/siem_project/urls.py` |
| MCP registry | `/api/v1/ai-assistant/mcp-registry/servers` | GET/POST | MCP server registry | `backend/siem_project/urls.py` |
| Skills monitor | `/api/v1/ai-assistant/skill-monitor` | GET/POST | Skill monitoring | `backend/siem_project/urls.py` |
| Skills catalog | `/api/v1/ai-assistant/skills/catalog` | GET/POST | Available skills catalog | `backend/siem_project/urls.py` |
| Skills config | `/api/v1/ai-assistant/skills/config` | GET/POST | Skill config collection | `backend/siem_project/urls.py` |
| Skill config detail | `/api/v1/ai-assistant/skills/config/{name}` | GET/PUT/PATCH/DELETE | One skill config | `backend/siem_project/urls.py` |
| Skill content detail | `/api/v1/ai-assistant/skills/content/{name}` | GET | Skill content payload | `backend/siem_project/urls.py` |
| AI chat | `/api/v1/ai-assistant/chat` | POST | Chat interaction endpoint | `backend/siem_project/urls.py` |
| Page assistant | `/api/v1/ai-assistant/page-chat` | POST | Authenticated page chat; optional SSE agent with enabled skills/MCP/HTTP tools | `backend/ai_assistant/page_chat.py` |
| Page tool approval | `/api/v1/ai-assistant/page-chat/approvals/{execution_id}` | POST | Owner-only approval/rejection of one pending external tool call | `backend/ai_assistant/page_agent.py` |
| HTTP tools | `/api/v1/ai-assistant/http-tools/` | GET/POST | Paginated HTTP query tool configurations; credentials are write-only | `backend/ai_assistant/http_tool_views.py` |
| HTTP tool detail | `/api/v1/ai-assistant/http-tools/{name}/` | GET/PUT/PATCH/DELETE | One HTTP query tool configuration | `backend/ai_assistant/http_tool_views.py` |
| Agent roles | `/api/v1/ai-assistant/agents/` | GET/POST | Permission-controlled specialist role configuration | `backend/ai_assistant/agent_views.py` |
| Agent role detail | `/api/v1/ai-assistant/agents/{name}/` | GET/PUT/PATCH/DELETE | One specialist role | `backend/ai_assistant/agent_views.py` |
| Chat agent catalog | `/api/v1/ai-assistant/agents/catalog/` | GET | Enabled names, titles and responsibilities for chat operators | `backend/ai_assistant/agent_views.py` |
| External MCP | `/api/v1/ai-assistant/external-mcp` | GET/POST | External MCP server list | `backend/siem_project/urls.py` |
| External MCP detail | `/api/v1/ai-assistant/external-mcp/{name}` | GET/PUT/PATCH/DELETE | One external MCP server | `backend/siem_project/urls.py` |
| External MCP start | `/api/v1/ai-assistant/external-mcp/{name}/start` | POST | Start external MCP server | `backend/siem_project/urls.py` |
| External MCP stop | `/api/v1/ai-assistant/external-mcp/{name}/stop` | POST | Stop external MCP server | `backend/siem_project/urls.py` |
| MCP JSON-RPC | `/api/v1/mcp` | POST | Standard MCP JSON-RPC endpoint | `backend/siem_project/urls.py` |
| MCP tools | `/api/v1/mcp/tools` | GET | Tool manifest | `backend/siem_project/urls.py` |
| MCP ticket context | `/api/v1/mcp/ticket-context/{ticket_number}` | GET | Ticket context retrieval | `backend/siem_project/urls.py` |
| MCP similar cases | `/api/v1/mcp/ticket-search/similar-cases` | GET/POST | Find similar tickets | `backend/siem_project/urls.py` |
| MCP CMDB lookup | `/api/v1/mcp/cmdb/asset-lookup` | GET/POST | Asset lookup | `backend/siem_project/urls.py` |
| MCP observables extract | `/api/v1/mcp/observables/extract` | POST | Extract observables | `backend/siem_project/urls.py` |

### LangChain model execution

Chat, ticket analysis and embeddings use the shared LangChain model client. Install the versions in `backend/requirements.txt` before starting this backend. Model failures use bounded diagnostics rather than logging provider payloads, and model/tool calls are not automatically retried. Existing chat and ticket-analysis response formats are preserved. New tool-result audit payloads are stored only for page-chat executions with an identified actor; legacy ownerless executions retain their existing audit payload behavior. The MCP monitor returns page-chat executions only to their initiating user, including filtering and pagination; legacy monitoring remains unchanged.

### Floating page assistant

The circle at the bottom-right of authenticated pages opens a chat panel. It uses the existing AI Assistant model settings and captures the current page again when a message is sent. Users can preview the context, share only page structure, or turn off page sharing. Conversation history remains in component memory and is cleared on refresh or logout.

The expand button beside Close docks the chat on the right and resizes the page into the left pane. Drag the divider to adjust their proportions; the page keeps at least 480px and chat at least 360px, plus an 8px divider. The focused divider also accepts Left/Right (Shift for larger steps), Home and End. Restore returns to the floating panel; closing releases the page width. Messages, drafts and page state survive these layout changes. If the available workspace (excluding navigation) becomes narrower than 848px, chat returns to floating mode and expansion is disabled until enough space is available. Ticket grids adapt to the pane width.

The snapshot contains `path` (300 characters), `title` (200), `content`, and optional `kind` (default `page`). Ordinary pages have a 12,000-character content limit. Capture is limited to the rendered main page subtree; navigation, chat itself, hidden elements, form inputs, raw code/event blocks, SVG/canvas content, and portal dialogs are excluded. Credential/account configuration pages share only headings, labels, buttons, and table headers. Common secret labels, bearer/JWT tokens, email addresses, and IPv4 addresses are filtered. Pattern-based filtering is not a complete data-loss-prevention system; sensitive custom components should use `data-ai-context-exclude`. Content outside the snapshot must not be assumed available to the model.

Ticket pages publish explicitly selected data through `AssistantPageContextProvider`, scoped to the mounted route and cleared on unmount. With **Include ticket data** enabled, the assistant uses these records instead of rendered text, including already-loaded information from inactive tabs. Original IP addresses, email addresses, usernames, hostnames, file paths, hashes, and noncredential URL parameters/fragments are sent to the configured AI model for investigation. Disabling it falls back to page structure; disabling **Share current page** omits the snapshot entirely.

- `ticket_detail` (48,000 characters): saved ticket fields and labels, classification, lifecycle dates, SLA/MITRE, raw alert evidence, ticket records and sources, work logs, handle logs, playbook execution metadata, attachment metadata, observables, and previous AI analysis. Each section has its own budget so large alerts do not displace other evidence. Logs prioritize recent entries; counts and truncation markers distinguish loaded data from omitted data. Loading/errors for handle logs and workplans are reported explicitly. No additional API requests, attachment downloads, unsaved form drafts, or workflow actions are triggered.
- `ticket_list` (24,000 characters): the loaded filtered set, search/facet/time-range filters, selected IDs, loaded/filtered counts, and up to 100 ticket summaries. This is not a complete server-wide inventory.

Ticket JSON retains original investigation evidence instead of anonymizing it. Only recognized credential values (including nested password/token/key fields, credential labels/headers and URL credentials) are filtered before size limits apply. Metadata such as `token_count`, `TokenElevationType` and `password_changed` is preserved. The attachment metadata allowlist excludes attachment download paths and binary objects; workflow execution metadata excludes trigger payloads. Paths and encoded text already present in alert evidence remain available. Previous AI results are marked as unverified analysis. The model is asked to reference log IDs/timestamps or alert field paths and state uncertainty when evidence is incomplete. Larger ticket snapshots consume more model context; the configured model's capacity still applies. Ordinary-page filtering is unchanged.

`POST /api/v1/ai-assistant/page-chat/` accepts `message` (4,000 characters), optional `page_context`, and optional `messages` (at most 12 user/assistant entries, 8,000 characters each and 32,000 total). Optional `api_key`, `model`, `base_url`, and `timeout_seconds` reuse model configuration; a different model URL requires an explicit API key so the server key cannot be forwarded to another destination. Without `stream`, the existing tool-free response remains `{ "response": "..." }`, with a sanitized 503 for model failures. Invalid input returns 400 and authentication/readonly restrictions return 401/403.

The floating/docked assistant sends `stream: true` with `Accept: text/event-stream` and receives SSE JSON `data` frames. The endpoint registers an SSE renderer so DRF accepts that header before authentication and validation; failures keep their HTTP status and use a safe terminal error frame. Default and explicit JSON requests retain their existing response format. Events include `status`, `model_call`, `tool_call`, `tool_result`, `answer_delta`, `analysis_summary_delta`, `analysis_summary`, `assistant_response`, `approval_required`, and terminal `done` or `error`. Tool events carry stable `call_id`/`execution_id`; answer and summary events carry an iteration number. The UI retains actual tool steps and partial text on stop/error. Analysis summaries are short model-authored explanations of evidence and conclusions; provider-private reasoning is not requested or exposed. A model gateway that buffers its own output can still limit token granularity.

Stream execution failures carry an additive diagnostic: a fixed `code` and safe `message`, a backend-generated `request_id`, the last reported `stage`, and available `iteration`/agent metadata. Model HTTP failures also include numeric `status_code`. The initial `status` supplies the same request ID so the browser can identify an abruptly closed stream. Codes distinguish model timeout, connection/DNS/TLS failure, authentication, rate/quota limits, model/API compatibility and upstream errors from the whole-turn `execution_timeout` and unexpected `execution_stopped`. DNS/TLS diagnoses require typed exception evidence; generic connection failures do not assert a DNS cause. Unknown exceptions remain `internal_error`. Child `agent_error` events use the same diagnostics without terminating a coordinator that can still summarize partial findings.

For HTTP 400/422 validation failures, recognized structured provider fields can add a bounded hint to `message`, such as a missing `messages[].reasoning_content`. The parser accepts nested `error`/`detail`/`errors` envelopes, SDK-unwrapped lists and JSON strings, bounded to four nesting levels, 16 KiB encoded strings, eight validation entries and three hints. A bounded response-JSON fallback recovers structured fields discarded by SDK error unwrapping. Only allowlisted protocol paths and fixed issue labels are returned; provider error text, offending input values, dynamic field names and response bodies are excluded. Unrecognized error shapes retain the general `model_bad_request` message.

For official MiniMax endpoints, the confirmed HTTP 400/422 error signature `type: unprocessable_entity_error` with `message: input new_sensitive (1026)` maps to `model_content_rejected` with a fixed content-safety explanation, rather than API-compatibility advice. This identifies an input rejection under [MiniMax's error codes](https://platform.minimax.io/docs/api-reference/errorcode), not a context-length failure, and does not identify which part of the request triggered it. The backend recognizes the exact signature in either an SDK-unwrapped error or its `error` envelope; other providers and unknown signatures retain existing classification. Coordinator and specialist errors retain the HTTP status and completed findings. No automatic retry or evidence rewriting is added, and raw provider errors are not exposed. For unexpected rejections, request a review from MiniMax support.

MiniMax Chat Completions endpoints (`api.minimax.io`, `api.minimaxi.com` and `api.minimax.cn`) preserve returned `reasoning_content` in backend message state and send it back on subsequent tool rounds, as required by [MiniMax's tool-use protocol](https://platform.minimax.io/docs/guides/text-m3-function-call). This supports models such as `MiniMax-M3.1-Flash-Preview` without exposing that field in answers, SSE events or tool audit results. It does not add reasoning when the provider omitted it. Tool-call-only assistant messages use `content: ""` on replay because the [MiniMax message schema](https://platform.minimax.io/docs/api-reference/text/api/openapi-chat-openai.json) permits strings or arrays, rather than the `null` emitted by the generic OpenAI adapter. Nonempty content is preserved. Other providers and the Responses API retain their existing adapters.

The chat retains errors with their failed turn or child step, alongside partial output. Browser HTTP errors, broken connections, incomplete streams and malformed frames have separate client diagnostics; no request is replayed automatically. Page-chat diagnostic warning logs include the matching request ID, error code, stage, iteration and HTTP status, never raw exception text, tracebacks, model payloads, credentials or provider URLs. On model 400/422 failures, `request_summary` additionally reports fixed adapter/tool-choice categories, message and tool counts, tool-ID uniqueness/pairing, and field types/lengths for the last six messages. Lengths are character/element counts, not token counts; IDs and field contents are not logged. This metadata is validated again before logging and removed from browser events. Cleanup failures use `cleanup_failed` in server logs without replacing the original result. Stage and request-structure metadata are diagnostic evidence, not proof of the underlying rejection cause.

The VS Code `Debug: Django` configuration and `.run/start-langchain.ps1` use `--noreload`. Restart that backend after Python changes; Next.js development hot reload only updates the frontend. An older backend can still send unclassified errors without a request ID, displayed as `server_error`. Restarting loads diagnostics for new requests; it cannot recover the cause of a previous failure whose details were discarded.

The agent uses enabled Skill configurations and enabled external MCP servers from **AI Assistant**, plus built-in ticket/CMDB/observable queries. Browser-supplied tool registries are ignored. Built-in reads enforce the current user's ticket, asset and knowledge-base read permissions on the server. Every external MCP call requires confirmation of its exact tool, arguments and endpoint because external tool side effects cannot be inferred from their descriptions. `POST .../approvals/{execution_id}/` with `{ "decision": "approve" }` or `{ "decision": "reject" }` is restricted to the initiating user, expires after 90 seconds, and rejects replay with 409. The enabled server and its credentials are rechecked before execution. Only that endpoint/tool is invoked, without retries, redirects or argument aliases; no user login token is forwarded. Duplicate endpoint configurations use the first enabled row by name consistently.

Snapshots, skills and tool results are untrusted evidence, not authorization. The endpoint does not persist conversation/page snapshots; tool arguments/results and actor/approval metadata use existing MCP execution audit records. Recognized credentials are removed from tool diagnostics and model-bound results while original SOC indicators are preserved. Guest action/status auditing omits page-chat request bodies. External tool errors remain failures. Existing JSON clients keep their original behavior.

Without configured specialists, each turn allows six agent model calls (plus optional skill selection) and a five-minute stream lifetime, with a bounded event queue. Stop/disconnect prevents subsequent agent calls and cancels pending approvals; a model/HTTP call already in flight may finish within its timeout and cannot be undone. The UI states this explicitly. The proxy does not retry page-chat or approval POSTs on another origin. Django gzip and proxy buffering are disabled for the stream. Production SSE needs the existing threaded Gunicorn deployment (or equivalent streaming support); heartbeat frames alone do not prevent sync-worker timeouts. Each active stream still occupies a serving thread. HTTP tool configuration requires migration `ai_assistant.0007_http_tool_config`; no additional packages or services are required.

### Coordinator and specialist agents

**AI Assistant → Agents** manages up to 50 specialist roles. Each has a unique mention name (lowercase letters, digits and underscores, at most 48 characters), display name (120), responsibility/routing description (500), instructions (6,000), and an enabled flag that defaults to false. `max_iterations` sets model rounds per delegated task (integer 1–100, default 3); optional Skill selection is outside this budget. `max_delegations` limits how often that role can be assigned work in one user message (integer 1–100, default 3). These are upper limits, not required execution counts. Started attempts count even if they fail or return incomplete findings; counts reset for the next user message. Both settings appear in the management list and use plain text inputs in the create/edit form: enter digits directly, without preset options or steppers. Empty, fractional, signed, scientific-notation and out-of-range entries are rejected; the API receives integers. `coordinator` and `catalog` are reserved names. The built-in coordinator remains responsible for dividing work and synthesizing the final answer. All agents reuse the current AI Assistant model configuration; this feature adds no services or dependencies.

With enabled roles, unqualified chat requests let the coordinator choose specialists or answer simple questions directly. Typing `@name` in the chat input opens autocomplete and selects up to three distinct enabled roles. Email addresses and code examples do not select roles. The frontend sends these names in the optional `agent_names` field of the streaming page-chat request; this explicit field is authoritative. Mentions embedded in page snapshots, conversation history, tool output or model text never change that field. Unknown/disabled selections return 400 before streaming, and `agent_names` requires `stream: true`. When roles are selected, delegation is restricted to those roles, and each must be attempted before the turn can complete. The model provider must support function calling, including a named `tool_choice`; ignoring required delegation cannot produce a successful turn.

The coordinator receives routing descriptions, each role's budgets and a single `delegate_to_agent` tool. It chooses a focused task for a specialist, which receives the original question, shared page snapshot/history and its configured role instructions. Specialists use the existing enabled Skills, built-in queries, MCP and HTTP tools; they cannot delegate further. Execution is serial. The shared delegation budget is the sum of available roles' `max_delegations`, capped at 100 per turn; the former shared limit of three no longer applies. Each role must also stay within its own limit. Explicitly selected roles must be attempted before repeating a role. Each task uses its configured `max_iterations`. The coordinator allows `max(6, shared_budget + 1)` model rounds, at most 101, so sequential assignments have room for a final answer. Its final round disables delegation and the server rejects new assignments in that round even if a model ignores that instruction. If selected roles are still unattempted when the final round is reached, the turn fails explicitly.

The whole turn retains the shared five-minute deadline, and model context limits may stop a long investigation sooner. Larger numbers do not guarantee every permitted call will run. Defaults remain three per role, but multiple roles can now collectively exceed three assignments; increasing budgets can increase latency and model usage. The backend enforces limits independently of model instructions and does not accept chat-request overrides of these managed settings.

Specialist events carry `agent`, `agent_title`, and `delegation_id`. `agent_start`, `agent_done`, and `agent_error` show the assigned task and bounded result, while existing model/tool/approval events appear under that specialist. Pending approvals also appear as separate cards after the current answer, with the agent, tool, request preview and decision buttons; collapsing execution steps cannot hide them. Only the coordinator's answer updates the main response; only the root `done`/`error` terminates the stream. The coordinator receives at most 12,000 characters per specialist result with an explicit truncation marker. Failure, cancellation and iteration-limit results remain distinct from completed work.

Tool lifecycle and approval events enter the bounded page-chat queue directly from tool threads, preserving each approval-gated execution's `tool_call` → `approval_required` → `tool_result` order. They do not depend on the graph's stream waiter, which can be blocked by a batch of tools waiting for approval or the serial tool lock. Model token streaming still uses the graph stream. Each external call in a batch requires its own approval; rejecting or stopping prevents subsequent external execution.

Every agent acts as the initiating user. Role instructions do not confer permissions. Enabled state and configuration version are rechecked before specialist model calls, tool calls and approved external execution. The same owner-only external approval flow remains in force. Rejecting an external call prevents additional external calls by any agent in that turn; a new user message is required to authorize a later attempt. Stop/disconnect shares cancellation across the coordinator and specialists, and cancels pending approvals. Existing tool audits include role name, configuration version and delegation ID inside `_page_chat` metadata, including denied calls.

Management requires the corresponding `ai_assistant.view_agentconfig`, `add_agentconfig`, `change_agentconfig`, or `delete_agentconfig` permission. The authenticated non-readonly chat catalog exposes only enabled `name`, `title`, and `role`, without full instructions; chat operators do not need configuration-edit permissions. CRUD lists use `{count,next,previous,results}`, default page size 50 and maximum 100. Configuration audit records include the two numeric budgets and omit role prompts and bodies. Apply migrations through `ai_assistant.0010_expand_agent_execution_limits` to the intended database before starting the updated application; 0009 adds the budget columns with default 3, and 0010 expands their validators without rewriting saved values. Older clients may omit the new fields: creation uses defaults and updates preserve existing values. Budget changes update the configuration version and stop further execution of an already-running specialist under the previous version. Existing permissions are not automatically broadened; assign management permissions through the existing Permissions page. Rolling back the code restores the earlier runtime caps; larger saved values may need lowering before editing with the old API. Retain the additive columns when rolling back; reversing 0009 removes saved budget settings.

### Configurable HTTP query tools

**AI Assistant → Tools** manages named GET/POST query tools used by the floating/docked streaming assistant. Select **Add tool** to configure a description, a fixed public HTTPS URL, typed AI input parameters, query parameter templates, an optional POST JSON body, timeout (1–30 seconds), and optional Bearer or custom-header authentication. Tools are disabled by default. Save and enable the tool to make it available to the assistant. No provider call happens when saving configuration.

Placeholders use `{parameter}`. A whole JSON value placeholder retains its declared string/number/integer/boolean type; embedded placeholders produce strings. Omitted optional parameters remove their whole-placeholder query/body entries; optional values embedded in a larger string must be supplied. URL path parameters must be required and are encoded as single segments. Hostnames, object keys and authentication headers cannot be generated by the model. URL query strings belong in `query_params`. Put credentials in the authentication field, not descriptions, URLs or templates.

Configuration CRUD requires authentication and the corresponding Django `ai_assistant.view_httptoolconfig`, `add_httptoolconfig`, `change_httptoolconfig`, or `delete_httptoolconfig` permission. Administrators can assign them through the existing **Permissions** page; migration does not automatically grant them to existing users. Readonly accounts cannot write or execute tools. List responses are `{count,next,previous,results}` with `page` and `page_size` (default 50, maximum 200). Credentials are encrypted in the database using an application-specific key derived from Django `SECRET_KEY`; reads return only `has_auth_secret`. Blank credentials on edit retain the stored value; `clear_auth_secret: true` explicitly removes it. Changing the URL, method or authentication settings requires re-entering or clearing the saved credential. Keep prior Django keys in `SECRET_KEY_FALLBACKS` during rotation or re-enter credentials; never commit these keys.

Enabled tools are registered as `http__{name}`. Active authenticated operators can request them through the page assistant, but each actual call requires owner confirmation. The approval shows the resolved method, URL, query and body without authentication headers. Approval and execution bind to a configuration version; changing, disabling or deleting it requires a new turn. Results and actor/approval metadata appear in the existing execution trace/audit, and configuration changes have separate audit events without credentials or request bodies. Tool output is untrusted evidence and cannot authorize another action. Legacy nonstreaming chat and workflows do not automatically gain these tools.

Requests use verified TLS with the original hostname and connect directly to a validated public IP. Loopback/private/link-local/reserved addresses, mixed private/public DNS results and IP transition addresses are rejected. Redirects, retries and environment proxies are not used. Responses are capped at 64 KiB with an explicit truncation flag, and compressed responses are rejected. The request deadline/cancellation closes the active socket; operating-system DNS resolution may finish later, but no HTTP request starts after cancellation/expiry. HTTP failures stay failed tool steps with safe diagnostics. Recognized credentials and exact configured credential echoes are removed before results reach the model or audit; IPs and other investigation evidence remain unchanged. These tools are intended for information queries; POST calls still require confirmation because effects cannot be inferred from HTTP method alone.

Apply the additive migration to the intended development database before starting the updated backend (not run automatically):

```powershell
.\.venv\Scripts\python.exe backend/manage.py migrate ai_assistant
```

Local regression verification (test files are retained locally and excluded from these commits; synthetic data, temporary SQLite test database, no production configuration or live model/MCP services):

```powershell
# From frontend/
node --test src/modules/aiAssistant/pageContext.test.mjs
node --test src/modules/aiAssistant/assistantSplit.test.mjs
node --test src/services/aiAssistant/stream.test.mjs src/modules/aiAssistant/chatState.test.mjs
node --test src/modules/aiAssistant/httpToolForm.test.mjs
node --test src/modules/aiAssistant/agentMentions.test.mjs
node --test src/modules/aiAssistant/agentLimits.test.mjs
node --test src/modules/tickets/aiContext.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false

# From backend/
..\.venv\Scripts\python.exe manage.py test ai_assistant.tests.test_page_chat ai_assistant.tests.test_page_agent ai_assistant.tests.test_chat_agent ai_assistant.tests.test_mcp_gateway_exact ai_assistant.tests.test_page_event_redaction --settings=ai_assistant.tests.page_chat_settings --verbosity=2
..\.venv\Scripts\python.exe manage.py test ai_assistant.tests.test_http_tools ai_assistant.tests.test_http_tool_api ai_assistant.tests.test_page_http_tools --settings=ai_assistant.tests.page_chat_settings --verbosity=2
..\.venv\Scripts\python.exe manage.py test ai_assistant.tests.test_agent_api ai_assistant.tests.test_multi_agent ai_assistant.tests.test_multi_agent_limits --settings=ai_assistant.tests.page_chat_settings --verbosity=2
..\.venv\Scripts\python.exe manage.py test ai_assistant.tests.test_model_client ai_assistant.tests.test_minimax_model ai_assistant.tests.test_model_validation ai_assistant.tests.test_chat_errors --settings=ai_assistant.tests.page_chat_settings --verbosity=2
```

