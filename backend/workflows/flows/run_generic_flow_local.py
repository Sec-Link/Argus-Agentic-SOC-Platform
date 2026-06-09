"""Local test harness for the generic Prefect flow.

This script runs the flow directly for quick validation without registering a
Prefect deployment. It is intended for developer verification only.
"""
from __future__ import annotations

from .generic_workflow_flow import run_soar_workflow


if __name__ == "__main__":
    payload = {
        "id": "demo-workflow",
        "name": "Demo Workflow",
        "steps": [
            {
                "id": "step-start",
                "order": 0,
                "name": "Start",
                "node_type": "start",
                "action_type": "",
                "action_config": {},
                "retry_count": 0,
            },
            {
                "id": "step-log",
                "order": 1,
                "name": "Log",
                "node_type": "action",
                "action_type": "log",
                "action_config": {"message": "Hello from Prefect flow"},
                "retry_count": 0,
            },
            {
                "id": "step-end",
                "order": 2,
                "name": "End",
                "node_type": "end",
                "action_type": "",
                "action_config": {},
                "retry_count": 0,
            },
        ],
    }

    result = run_soar_workflow(payload, execution_id="demo-exec", trigger_data={}, trigger_source="manual")
    print(result)

