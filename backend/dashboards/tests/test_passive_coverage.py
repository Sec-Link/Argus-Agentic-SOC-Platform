from unittest import mock

from django.test import SimpleTestCase

from dashboards import log_source_discovery as discovery


class PassiveSnapshotTests(SimpleTestCase):
    def test_no_snapshot_does_not_scan_or_touch_es(self):
        with mock.patch.object(discovery, "load_snapshot", return_value=None), \
             mock.patch.object(discovery, "_es_client") as es, \
             mock.patch.object(discovery, "run_scan") as scan:
            snap, error = discovery.ensure_snapshot(allow_scan=False)
        self.assertIsNone(snap)
        self.assertTrue(error)
        es.assert_not_called()
        scan.assert_not_called()

    def test_existing_snapshot_is_returned_without_scanning(self):
        stored = object()
        with mock.patch.object(discovery, "load_snapshot", return_value=stored), \
             mock.patch.object(discovery, "run_scan") as scan:
            snap, error = discovery.ensure_snapshot(allow_scan=False)
        self.assertIs(snap, stored)
        self.assertIsNone(error)
        scan.assert_not_called()

    def test_explicit_rescan_is_ignored_when_scanning_not_allowed(self):
        with mock.patch.object(discovery, "load_snapshot", return_value=None), \
             mock.patch.object(discovery, "run_scan") as scan, \
             mock.patch.object(discovery.LogSourceCategory.objects, "all", return_value=[]), \
             mock.patch.object(discovery.LogSourceMapping.objects, "all", return_value=[]):
            result = discovery.resolve_sources(rescan_actor="someone", allow_scan=False)
        scan.assert_not_called()
        self.assertFalse(result["initialized"])
