from types import SimpleNamespace

from django.test import SimpleTestCase

from dashboards.event_flow import MAX_SOURCES_PER_GROUP, build_event_flow

CATS = [SimpleNamespace(id=1, name="EDR"), SimpleNamespace(id=2, name="Identity"), SimpleNamespace(id=3, name="DNS")]


def src(key, docs, cat=None, ignored=False):
    return {"source_key": key, "docs": docs, "effective_category_id": cat, "ignored": ignored}


def flow(sources, **kw):
    resolved = {"initialized": True, "window_days": 7, "scanned_at": "2026-11-05T00:00:00Z", "sources": sources}
    return build_event_flow(resolved, CATS, alerts=kw.get("alerts", 0), open_tickets=kw.get("open", 0), incidents=kw.get("inc", 0))


class BuildEventFlowTests(SimpleTestCase):
    def test_groups_sorted_by_volume_with_totals(self):
        out = flow([src("a", 10, 1), src("b", 90, 2), src("c", 5, 1)])
        self.assertEqual([g["name"] for g in out["groups"]], ["Identity", "EDR"])
        self.assertEqual(out["total_events"], 105)

    def test_ignored_sources_are_excluded(self):
        out = flow([src("a", 10, 1), src("noise", 999, 1, ignored=True)])
        self.assertEqual(out["total_events"], 10)

    def test_unclassified_group_counts_toward_total_and_stays_last(self):
        out = flow([src("x", 700, None), src("a", 3, 1)])
        self.assertEqual([g["name"] for g in out["groups"]], ["EDR", "Unclassified"])  # last despite the larger volume
        self.assertIsNone(out["groups"][-1]["category_id"])
        self.assertEqual(out["total_events"], 703)

    def test_all_sources_up_to_cap_are_returned_and_the_rest_folded(self):
        out = flow([src(f"s{i}", i + 1, 1) for i in range(8)])
        group = out["groups"][0]
        self.assertEqual(len(group["sources"]), 8)
        self.assertEqual(group["sources"][0]["source_key"], "s7")  # highest docs first
        self.assertIsNone(group["others"])
        many = flow([src(f"m{i}", 1, 1) for i in range(MAX_SOURCES_PER_GROUP + 3)])["groups"][0]
        self.assertEqual(len(many["sources"]), MAX_SOURCES_PER_GROUP)
        self.assertEqual(many["others"], {"count": 3, "docs": 3})

    def test_empty_categories_are_omitted_and_counts_passed_through(self):
        out = flow([], alerts=4, open=3, inc=1)
        self.assertEqual(out["groups"], [])
        self.assertEqual((out["alerts"], out["open_tickets"], out["incidents"]), (4, 3, 1))
