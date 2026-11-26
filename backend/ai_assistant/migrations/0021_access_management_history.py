from itertools import batched

from django.db import migrations, transaction
from django.db.models import Q


OLD = "accounts.view_user"
STAFF = "accounts.staff_access_management"
ACCESS_PAGE = "/settings/permissions"
OTHER_PAGES = ("/settings/registration-approvals", "/settings/audit-logs", "/settings/system")


def rewrite_calls(rows, requirements):
    for batch in batched(rows.only("pk", "request_id", "detail_permissions").iterator(), 200):
        changed = []
        for row in batch:
            tags = set(row.detail_permissions)
            updated = requirements(row.request_id, tags)
            if updated != tags:
                row.detail_permissions = sorted(updated)
                changed.append(row)
        if changed:
            rows.bulk_update(changed, ["detail_permissions"])


def migrate_paths(apps, schema_editor):
    alias = schema_editor.connection.alias
    chats = apps.get_model("ai_assistant", "PageChatConversation").objects.using(alias)
    turns = apps.get_model("ai_assistant", "PageChatTurn").objects.using(alias)
    call_tables = [apps.get_model("ai_assistant", name).objects.using(alias)
                   for name in ("ModelUsage", "MCPToolExecution")]
    affected = turns.filter(Q(page_context__path=ACCESS_PAGE) |
                            Q(page_context__path__startswith=ACCESS_PAGE + "/")).values("conversation_id")
    for pk in chats.filter(pk__in=affected).values_list("pk", flat=True).iterator():
        with transaction.atomic(using=alias):
            chat = chats.select_for_update().filter(pk=pk).first()
            if chat is None:
                continue
            page_tags = set()
            per_request = {}
            for request_id, path in turns.filter(conversation_id=pk).order_by("sequence").values_list(
                "request_id", "page_context__path",
            ):
                if isinstance(path, str):
                    if path == ACCESS_PAGE or path.startswith(ACCESS_PAGE + "/"):
                        page_tags.add(STAFF)
                    if any(path == page or path.startswith(page + "/") for page in OTHER_PAGES):
                        page_tags.add(OLD)
                per_request[request_id] = page_tags.copy()
            if STAFF not in page_tags:
                continue
            tags = set(chat.required_permissions)
            updated = (tags - {OLD}) | page_tags
            if updated != tags:
                chats.filter(pk=pk).update(required_permissions=sorted(updated))

            # Each call may contain the evidence from all turns up to its own request.
            def call_tags(request_id, tags):
                if request_id not in per_request:
                    return tags | page_tags
                return (tags - {OLD}) | per_request[request_id]

            for table in call_tables:
                rewrite_calls(table.filter(conversation_id=pk), call_tags)

    # Deleted conversations have no trustworthy path. Preserve the old restriction
    # and also require staff when the old tag could refer to Access Management.
    for table in call_tables:
        orphans = table.filter(source="page_chat", conversation_id=None).exclude(detail_permissions=[])
        rewrite_calls(orphans, lambda _, tags: tags | {STAFF} if OLD in tags else tags)


def restore_old_tag(apps, schema_editor):
    alias = schema_editor.connection.alias
    chats = apps.get_model("ai_assistant", "PageChatConversation").objects.using(alias)
    for pk, tags in chats.exclude(required_permissions=[]).values_list("pk", "required_permissions").iterator():
        if STAFF in tags:
            chats.filter(pk=pk).update(required_permissions=sorted((set(tags) - {STAFF}) | {OLD}))
    for name in ("ModelUsage", "MCPToolExecution"):
        rows = apps.get_model("ai_assistant", name).objects.using(alias).exclude(detail_permissions=[])
        rewrite_calls(rows, lambda _, tags: (tags - {STAFF}) | {OLD} if STAFF in tags else tags)


class Migration(migrations.Migration):
    atomic = False
    dependencies = [("ai_assistant", "0020_ai_resource_use_roles")]
    operations = [migrations.RunPython(migrate_paths, restore_old_tag)]
