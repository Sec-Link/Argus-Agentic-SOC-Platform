"""Persist a skill read against the configuration and document that authorized it."""

SKILL_PREFIX = "skill:"
UNKNOWN_SKILL = SKILL_PREFIX + "unresolved"


def skill_permission(config_id, name):
    return f"{SKILL_PREFIX}{config_id}:{name}"


def is_skill_read(event):
    return (isinstance(event, dict) and event.get("type") == "tool_result"
            and event.get("success") is True and event.get("tool") == "read_skill"
            and event.get("source") in (None, "internal"))


def trace_skill_permissions(trace):
    if not isinstance(trace, list):
        return set()
    markers = set()
    for event in trace:
        if is_skill_read(event):
            marker = event.get("skill_access")
            markers.add(marker if isinstance(marker, str) and marker.startswith(SKILL_PREFIX) else UNKNOWN_SKILL)
    return markers


def granted_skill_permissions(user, required):
    from .models import SkillConfig
    from .tool_access import allowed_tools

    if not required:
        return set()
    # A renamed configuration and a new configuration reusing a name cannot stand in for the original.
    names = [marker.rsplit(":", 1)[-1] for marker in required]
    rows = allowed_tools(SkillConfig.objects.filter(name__in=names), user).values_list("pk", "name")
    return {skill_permission(pk, name) for pk, name in rows}
