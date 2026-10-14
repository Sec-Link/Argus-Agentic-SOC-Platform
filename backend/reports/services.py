"""SOC Operations Report engine built on existing platform data services."""
from __future__ import annotations

import base64
import io
import logging
import os
import re
import struct
import tempfile
import zlib
from datetime import datetime, timedelta
from typing import Any, Mapping, Sequence

from django.db.models import Avg, Count, Max, QuerySet, Sum
from django.db.models.functions import Lower, Trim, TruncDate, TruncHour
from django.utils import timezone

from alerts.models import Alert
from correlation.models import CorrelationEvent
from detections.models import LocalDetectionRule
from detections.sigma import ATTACK_TACTIC_MAP
from risk.models import RiskEvent
from tickets.models import EventTicket

logger = logging.getLogger(__name__)

CHART_BACKGROUND = "#f8fafc"
CHART_TEXT = "#0f172a"
CHART_MUTED = "#64748b"
CHART_GRID = "#cbd5e1"
CHART_BLUE = "#2563eb"
CHART_ORANGE = "#f97316"
RANGES = {"24h": timedelta(hours=24), "7d": timedelta(days=7), "30d": timedelta(days=30)}
SEVERITY_ORDER = ("critical", "high", "medium", "low", "informational", "unknown")
SEVERITY_COLORS = {
    "critical": "#dc2626",
    "high": "#f97316",
    "medium": "#eab308",
    "low": "#22c55e",
    "informational": "#0ea5e9",
    "unknown": "#94a3b8",
}
CATEGORY_COLORS = ("#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", "#f97316", "#fb923c", "#64748b", "#94a3b8")
ALERT_TIME_FIELDS = ("timestamp", "event_time", "created_at")
PLACEHOLDER_CATALOG = (
    {"key": "company.name", "label": "Company name", "group": "Brand", "description": "Organization shown in the report header."},
    {"key": "company.logo", "label": "Company logo", "group": "Brand", "description": "Uploaded logo rendered in preview and PDF."},
    {"key": "report.title", "label": "Report title", "group": "Report", "description": "Display title for the report."},
    {"key": "report.window", "label": "Reporting window", "group": "Report", "description": "Resolved start and end of the selected range."},
    {"key": "report.generated_at", "label": "Generated at", "group": "Report", "description": "Time at which the report data was generated."},
    {"key": "metrics.posture", "label": "Security posture", "group": "Metrics", "description": "Calculated posture for the selected range."},
    {"key": "metrics.total_alerts", "label": "Total alerts", "group": "Metrics", "description": "Alerts in the selected reporting range."},
    {"key": "metrics.critical_high_alerts", "label": "Critical + high alerts", "group": "Metrics", "description": "Combined critical and high severity alert count."},
    {"key": "metrics.total_tickets", "label": "Total tickets", "group": "Metrics", "description": "Incident tickets created in the selected range."},
    {"key": "metrics.resolved_tickets", "label": "Resolved tickets", "group": "Metrics", "description": "Resolved or closed incident tickets."},
    {"key": "metrics.resolution_rate", "label": "Resolution rate", "group": "Metrics", "description": "Percentage of incident tickets resolved."},
    {"key": "metrics.mttd", "label": "MTTD", "group": "Metrics", "description": "Mean time to detect."},
    {"key": "metrics.mttr", "label": "MTTR", "group": "Metrics", "description": "Mean time to respond or resolve."},
    {"key": "metrics.open_priority_incidents", "label": "Open priority incidents", "group": "Metrics", "description": "Open critical and high-priority incidents."},
    {"key": "charts.category", "label": "Category breakdown", "group": "Charts", "description": "Generated alert category chart."},
    {"key": "charts.severity", "label": "Severity distribution", "group": "Charts", "description": "Generated alert severity chart."},
    {"key": "charts.alert_trend", "label": "Alert trend", "group": "Charts", "description": "Generated alert trend chart."},
    {"key": "charts.score_trend", "label": "Score trend", "group": "Charts", "description": "Generated alert score trend chart."},
    {"key": "charts.funnel", "label": "Alert funnel", "group": "Charts", "description": "Overview conversion funnel for alerts and incident handling."},
    {"key": "charts.sankey", "label": "Detection pipeline", "group": "Charts", "description": "MITRE-to-event-level detection pipeline flow."},
)

TACTIC_TO_USE_CASE = {
    "reconnaissance": "Behavior-Based Use Cases",
    "resource-development": "Behavior-Based Use Cases",
    "initial-access": "Behavior-Based Use Cases",
    "execution": "Behavior-Based Use Cases",
    "persistence": "Behavior-Based Use Cases",
    "lateral-movement": "Behavior-Based Use Cases",
    "collection": "Behavior-Based Use Cases",
    "exfiltration": "Behavior-Based Use Cases",
    "command-and-control": "Behavior-Based Use Cases",
    "privilege-escalation": "Device-Based Use Cases",
    "defense-evasion": "Device-Based Use Cases",
    "discovery": "Device-Based Use Cases",
    "credential-access": "Health-Based Use Cases",
    "impact": "Health-Based Use Cases",
}

_PIXEL_FONT = {
    "A": ("01110", "10001", "10001", "11111", "10001", "10001", "10001"),
    "C": ("01111", "10000", "10000", "10000", "10000", "10000", "01111"),
    "D": ("11110", "10001", "10001", "10001", "10001", "10001", "11110"),
    "E": ("11111", "10000", "10000", "11110", "10000", "10000", "11111"),
    "N": ("10001", "11001", "10101", "10011", "10001", "10001", "10001"),
    "O": ("01110", "10001", "10001", "10001", "10001", "10001", "01110"),
    "R": ("11110", "10001", "10001", "11110", "10100", "10010", "10001"),
    "S": ("01111", "10000", "10000", "01110", "00001", "00001", "11110"),
    "T": ("11111", "00100", "00100", "00100", "00100", "00100", "00100"),
    "V": ("10001", "10001", "10001", "10001", "10001", "01010", "00100"),
    " ": ("00000",) * 7,
}


def _pyplot() -> Any | None:
    try:
        cache_dir = os.path.join(tempfile.gettempdir(), "argus-matplotlib")
        os.makedirs(cache_dir, exist_ok=True)
        os.environ.setdefault("MPLCONFIGDIR", cache_dir)
        import matplotlib

        matplotlib.use("Agg", force=True)
        import matplotlib.pyplot as plt
    except Exception:
        logger.exception("Matplotlib initialization failed; using the built-in PNG fallback")
        return None
    return plt


