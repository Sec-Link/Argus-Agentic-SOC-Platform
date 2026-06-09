# 2026-06-01 Workflows Prefect Refactor

## Summary

- Introduced Prefect task wrappers under `backend/workflows/tasks` to map workflow nodes to Prefect tasks.
- Added a generic Prefect flow under `backend/workflows/flows` to execute serialized workflow definitions.
- Condition nodes now execute a compute-only task; branching remains in the flow driver.
- Documented the new tasks/flows layout and added a local test harness.

## Files

- `backend/workflows/tasks/__init__.py`
- `backend/workflows/tasks/utils.py`
- `backend/workflows/tasks/utility.py`
- `backend/workflows/tasks/notification.py`
- `backend/workflows/tasks/ticketing.py`
- `backend/workflows/tasks/threat_intel.py`
- `backend/workflows/tasks/containment.py`
- `backend/workflows/tasks/release.py`
- `backend/workflows/tasks/condition.py`
- `backend/workflows/tasks/README.md`
- `backend/workflows/flows/__init__.py`
- `backend/workflows/flows/generic_workflow_flow.py`
- `backend/workflows/flows/run_generic_flow_local.py`
- `backend/workflows/flows/README.md`
- `backend/workflows/prefect_flow.py`
- `backend/workflows/engine.py`

## Updates

- Added Prefect deployment sync APIs in `backend/workflows/views.py`.
- Added Prefect deployment list/sync routes in `backend/workflows/urls.py`.
- Added Prefect deployment helpers in `backend/workflows/prefect_client.py`.
- Auto-create Prefect deployments on workflow save using entrypoint `backend/workflows/prefect_flow.py:run_soar_workflow` and name pattern `soar-{workflow_slug}`.
- Added Prefect flow/deployment creation helpers in `backend/workflows/prefect_client.py`.
