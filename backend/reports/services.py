"""SOC Operations Report engine built on existing platform data services."""
from __future__ import annotations

import base64
import io
from datetime import datetime, timedelta
from typing import Any, Mapping, Sequence

from django.db.models import Avg
from django.utils import timezone

from alerts.services import AlertService
from risk.services import get_top_risk_entities
from tickets.models import EventTicket

BACKGROUND = "#161b22"
FOREGROUND = "#f0f6fc"
GRID = "#30363d"
ACCENT = "#58a6ff"
RANGES = {"24h": timedelta(hours=24), "7d": timedelta(days=7), "30d": timedelta(days=30)}
SEVERITY_ORDER = ("critical", "high", "medium", "low", "informational")
SEVERITY_COLORS = {
    "critical": "#ff4d4f",
    "high": "#fa8c16",
    "medium": "#fadb14",
    "low": "#52c41a",
    "informational": "#8c8c8c",
}

def _png_data_uri(fig: Any) -> str:
    output = io.BytesIO()
    fig.savefig(output, format="png", dpi=150, facecolor=BACKGROUND, bbox_inches="tight")
    plt.close(fig)
    return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode("ascii")


def generate_severity_pie_chart(sev_data: Mapping[str, Any]) -> str:
    normalized = {str(key).lower(): max(0, int(value or 0)) for key, value in sev_data.items()}
    labels = [name.title() for name in SEVERITY_ORDER if normalized.get(name, 0) > 0]
    values = [normalized[name] for name in SEVERITY_ORDER if normalized.get(name, 0) > 0]
    colors = [SEVERITY_COLORS[name] for name in SEVERITY_ORDER if normalized.get(name, 0) > 0]
    if not values:
        return ""
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ModuleNotFoundError:
        return ""
    fig, ax = plt.subplots(figsize=(7.5, 4.2), facecolor=BACKGROUND)
    ax.set_facecolor(BACKGROUND)
    wedges, _, autotexts = ax.pie(
        values, colors=colors, startangle=90, autopct=lambda pct: f"{pct:.1f}%" if pct >= 3 else "",
        pctdistance=.78, wedgeprops={"width": .42, "edgecolor": BACKGROUND, "linewidth": 2},
    )
    for text in autotexts:
        text.set_color(FOREGROUND); text.set_fontsize(9); text.set_weight("bold")
    ax.legend(wedges, labels, loc="center left", bbox_to_anchor=(1, .5), frameon=False, labelcolor=FOREGROUND)
    ax.text(0, 0, f"{sum(values):,}\nALERTS", ha="center", va="center", color=FOREGROUND, fontsize=12, weight="bold")
    ax.set_title("Alert Severity Distribution", color=FOREGROUND, fontsize=15, weight="bold", loc="left", pad=15)
    fig.tight_layout()
    return _png_data_uri(fig)


def generate_trend_line_chart(trend_data: Sequence[Mapping[str, Any]] | Mapping[str, Any]) -> str:
    items = list(trend_data.items()) if isinstance(trend_data, Mapping) else [
        (str(item.get("label") or item.get("date") or item.get("time") or ""), int(item.get("count") or item.get("value") or 0))
        for item in trend_data
    ]
    if not items:
        return ""
    labels, values = zip(*items)
    x = list(range(len(values)))
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ModuleNotFoundError:
        return ""
    fig, ax = plt.subplots(figsize=(9, 4.2), facecolor=BACKGROUND)
    ax.set_facecolor(BACKGROUND)
    ax.plot(x, values, color=ACCENT, linewidth=2.6, marker="o", markersize=6, markerfacecolor=BACKGROUND, markeredgewidth=2)
    ax.fill_between(x, values, color=ACCENT, alpha=.14)
    ax.set_xticks(x, labels, rotation=30, ha="right")
    ax.set_ylabel("Alert Count", color=FOREGROUND)
    ax.set_title("Alert Trend Over Time", color=FOREGROUND, fontsize=15, weight="bold", loc="left", pad=15)
    ax.tick_params(colors=FOREGROUND)
    ax.grid(axis="y", color=GRID, linestyle="--", alpha=.85)
    for spine in ax.spines.values():
        spine.set_color(GRID)
    fig.tight_layout()
    return _png_data_uri(fig)


def _window(time_range: str, start_time: datetime | None, end_time: datetime | None) -> tuple[datetime, datetime]:
    end = end_time or timezone.now()
    if time_range == "custom" and start_time:
        return start_time, end
    return end - RANGES.get(time_range, RANGES["7d"]), end