def _png_chunk(chunk_type: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + chunk_type + payload + struct.pack(">I", zlib.crc32(chunk_type + payload) & 0xFFFFFFFF)


def _fallback_png_data_uri(message: str = "NO EVENTS RECORDED") -> str:
    """Render a dependency-free neutral PNG so chart slots never collapse to text."""
    width, height = 1000, 360
    background = (248, 250, 252)
    pixels = bytearray(background * (width * height))

    def rectangle(left: int, top: int, right: int, bottom: int, color: tuple[int, int, int]) -> None:
        for y in range(max(0, top), min(height, bottom)):
            for x in range(max(0, left), min(width, right)):
                offset = (y * width + x) * 3
                pixels[offset:offset + 3] = bytes(color)

    rectangle(0, 0, width, 5, (37, 99, 235))
    rectangle(32, 36, width - 32, height - 32, (255, 255, 255))
    rectangle(32, 36, 36, height - 32, (249, 115, 22))

    rendered_message = "".join(char if char in _PIXEL_FONT else " " for char in message.upper()).strip() or "NO EVENTS RECORDED"
    scale = 4
    glyph_width = 5 * scale
    spacing = 2 * scale
    text_width = len(rendered_message) * (glyph_width + spacing) - spacing
    origin_x = max(42, (width - text_width) // 2)
    origin_y = (height - 7 * scale) // 2
    for index, char in enumerate(rendered_message):
        glyph = _PIXEL_FONT[char]
        for row_index, row in enumerate(glyph):
            for column_index, enabled in enumerate(row):
                if enabled == "1":
                    x = origin_x + index * (glyph_width + spacing) + column_index * scale
                    y = origin_y + row_index * scale
                    rectangle(x, y, x + scale, y + scale, (71, 85, 105))

    raw_rows = b"".join(b"\x00" + bytes(pixels[y * width * 3:(y + 1) * width * 3]) for y in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", header) + _png_chunk(b"IDAT", zlib.compress(raw_rows, 9)) + _png_chunk(b"IEND", b"")
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def _png_data_uri(fig: Any, plt: Any) -> str:
    output = io.BytesIO()
    try:
        fig.savefig(output, format="png", dpi=170, facecolor=CHART_BACKGROUND, bbox_inches="tight", pad_inches=.18)
    finally:
        plt.close(fig)
    return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode("ascii")


def _empty_chart(title: str, message: str = "No Events Recorded") -> str:
    plt = _pyplot()
    if plt is None:
        return _fallback_png_data_uri(message)
    try:
        fig, ax = plt.subplots(figsize=(10.8, 3.8), facecolor=CHART_BACKGROUND)
        ax.set_facecolor(CHART_BACKGROUND)
        ax.set_title(title, color=CHART_TEXT, fontsize=16, weight="bold", loc="left", pad=16)
        ax.text(.5, .5, message, transform=ax.transAxes, ha="center", va="center", color=CHART_MUTED, fontsize=13, weight="medium")
        ax.set_axis_off()
        fig.tight_layout()
        return _png_data_uri(fig, plt)
    except Exception:
        logger.exception("Failed to render the %s empty-state chart", title)
        return _fallback_png_data_uri(message)


def _clean_axes(ax: Any, grid_axis: str = "y") -> None:
    ax.grid(axis=grid_axis, color=CHART_GRID, linestyle=(0, (3, 4)), linewidth=.8, alpha=.1)
    ax.set_axisbelow(True)
    ax.tick_params(colors=CHART_MUTED, labelsize=9, length=0)
    for spine in ax.spines.values():
        spine.set_visible(False)


def _category_bar_chart(data: Mapping[str, Any], title: str) -> str:
    entries = [(str(key).replace("_", " ").title(), max(0, int(value or 0))) for key, value in data.items()]
    entries = sorted((entry for entry in entries if entry[1] > 0), key=lambda entry: entry[1], reverse=True)
    if len(entries) > 8:
        entries = entries[:7] + [("Other", sum(value for _, value in entries[7:]))]
    if not entries:
        return _empty_chart(title)
    plt = _pyplot()
    if plt is None:
        return _fallback_png_data_uri("RENDER ERROR")
    fig = None
    try:
        entries.reverse()
        labels = [label if len(label) <= 34 else f"{label[:31]}…" for label, _ in entries]
        values = [value for _, value in entries]
        fig, ax = plt.subplots(figsize=(10.8, max(4.0, 1.6 + len(entries) * .52)), facecolor=CHART_BACKGROUND)
        ax.set_facecolor(CHART_BACKGROUND)
        colors = [CATEGORY_COLORS[min(index, len(CATEGORY_COLORS) - 1)] for index in range(len(entries) - 1, -1, -1)]
        bars = ax.barh(range(len(labels)), values, height=.58, color=colors, edgecolor="none")
        ax.set_yticks(range(len(labels)), labels)
        ax.set_xlim(0, max(values) * 1.16 if max(values) else 1)
        ax.set_xlabel("Alerts", color=CHART_MUTED, fontsize=9, labelpad=10)
        ax.set_title(title, color=CHART_TEXT, fontsize=16, weight="semibold", loc="left", pad=18)
        _clean_axes(ax, "x")
        for bar, value in zip(bars, values):
            ax.text(bar.get_width() + max(values) * .018, bar.get_y() + bar.get_height() / 2, f"{value:,}", va="center", color=CHART_TEXT, fontsize=9, weight="semibold")
        fig.tight_layout()
        return _png_data_uri(fig, plt)
    except Exception:
        if fig is not None:
            plt.close(fig)
        logger.exception("Failed to render %s", title)
        return _fallback_png_data_uri("RENDER ERROR")


def generate_category_chart(category_data: Mapping[str, Any]) -> str:
    return _category_bar_chart(category_data, "Alert Category Breakdown")


def generate_severity_pie_chart(sev_data: Mapping[str, Any]) -> str:
    normalized = {str(key).lower(): max(0, int(value or 0)) for key, value in sev_data.items()}
    ordered = {name: normalized.get(name, 0) for name in SEVERITY_ORDER if normalized.get(name, 0) > 0}
    if not ordered:
        return _empty_chart("Alert Severity Distribution")
    plt = _pyplot()
    if plt is None:
        return _fallback_png_data_uri("RENDER ERROR")
    fig = None
    try:
        labels = [name.title() for name in ordered]
        values = list(ordered.values())
        fig, ax = plt.subplots(figsize=(10.8, 4.4), facecolor=CHART_BACKGROUND)
        ax.set_facecolor(CHART_BACKGROUND)
        bars = ax.bar(range(len(labels)), values, width=.58, color=[SEVERITY_COLORS[name] for name in ordered], edgecolor="none")
        ax.set_xticks(range(len(labels)), labels)
        ax.set_ylim(0, max(values) * 1.18 if max(values) else 1)
        ax.set_ylabel("Alerts", color=CHART_MUTED, fontsize=9, labelpad=10)
        ax.set_title("Alert Severity Distribution", color=CHART_TEXT, fontsize=16, weight="semibold", loc="left", pad=18)
        _clean_axes(ax)
        for bar, value in zip(bars, values):
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + max(values) * .025, f"{value:,}", ha="center", color=CHART_TEXT, fontsize=9, weight="semibold")
        fig.tight_layout()
        return _png_data_uri(fig, plt)
    except Exception:
        if fig is not None:
            plt.close(fig)
        logger.exception("Failed to render Alert Severity Distribution")
        return _fallback_png_data_uri("RENDER ERROR")


def _stacked_trend_chart(
    series_data: Sequence[Mapping[str, Any]] | None,
    fallback_data: Mapping[str, Any] | None,
    title: str,
    y_label: str,
) -> str:
    buckets: dict[str, dict[str, float]] = {}
    for item in series_data or []:
        label = str(item.get("time") or item.get("date") or item.get("label") or "")
        series = str(item.get("series") or "total").lower()
        if label:
            bucket = buckets.setdefault(label, {})
            bucket[series] = bucket.get(series, 0) + float(item.get("value") or item.get("count") or 0)
    if not buckets:
        for label, value in (fallback_data or {}).items():
            buckets[str(label)] = {"total": float(value or 0)}
    if not buckets:
        return _empty_chart(title)
    plt = _pyplot()
    if plt is None:
        return _fallback_png_data_uri("RENDER ERROR")
    fig = None
    try:
        labels = sorted(buckets)
        x = list(range(len(labels)))
        values = [sum(buckets[label].values()) for label in labels]
        fig, ax = plt.subplots(figsize=(10.8, 4.4), facecolor=CHART_BACKGROUND)
        ax.set_facecolor(CHART_BACKGROUND)
        ax.bar(x, values, width=.58, color=CHART_ORANGE, edgecolor="none")
        tick_step = max(1, len(labels) // 8)
        ticks = list(range(0, len(labels), tick_step))
        ax.set_xticks(ticks, [labels[index].replace("T", " ") for index in ticks], rotation=28, ha="right")
        ax.set_ylabel(y_label, color=CHART_MUTED, fontsize=9)
        ax.set_title(title, color=CHART_TEXT, fontsize=16, weight="semibold", loc="left", pad=18)
        _clean_axes(ax)
        fig.tight_layout()
        return _png_data_uri(fig, plt)
    except Exception:
        if fig is not None:
            plt.close(fig)
        logger.exception("Failed to render %s", title)
        return _fallback_png_data_uri("RENDER ERROR")


def _score_trend_chart(
    series_data: Sequence[Mapping[str, Any]] | None,
    fallback_data: Mapping[str, Any] | None,
) -> str:
    totals: dict[str, float] = {}
    for item in series_data or []:
        label = str(item.get("time") or item.get("date") or item.get("label") or "")
        if label:
            totals[label] = totals.get(label, 0) + float(item.get("value") or item.get("count") or 0)
    if not totals:
        totals = {str(label): float(value or 0) for label, value in (fallback_data or {}).items()}
    if not totals:
        return _empty_chart("Alert Score Trend")
    plt = _pyplot()
    if plt is None:
        return _fallback_png_data_uri("RENDER ERROR")
    fig = None
    try:
        labels = sorted(totals)
        values = [totals[label] for label in labels]
        x = list(range(len(labels)))
        fig, ax = plt.subplots(figsize=(10.8, 4.4), facecolor=CHART_BACKGROUND)
        ax.set_facecolor(CHART_BACKGROUND)
        ax.fill_between(x, values, color=CHART_BLUE, alpha=.08)
        ax.plot(x, values, color=CHART_BLUE, linewidth=2.4, marker="o", markersize=4.5, markerfacecolor=CHART_BACKGROUND, markeredgecolor=CHART_BLUE, markeredgewidth=1.6)
        tick_step = max(1, len(labels) // 8)
        ticks = list(range(0, len(labels), tick_step))
        ax.set_xticks(ticks, [labels[index].replace("T", " ") for index in ticks], rotation=28, ha="right")
        ax.set_ylabel("Weighted risk score", color=CHART_MUTED, fontsize=9)
        ax.set_title("Alert Score Trend", color=CHART_TEXT, fontsize=16, weight="semibold", loc="left", pad=18)
        _clean_axes(ax)
        fig.tight_layout()
        return _png_data_uri(fig, plt)
    except Exception:
        if fig is not None:
            plt.close(fig)
        logger.exception("Failed to render Alert Score Trend")
        return _fallback_png_data_uri("RENDER ERROR")


def generate_trend_line_chart(trend_data: Sequence[Mapping[str, Any]] | Mapping[str, Any]) -> str:
    if isinstance(trend_data, Mapping):
        return _stacked_trend_chart(None, trend_data, "Alert Trend", "Alert count")
    return _stacked_trend_chart(trend_data, None, "Alert Trend", "Alert count")


def _conversion_stats(alerts: QuerySet, tickets: QuerySet) -> dict[str, int]:
    """Use the same stage definitions as the Overview conversion funnel."""
    return {
        "alerts": alerts.count(),
        "tickets": tickets.count(),
        "true_positive": tickets.filter(
            event_result__in=("true_positive", "true_positive_benign")
        ).count(),
        "security_events": tickets.filter(event_result="true_positive").count(),
        "incidents": tickets.filter(
            event_result="true_positive", priority__in=("critical", "high")
        ).count(),
    }


def _funnel_chart(stats: Mapping[str, Any]) -> str:
    labels = ("Alerts", "Tickets", "TP + TP-B", "Security Events", "Incidents")
    keys = ("alerts", "tickets", "true_positive", "security_events", "incidents")
    values = [max(0, int(stats.get(key) or 0)) for key in keys]
    if not any(values):
        return _empty_chart("Alert Conversion Funnel")
    plt = _pyplot()
    if plt is None:
        return _fallback_png_data_uri("RENDER ERROR")
    fig = None
    try:
        from matplotlib.patches import Polygon

        colors = ("#2563eb", "#0891b2", "#16a34a", "#d97706", "#dc2626")
        widths = (1.0, .84, .69, .55, .42, .32)
        fig, ax = plt.subplots(figsize=(10.8, 5.3), facecolor=CHART_BACKGROUND)
        ax.set_facecolor(CHART_BACKGROUND)
        for index, (label, value, color) in enumerate(zip(labels, values, colors)):
            top_width, bottom_width = widths[index], widths[index + 1]
            y_top, y_bottom = 4.65 - index * .82, 3.98 - index * .82
            points = [(-top_width / 2, y_top), (top_width / 2, y_top),
                      (bottom_width / 2, y_bottom), (-bottom_width / 2, y_bottom)]
            ax.add_patch(Polygon(points, closed=True, facecolor=color, edgecolor=CHART_BACKGROUND, linewidth=2))
            rate = "100%" if index == 0 else (
                f"{value / values[index - 1] * 100:.1f}%" if values[index - 1] else "—"
            )
            ax.text(0, (y_top + y_bottom) / 2 + .09, f"{value:,}", ha="center", va="center",
                    color="#ffffff", fontsize=13, weight="bold")
            ax.text(0, (y_top + y_bottom) / 2 - .16, f"{label}  ·  {rate}", ha="center", va="center",
                    color="#ffffff", fontsize=8.5, weight="medium")
        ax.set_xlim(-.65, .65)
        ax.set_ylim(.25, 5.15)
        ax.set_title("Alert Conversion Funnel", color=CHART_TEXT, fontsize=16, weight="semibold", loc="left", pad=14)
        ax.text(-.64, 4.92, "Overview stage definitions · selected report window", color=CHART_MUTED, fontsize=8.5)
        ax.set_axis_off()
        fig.tight_layout()
        return _png_data_uri(fig, plt)
    except Exception:
        if fig is not None:
            plt.close(fig)
        logger.exception("Failed to render Alert Conversion Funnel")
        return _fallback_png_data_uri("RENDER ERROR")


def _labelize(value: Any) -> str:
    return str(value or "").strip().replace("_", " ").replace("-", " ").title()


def _pipeline_stats(tickets: QuerySet) -> dict[str, Any]:
    """Build the Overview Sankey stages from real records in the report window."""
    stages = (
        "MITRE ATT&CK Framework", "Developed Use Cases", "Alerts", "Resolution", "Event Level"
    )
    category_labels = dict(EventTicket.EVENT_CATEGORY_CHOICES)
    result_labels = {
        "true_positive": "True Positive", "false_positive": "False Positive",
        "true_positive_benign": "TP - Benign", "duplicate": "Duplicate", "pending": "Pending",
    }
    priority_labels = {
        "critical": "P1 - Critical", "high": "P2 - High",
        "medium": "P3 - Medium", "low": "P4 - Low",
    }
    base = (
        tickets.filter(is_deleted=False)
        .annotate(
            category_key=Lower(Trim("event_category")),
            result_key=Lower(Trim("event_result")),
            priority_key=Lower(Trim("priority")),
        )
        .exclude(category_key="").filter(category_key__isnull=False)
    )
    nodes: dict[str, dict[str, str]] = {}
    links: dict[tuple[str, str, str], int] = {}

    def add_link(source: str, target: str, value: int, stage: str, source_stage: str, target_stage: str) -> None:
        if not source or not target or value <= 0:
            return
        nodes[source] = {"name": source, "stage": source_stage}
        nodes[target] = {"name": target, "stage": target_stage}
        key = (source, target, stage)
        links[key] = links.get(key, 0) + value

    category_result_rows = (
        base.exclude(result_key="").filter(result_key__isnull=False)
        .values("category_key", "result_key").annotate(count=Count("ticket_number"))
    )
    for row in category_result_rows:
        category = category_labels.get(row["category_key"], _labelize(row["category_key"]))
        result = result_labels.get(row["result_key"], _labelize(row["result_key"]))
        add_link(category, result, int(row["count"] or 0), "Alerts -> Resolution", stages[2], stages[3])

    result_priority_rows = (
        base.exclude(result_key="").exclude(priority_key="")
        .filter(result_key__isnull=False, priority_key__isnull=False)
        .values("result_key", "priority_key").annotate(count=Count("ticket_number"))
    )
    for row in result_priority_rows:
        result = result_labels.get(row["result_key"], _labelize(row["result_key"]))
        priority = priority_labels.get(row["priority_key"], _labelize(row["priority_key"]))
        add_link(result, priority, int(row["count"] or 0), "Resolution -> Event Level", stages[3], stages[4])

    ticket_rows = list(base.values("ticket_number", "category_key").distinct())
    ticket_categories = {row["ticket_number"]: row["category_key"] for row in ticket_rows if row["ticket_number"]}
    ticket_rules: dict[str, set[str]] = {}
    if ticket_categories:
        for row in (
            Alert.objects.filter(ticket_number__in=ticket_categories)
            .exclude(rule_id__isnull=True).exclude(rule_id="")
            .values("ticket_number", "rule_id").distinct()
        ):
            ticket_rules.setdefault(row["ticket_number"], set()).add(row["rule_id"])
    rule_ids = {rule_id for values in ticket_rules.values() for rule_id in values}
    rule_tags = {
        row["rule_uuid"]: [str(tag).strip().lower() for tag in (row["payload"] or {}).get("tags", [])]
        for row in LocalDetectionRule.objects.filter(rule_uuid__in=rule_ids, is_deleted=False).values("rule_uuid", "payload")
    }
    for ticket_number, rules in ticket_rules.items():
        category_key = ticket_categories.get(ticket_number, "")
        category = category_labels.get(category_key, _labelize(category_key))
        tactics = {
            tag[7:] for rule_id in rules for tag in rule_tags.get(rule_id, [])
            if tag.startswith("attack.") and not re.fullmatch(r"attack\.t\d{4}(\.\d{3})?", tag)
            and tag[7:] in ATTACK_TACTIC_MAP
        }
        for tactic in tactics:
            tactic_label = ATTACK_TACTIC_MAP[tactic]["name"]
            use_case = TACTIC_TO_USE_CASE.get(tactic, "Behavior-Based Use Cases")
            add_link(tactic_label, use_case, 1, "MITRE -> Use Cases", stages[0], stages[1])
            add_link(use_case, category, 1, "Use Cases -> Alerts", stages[1], stages[2])

    return {
        "nodes": list(nodes.values()),
        "links": [
            {"source": source, "target": target, "stage": stage, "value": value}
            for (source, target, stage), value in links.items()
        ],
        "stages": list(stages),
        "summary": {"tickets": base.count()},
    }


def _sankey_chart(data: Mapping[str, Any]) -> str:
    links = [dict(link) for link in data.get("links", []) if int(link.get("value") or 0) > 0]
    nodes = [dict(node) for node in data.get("nodes", [])]
    stages = list(data.get("stages", []))
    if not links or not nodes or not stages:
        return _empty_chart("Alert Correlation — Detection Pipeline")
    plt = _pyplot()
    if plt is None:
        return _fallback_png_data_uri("RENDER ERROR")
    fig = None
    try:
        from matplotlib.path import Path
        from matplotlib.patches import PathPatch, FancyBboxPatch

        flow: dict[str, int] = {}
        for link in links:
            value = int(link["value"])
            flow[link["source"]] = flow.get(link["source"], 0) + value
            flow[link["target"]] = flow.get(link["target"], 0) + value
        selected: dict[str, list[str]] = {}
        for stage in stages:
            names = [node["name"] for node in nodes if node.get("stage") == stage and node["name"] in flow]
            selected[stage] = sorted(names, key=lambda name: flow[name], reverse=True)[:6]
        allowed = {name for names in selected.values() for name in names}
        links = [link for link in links if link["source"] in allowed and link["target"] in allowed]
        if not links:
            return _empty_chart("Alert Correlation — Detection Pipeline")

        colors = ("#7c3aed", "#0891b2", "#2563eb", "#f97316", "#dc2626")
        positions: dict[str, tuple[float, float, int]] = {}
        for stage_index, stage in enumerate(stages):
            stage_nodes = selected.get(stage, [])
            count = len(stage_nodes)
            for index, name in enumerate(stage_nodes):
                positions[name] = (stage_index, 1 - (index + 1) / (count + 1), stage_index)

        fig, ax = plt.subplots(figsize=(13.4, 6.2), facecolor=CHART_BACKGROUND)
        ax.set_facecolor(CHART_BACKGROUND)
        maximum = max(int(link["value"]) for link in links)
        for link in sorted(links, key=lambda item: int(item["value"])):
            x1, y1, source_stage = positions[link["source"]]
            x2, y2, _ = positions[link["target"]]
            value = int(link["value"])
            path = Path(
                [(x1 + .065, y1), (x1 + .42, y1), (x2 - .42, y2), (x2 - .065, y2)],
                [Path.MOVETO, Path.CURVE4, Path.CURVE4, Path.CURVE4],
            )
            ax.add_patch(PathPatch(path, facecolor="none", edgecolor=colors[source_stage],
                                   linewidth=1.2 + 9 * (value / maximum) ** .55, alpha=.25, capstyle="round"))
        for name, (x, y, stage_index) in positions.items():
            ax.add_patch(FancyBboxPatch((x - .065, y - .028), .13, .056,
                                        boxstyle="round,pad=0.008,rounding_size=0.012",
                                        facecolor=colors[stage_index], edgecolor="white", linewidth=.7))
            alignment = "right" if stage_index == len(stages) - 1 else "left"
            offset = -.085 if alignment == "right" else .085
            label = name if len(name) <= 24 else f"{name[:21]}…"
            ax.text(x + offset, y, f"{label}  {flow[name]:,}", ha=alignment, va="center",
                    color=CHART_TEXT, fontsize=7.2, weight="medium")
        for index, stage in enumerate(stages):
            ax.text(index, 1.07, stage.replace(" Framework", "\nFramework").replace("Developed ", "Developed\n"),
                    ha="center", va="bottom", color=colors[index], fontsize=9, weight="bold")
        ax.set_xlim(-.5, len(stages) - .5)
        ax.set_ylim(-.04, 1.18)
        ax.set_title("Alert Correlation — Detection Pipeline", color=CHART_TEXT, fontsize=16,
                     weight="semibold", loc="left", pad=18)
        ax.set_axis_off()
        fig.tight_layout()
        return _png_data_uri(fig, plt)
    except Exception:
        if fig is not None:
            plt.close(fig)
        logger.exception("Failed to render detection pipeline Sankey")
        return _fallback_png_data_uri("RENDER ERROR")


def _window(time_range: str, start_time: datetime | None, end_time: datetime | None) -> tuple[datetime, datetime]:
    anchor = end_time or _latest_telemetry_anchor()
    anchor = timezone.make_aware(anchor, timezone.get_current_timezone()) if timezone.is_naive(anchor) else anchor
    if time_range == "custom" and start_time:
        start = timezone.make_aware(start_time, timezone.get_current_timezone()) if timezone.is_naive(start_time) else start_time
        return start, anchor
    duration = RANGES.get(time_range, RANGES["7d"])
    return anchor - duration, anchor


def _populated_alert_time_field(queryset: QuerySet) -> str | None:
    model_fields = {field.name for field in queryset.model._meta.get_fields()}
    for field_name in ALERT_TIME_FIELDS:
        if field_name in model_fields and queryset.filter(**{f"{field_name}__isnull": False}).exists():
            return field_name
    return None


def _latest_telemetry_anchor() -> datetime:
    """Anchor relative ranges to the newest real event across SOC telemetry.

    This keeps imported or fixture-backed environments useful without mixing
    per-model clocks. Every relative window ends at the same instant, which
    makes the 24h/7d/30d alert sets mathematically nested.
    """
    candidates: list[datetime] = []
    alert_queryset = Alert.objects.all()
    alert_time_field = _populated_alert_time_field(alert_queryset)
    if alert_time_field:
        alert_latest = alert_queryset.aggregate(value=Max(alert_time_field))["value"]
        if alert_latest:
            candidates.append(alert_latest)
    for model, field_name in (
        (CorrelationEvent, "occurred_at"),
        (EventTicket, "created_time"),
        (RiskEvent, "occurred_at"),
    ):
        latest = model.objects.aggregate(value=Max(field_name))["value"]
        if latest:
            candidates.append(latest)
    if not candidates:
        return timezone.now()
    aware_candidates = [
        timezone.make_aware(value, timezone.get_current_timezone()) if timezone.is_naive(value) else value
        for value in candidates
    ]
    return max(aware_candidates)


def filter_alerts_by_time(queryset: QuerySet, start_dt: datetime, end_dt: datetime) -> QuerySet:
    """Filter alerts by the first populated event-time field.

    Event timestamps are preferred over ingestion timestamps. If legacy rows
    have no usable time field, the complete queryset is retained as an explicit
    all-time baseline rather than being silently converted into an empty range.
    """
    field_name = _populated_alert_time_field(queryset)
    if field_name is None:
        return queryset
    return queryset.filter(**{f"{field_name}__range": (start_dt, end_dt)})


def _severity_tier(value: Any) -> str:
    if value is None:
        return "unknown"
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = None
    if number is not None:
        if number <= 15:
            return "critical" if number >= 12 else "high" if number >= 9 else "medium" if number >= 6 else "low"
        return "critical" if number >= 90 else "high" if number >= 70 else "medium" if number >= 40 else "low"
    normalized = str(value).strip().lower()
    if normalized in {"critical", "crit", "fatal", "emergency", "panic"}:
        return "critical"
    if normalized in {"high", "error", "err", "severe"}:
        return "high"
    if normalized in {"medium", "med", "moderate", "warning", "warn"}:
        return "medium"
    if normalized in {"low", "info", "informational", "notice", "debug"}:
        return "low"
    return "unknown"


def _aggregate_alerts(start: datetime, end: datetime) -> tuple[dict[str, Any], str | None]:
    base_queryset = Alert.objects.all()
    time_field = _populated_alert_time_field(base_queryset)
    if time_field is None:
        logger.warning("Alert rows have no populated time field; report is using the all-time alert baseline")
        queryset = base_queryset
        baseline_count = base_queryset.count()
        window_counts = {name: baseline_count for name in RANGES}
        latest_event_time = None
    else:
        queryset = base_queryset.filter(**{f"{time_field}__range": (start, end)})
        window_counts = {
            name: base_queryset.filter(**{f"{time_field}__range": (end - duration, end)}).count()
            for name, duration in RANGES.items()
        }
        latest_event_time = base_queryset.aggregate(value=Max(time_field))["value"]

    if not window_counts["24h"] <= window_counts["7d"] <= window_counts["30d"]:
        raise RuntimeError(f"Alert window invariant failed: {window_counts}")

    category = {
        str(row["category"] or "unknown"): int(row["count"] or 0)
        for row in queryset.values("category").annotate(count=Count("pk")).order_by("-count")[:20]
    }

    severity: dict[str, int] = {}
    for row in queryset.values("severity").annotate(count=Count("pk")):
        tier = _severity_tier(row["severity"])
        severity[tier] = severity.get(tier, 0) + int(row["count"] or 0)

    top_rules = [
        {"name": str(row["rule_id"]), "count": int(row["count"] or 0)}
        for row in (
            queryset.exclude(rule_id__isnull=True)
            .exclude(rule_id="")
            .values("rule_id")
            .annotate(count=Count("pk"))
            .order_by("-count")[:10]
        )
    ]

    alert_trend: dict[str, int] = {}
    alert_score_trend: dict[str, int] = {}
    alert_trend_series: list[dict[str, Any]] = []
    alert_score_trend_series: list[dict[str, Any]] = []
    if time_field is not None:
        use_hour_buckets = end - start <= timedelta(days=2)
        bucket_expression = TruncHour(time_field) if use_hour_buckets else TruncDate(time_field)
        rows = (
            queryset.exclude(**{f"{time_field}__isnull": True})
            .annotate(bucket=bucket_expression)
            .values("bucket", "severity")
            .annotate(count=Count("pk"))
            .order_by("bucket")
        )
        weights = {"critical": 4, "high": 3, "medium": 2, "low": 1, "informational": 1, "unknown": 0}
        for row in rows:
            bucket = row["bucket"]
            if bucket is None:
                continue
            label = bucket.isoformat(timespec="hours") if use_hour_buckets else bucket.isoformat()
            tier = _severity_tier(row["severity"])
            count = int(row["count"] or 0)
            score = count * weights[tier]
            alert_trend[label] = alert_trend.get(label, 0) + count
            alert_score_trend[label] = alert_score_trend.get(label, 0) + score
            alert_trend_series.append({"time": label, "series": tier, "value": count})
            alert_score_trend_series.append({"time": label, "series": tier, "value": score})

    return {
        "total": queryset.count(),
        "category_breakdown": category,
        "severity_distribution": severity,
        "top_rules": top_rules,
        "alert_trend": alert_trend,
        "alert_score_trend": alert_score_trend,
        "alert_trend_series": alert_trend_series,
        "alert_score_trend_series": alert_score_trend_series,
        "window_counts": window_counts,
        "latest_event_time": latest_event_time.isoformat() if latest_event_time else None,
    }, time_field


def _risk_tier(score: float) -> str:
    if score >= 100:
        return "critical"
    if score >= 50:
        return "high"
    if score >= 20:
        return "medium"
    if score > 0:
        return "low"
    return "none"


def _top_risk_entities(start: datetime, end: datetime, limit: int = 5) -> list[dict[str, Any]]:
    rows = (
        RiskEvent.objects.filter(occurred_at__range=(start, end))
        .values("profile__risk_object", "profile__risk_object_type")
        .annotate(current_score=Sum("score_contribution"), total_events=Count("pk"), last_seen=Max("occurred_at"))
        .order_by("-current_score")[:limit]
    )
    entities = []
    for row in rows:
        score = max(0.0, float(row["current_score"] or 0))
        entities.append({
            "risk_object": row["profile__risk_object"],
            "risk_object_type": row["profile__risk_object_type"],
            "current_score": score,
            "tier": _risk_tier(score),
            "total_events": int(row["total_events"] or 0),
            "last_seen": row["last_seen"].isoformat() if row["last_seen"] else None,
        })
    return entities


def _duration(seconds: Any) -> str:
    if seconds is None:
        return "N/A"
    minutes = float(seconds) / 60
    return f"{minutes:.1f}m" if minutes < 60 else f"{minutes / 60:.1f}h"


def _cell(value: Any) -> str:
    return str(value if value is not None else "-").replace("|", "\\|").replace("\n", " ")


def _iso(value: datetime | None) -> str | None:
    return value.isoformat().replace("+00:00", "Z") if value else None


def _extract_trend(dashboard: Mapping[str, Any]) -> list[dict[str, Any]]:
    series = dashboard.get("alert_trend_series") or []
    if isinstance(series, list) and series:
        return [{"label": row.get("date") or row.get("label") or row.get("time"), "count": row.get("count") or row.get("value") or 0} for row in series]
    daily = dashboard.get("daily_trend") or dashboard.get("alert_trend") or {}
    return [{"label": key, "count": value} for key, value in daily.items()] if isinstance(daily, Mapping) else []


def generate_soc_report_md(time_range: str = "7d", start_time: datetime | None = None, end_time: datetime | None = None) -> dict[str, Any]:
    start, end = _window(time_range, start_time, end_time)
    dashboard, alert_time_field = _aggregate_alerts(start, end)
    severity = {str(k).lower(): int(v or 0) for k, v in (dashboard.get("severity_distribution") or dashboard.get("severity") or {}).items()}
    category = {str(k): int(v or 0) for k, v in (dashboard.get("category_breakdown") or {}).items()}
    total_alerts = int(dashboard.get("total", 0))
    top_rules = list(dashboard.get("top_rules") or [])[:5]
    trend = _extract_trend(dashboard)

    ticket_qs = EventTicket.objects.filter(created_time__gte=start, created_time__lte=end, is_deleted=False)
    real_ticket_count = ticket_qs.count()
    if real_ticket_count:
        resolved = ticket_qs.filter(status__in=("resolved", "closed")).count()
        averages = ticket_qs.aggregate(mttd=Avg("sla__mtta_seconds"), mttr=Avg("sla__mttr_seconds"))
        ticket_stats = {"total": real_ticket_count, "resolved": resolved, "mttd_seconds": averages["mttd"], "mttr_seconds": averages["mttr"]}
        open_tickets = [{"ticket": row.ticket_number, "priority": row.priority.title(), "title": row.title, "status": row.status.title()} for row in ticket_qs.filter(status__in=("new", "acknowledged", "triaged", "contained"), priority__in=("critical", "high")).order_by("-created_time")[:5]]
    else:
        ticket_stats = {"total": 0, "resolved": 0, "mttd_seconds": None, "mttr_seconds": None}; open_tickets = []
    entities = _top_risk_entities(start, end, 5)
    telemetry_freshness = {
        "alerts": dashboard.get("latest_event_time"),
        "correlation_events": _iso(CorrelationEvent.objects.aggregate(value=Max("occurred_at"))["value"]),
        "tickets": _iso(EventTicket.objects.aggregate(value=Max("created_time"))["value"]),
        "risk_events": _iso(RiskEvent.objects.aggregate(value=Max("occurred_at"))["value"]),
        "detection_rules": _iso(LocalDetectionRule.objects.aggregate(value=Max("updated_at"))["value"]),
    }

    critical_high = severity.get("critical", 0) + severity.get("high", 0)
    exposure = critical_high / max(total_alerts, 1)
    posture = "CRITICAL" if exposure >= .35 else "ELEVATED" if exposure >= .15 else "STABLE"
    resolved_rate = ticket_stats["resolved"] / max(ticket_stats["total"], 1) * 100
    alert_trend_map = dashboard.get("alert_trend") or dashboard.get("daily_trend") or {}
    alert_trend_series = dashboard.get("alert_trend_series") or []
    score_trend_map = dashboard.get("alert_score_trend") or {}
    score_trend_series = dashboard.get("alert_score_trend_series") or []
    category_chart = generate_category_chart(category)
    severity_chart = generate_severity_pie_chart(severity)
    trend_chart = _stacked_trend_chart(alert_trend_series, alert_trend_map, "Alert Trend", "Alert count")
    score_chart = _score_trend_chart(score_trend_series, score_trend_map)
    alert_qs = filter_alerts_by_time(Alert.objects.all(), start, end)
    funnel_stats = _conversion_stats(alert_qs, ticket_qs)
    pipeline_stats = _pipeline_stats(ticket_qs)
    funnel_chart = _funnel_chart(funnel_stats)
    sankey_chart = _sankey_chart(pipeline_stats)
    category_chart = category_chart or _fallback_png_data_uri("RENDER ERROR")
    severity_chart = severity_chart or _fallback_png_data_uri("RENDER ERROR")
    trend_chart = trend_chart or _fallback_png_data_uri("RENDER ERROR")
    score_chart = score_chart or _fallback_png_data_uri("RENDER ERROR")
    funnel_chart = funnel_chart or _fallback_png_data_uri("RENDER ERROR")
    sankey_chart = sankey_chart or _fallback_png_data_uri("RENDER ERROR")
    severity_rows = "\n".join(f"| {name.title()} | {severity.get(name, 0):,} | {severity.get(name, 0) / max(total_alerts, 1) * 100:.1f}% |" for name in SEVERITY_ORDER)
    rule_rows = "\n".join(f"| {index} | {_cell(rule.get('name', 'Unknown Rule'))} | {int(rule.get('count', 0)):,} |" for index, rule in enumerate(top_rules, 1)) or "| - | No data available in this time range | - |"
    ticket_rows = "\n".join(f"| `{_cell(row['ticket'])}` | **{_cell(row['priority'])}** | {_cell(row['title'])} | {_cell(row['status'])} |" for row in open_tickets) or "| - | No data available in this time range | - | - |"
    entity_rows = "\n".join(f"| {index} | `{_cell(entity.get('risk_object'))}` | {_cell(entity.get('risk_object_type'))} | **{float(entity.get('current_score', 0)):.1f}** | {_cell(entity.get('tier'))} |" for index, entity in enumerate(entities, 1)) or "| - | No data available in this time range | - | - | - |"
    if alert_time_field is None:
        fallback_note = " Alert timestamps were unavailable, so alert totals use the complete database baseline."
    elif total_alerts == 0 and telemetry_freshness["alerts"]:
        fallback_note = f" No alert events fall within this real-time window; the newest stored alert is {_cell(telemetry_freshness['alerts'])}."
    else:
        fallback_note = ""
    chart_style = "display:block; width:100%; max-width:none; height:auto; margin:16px 0 28px; border-radius:12px;"
    category_section = f'<img src="{{{{charts.category}}}}" alt="Alert Category Breakdown" style="{chart_style}" />'
    severity_section = f'<img src="{{{{charts.severity}}}}" alt="Alert Severity Distribution" style="{chart_style}" />'
    trend_section = f'<img src="{{{{charts.alert_trend}}}}" alt="Alert Trend" style="{chart_style}" />'
    score_section = f'<img src="{{{{charts.score_trend}}}}" alt="Alert Score Trend" style="{chart_style}" />'
    funnel_section = f'<img src="{{{{charts.funnel}}}}" alt="Alert Conversion Funnel" style="{chart_style}" />'
    sankey_section = f'<img src="{{{{charts.sankey}}}}" alt="Alert Correlation Detection Pipeline" style="{chart_style}" />'

    report_window = f"{start.strftime('%Y-%m-%d %H:%M UTC')} — {end.strftime('%Y-%m-%d %H:%M UTC')}"
    generated_at = timezone.now().strftime('%Y-%m-%d %H:%M UTC')
    template_context = {
        "company.name": "Argus",
        "company.logo": "/seclink-logo.png",
        "report.title": "SOC Security Operations Report",
        "report.window": report_window,
        "report.generated_at": generated_at,
        "metrics.posture": posture,
        "metrics.total_alerts": f"{total_alerts:,}",
        "metrics.critical_high_alerts": f"{critical_high:,}",
        "metrics.total_tickets": str(ticket_stats["total"]),
        "metrics.resolved_tickets": str(ticket_stats["resolved"]),
        "metrics.resolution_rate": f"{resolved_rate:.1f}%",
        "metrics.mttd": _duration(ticket_stats["mttd_seconds"]),
        "metrics.mttr": _duration(ticket_stats["mttr_seconds"]),
        "metrics.open_priority_incidents": str(len(open_tickets)),
        "charts.category": category_chart,
        "charts.severity": severity_chart,
        "charts.alert_trend": trend_chart,
        "charts.score_trend": score_chart,
        "charts.funnel": funnel_chart,
        "charts.sankey": sankey_chart,
    }

    markdown = f"""<div class="argus-report-header" style="display:flex; align-items:center; gap:14px; border-bottom:2px solid #3b82f6; padding-bottom:14px; margin-bottom:20px;">
  <img src="{{{{company.logo}}}}" alt="Company logo" class="argus-report-logo" style="width:52px; height:52px; object-fit:contain; margin:0; border:0; background:transparent;" />
  <div class="argus-report-title-group" style="display:flex; flex-direction:column; gap:5px;">
    <span class="argus-brand-wordmark argus-report-wordmark" style="font-family:'Orbitron','Share Tech Mono',monospace; font-size:28px; font-weight:800; letter-spacing:.08em; line-height:1;">{{{{company.name}}}}</span>
    <span class="argus-report-title" style="font-size:13px; font-weight:700; letter-spacing:.12em;">{{{{report.title}}}}</span>
  </div>
</div>

> **Classification:** Internal — SOC Operations  
> **Reporting Window:** {{{{report.window}}}}<br />
> **Generated:** {{{{report.generated_at}}}}

---

## 1. Executive Summary

The environment's current security posture is **{posture}**. The SOC analyzed **{total_alerts:,} alerts**, including **{critical_high:,} high or critical events ({exposure * 100:.1f}%)**, and resolved **{ticket_stats['resolved']} of {ticket_stats['total']} incident tickets ({resolved_rate:.1f}%)**. Mean detection time was **{_duration(ticket_stats['mttd_seconds'])}** and mean resolution time was **{_duration(ticket_stats['mttr_seconds'])}**.{fallback_note}

| Posture | Total Alerts | Critical + High | Resolution Rate | Open Priority Incidents |
|---|---:|---:|---:|---:|
| **{posture}** | **{total_alerts:,}** | **{critical_high:,}** | **{resolved_rate:.1f}%** | **{len(open_tickets)}** |

## 2. Core Metrics & Alert Severity

### Category Breakdown

{category_section}

### Severity Distribution

{severity_section}

| Severity | Alert Count | Share |
|---|---:|---:|
{severity_rows}

### Top 5 Triggered Detection Rules

| Rank | Detection Rule | Alerts |
|---:|---|---:|
{rule_rows}

## 3. Alert Trend & Incident Response

### Alert Trend

{trend_section}

### Score Trend

{score_section}

### Alert Conversion Funnel

{funnel_section}

### Detection Pipeline

{sankey_section}

### Response Performance

| Metric | Value |
|---|---:|
| Total Incident Tickets | **{ticket_stats['total']}** |
| Resolved Tickets | **{ticket_stats['resolved']}** |
| Resolution Rate | **{resolved_rate:.1f}%** |
| Mean Time to Detect (MTTD) | **{{{{metrics.mttd}}}}** |
| Mean Time to Respond/Resolve (MTTR) | **{{{{metrics.mttr}}}}** |

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
4. **Improve response efficiency:** Compare current MTTD (**{{{{metrics.mttd}}}}**) and MTTR (**{{{{metrics.mttr}}}}**) against SLA objectives and automate repetitive enrichment and containment steps.

---

_This report is generated from the SOC platform's alert, incident, and risk aggregation services. Analyst edits should be reviewed before external distribution._
"""
    raw_stats = {
        "time_range": time_range, "start_time": start.isoformat(), "end_time": end.isoformat(),
        "alert_time_field": alert_time_field or "all_time_baseline",
        "window_anchor": "latest_telemetry",
        "window_anchor_time": end.isoformat(),
        "window_counts": dashboard["window_counts"],
        "window_invariant": dashboard["window_counts"]["24h"] <= dashboard["window_counts"]["7d"] <= dashboard["window_counts"]["30d"],
        "telemetry_freshness": telemetry_freshness,
        "is_sample_data": False, "total_alerts": total_alerts, "severity": severity,
        "category_breakdown": category, "top_rules": top_rules, "trend": trend,
        "tickets": {**ticket_stats, "mttd": _duration(ticket_stats["mttd_seconds"]), "mttr": _duration(ticket_stats["mttr_seconds"]), "resolve_rate": round(resolved_rate, 1), "open_critical": open_tickets},
        "top_risk_entities": entities,
        "conversion_funnel": funnel_stats,
        "detection_pipeline": pipeline_stats,
        "data_provenance": {
            "risk_entities": "risk.RiskEvent grouped by profile within the report window",
            "conversion_funnel": "alerts.Alert and tickets.EventTicket using Overview stage definitions",
            "detection_pipeline": "tickets.EventTicket joined to alerts.Alert and detections.LocalDetectionRule",
        },
        "charts": {
            "category": category_chart,
            "severity": severity_chart,
            "alert_trend": trend_chart,
            "score_trend": score_chart,
            "funnel": funnel_chart,
            "sankey": sankey_chart,
            "trend": trend_chart,
        },
    }
    return {
        "markdown_content": markdown,
        "raw_stats": raw_stats,
        "template_context": template_context,
        "placeholder_catalog": [
            {**item, "token": "{{" + item["key"] + "}}", "value": template_context[item["key"]]}
            for item in PLACEHOLDER_CATALOG
        ],
    }


build_report = generate_soc_report_md
