"""Role-specific ticket investigation turns built on the existing LangChain agent.

This layer intentionally owns only role prompts, saved role history, and ticket
context. Model selection, LangChain tools, MCP, skills, approvals, and usage
recording remain in the established AI assistant implementation.
"""

from __future__ import annotations

from typing import Any

from .chat_agent import run_chat_agent


ROLE_INSTRUCTIONS = {
    "main": (
        "You are the Main Agent for this ticket investigation. Coordinate the human investigator, "
        "summarize confirmed facts, identify uncertainties, and recommend whether Planner or a Worker "
        "should be asked to continue. Do not claim that a proposed action has already run."
    ),
    "planner": (
        "You are the Planner for this ticket investigation. Convert the current evidence into a short, "
        "ordered investigation plan. Every step must name the evidence it needs and the condition that "
        "would close it. Propose Worker objectives only when a focused follow-up is useful."
    ),
    "worker": (
        "You are a Worker on one bounded investigation objective. Work only on the stated objective, "
        "use available tools when they materially help, distinguish observed evidence from inference, "
        "and return concise findings, gaps, and a recommended next operation."
    ),
    "side_question": (
        "You are handling a Side Question for the current ticket. Answer the question independently "
        "from the main investigation while using the same ticket evidence. State any impact on the main "
        "investigation and avoid changing ticket state."
    ),
}


def _compact(value: Any, limit: int) -> str:
    text = str(value or "").strip()
    return text[:limit] + ("…" if len(text) > limit else "")


def ticket_context(ticket) -> str:
    """Only include ticket fields already shown to authorized ticket readers."""
    return "\n".join([
        f"Ticket: {ticket.ticket_number}",
        f"Title: {_compact(ticket.title, 500)}",
        f"Status: {_compact(ticket.status, 80)} | Priority: {_compact(ticket.priority, 80)}",
        f"Category: {_compact(ticket.event_category, 160)} | Result: {_compact(ticket.event_result, 160)}",
        f"Platform: {_compact(ticket.event_platform, 160)} | Source: {_compact(ticket.event_sources, 500)}",
        f"Description: {_compact(ticket.description, 2500)}",
        f"Alert evidence: {_compact(ticket.alert_message, 5000)}",
    ])


def session_findings(session, excluding_run_id=None) -> str:
    rows = session.messages.filter(role="assistant").exclude(run_id=excluding_run_id).order_by("-created_at")[:12]
    excerpts = [_compact(row.content, 900) for row in reversed(list(rows)) if row.content]
    return "\n\n".join(excerpts) or "No completed findings from other roles yet."


def run_investigation_turn(*, run, actor, message: str, overrides: dict, model_guard=None) -> dict:
    """Execute one saved role turn using the shared LangChain agent implementation."""
    history = [
        {"role": row.role, "content": row.content}
        for row in run.messages.filter(role__in=("user", "assistant")).order_by("created_at")[:80]
    ]
    # The endpoint persists the submitted message before execution so a failed
    # turn remains visible. The shared runner appends its own current user
    # message, therefore remove that just-persisted copy from its history.
    if history and history[-1]["role"] == "user" and history[-1]["content"] == message:
        history.pop()
    objective = _compact(run.objective, 2500) or "No separate objective was supplied."
    system_prompt_extra = "\n\n".join([
        ROLE_INSTRUCTIONS[run.role],
        "Current ticket context:\n" + ticket_context(run.session.ticket),
        "This role's objective:\n" + objective,
        "Relevant completed findings from the other roles:\n" + session_findings(run.session, excluding_run_id=run.id),
    ])
    return run_chat_agent(
        message,
        history_messages=history,
        overrides=overrides,
        system_prompt_extra=system_prompt_extra,
        model_call_guard=model_guard,
        audit_source="ticket_investigation",
        audit_context={"actor_id": actor.pk, "source": "ticket_investigation", "agent_name": run.role},
    )
