"""
Generic Prefect flow for dynamic SOAR workflows.

This flow is the execution backbone for the shared Deployment strategy. It
accepts a serialized workflow definition and executes nodes in order, while
condition nodes are evaluated by a compute-only task and branching is driven
by the flow itself.
"""
from __future__ import annotations

from typing import Any, Dict, List

from prefect import flow, get_run_logger

from workflows.tasks import (
    block_ip_task,
    condition_task,
    create_ticket_task,
    delay_task,
    disable_user_task,
    enable_user_task,
    hash_lookup_task,
    ip_lookup_task,
    log_task,
    release_ip_task,
    send_email_task,
    send_webhook_task,
    update_ticket_task,
)


ACTION_TASKS = {
    "log": log_task,
    "delay": delay_task,
    "send_email": send_email_task,
    "send_webhook": send_webhook_task,
    "create_ticket": create_ticket_task,
    "update_ticket": update_ticket_task,
    "ip_lookup": ip_lookup_task,
    "hash_lookup": hash_lookup_task,
    "block_ip": block_ip_task,
    "disable_user": disable_user_task,
    "release_ip": release_ip_task,
    "enable_user": enable_user_task,
}


def _next_by_order(ordered_steps: List[Dict[str, Any]], order_index: Dict[str, int], step_id: str) -> str | None:
    idx = order_index.get(step_id)
    if idx is None:
        return None
    if idx + 1 < len(ordered_steps):
        return str(ordered_steps[idx + 1].get("id"))
    return None


def _next_step_id(
    ordered_steps: List[Dict[str, Any]],
    order_index: Dict[str, int],
    step: Dict[str, Any],
    condition_result: bool | None = None,
) -> str | None:
    if step.get("node_type") == "condition":
        if condition_result is True and step.get("next_step_true"):
            return str(step.get("next_step_true"))
        if condition_result is False and step.get("next_step_false"):
            return str(step.get("next_step_false"))
    connections = step.get("connections") or []
    if connections:
        return str(connections[0])
    return _next_by_order(ordered_steps, order_index, str(step.get("id")))


@flow(name="soar-generic")
def run_soar_workflow(
    workflow_definition: Dict[str, Any],
    execution_id: str,
    trigger_data: Dict[str, Any] | None = None,
    trigger_source: str = "manual",
) -> Dict[str, Any]:
    """Execute a serialized workflow definition in Prefect."""
    logger = get_run_logger()
    logger.info(
        "Running SOAR workflow %s (execution %s)",
        workflow_definition.get("name"),
        execution_id,
    )

    context: Dict[str, Any] = {
        "trigger_data": trigger_data or {},
        "trigger_source": trigger_source,
        "execution_id": execution_id,
        "workflow_id": workflow_definition.get("id"),
        "workflow_name": workflow_definition.get("name"),
        "variables": {},
        "step_results": {},
    }

    steps = list(workflow_definition.get("steps", []) or [])
    if not steps:
        return {
            "execution_id": execution_id,
            "status": "completed",
            "step_results": [],
        }

    steps_by_id = {str(step.get("id")): step for step in steps if step.get("id")}
    ordered_steps = sorted(steps, key=lambda s: s.get("order", 0))
    order_index = {str(step.get("id")): idx for idx, step in enumerate(ordered_steps) if step.get("id")}

    start_step = next((s for s in ordered_steps if s.get("node_type") == "start"), None)
    current_step_id = str(start_step.get("id")) if start_step and start_step.get("id") else str(ordered_steps[0].get("id"))

    results: List[Dict[str, Any]] = []
    max_iterations = max(len(ordered_steps) * 5, 1)
    iterations = 0

    while current_step_id:
        iterations += 1
        if iterations > max_iterations:
            return {
                "execution_id": execution_id,
                "status": "failed",
                "step_results": results,
                "error": "Workflow exceeded max iteration limit; possible loop in graph.",
            }

        step = steps_by_id.get(str(current_step_id))
        if not step:
            break

        node_type = step.get("node_type")
        if node_type in ("start", "end"):
            results.append(
                {
                    "step_id": step.get("id"),
                    "status": "skipped",
                    "attempt_number": 1,
                    "input_data": {},
                    "output_data": {},
                    "error_message": "",
                    "logs": f"skipped {node_type} node",
                }
            )
            if node_type == "end":
                break
            current_step_id = _next_step_id(ordered_steps, order_index, step)
            continue

        if node_type == "condition":
            try:
                condition_output = condition_task(step.get("condition") or {}, context)
                condition_result = bool(condition_output.get("result"))
                step_result = {
                    "step_id": step.get("id"),
                    "status": "completed",
                    "attempt_number": 1,
                    "input_data": step.get("condition") or {},
                    "output_data": condition_output.get("details") or {"condition_matched": condition_result},
                    "error_message": "",
                    "logs": f"Condition evaluated: {condition_result}",
                }
            except Exception as exc:
                condition_result = False
                step_result = {
                    "step_id": step.get("id"),
                    "status": "failed",
                    "attempt_number": 1,
                    "input_data": step.get("condition") or {},
                    "output_data": {},
                    "error_message": str(exc),
                    "logs": f"Condition evaluation failed: {exc}",
                }

            results.append(step_result)
            context["step_results"][step.get("id")] = step_result.get("output_data") or {}
            if step_result.get("status") == "failed" and step.get("on_failure") == "stop":
                return {
                    "execution_id": execution_id,
                    "status": "failed",
                    "step_results": results,
                }

            current_step_id = _next_step_id(ordered_steps, order_index, step, condition_result=condition_result)
            continue

        action_type = step.get("action_type")
        action_task = ACTION_TASKS.get(action_type)
        if not action_task:
            results.append(
                {
                    "step_id": step.get("id"),
                    "status": "failed",
                    "attempt_number": 1,
                    "input_data": step.get("action_config") or {},
                    "output_data": {},
                    "error_message": f"Unknown action type: {action_type}",
                    "logs": "No task mapped for action type",
                }
            )
            if step.get("on_failure") == "stop":
                return {
                    "execution_id": execution_id,
                    "status": "failed",
                    "step_results": results,
                }
            current_step_id = _next_step_id(ordered_steps, order_index, step)
            continue

        retry_count = int(step.get("retry_count") or 0)
        attempt = 1
        action_result = action_task(step.get("action_config") or {}, context)
        while not bool(action_result.get("success", True)) and attempt <= retry_count:
            attempt += 1
            action_result = action_task(step.get("action_config") or {}, context)

        results.append(
            {
                "step_id": step.get("id"),
                "status": "completed" if bool(action_result.get("success", True)) else "failed",
                "attempt_number": attempt,
                "input_data": step.get("action_config") or {},
                "output_data": action_result.get("data", {}) if isinstance(action_result, dict) else {},
                "error_message": action_result.get("error", "") if isinstance(action_result, dict) else "",
                "logs": action_result.get("logs", "") if isinstance(action_result, dict) else "",
            }
        )
        context["step_results"][step.get("id")] = action_result.get("data", {}) if isinstance(action_result, dict) else {}
        context["variables"].update(action_result.get("data", {}) if isinstance(action_result, dict) else {})

        if action_result.get("success") is False and step.get("on_failure") == "stop":
            return {
                "execution_id": execution_id,
                "status": "failed",
                "step_results": results,
            }

        current_step_id = _next_step_id(ordered_steps, order_index, step)

    return {
        "execution_id": execution_id,
        "status": "completed",
        "step_results": results,
    }

