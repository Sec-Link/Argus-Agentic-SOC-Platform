from django.test import SimpleTestCase

from detections.services import _mitre_rows_from_kibana_threat


def _threat(tactic_id="TA0002", techniques=None):
    return [{"tactic": {"id": tactic_id, "name": "Execution"}, "technique": techniques or []}]


class MitreRowsFromKibanaThreatTests(SimpleTestCase):
    def test_technique_and_subtechnique_rows(self):
        threat = _threat(techniques=[
            {"id": "t1059", "name": "Command and Scripting Interpreter",
             "subtechnique": [{"id": "t1059.001", "name": "PowerShell"}]},
        ])
        rows = _mitre_rows_from_kibana_threat(threat)
        self.assertEqual([r["technique_id"] for r in rows], ["T1059", "T1059.001"])
        self.assertTrue(all(r["tactic_id"] == "TA0002" for r in rows))
        self.assertEqual(rows[1]["technique_name"], "PowerShell")

    def test_non_list_input(self):
        for bad in (None, {}, "x", 5):
            with self.subTest(bad=bad):
                self.assertEqual(_mitre_rows_from_kibana_threat(bad), [])

    def test_skips_malformed_entries(self):
        threat = [
            "junk",
            {"tactic": {"name": "no id"}, "technique": [{"id": "T1"}]},  # tactic without id
            {"tactic": {"id": "TA0001"}, "technique": ["junk", {"name": "no id"}]},
        ]
        self.assertEqual(_mitre_rows_from_kibana_threat(threat), [])

    def test_tactic_without_techniques(self):
        self.assertEqual(_mitre_rows_from_kibana_threat(_threat()), [])
