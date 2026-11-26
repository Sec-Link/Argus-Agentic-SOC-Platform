"""Persisted runtime projections for ticket-investigation role turns."""

from __future__ import annotations

from typing import Any

from .models import TicketInvestigationRuntimeEvent, TicketInvestigationToolReceipt


def event(*, session, run=None, message=None, event_type: str, title: str, content: str = "", payload: dict | None = None):
    """Write a bounded, owner-scoped runtime event; never log credentials."""
    return TicketInvestigationRuntimeEvent.objects.create(
        session=session, run=run, message=message, event_type=event_type[:64],
        title=title[:240], content=str(content or "")[:12000], payload=payload or {},
    )


def record_trace(*, session, run, message, trace: list[dict[str, Any]] | None) -> None:
    """Project shared LangChain trace events into receipt and activity records."""
    for item in trace or []:
        if not isinstance(item, dict):
            continue
        event_type = str(item.get("type") or "runtime")[:64]
        tool_name = str(item.get("tool") or "")[:240]
        if event_type == "tool_call":
            event(session=session, run=run, message=message, event_type=event_type,
                  title=f"{tool_name or 'Tool'} started", payload={
                      "tool": tool_name, "call_id": str(item.get("call_id") or "")[:160],
                  })
        elif event_type == "tool_result":
            content = str(item.get("content") or "")[:12000]
            TicketInvestigationToolReceipt.objects.create(
                session=session, run=run, message=message,
                call_id=str(item.get("call_id") or "")[:160], execution_id=str(item.get("execution_id") or "")[:160],
                tool_name=tool_name or "unknown_tool", status="completed" if item.get("success") else "failed",
                arguments=item.get("arguments") if isinstance(item.get("arguments"), dict) else {}, result_preview=content,
            )
            event(session=session, run=run, message=message, event_type=event_type,
                  title=f"{tool_name or 'Tool'} {'completed' if item.get('success') else 'failed'}",
                  content=content, payload={"tool": tool_name, "success": bool(item.get("success"))})
        elif event_type in {"assistant_response", "max_iterations", "agent_error"}:
            event(session=session, run=run, message=message, event_type=event_type,
                  title={"assistant_response": "Role response recorded", "max_iterations": "Role iteration limit reached", "agent_error": "Role execution failed"}.get(event_type, "Runtime event"),
                  content=str(item.get("content") or "")[:12000])
