"""Session-scoped result contracts and deterministic orchestration gates.

Dialogue is not evidence or completion. Tools validate references against this
session and bind decisions to the exact persisted result version they consumed.
"""
import hashlib
import json
import uuid

from django.db import transaction
from jsonschema import validate, ValidationError
from langchain_core.tools import StructuredTool, ToolException

from .models import TicketInvestigationRun
from .ticket_investigation_runtime import event


TEXT = {"type": "string", "minLength": 1, "maxLength": 8000}
IDS = {"type": "array", "maxItems": 100, "uniqueItems": True, "items": {"type": "string", "maxLength": 160}}
STRINGS = {"type": "array", "maxItems": 50, "items": {"type": "string", "minLength": 1, "maxLength": 2000}}
WORKER_RESULT = {"type": "object", "additionalProperties": False, "properties": {
    "outcome": {"type": "string", "enum": ["answered", "blocked", "exhausted"]},
    "conclusion": TEXT, "completed": TEXT, "remaining": {"type": "string", "maxLength": 4000},
    "stop_reason": {"type": "string", "enum": ["answered", "evidence_unavailable", "execution_error", "budget"]},
    "next_operation": {"type": "string", "maxLength": 4000}, "receipt_ids": IDS, "limitations": STRINGS,
}, "required": ["outcome", "conclusion", "completed", "remaining", "stop_reason", "next_operation", "receipt_ids", "limitations"]}
FINDING = {"type": "object", "additionalProperties": False, "properties": {
    "claim": TEXT, "receipt_ids": IDS, "limitations": STRINGS,
}, "required": ["claim", "receipt_ids", "limitations"]}
PLAN_ROW = {"type": "object", "additionalProperties": False, "properties": {
    "priority": {"type": "string", "enum": ["P1", "P2", "P3"]},
    "capability": {"type": "string", "maxLength": 1000},
    "reason": {"type": "string", "minLength": 1, "maxLength": 4000},
    "start_condition": {"type": "string", "minLength": 1, "maxLength": 4000},
    "artifacts": {"type": "array", "maxItems": 50, "items": {"type": "string", "minLength": 1, "maxLength": 500}},
    "expected_output": {"type": "string", "minLength": 1, "maxLength": 4000},
    "round_number": {"type": "integer", "minimum": 1},
}, "required": ["priority", "capability", "reason", "start_condition", "artifacts", "expected_output", "round_number"]}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def pending_results(session):
    return [row for row in session.runs.filter(role="worker").order_by("created_at", "id")
            if row.result and row.synthesis.get("result_hash") != digest(row.result)]


def findings(session):
    return [item for run in session.runs.filter(role="worker").order_by("created_at", "id")
            if run.result and run.synthesis.get("result_hash") == digest(run.result)
            for item in run.synthesis.get("findings", [])]


def snapshot(session):
    runs = list(session.runs.filter(role="worker").order_by("created_at", "id"))
    return {
        "goals": list(session.goals.order_by("id").values("id", "title", "acceptance_criteria", "status", "evidence_summary")),
        "workers": [{"id": str(row.id), "title": row.title, "objective": row.objective,
                     "status": row.status, "result": row.result, "synthesis": row.synthesis} for row in runs],
        "findings": findings(session),
    }


def evidence_fingerprint(session):
    # UUID goal IDs are serialized identically for all callers.
    return hashlib.sha256(json.dumps(snapshot(session), sort_keys=True, default=str).encode()).hexdigest()


def checked_receipts(session, ids, *, worker=None, successful=False):
    rows = session.tool_receipts.filter(id__in=ids)
    if worker is not None:
        rows = rows.filter(run=worker)
    if successful:
        # Bookkeeping and knowledge lookup cannot establish incident evidence.
        rows = rows.filter(status="completed").exclude(tool_name__in=[
            "search_knowledge_base", "list_knowledge_risk_types", "resolve_worker_result",
            "read_investigation_record", "read_investigation_receipt",
        ])
    if rows.count() != len(set(ids)):
        raise ToolException("Use exact saved receipt IDs from this session; a Finding needs successful evidence receipts.")
    return rows


def tool(name, description, properties, required, handler):
    schema = {"type": "object", "additionalProperties": False, "properties": properties, "required": required}

    def invoke(**kwargs):
        try:
            validate(kwargs, schema)
            return handler(**kwargs)
        except (ValidationError, ValueError, TypeError) as exc:
            raise ToolException("Invalid investigation contract: " + str(exc)[:500]) from None

    return StructuredTool(name=name, description=description, args_schema=schema, func=invoke,
                          metadata={"source": "internal", "tool_name": name}, handle_tool_error=True)


def readers(run, read_receipt_ids=None):
    session = run.session

    def read_record(run_id):
        try:
            row = session.runs.get(id=uuid.UUID(run_id))
        except (ValueError, TicketInvestigationRun.DoesNotExist):
            raise ToolException("Choose a run in this investigation session.") from None
        return {"id": str(row.id), "role": row.role, "status": row.status, "objective": row.objective,
                "result": row.result, "synthesis": row.synthesis,
                "messages": list(row.messages.order_by("created_at", "id").values("id", "role", "content")[:100]),
                "receipts": list(session.tool_receipts.filter(run=row).values("id", "tool_name", "status"))}

    def read_receipt(receipt_id):
        try:
            row = session.tool_receipts.get(id=uuid.UUID(receipt_id))
        except (ValueError, session.tool_receipts.model.DoesNotExist):
            raise ToolException("Choose a receipt in this investigation session.") from None
        if read_receipt_ids is not None:
            read_receipt_ids.add(str(row.id))
        return {"id": str(row.id), "tool": row.tool_name, "status": row.status,
                "arguments": row.arguments, "result_preview": row.result_preview,
                "execution_id": row.execution_id, "preview_only": True}

    return [tool("read_investigation_record", "Read saved role results and dialogue directly from this session. No knowledge-base lookup is needed.",
                 {"run_id": {"type": "string"}}, ["run_id"], read_record),
            tool("read_investigation_receipt", "Read a saved evidence receipt preview. A truncated preview is not full-source inspection.",
                 {"receipt_id": {"type": "string"}}, ["receipt_id"], read_receipt)]


