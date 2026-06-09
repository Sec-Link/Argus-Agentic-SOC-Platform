"""Condition task used for computing boolean results only."""
from __future__ import annotations

from typing import Dict

from prefect import task

from ..condition_evaluator import evaluate_condition_object, resolve_context_path


@task(name="condition")
def condition_task(condition: Dict[str, object], context: Dict[str, object]) -> Dict[str, object]:
    """Compute a boolean condition result for the flow driver."""
    ctx = context or {}
    matched = evaluate_condition_object(condition or {}, lambda path: resolve_context_path(ctx, path), ctx)
    return {
        "result": matched,
        "details": {"condition_matched": matched},
    }
