# ClickHouse Alert Collection

Configure **Data Pipeline > Integrations > ClickHouse** to collect existing alert
rows from one ClickHouse table. Multiple saved connections/tables are supported.
This is not a ClickStack/HyperDX alert-management API or a rule publisher.

## Connection and Mapping

- Use the ClickHouse HTTP(S) origin, normally HTTPS port `8443` or HTTP port `8123`,
  not the native TCP port or the ClickStack UI URL. Paths, URL credentials,
  query strings and fragments are rejected.
- Use a dedicated account with SELECT permission only on the chosen table.
  HTTPS and certificate verification should be enabled outside development.
- Select a literal database/table name. Their combined `database.table` length
  must be at most 64 characters, matching Argus's existing `Alert.source_index`.
- Map a stable, unique source alert ID and a DateTime/DateTime64 timestamp column.
  String and integer alert IDs are supported. Timestamp output is converted to
  epoch milliseconds on ClickHouse, so the server's display time zone does not
  change the stored instant.
- Severity, message, title, rule ID, description, category and numeric status can
  also be mapped. Clear optional mappings for columns that do not exist.
  Defaults are `alert_id`, `timestamp`, `severity` and `message`.
- Identifiers accept letters, digits and underscores, cannot start with a digit,
  and are limited to 63 characters. Arbitrary SQL, expressions, table functions,
  dotted paths and cross-table queries are not accepted.

For ClickStack-style tables, map fields such as `Timestamp`, `SeverityText` and
`Body` explicitly. A stable alert ID is still required: a table containing raw
logs is not automatically converted into security alerts or given generated IDs.

**Test Connection** validates table/mapping SELECT access with `LIMIT 0` and then
returns only the ClickHouse version and HTTP status. It does not fetch alert rows.
ClickHouse HTTP 404 can also mean that the configured database or table does not
exist. Error messages use the numeric `X-ClickHouse-Exception-Code` header to
distinguish `UNKNOWN_DATABASE`, `UNKNOWN_TABLE` and mapping errors without exposing
the raw response. A 404 without that header requires checking both the HTTP API
origin/proxy route and the database/table configuration.
**Save Configuration** does not ingest anything. **Fetch Data** becomes available
after saving and is disabled again when the form has unsaved changes.

## Collection Semantics

Fetch reads the newest 1-1000 rows (default 500) within a 1-168 hour lookback
(default 24 hours), ordered by source timestamp descending and alert ID ascending.
This is a bounded snapshot, not a full-table backfill, cursor or automatic poller.
A batch-limit warning means older eligible rows may not have been fetched;
repeating the same batch does not page through them.

Only mapped columns are selected and persisted. IDs are namespaced by integration,
database and table. Fetching the same ID again updates its existing Argus Alert;
different connectors cannot overwrite one another. Rows with missing/invalid IDs
or timestamps are skipped and reported as partial failures, not timestamped as now.
The source table should have one current row per stable alert ID.

Elasticsearch sync counts, ID repair, upserts and duplicate cleanup exclude records
marked as ClickHouse/Splunk, even when their `source_index` names match an ES index.
The ES cache-upsert path shares the same source filter as the main sync. ClickHouse
updates also require both its connector marker and the saved integration ID. An
identical internal alert ID and source name belonging to another connector or
integration are preserved; ingestion creates a separate record for its own source.
Existing ClickHouse source names and alert IDs remain unchanged; no historical data
migration or re-import is required for this isolation fix. Previously overwritten
records are not automatically restored and require separate review/re-ingestion.

On PostgreSQL, a nonblocking transaction-scoped advisory lock covers the entire
ClickHouse fetch and storage operation for each integration. Overlapping fetches
return HTTP `409` with code `fetch_in_progress` before querying upstream; retry
after the active fetch completes. Different integrations can still fetch in
parallel. The lock has no TTL and is released at transaction completion, including
rollback or connection termination. An in-process guard also blocks thread/reentrant
overlap; SQLite is used only for isolated tests, not cross-process deployment.
The operation keeps a PostgreSQL transaction/connection open while reading upstream.
Connection tests are unchanged and are not serialized by this fetch lock.

Records are written to the shared `alerts_alert` table and remain visible through
the normal alert list even with an active Elasticsearch index. They are not
included in the ELK or Splunk Monitoring platform filters. This change does not add
a ClickHouse Overview/Coverage platform, create tickets, or execute RBA/workflows.

## Security and Operations

- The existing connector HTTP policy applies, including DNS/IP validation,
  metadata/loopback blocking, DNS pinning and no redirects or ambient proxies.
  When `DEBUG=False`, add the intended ClickHouse hostname/IP/CIDR to
  `CONNECTOR_HTTP_ALLOWED_HOSTS` using your existing deployment environment config.
  Loopback and metadata addresses remain blocked even when listed.
- Queries use ClickHouse typed identifier/value parameters, fixed SELECT SQL and
  `readonly=1`. Limits include 20 seconds of query execution, 256 MiB server memory,
  8 MiB response size, 1 MiB per row and bounded HTTP timeouts. Upstream errors,
  late streaming exceptions or malformed JSON fail without ingesting partial data.
  Query settings must be permitted by the server-side read-only user's profile.
- Fetch requires `integrations.change_integration`, `alerts.add_alert` and
  `alerts.change_alert`. Connection tests require `integrations.change_integration`.
  Read-only profiles cannot execute either operation. Fetch outcomes audit only
  connector ID, status and counts, not connection credentials or source events.
- ClickHouse passwords are encrypted before persistence with a domain-separated
  key derived from Django's `SECRET_KEY`. Responses return `password_configured`,
  never the password/ciphertext. Blank password updates retain the saved value;
  changing host/user requires re-entry of an existing password. Keep the old Django
  key in `SECRET_KEY_FALLBACKS` during key rotation or re-enter connector passwords.
  Existing ES/Splunk credential storage is unchanged.
- No new package or database migration is needed. Rebuild backend/frontend images
  together. No external query, real database migration or deployment is part of the
  automated tests. Removing a connection does not delete previously collected alerts.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/v1/integrations/` | Save `type: "clickhouse"` and its config |
| PATCH | `/api/v1/integrations/{id}/` | Update saved connection/mappings |
| POST | `/api/v1/integrations/test_clickhouse` | Test unsaved config (no trailing slash) |
| POST | `/api/v1/integrations/{id}/test/` | Test using saved credentials, optionally overridden by `config` |
| POST | `/api/v1/integrations/{id}/fetch-data/` | Fetch with `{ "size": 500 }` |

The implementation uses ClickHouse's documented
[HTTP interface](https://clickhouse.com/docs/interfaces/http) and
[typed query parameters](https://clickhouse.com/docs/sql-reference/syntax#defining-and-using-query-parameters).
