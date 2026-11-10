from unittest import mock

from django.test import SimpleTestCase

from detections import kibana_service


class FakeRule:
    """Stands in for LocalDetectionRule so the sync logic runs without a database."""

    def __init__(self, uuid, enabled, published=True, remote_id="r1"):
        self.rule_uuid = uuid
        self.enabled = enabled
        self.version = 1
        self.updated_by = ""
        meta = {"published": published, "enabled": enabled, "remote_id": remote_id} if published else {}
        self.payload = {"kibana_metadata": meta, "kibana_rule_id": remote_id} if published else {}

    def save(self, **kwargs):
        pass


def run_sync(rules, remote):
    qs = mock.MagicMock()
    qs.iterator.side_effect = lambda: iter(rules)
    saved = []
    with mock.patch.object(kibana_service, "kibana_proxy", return_value=(200, {"data": remote, "total": len(remote)})), \
         mock.patch.object(kibana_service.LocalDetectionRule.objects, "filter", return_value=qs), \
         mock.patch.object(kibana_service, "append_rule_version", side_effect=lambda r, **kw: saved.append((r.rule_uuid, kw))), \
         mock.patch.object(kibana_service.transaction, "atomic", mock.MagicMock()):
        status, result = kibana_service.sync_rules_from_kibana("tester")
    return status, result, saved


class KibanaSyncTests(SimpleTestCase):
    def test_empty_remote_aborts_without_changes(self):
        rules = [FakeRule("a", True), FakeRule("b", True)]
        status, result, saved = run_sync(rules, [])
        self.assertEqual(status, 409)
        self.assertIn("refusing to unpublish 2", result["detail"])
        self.assertEqual(saved, [])
        self.assertTrue(all(r.enabled for r in rules))

    def test_empty_remote_with_nothing_published_is_fine(self):
        status, result, saved = run_sync([FakeRule("a", True, published=False)], [])
        self.assertEqual(status, 200)
        self.assertEqual(result["checked"], 0)

    def test_missing_rule_is_unpublished_and_versioned(self):
        keep, gone = FakeRule("a", True, remote_id="ra"), FakeRule("b", True, remote_id="rb")
        status, result, saved = run_sync([keep, gone], [{"rule_id": "a", "id": "ra", "enabled": True}])
        self.assertEqual(status, 200)
        self.assertEqual(result["marked_unpublished"], 1)
        self.assertFalse(gone.enabled)
        self.assertTrue(keep.enabled)
        self.assertEqual([s[0] for s in saved], ["b"])
        self.assertEqual(saved[0][1]["change_type"], "kibana_sync")

    def test_enabled_flip_is_versioned(self):
        rule = FakeRule("a", True, remote_id="ra")
        status, result, saved = run_sync([rule], [{"rule_id": "a", "id": "ra", "enabled": False}])
        self.assertEqual(result["enabled_changed"], 1)
        self.assertFalse(rule.enabled)
        self.assertEqual(len(saved), 1)

    def test_unchanged_rule_writes_nothing(self):
        rule = FakeRule("a", True, remote_id="ra")
        status, result, saved = run_sync([rule], [{"rule_id": "a", "id": "ra", "enabled": True}])
        self.assertEqual(result["unchanged"], 1)
        self.assertEqual(saved, [])
