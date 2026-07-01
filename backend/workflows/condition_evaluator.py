"""Shared condition evaluation helpers for workflow triggers and condition nodes."""
from __future__ import annotations

import re
from fnmatch import fnmatchcase
from typing import Any, Callable, Dict


Resolver = Callable[[str], Any]


def normalize_condition_field(field: str) -> str:
    field = (field or '').strip()
    if field.startswith('{{') and field.endswith('}}'):
        field = field[2:-2].strip()
    if field.startswith('trigger.data.'):
        field = 'trigger_data.' + field[len('trigger.data.'):]
    if field.startswith('trigger.data'):
        field = field.replace('trigger.data', 'trigger_data', 1)
    if field.startswith('context.'):
        field = field[len('context.'):]
    if field.startswith('previous_step.output.'):
        field = 'previous_step.output.' + field[len('previous_step.output.'):]
    return field


def coerce_number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def resolve_context_path(ctx: Dict[str, Any], path: str) -> Any:
    normalized_path = normalize_condition_field(path)
    aliases = [normalized_path]

    if normalized_path.startswith('ticket.'):
        aliases.append('trigger_data.' + normalized_path[len('ticket.'):])
    if normalized_path.startswith('workflow.'):
        aliases.append(normalized_path.replace('workflow.', '', 1))

    for alias in aliases:
        value: Any = ctx
        found = True
        for key in alias.split('.'):
            if isinstance(value, dict) and key in value:
                value = value.get(key)
            else:
                found = False
                break
        if found:
            return value
    return None


def evaluate_condition_rule(rule: Dict[str, Any], resolver: Resolver, ctx: Dict[str, Any] | None = None) -> bool:
    if not isinstance(rule, dict):
        return True
    field = normalize_condition_field(rule.get('field', ''))
    operator = rule.get('operator') or 'equals'
    compare_to = rule.get('value')
    if compare_to is None:
        compare_to = rule.get('compare_to')

    if isinstance(compare_to, str) and compare_to.startswith('{{') and compare_to.endswith('}}') and ctx is not None:
        resolved_compare_to = resolve_context_path(ctx, compare_to)
        if resolved_compare_to is not None:
            compare_to = resolved_compare_to

    if not field:
        return True

    value = resolver(field)

    if operator in ('equals', '=='):
        return value == compare_to
    if operator in ('not_equals', '!='):
        return value != compare_to
    if operator in ('contains',):
        return compare_to in str(value) if value is not None else False
    if operator in ('not_contains',):
        return compare_to not in str(value) if value is not None else True
    if operator in ('starts_with',):
        return str(value).startswith(str(compare_to)) if value is not None else False
    if operator in ('ends_with',):
        return str(value).endswith(str(compare_to)) if value is not None else False
    if operator in ('greater_than', '>'):
        left = coerce_number(value)
        right = coerce_number(compare_to)
        return left is not None and right is not None and left > right
    if operator in ('less_than', '<'):
        left = coerce_number(value)
        right = coerce_number(compare_to)
        return left is not None and right is not None and left < right
    if operator in ('greater_equal', '>='):
        left = coerce_number(value)
        right = coerce_number(compare_to)
        return left is not None and right is not None and left >= right
    if operator in ('less_equal', '<='):
        left = coerce_number(value)
        right = coerce_number(compare_to)
        return left is not None and right is not None and left <= right
    if operator == 'in_list':
        if compare_to is None:
            return False
        options = [item.strip() for item in str(compare_to).split(',') if item.strip()]
        return str(value) in options if value is not None else False
    if operator == 'not_in_list':
        if compare_to is None:
            return True
        options = [item.strip() for item in str(compare_to).split(',') if item.strip()]
        return str(value) not in options if value is not None else True
    if operator in ('is_empty',):
        return value is None or value == ''
    if operator in ('is_not_empty', 'not_empty'):
        return value is not None and value != ''
    if operator == 'matches_regex':
        if compare_to is None:
            return False
        try:
            return re.search(str(compare_to), str(value or '')) is not None
        except re.error:
            return False
    if operator == 'wildcard':
        return fnmatchcase(str(value or ''), str(compare_to or ''))

    return True


def evaluate_condition_object(condition: Dict[str, Any], resolver: Resolver, ctx: Dict[str, Any] | None = None) -> bool:
    if not condition or not isinstance(condition, dict):
        return True

    if condition.get('groups'):
        groups = condition.get('groups') or []
        logic = (condition.get('logic') or 'AND').upper()
        results = []
        for group in groups:
            rules = group.get('rules') or [] if isinstance(group, dict) else []
            group_logic = (group.get('logic') or 'AND').upper() if isinstance(group, dict) else 'AND'
            rule_results = [evaluate_condition_rule(rule, resolver, ctx) for rule in rules]
            results.append(all(rule_results) if group_logic == 'AND' else any(rule_results))
        return all(results) if logic == 'AND' else any(results)

    if condition.get('field'):
        return evaluate_condition_rule(condition, resolver, ctx)

    if condition.get('rules'):
        logic = (condition.get('logic') or 'AND').upper()
        rule_results = [evaluate_condition_rule(rule, resolver, ctx) for rule in condition.get('rules', [])]
        return all(rule_results) if logic == 'AND' else any(rule_results)

    return True


def extract_condition_fields(condition: Dict[str, Any]) -> list[str]:
    fields: list[str] = []
    if not isinstance(condition, dict):
        return fields

    if condition.get('field'):
        fields.append(normalize_condition_field(condition.get('field', '')))

    for rule in condition.get('rules', []) or []:
        if isinstance(rule, dict) and rule.get('field'):
            fields.append(normalize_condition_field(rule.get('field', '')))

    for group in condition.get('groups', []) or []:
        if not isinstance(group, dict):
            continue
        for rule in group.get('rules', []) or []:
            if isinstance(rule, dict) and rule.get('field'):
                fields.append(normalize_condition_field(rule.get('field', '')))

    return [field for field in fields if field]
