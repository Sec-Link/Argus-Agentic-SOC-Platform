---
layout: default
title: "FAQ"
---

# Frequently Asked Questions

---

## Installation & Setup

### The stack starts but the frontend shows a blank page or network errors

Check that `BACKEND_ORIGIN` in your `.env` points to the correct internal hostname.
In Docker Compose it should be `http://backend:8000`, not `http://localhost:8000`
(the frontend container cannot reach `localhost` of your host machine).

```env
BACKEND_ORIGIN=http://backend:8000
```

---

### `make build-dev` fails with "port already in use"

Another process is using port 3000 or 8000. Find and stop it:

```bash
lsof -i :3000
lsof -i :8000
kill -9 <PID>
```

---

### I see `ProgrammingError: column "X" of relation "Y" already exists`

Migrations were applied out of order, likely after a manual schema change. Check the migration history:

```bash
docker compose -f docker-compose.dev.yml exec backend \
  python manage.py showmigrations
```

If a migration shows `[ ]` (unapplied) before a later one that is `[X]`, you may need to fake-apply it:

```bash
python manage.py migrate <app_name> <migration_name> --fake
```

---

### How do I reset the database entirely?

```bash
docker compose -f docker-compose.dev.yml down -v   # removes volumes
make build-dev
```

This drops all data. Only use in development.

---

## Alerts & Integrations

### No alerts appear even after connecting Elasticsearch

1. Verify connectivity: **Integrations → Elastic Stack → Configure → Test Connection**
2. Trigger a manual sync: `POST /api/v1/alerts/sync/` (requires auth token)
3. Check backend logs for ES errors: `make logs-dev`
4. Confirm the index pattern in `ES_INDEX` matches actual indices in your cluster

---

### Alerts sync but the UI shows "0 alerts"

The index specified in `ES_INDEX` might be empty or the time filter is excluding all results.
Try expanding the dashboard time range or directly query the API:

```bash
curl -H "Authorization: Token <your-token>" \
  http://localhost:8000/api/v1/alerts/list/
```

---

### Can I ingest alerts without Elasticsearch?

Yes. Use the **webhook ingest** endpoint. Any HTTP client can POST alert payloads:

```bash
curl -X POST http://localhost:8000/api/v1/interfaces/webhooks/<endpoint_id>/ \
  -H "Content-Type: application/json" \
  -d '{"severity": "high", "message": "Suspicious login", "source": "nginx"}'
```

Register an interface endpoint first via **Data Pipeline → Interfaces**.

---

## Tickets & SLA

### SLA timers aren't updating

SLA metrics are calculated at status transition time. Ensure the ticket status is being updated
through the API or UI (not direct DB edits). Check `TicketSLA` records via Django admin.

---

### The correlation engine isn't creating tickets automatically

1. Check **Data Pipeline → Correlation** — a policy must be saved and enabled
2. The policy's `match_keys` must match fields present in incoming alerts
3. Backend logs will show correlation evaluation errors if the policy fails to parse

---

## AI Assistant

### The AI Assistant returns "connectivity error"

1. Verify `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) is set in `.env`
2. Check connectivity: `GET /api/v1/ai-assistant/test-connectivity`
3. If using external MCP servers, verify they are started: **Administration → AI Assistant**

---

### MCP tool calls time out

Increase `MCP_TIMEOUT_SECONDS` (if supported) or check that the MCP server process
is healthy via `GET /api/v1/ai-assistant/mcp-monitor`.

---

## Deployment

### GitHub Actions / CI shows build failures

Check the **Actions** tab in the GitHub repository. Common causes:

- Django migration conflicts — run `python manage.py migrate --check` locally
- Missing environment variables in the CI secret store
- Frontend TypeScript errors — run `cd frontend && npx tsc --noEmit`

---

### How do I update to a new version?

```bash
git pull origin main
make redeploy-prod   # pulls images, restarts, applies migrations
```

Always review migration changes before applying to a production database with live data.

---

## GitHub Pages (this docs site)

### Images on the docs site return 404

Use the `relative_url` filter instead of bare paths:

```markdown
<!-- Wrong — breaks under /ECHO-Agentic-SOC-Platform/ baseurl -->
![Diagram](/assets/images/diagram.png)

<!-- Correct -->
![Diagram]({{ '/assets/images/diagram.png' | relative_url }})
```

### My `.md` changes don't appear after pushing

GitHub Pages rebuilds take 1–3 minutes. Check the **Actions** tab (or **Settings → Pages**)
for build status. A red ✗ means Jekyll encountered a YAML or Markdown error — inspect the
action log for the exact line.
