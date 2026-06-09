# Prefect Flows

This folder contains Prefect flows used by the SOAR workflow module.

## generic_workflow_flow.py

- `run_soar_workflow` executes a serialized workflow definition.
- Condition nodes are computed by a task and branching is handled by the flow.

## run_generic_flow_local.py

A minimal test harness for running the generic flow locally.

