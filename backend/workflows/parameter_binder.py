import json
from typing import Any

from django.core.exceptions import ValidationError


def bind_workflow_parameters(inputs_schema, user_inputs, ticket_data=None, context=None):
    if not inputs_schema:
        return dict(user_inputs or {})

    bound = {}
    errors = []
    user_inputs = user_inputs or {}
    ticket_data = ticket_data or {}
    context = context or {}

    for field_def in inputs_schema:
        if not isinstance(field_def, dict):
            errors.append('Each input schema item must be an object')
            continue

        field_name = str(field_def.get('name') or '').strip()
        if not field_name:
            errors.append('Input schema item is missing name')
            continue

        value = _resolve_value(field_name, field_def, user_inputs, ticket_data, context)
        if field_def.get('required') and value in (None, ''):
            errors.append(f"Required field '{field_name}' is missing")
            continue
        if value in (None, ''):
            continue

        try:
            value = _coerce_type(value, field_def.get('type', 'string'))
            _validate_enum(value, field_def)
            bound[field_name] = value
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            errors.append(f"Field '{field_name}': {exc}")

    if errors:
        raise ValidationError(errors)
    return bound


def _resolve_value(field_name, field_def, user_inputs, ticket_data, context):
    source = field_def.get('source', 'user')
    default_value = field_def.get('default')

    if source == 'ticket':
        return ticket_data.get(field_name, default_value)
    if source == 'context':
        return context.get(field_name, default_value)
    if source == 'static':
        return default_value
    return user_inputs.get(field_name, default_value)


def _coerce_type(value: Any, target_type: str):
    if target_type == 'string':
        return str(value)
    if target_type == 'integer':
        return int(value)
    if target_type == 'number':
        return float(value)
    if target_type == 'boolean':
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in ('true', '1', 'yes', 'y'):
                return True
            if normalized in ('false', '0', 'no', 'n'):
                return False
            raise ValueError('Invalid boolean value')
        return bool(value)
    if target_type == 'array':
        if isinstance(value, str):
            value = json.loads(value)
        if not isinstance(value, list):
            raise TypeError('Expected array')
        return value
    if target_type == 'object':
        if isinstance(value, str):
            value = json.loads(value)
        if not isinstance(value, dict):
            raise TypeError('Expected object')
        return value
    return value


def _validate_enum(value, field_def):
    enum_values = field_def.get('enum')
    if enum_values and value not in enum_values:
        raise ValueError(f"Value '{value}' not in allowed values: {enum_values}")
