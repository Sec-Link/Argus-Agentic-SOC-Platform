# Monitoring Coverage Settings

Overview and Coverage Settings share the `platform=elk|splunk` URL parameter.
Switching tabs, following Coverage settings, and reloading retain the selected
platform. ELK is the default for existing links and API clients.

## Splunk setup

1. Save a Splunk alert collection integration (`splunk_search`). Scanning reuses
   its management API credentials and TLS settings, not a rule publisher token.
2. In Splunk Coverage Settings, an administrator selects Rescan, a saved
   integration, one to ten literal index names and a time range: 24 hours,
   48 hours, 7 days (default), or All time. No wildcard or arbitrary SPL
   is accepted. This selection is independent of the alert ingestion index and
   does not change ingestion configuration.
3. Classify sources using the same category cards, drag/drop, Configure drawer,
   bulk assignments, ignore/restore/reset, category CRUD and icon uploads as ELK.
   Advanced matchers accept an index or `index/sourcetype` wildcard pattern.
   For overlapping matchers, category sort order then name determines the first
   match. Manual assignments always take precedence.
   Test match has its own time range selector and runs a read-only query against
   the last selected integration and indices, without replacing the coverage
   snapshot. Clients that omit `time_range` retain the stored-preview behavior.
4. Configure optional CMDB asset types and a literal host field (`host` by
   default), then Rescan to refresh host coverage. Changing this configuration
   does not trigger a live search on every page visit.

Each successful scan replaces only that platform's snapshot. Scan scope is one
saved integration and its selected indices. Categories, mappings and snapshots
are independent between ELK and Splunk; the ATT&CK reference catalog is shared.

## Statistics and limits

- The read-only API is `POST /services/search/v2/jobs/export`, with the selected
  window and a server-generated `tstats` aggregation grouped by index/sourcetype.
  It does not retrieve raw events, write saved searches, ingest alerts, score
  risk, or create tickets. No new Splunk write permissions are needed.
- Results are capped at 300 sources. Truncation is displayed; sources outside
  the scan remain unknown, not evidence of complete coverage.
- Optional host evidence uses bounded `tstats` for the indexed `host` field and
  `search | stats` for custom search-time fields. At most five distinct host
  fields and 5,000 index/sourcetype/host rows per field are retained. Incomplete
  host results produce unavailable host coverage, not a misleading percentage.
  Host names are used internally for CMDB matching, not returned in responses.
- Existing connector allowlists, DNS checks, redirect rejection, TLS settings,
  response-size limits and request timeouts apply. Credentials are never sent
  to the browser by the scan target options endpoint.
- Successful snapshots record scan time, administrator, selected indices and
  time range. Source and CMDB host statistics use the same range. All time means
  epoch time through now, subject to the account's search access and retention;
  it measures historical activity, not the freshness of a current log feed.
  existing timeout and result-size limits still apply, so large searches may
  time out. The default remains 7 days. This time-range addition needs no new
  schema migration: `targets.time_range` stores the choice and `window_days=0`
  denotes All time for Splunk snapshots.
  Errors or upstream warnings preserve the previous good snapshot. GET requests
  do not automatically scan Splunk. Known sources that disappear within the
  same scan scope remain as silent sources; changing scope does not make an
  out-of-scope source appear healthy.
- Rule counts use published Splunk bindings. Live-data coverage additionally
  requires a matching connection origin, index and optional sourcetype, a source
  category and an enabled/synced publication for that target. A different enabled
  publication cannot borrow data from a disabled target. Different DNS aliases
  for the same physical Splunk instance are not assumed to be equivalent.
- These are snapshots, not continuous health checks. Review the displayed scan
  age before interpreting coverage as current.

## Deployment

Deploy the new backend schema before serving the updated frontend. Run the
normal Django migration command in the intended environment after backup:

```sh
python manage.py migrate dashboards
```

`0009_log_source_platform` marks all existing records as ELK without discarding
them, adds platform-scoped uniqueness and seeds seven independent Splunk
categories. New columns have backward-compatible defaults, but **old application
code does not filter by platform**. Do not keep old/new backend versions serving
traffic together after Splunk categories are seeded.

The data migration is deliberately not automatically reversible: independently
configured categories can share names across platforms. For rollback, restore
the pre-migration database backup together with the previous application, or
prepare a reviewed data migration; do not fake-unapply this migration. No real
database migration or deployment is performed by the development tests.
