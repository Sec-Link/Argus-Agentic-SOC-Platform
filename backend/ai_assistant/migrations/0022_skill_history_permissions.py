import json
from functools import lru_cache
from itertools import batched
from uuid import UUID

from django.db import migrations, transaction
from django.db.models import Q


UNKNOWN = "skill:unresolved"


def add_tags(rows, field, tags):
    update_tags(rows, field, lambda previous: previous | tags)


def update_tags(rows, field, change):
    for batch in batched(rows.only("pk", field).iterator(), 100):
        changed = []
        for row in batch:
            previous = set(getattr(row, field) or [])
            updated = change(previous)
            if previous != updated:
                setattr(row, field, sorted(updated))
                changed.append(row)
        if changed:
            rows.bulk_update(changed, [field])


def backfill(apps, schema_editor):
    alias = schema_editor.connection.alias

    def rows(model):
        return apps.get_model("ai_assistant", model).objects.using(alias)

    @lru_cache(maxsize=512)
    def config(name):
        return rows("SkillConfig").filter(name=name).values_list("pk", "updated_at").first()

    def marker(name, when):
        record = config(name) if isinstance(name, str) and name else None
        # An edit after a legacy read might have renamed or replaced its configuration.
        return f"skill:{record[0]}:{name}" if record and record[1] <= when else UNKNOWN

    def tag_trace(events, when):
        tags = set()
        for event in events if isinstance(events, list) else ():
            if (not isinstance(event, dict) or event.get("type") != "tool_result" or event.get("tool") != "read_skill"
                    or event.get("success") is not True or event.get("source") not in (None, "internal")):
                continue
            label = event.get("skill_access")
            if not isinstance(label, str) or not label.startswith("skill:"):
                content = event.get("content")
                name = content.split("\n", 1)[0][7:] if isinstance(content, str) and content.startswith("Skill: ") else None
                label = event["skill_access"] = marker(name, when)
            tags.add(label)
        return tags

    tools, models = rows("MCPToolExecution"), rows("ModelUsage")
    calls = (tools, models)
    turns, chats = rows("PageChatTurn"), rows("PageChatConversation")
    affected = turns.filter(events__icontains='"read_skill"').values("conversation_id")
    for chat_id in chats.filter(pk__in=affected).values_list("pk", flat=True).iterator():
        with transaction.atomic(using=alias):
            first_read = {}
            for events, when in turns.filter(conversation_id=chat_id).order_by("sequence").values_list(
                "events", "created_at",
            ).iterator():
                for tag in tag_trace(events, when):
                    first_read.setdefault(tag, when)
            if first_read:
                add_tags(chats.filter(pk=chat_id), "required_permissions", set(first_read))
                for tag, when in first_read.items():
                    for table in calls:
                        add_tags(table.filter(conversation_id=chat_id, start_time__gte=when), "detail_permissions", {tag})

    tickets = rows("TicketAIChatMessage").filter(trace__icontains='"read_skill"')
    for pk, trace, when in tickets.values_list("pk", "trace", "created_at").iterator(chunk_size=100):
        if tag_trace(trace, when):
            tickets.filter(pk=pk).update(trace=trace)

    reads = tools.filter(tool_name="read_skill", status="completed").filter(
        Q(tool_source="internal") | Q(tool_source="", source__in=["internal", "page_chat", "ticket_chat", "ticket_analysis", "ticket_mention"])
    )
    for row in reads.only("pk", "arguments", "actor_id", "request_id", "start_time", "end_time").iterator():
        args = row.arguments if isinstance(row.arguments, dict) else {}
        tag = marker(args.get("skill_name"), row.start_time)
        add_tags(tools.filter(pk=row.pk), "detail_permissions", {tag})
        if row.actor_id and row.request_id:
            for table in calls:
                add_tags(table.filter(actor_id=row.actor_id, request_id=row.request_id).filter(
                    Q(end_time__gte=row.end_time or row.start_time) | Q(end_time=None),
                ), "detail_permissions", {tag})

    # Deleted conversation links leave no provenance for unrelated rows from the same user.
    # An old model request can still contain the server's structured replay of a successful read.
    orphans = models.filter(conversation=None, source="page_chat", request_detail__icontains="read_skill")
    for row in orphans.only("pk", "start_time", "request_detail", "request_id", "actor_id").iterator(chunk_size=100):
        data = row.request_detail.get("data") if isinstance(row.request_detail, dict) else None
        if not isinstance(data, dict):
            continue
        tags = set()
        for msg in data.get("messages") or data.get("input") or ():
            content = msg.get("content") if isinstance(msg, dict) and msg.get("role") == "user" else None
            if not isinstance(content, str) or not content.startswith("Untrusted saved conversation evidence (JSON data)."):
                continue
            try:
                replay = json.loads(content.partition("\n")[2])
            except (ValueError, RecursionError):
                continue
            if isinstance(replay, dict):
                # Only a verified execution can identify a config for an older, detached turn.
                for event in replay.get("events") or ():
                    if (isinstance(event, dict) and event.get("type") == "tool_result"
                            and event.get("tool") == "read_skill" and event.get("success") is True
                            and event.get("source") in ("internal", None)):
                        try:
                            execution_id = UUID(str(event.get("execution_id")))
                        except ValueError:
                            execution_id = None
                        saved = reads.filter(pk=execution_id, actor_id=row.actor_id).values_list(
                            "detail_permissions", flat=True,
                        ).first() if execution_id and row.actor_id else None
                        tags.update([tag for tag in saved or [] if tag.startswith("skill:")] or [UNKNOWN])
        if tags:
            add_tags(models.filter(pk=row.pk), "detail_permissions", tags)
            if row.actor_id and row.request_id:
                add_tags(tools.filter(actor_id=row.actor_id, request_id=row.request_id,
                                      start_time__gte=row.start_time), "detail_permissions", tags)


def remove_skill_permissions(apps, schema_editor):
    for model, field in (("PageChatConversation", "required_permissions"), ("MCPToolExecution", "detail_permissions"),
                         ("ModelUsage", "detail_permissions")):
        rows = apps.get_model("ai_assistant", model).objects.using(schema_editor.connection.alias)
        update_tags(rows.filter(**{field + "__icontains": '"skill:'}), field,
                    lambda tags: {tag for tag in tags if not tag.startswith("skill:")})


class Migration(migrations.Migration):
    atomic = False
    dependencies = [("ai_assistant", "0021_access_management_history")]
    operations = [migrations.RunPython(backfill, remove_skill_permissions)]