def worker_settlement_tools(run, actor):
    def settle(result):
        validate(result, WORKER_RESULT)
        checked_receipts(run.session, result["receipt_ids"])
        if result["outcome"] == "answered":
            if result["remaining"].strip() or result["stop_reason"] != "answered":
                raise ToolException("Answered work must have no remaining work and stop_reason=answered.")
            if not result["receipt_ids"]:
                raise ToolException("An answered investigation needs saved evidence receipts; otherwise preserve the gap.")
            checked_receipts(run.session, result["receipt_ids"], successful=True)
        elif not result["remaining"].strip() or not result["next_operation"].strip() or not result["limitations"]:
            raise ToolException("Unfinished work needs remaining scope, next operation and explicit limitations.")
        if result["outcome"] == "exhausted" and result["stop_reason"] != "budget":
            raise ToolException("Exhausted means the execution budget ended; record stop_reason=budget.")
        if result["outcome"] == "blocked" and result["stop_reason"] not in {"evidence_unavailable", "execution_error"}:
            raise ToolException("Blocked requires an actual source gap or execution error.")
        with transaction.atomic():
            current = TicketInvestigationRun.objects.select_for_update().get(id=run.id, session=run.session)
            if current.status in {"paused", "cancelled"}:
                raise ToolException("This Worker is paused or cancelled.")
            current.result = result
            current.synthesis = {key: current.synthesis[key] for key in ("assignment", "plan") if key in current.synthesis}
            current.save(update_fields=["result", "synthesis", "updated_at"])
            event(session=run.session, run=current, event_type="worker_result_saved", title="Structured Worker result saved", payload=result)
        return {"saved": True, "outcome": result["outcome"]}

    return [tool("resolve_worker_result", "Save the actual answer or an honest blocked/exhausted handoff from the saved response and receipts. Never invent evidence. Required before this Worker can settle.",
                 {"result": WORKER_RESULT}, ["result"], settle)]


def planner_contract_tools(run, actor):
    def synthesize(worker_id, reason, findings):
        worker = run.session.runs.filter(id=uuid.UUID(worker_id), role="worker", parent=run).first()
        if worker is None or not worker.result:
            raise ToolException("Choose a Worker with a saved structured result under this Planner.")
        for item in findings:
            if not item["receipt_ids"] or not set(item["receipt_ids"]) <= set(worker.result.get("receipt_ids", [])):
                raise ToolException("A Finding must cite evidence from this Worker's result. Use findings=[] for unsupported answers.")
            checked_receipts(run.session, item["receipt_ids"], successful=True)
        value = {"result_hash": digest(worker.result), "reason": reason,
                 "findings": [{**item, "id": str(uuid.uuid4()), "worker_id": str(worker.id)} for item in findings]}
        with transaction.atomic():
            current = TicketInvestigationRun.objects.select_for_update().get(id=worker.id)
            if digest(current.result) != value["result_hash"]:
                raise ToolException("Worker result changed; reread it.")
            if current.synthesis.get("result_hash") == value["result_hash"]:
                return {"consumed": True, "already_recorded": True}
            current.synthesis = {**value, **{key: current.synthesis[key] for key in ("assignment", "plan") if key in current.synthesis}}
            current.save(update_fields=["synthesis", "updated_at"])
            event(session=run.session, run=run, event_type="worker_result_consumed", title="Planner consumed Worker result",
                  payload={"worker_id": str(worker.id), **value})
        return {"consumed": True, **value}

    def decide(action, reason, required_material):
        if pending_results(run.session):
            raise ToolException("Consume all pending Worker results before deciding or creating more work.")
        active = run.session.runs.filter(role="worker", status__in=["open", "running", "paused"]).exists()
        if action != "continue_investigation" and active:
            raise ToolException("Finish or explicitly cancel queued/running/paused work before final reporting or waiting for input.")
        if action == "wait_for_input" and not required_material.strip():
            raise ToolException("Name the exact missing user-held material.")
        value = {"action": action, "reason": reason, "required_material": required_material,
                 "fingerprint": evidence_fingerprint(run.session)}
        run.result = value
        run.save(update_fields=["result", "updated_at"])
        event(session=run.session, run=run, event_type="planner_decision", title=f"Planner: {action}", payload=value)
        return value

    return [tool("synthesize_worker_result", "Consume one pending Worker result. Record supported Findings with successful original receipt IDs, or findings=[] and explain why no supported Finding exists. Required before new work or decisions.",
                 {"worker_id": {"type": "string"}, "reason": TEXT, "findings": {"type": "array", "maxItems": 30, "items": FINDING}},
                 ["worker_id", "reason", "findings"], synthesize),
            tool("decide_investigation_next_step", "Save next action after consuming results. continue_investigation needs queued distinct work; wait_for_input names missing material; final_report permits an explicit indeterminate report with unresolved gaps. No queued work may be skipped.",
                 {"action": {"type": "string", "enum": ["continue_investigation", "wait_for_input", "final_report"]},
                  "reason": TEXT, "required_material": {"type": "string", "maxLength": 4000}},
                 ["action", "reason", "required_material"], decide)]
