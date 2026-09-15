"""SOC report assembly. Reuses existing service/aggregation layers only —
no statistical logic is re-implemented here."""

from datetime import timedelta

from django.db.models import Avg
from django.utils import timezone

from alerts.services import AlertService
from risk.services import get_top_risk_entities
from tickets.models import EventTicket

_RANGES = {"24h": 1, "7d": 7, "30d": 30}


def _window(range_key: str):
    days = _RANGES.get(range_key, 7)
    end = timezone.now()
    return end - timedelta(days=days), end, days


def _fmt_secs(value) -> str:
    if not value:
        return "N/A"
    s = int(value)
    h, m = s // 3600, (s % 3600) // 60
    return f"{h}h {m}m" if h else f"{m}m"


def build_report(range_key: str = "7d") -> dict:
    start, end, days = _window(range_key)

    dash = AlertService.aggregate_dashboard(force_db=True, start_time=start, end_time=end)
    total_alerts = int(dash.get("total") or 0)
    severity = dash.get("severity_distribution") or dash.get("severity") or {}
    top_rules = (dash.get("top_rules") or [])[:5]

    tq = EventTicket.objects.filter(created_time__gte=start, created_time__lte=end)
    try:
        tq = tq.filter(is_deleted=False)
    except Exception:
        pass
    total_tickets = tq.count()
    resolved = tq.filter(status__in=["resolved", "closed"]).count()
    open_high = tq.filter(
        status__in=["new", "acknowledged", "triaged", "contained"],
        priority__in=["critical", "high"],
    ).count()
    mtt = tq.aggregate(mttd=Avg("mtta_seconds"), mttr=Avg("mttr_seconds"))
    mttd, mttr = _fmt_secs(mtt.get("mttd")), _fmt_secs(mtt.get("mttr"))

    entities = get_top_risk_entities(5)

    crit = int(severity.get("critical", 0)) + int(severity.get("high", 0))
    resolve_rate = f"{(resolved / total_tickets * 100):.0f}%" if total_tickets else "N/A"
    posture = (
        "elevated — high/critical volume warrants active hunting"
        if crit and crit >= max(1, total_alerts * 0.2)
        else "nominal — activity within expected baseline"
    )

    raw = {
        "range": range_key,
        "window_days": days,
        "total_alerts": total_alerts,
        "severity": severity,
        "top_rules": top_rules,
        "tickets": {"total": total_tickets, "resolved": resolved, "open_high": open_high,
                    "mttd": mttd, "mttr": mttr, "resolve_rate": resolve_rate},
        "top_risk_entities": entities,
    }

    def _rows_rules():
        if not top_rules:
            return "| _no data_ | - |"
        return "\n".join(f"| {r.get('name', 'unknown')} | {r.get('count', 0)} |" for r in top_rules)

    def _rows_sev():
        order = ["critical", "high", "medium", "low", "informational"]
        keys = [k for k in order if k in severity] or list(severity.keys())
        return "\n".join(f"| {k.title()} | {severity.get(k, 0)} |" for k in keys) or "| _no data_ | - |"

    def _rows_entities():
        if not entities:
            return "| _no data_ | - | - |"
        return "\n".join(
            f"| `{e['risk_object']}` | {e['risk_object_type']} | {e['current_score']} ({e.get('tier', '-')}) |"
            for e in entities
        )

    md = f"""# SOC Security Report

_Window: last {days} day(s) · generated {end.strftime('%Y-%m-%d %H:%M UTC')}_

## Executive Summary

Over the past {days} day(s) the platform processed **{total_alerts}** alerts and opened **{total_tickets}** incident tickets ({resolve_rate} resolved). Current security posture is **{posture}**. {open_high} high/critical incident(s) remain unresolved.

## Core SOC Metrics

- **Total alerts:** {total_alerts}

### Severity Distribution
| Severity | Count |
|---|---|
{_rows_sev()}

### Top 5 Triggered Rules
| Rule | Alerts |
|---|---|
{_rows_rules()}

## Incident Handling

| Metric | Value |
|---|---|
| Tickets opened | {total_tickets} |
| Resolved | {resolved} ({resolve_rate}) |
| Unresolved high/critical | {open_high} |
| MTTD (avg) | {mttd} |
| MTTR (avg) | {mttr} |

## RBA — Top Risk Entities
| Entity | Type | Score |
|---|---|---|
{_rows_entities()}

## Recommendations

1. {"Prioritize triage of the " + str(open_high) + " open high/critical incident(s) and validate containment." if open_high else "Maintain current triage cadence; no high/critical backlog detected."}
2. {"Review the top-scoring risk entities above for lateral movement and consider watchlisting them." if entities else "Enable risk-object extraction on more detection rules to build entity risk coverage."}
"""
    return {"markdown_content": md, "raw_stats": raw}
