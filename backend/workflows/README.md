# Workflow publication storage

Drafts live in `Workflow` and `WorkflowStep`. Published definitions live in
`WorkflowRevision`; `Workflow.published_revision` selects the current version.
Ordinary edits mark the draft dirty without changing a published snapshot.
Executions retain their original version, including after another publication.

The runtime entrypoint is `backend/workflows/prefect/flow.py:run_soar_workflow`.
Normal operation does not read, write, or create `workflows/flows`. The old
directory can be removed **after** its required versions have been imported and
verified. Fresh installations do not need it.

## Upgrade an existing installation

Use a workflows maintenance window: pause edits, imports, publications, new
executions and Prefect schedules; stop old workflows consumers and writers.
Do not rotate encryption keys during the cutover. Keep a complete database
backup, matching code revision, old encryption keys and a copy of the entire
old `flows` directory. Rehearse restoration and import against an isolated
database first.

From `backend`, with the original encryption keys configured:

```text
python manage.py migrate workflows
python manage.py migrate_workflow_manifests --source /absolute/path/to/old/generated
python manage.py migrate_workflow_manifests --source /absolute/path/to/old/generated --apply
python manage.py migrate_workflow_manifests --source /absolute/path/to/old/generated
```

The command requires an explicit source and defaults to a read-only preflight.
It verifies all versions, current pointers, encrypted configurations and
existing execution references before applying one database transaction. The
last command confirms an identical rerun has nothing left to import. Source
files are never rewritten or deleted.

Current pointers are preserved exactly; the highest version is not assumed
to be current. Orphan directories, invalid data, missing execution versions,
conflicting snapshots and conflicting current pointers fail the import. Do
not replace missing historical snapshots with drafts or republish to simulate
them. If orphan directories belong to previously deleted workflows, archive
them explicitly and prepare a separate migration source containing only the
approved workflows; the importer never silently skips them.

Start only the new database-backed services, then run:

```text
python manage.py sync_prefect_schedules
```

Verify exports and historical callbacks before resuming normal traffic and
schedules. If cutover fails, remain in maintenance and restore matching code,
database and source backups together; do not resume old file writers alongside
the new implementation.

## API and schedule behavior

Exports remain JSON downloads of the last published snapshot, including
ciphertext. Uploaded JSON remains an inactive draft and does not restore a
publication pointer. `manifest_ref` and `manifest_filename` are logical names;
the deprecated `manifest_path` field is an empty string.

Plans expose `sync_status` (`pending`, `synced`, `failed`), `synced_version`,
`last_error` and `last_synced_at` as read-only metadata. A publication, plan
change or pause/resume first commits the desired database state, then attempts
Prefect synchronization. An error response may therefore mean the plan was
saved but its remote synchronization failed. The error is persisted; retry
with `sync_prefect_schedules`, which also includes paused plans. Publication
success still includes `schedule_errors` when remote synchronization fails.
Deleting a plan retains the original behavior: delete remotely first and keep
the local plan when deletion fails.

The secrets migration command now covers all database revisions. Dry-run and
rotation options are unchanged; controlled re-encryption is the exception to
historical snapshot immutability. Already queued Prefect runs contain their
original ciphertext, so retain their decryption keys until they finish.

## Verification

The PostgreSQL test settings use the configured connection credentials but
create a separate `test_workflows_` database and disable the configured Prefect
endpoint. Run from `backend`:

```text
python manage.py test workflows.tests --settings=workflows.tests.settings --noinput
```

The suite exercises publication rollback/concurrency, immutable export,
historical callbacks, source migration and schedule synchronization failures.
`forbid_flows_access()` additionally rejects filesystem access to the old
directory. Directory removal must also pass the isolated integration smoke
check, including service restart, manual execution and scheduled execution,
before deleting the original source archive.

Run the real smoke check from the repository root:

```text
.venv/Scripts/python.exe backend/workflows/tests/smoke_without_flows.py
```

It creates a disposable database and a backend copy without the entire `flows`
directory, starts an independent local Prefect server and process worker,
restarts Django/the consumer/the worker, and checks manual and interval runs.
It removes only its own services and database. Failure logs remain in its
reported temporary directory; configured production services are untouched.
