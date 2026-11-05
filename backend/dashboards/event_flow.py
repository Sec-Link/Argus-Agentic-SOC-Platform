"""Data for the Overview "events flow" diagram: log volume per source category -> alerts -> tickets."""
from .icon_upload import icon_data_url
from .models import LogSourceCategory

# Sources sent per category; the UI shows the top few and lets the user expand the rest.
MAX_SOURCES_PER_GROUP = 50
UNCLASSIFIED_NAME = "Unclassified"


def build_event_flow(resolved, categories, alerts, open_tickets, incidents):
    """Pure aggregation (no DB access) so it can be unit tested.

    `resolved` is the result of `resolve_sources()`, `categories` an iterable of objects with `id`/`name`
    ordered for display. Ignored sources are skipped; sources with no category form a final "Unclassified" group
    (always last, whatever its volume) that still counts toward the total.
    """
    groups = {}
    order = []
    for c in categories:
        groups[c.id] = {
            "category_id": c.id, "name": c.name, "icon": icon_data_url(getattr(c, "icon_png", None)),
            "total_docs": 0, "sources": [],
        }
        order.append(c.id)
    unclassified = {"category_id": None, "name": UNCLASSIFIED_NAME, "icon": None, "total_docs": 0, "sources": []}

    for s in resolved.get("sources", []):
        if s.get("ignored"):
            continue
        docs = int(s.get("docs") or 0)
        group = groups.get(s.get("effective_category_id"), unclassified)
        group["total_docs"] += docs
        group["sources"].append({
            "source_key": s["source_key"],
            "docs": docs,
            "last_seen": s.get("last_seen"),
            "hosts": s.get("hosts_approx"),
            "indices": s.get("index_count"),
            "origin": s.get("origin"),
        })

    out = []
    for gid in order + [None]:
        group = groups[gid] if gid is not None else unclassified
        if not group["sources"]:
            continue
        ranked = sorted(group["sources"], key=lambda x: (-x["docs"], x["source_key"]))
        top, rest = ranked[:MAX_SOURCES_PER_GROUP], ranked[MAX_SOURCES_PER_GROUP:]
        group["sources"] = top
        group["others"] = {"count": len(rest), "docs": sum(x["docs"] for x in rest)} if rest else None
        out.append(group)
    # Classified categories by volume; the Unclassified branch always stays at the bottom.
    out.sort(key=lambda g: (g["category_id"] is None, -g["total_docs"]))

    return {
        "initialized": bool(resolved.get("initialized")),
        "window_days": resolved.get("window_days"),
        "scanned_at": resolved.get("scanned_at"),
        "total_events": sum(g["total_docs"] for g in out),
        "groups": out,
        "alerts": alerts,
        "open_tickets": open_tickets,
        "incidents": incidents,
    }


def load_categories():
    return list(LogSourceCategory.objects.all())