def _duration(seconds: Any) -> str:
    if seconds is None:
        return "N/A"
    minutes = float(seconds) / 60
    return f"{minutes:.1f}m" if minutes < 60 else f"{minutes / 60:.1f}h"


def _cell(value: Any) -> str:
    return str(value if value is not None else "-").replace("|", "\\|").replace("\n", " ")


def _extract_trend(dashboard: Mapping[str, Any]) -> list[dict[str, Any]]:
    series = dashboard.get("alert_trend_series") or []
    if isinstance(series, list) and series:
        return [{"label": row.get("date") or row.get("label") or row.get("time"), "count": row.get("count") or row.get("value") or 0} for row in series]
    daily = dashboard.get("daily_trend") or dashboard.get("alert_trend") or {}
    return [{"label": key, "count": value} for key, value in daily.items()] if isinstance(daily, Mapping) else []


def generate_soc_report_md(time_range: str = "7d", start_time: datetime | None = None, end_time: datetime | None = None) -> dict[str, Any]:
    start, end = _window(time_range, start_time, end_time)
    dashboard = AlertService.aggregate_dashboard(force_db=True, start_time=start, end_time=end) or {}
    severity = {str(k).lower(): int(v or 0) for k, v in (dashboard.get("severity_distribution") or dashboard.get("severity") or {}).items()}
    total_alerts = int(dashboard.get("total") or sum(severity.values()))
    using_fallback = False
    top_rules = list(dashboard.get("top_rules") or [])[:5]
    trend = _extract_trend(dashboard)

    ticket_qs = EventTicket.objects.filter(created_time__gte=start, created_time__lte=end)
    real_ticket_count = ticket_qs.count()
    if real_ticket_count:
        resolved = ticket_qs.filter(status__in=("resolved", "closed")).count()
        averages = ticket_qs.aggregate(mttd=Avg("sla__mtta_seconds"), mttr=Avg("sla__mttr_seconds"))
        ticket_stats = {"total": real_ticket_count, "resolved": resolved, "mttd_seconds": averages["mttd"], "mttr_seconds": averages["mttr"]}
        open_tickets = [{"ticket": row.ticket_number, "priority": row.priority.title(), "title": row.title, "status": row.status.title()} for row in ticket_qs.filter(status__in=("new", "acknowledged", "triaged", "contained"), priority__in=("critical", "high")).order_by("-created_time")[:5]]
    else:
        ticket_stats = {"total": 0, "resolved": 0, "mttd_seconds": None, "mttr_seconds": None}; open_tickets = []
    entities = list(get_top_risk_entities(5) or [])

    critical_high = severity.get("critical", 0) + severity.get("high", 0)
    exposure = critical_high / max(total_alerts, 1)
    posture = "CRITICAL" if exposure >= .35 else "ELEVATED" if exposure >= .15 else "STABLE"
    resolved_rate = ticket_stats["resolved"] / max(ticket_stats["total"], 1) * 100
    severity_chart = generate_severity_pie_chart(severity) if total_alerts else ""
    trend_chart = generate_trend_line_chart(trend) if trend else ""
    severity_rows = "\n".join(f"| {name.title()} | {severity.get(name, 0):,} | {severity.get(name, 0) / max(total_alerts, 1) * 100:.1f}% |" for name in SEVERITY_ORDER)
    rule_rows = "\n".join(f"| {index} | {_cell(rule.get('name', 'Unknown Rule'))} | {int(rule.get('count', 0)):,} |" for index, rule in enumerate(top_rules, 1)) or "| - | No data available in this time range | - |"
    ticket_rows = "\n".join(f"| `{_cell(row['ticket'])}` | **{_cell(row['priority'])}** | {_cell(row['title'])} | {_cell(row['status'])} |" for row in open_tickets) or "| - | No data available in this time range | - | - |"
    entity_rows = "\n".join(f"| {index} | `{_cell(entity.get('risk_object'))}` | {_cell(entity.get('risk_object_type'))} | **{float(entity.get('current_score', 0)):.1f}** | {_cell(entity.get('tier'))} |" for index, entity in enumerate(entities, 1)) or "| - | No data available in this time range | - | - | - |"
    fallback_note = ""
    chart_section = f'<img src="{severity_chart}" alt="Alert Severity Distribution" style="width:100%; max-width:700px; margin:16px 0; border-radius:6px;" />' if severity_chart else "_No alert severity data in selected period._"
    trend_section = f'<img src="{trend_chart}" alt="Alert Trend Over Time" style="width:100%; max-width:700px; margin:16px 0; border-radius:6px;" />' if trend_chart else "_No alert trend data in selected period._"

    markdown = f"""# 🛡️ SOC Security Operations Report

> **Classification:** Internal — SOC Operations  
> **Reporting Window:** {start.strftime('%Y-%m-%d %H:%M UTC')} — {end.strftime('%Y-%m-%d %H:%M UTC')}  
> **Generated:** {timezone.now().strftime('%Y-%m-%d %H:%M UTC')}

---

## 1. Executive Summary

The environment's current security posture is **{posture}**. The SOC analyzed **{total_alerts:,} alerts**, including **{critical_high:,} high or critical events ({exposure * 100:.1f}%)**, and resolved **{ticket_stats['resolved']} of {ticket_stats['total']} incident tickets ({resolved_rate:.1f}%)**. Mean detection time was **{_duration(ticket_stats['mttd_seconds'])}** and mean resolution time was **{_duration(ticket_stats['mttr_seconds'])}**.{fallback_note}

| Posture | Total Alerts | Critical + High | Resolution Rate | Open Priority Incidents |
|---|---:|---:|---:|---:|
| **{posture}** | **{total_alerts:,}** | **{critical_high:,}** | **{resolved_rate:.1f}%** | **{len(open_tickets)}** |

## 2. Core Metrics & Alert Severity

{chart_section}

### Severity Distribution

| Severity | Alert Count | Share |
|---|---:|---:|
{severity_rows}

### Top 5 Triggered Detection Rules

| Rank | Detection Rule | Alerts |
|---:|---|---:|
{rule_rows}

## 3. Alert Trend & Incident Response

{trend_section}

### Response Performance

| Metric | Value |
|---|---:|
| Total Incident Tickets | **{ticket_stats['total']}** |
| Resolved Tickets | **{ticket_stats['resolved']}** |
| Resolution Rate | **{resolved_rate:.1f}%** |
| Mean Time to Detect (MTTD) | **{_duration(ticket_stats['mttd_seconds'])}** |
| Mean Time to Respond/Resolve (MTTR) | **{_duration(ticket_stats['mttr_seconds'])}** |

### Open Critical and High-Priority Tickets

| Ticket | Priority | Incident | Status |
|---|---|---|---|
{ticket_rows}

## 4. Top RBA Risk Entities

| Rank | Risk Entity | Type | Risk Score | Tier |
|---:|---|---|---:|---|
{entity_rows}

## 5. SOC Operational Recommendations

1. **Accelerate priority incident handling:** Assign named owners and containment deadlines to the **{len(open_tickets)}** open critical/high-priority incidents; validate isolation, credential revocation, and evidence preservation.
2. **Reduce concentrated detection risk:** {f"Hunt across the top RBA entities—beginning with `{_cell(entities[0].get('risk_object'))}`—and correlate identity, endpoint, network, and threat-intelligence telemetry." if entities else "No risk entities were returned for this time range; validate risk telemetry coverage."}
3. **Tune high-volume detections:** {f"Review the top triggered rule, **{_cell(top_rules[0].get('name'))}**, for false-positive concentration while preserving coverage for confirmed malicious behavior." if top_rules else "No detection rules were returned for this time range; validate alert rule telemetry."}
4. **Improve response efficiency:** Compare current MTTD (**{_duration(ticket_stats['mttd_seconds'])}**) and MTTR (**{_duration(ticket_stats['mttr_seconds'])}**) against SLA objectives and automate repetitive enrichment and containment steps.

---

_This report is generated from the SOC platform's alert, incident, and risk aggregation services. Analyst edits should be reviewed before external distribution._
"""
    raw_stats = {
        "time_range": time_range, "start_time": start.isoformat(), "end_time": end.isoformat(),
        "is_sample_data": False, "total_alerts": total_alerts, "severity": severity,
        "top_rules": top_rules, "trend": trend,
        "tickets": {**ticket_stats, "mttd": _duration(ticket_stats["mttd_seconds"]), "mttr": _duration(ticket_stats["mttr_seconds"]), "resolve_rate": round(resolved_rate, 1), "open_critical": open_tickets},
        "top_risk_entities": entities,
        "charts": {"severity": severity_chart, "trend": trend_chart},
    }
    return {"markdown_content": markdown, "raw_stats": raw_stats}


build_report = generate_soc_report_md
