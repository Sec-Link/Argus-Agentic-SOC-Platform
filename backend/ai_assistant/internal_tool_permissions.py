"""Resource permissions shared by internal tool entry points."""

from ai_assistant.models import SkillConfig


def _check_internal(user, name, arguments):
    required = []
    if name in {"ticket_context", "ticket_search_similar_cases"} or arguments.get("ticket_number"):
        required.append("tickets.view_eventticket")
    if name == "cmdb_asset_lookup":
        required.append("cmdb.view_asset")
    if name in {"list_knowledge_risk_types", "search_knowledge_base"}:
        required.append("ai_assistant.view_knowledgebaseitem")
    if not all(user.has_perm(perm) for perm in required):
        raise PermissionError("Your account does not have permission to read this resource.")
    if name == "read_skill" and not SkillConfig.objects.filter(name=arguments.get("skill_name"), enabled=True).exists():
        raise PermissionError("This skill is no longer enabled.")
