"""Condition task used for computing boolean results only.

The flow driver decides which branch to take based on the returned result.
"""
from __future__ import annotations

import re
from fnmatch import fnmatchcase
from typing import Any, Dict

from prefect import task


def _normalize_condition_field(field: str) -> str:
    field = (field or "").strip()
    if field.startswith("{{") and field.endswith("}}"):
        field = field[2:-2].strip()
    if field.startswith("trigger.data."):
        field = "trigger_data." + field[len("trigger.data.") :]
    if field.startswith("trigger.data"):
        field = field.replace("trigger.data", "trigger_data", 1)
    return field


def _coerce_number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _resolve_context_path(ctx: Dict[str, Any], path: str) -> Any:
    value: Any = ctx
    for key in _normalize_condition_field(path).split("."):
        if isinstance(value, dict):
            value = value.get(key)
        else:
            return None
    return value


def _evaluate_condition_rule(rule: Dict[str, Any], ctx: Dict[str, Any]) -> bool:
    if not isinstance(rule, dict):
        return True
    field = _normalize_condition_field(rule.get("field", ""))
    operator = rule.get("operator") or "equals"
    compare_to = rule.get("value")
    if compare_to is None:
        compare_to = rule.get("compare_to")

    if not field:
        return True

    value = _resolve_context_path(ctx, field)

    if operator in ("equals", "=="):
        return value == compare_to
    if operator in ("not_equals", "!="):
        return value != compare_to
    if operator in ("contains",):
        return compare_to in str(value) if value is not None else False
    if operator in ("not_contains",):
        return compare_to not in str(value) if value is not None else True
    if operator in ("starts_with",):
        return str(value).startswith(str(compare_to)) if value is not None else False
    if operator in ("ends_with",):
        return str(value).endswith(str(compare_to)) if value is not None else False
    if operator in ("greater_than", ">"):
        left = _coerce_number(value)
        right = _coerce_number(compare_to)
        return left is not None and right is not None and left > right
    if operator in ("less_than", "<"):
        left = _coerce_number(value)
        right = _coerce_number(compare_to)
        return left is not None and right is not None and left < right
    if operator in ("greater_equal", ">="):
        left = _coerce_number(value)
        right = _coerce_number(compare_to)
        return left is not None and right is not None and left >= right
    if operator in ("less_equal", "<="):
        left = _coerce_number(value)
        right = _coerce_number(compare_to)
        return left is not None and right is not None and left <= right
    if operator == "in_list":
        if compare_to is None:
            return False
        options = [item.strip() for item in str(compare_to).split(",") if item.strip()]
        return str(value) in options if value is not None else False
    if operator == "not_in_list":
        if compare_to is None:
            return True
        options = [item.strip() for item in str(compare_to).split(",") if item.strip()]
        return str(value) not in options if value is not None else True
    if operator in ("is_empty",):
        return value is None or value == ""
    if operator in ("is_not_empty", "not_empty"):
        return value is not None and value != ""
    if operator == "matches_regex":
        if compare_to is None:
            return False
        try:
            return re.search(str(compare_to), str(value or "")) is not None
        except re.error:
            return False
    if operator == "wildcard":
        return fnmatchcase(str(value or ""), str(compare_to or ""))

    return True


def _evaluate_condition_object(condition: Dict[str, Any], ctx: Dict[str, Any]) -> bool:
    if not condition or not isinstance(condition, dict):
        return True

    if condition.get("groups"):
        groups = condition.get("groups") or []
        logic = (condition.get("logic") or "AND").upper()
        results = []
        for group in groups:
            rules = group.get("rules") or [] if isinstance(group, dict) else []
            group_logic = (group.get("logic") or "AND").upper() if isinstance(group, dict) else "AND"
            rule_results = [_evaluate_condition_rule(rule, ctx) for rule in rules]
            results.append(all(rule_results) if group_logic == "AND" else any(rule_results))
        return all(results) if logic == "AND" else any(results)

    if condition.get("field"):
        return _evaluate_condition_rule(condition, ctx)

    if condition.get("rules"):
        logic = (condition.get("logic") or "AND").upper()
        rule_results = [_evaluate_condition_rule(rule, ctx) for rule in condition.get("rules", [])]
        return all(rule_results) if logic == "AND" else any(rule_results)

    return True


@task(name="condition")
def condition_task(condition: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """Compute a boolean condition result for the flow driver."""
    ctx = context or {}
    matched = _evaluate_condition_object(condition or {}, ctx)
    return {
        "result": matched,
        "details": {"condition_matched": matched},
    }

