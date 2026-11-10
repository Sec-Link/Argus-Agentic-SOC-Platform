from django.test import SimpleTestCase

from dashboards.log_source_classifier import (
    UNCLASSIFIED,
    classify_source,
    is_internal_source,
    normalize_source_key,
)


class NormalizeSourceKeyTests(SimpleTestCase):
    def test_backing_index_of_data_stream(self):
        self.assertEqual(
            normalize_source_key(".ds-logs-okta.system-default-2026.10.01-000001"),
            "logs-okta.system-*",
        )

    def test_beat_version_and_date_suffix(self):
        self.assertEqual(normalize_source_key("winlogbeat-8.11.0-2026.10.27"), "winlogbeat-*")

    def test_plain_name_unchanged(self):
        self.assertEqual(normalize_source_key("fw-logs"), "fw-logs")


class InternalSourceTests(SimpleTestCase):
    def test_hidden_indices_are_internal(self):
        self.assertTrue(is_internal_source(".kibana_8.11.0"))
        self.assertTrue(is_internal_source(".alerts-security.alerts-default"))

    def test_data_stream_backing_index_is_not_internal(self):
        self.assertFalse(is_internal_source(".ds-logs-okta.system-default-2026.10.01-000001"))
        self.assertFalse(is_internal_source("winlogbeat-*"))


class ClassifySourceTests(SimpleTestCase):
    def test_name_rules(self):
        cases = {
            "logs-okta.system-*": "Identity",
            "logs-crowdstrike.fdr-*": "EDR",
            "winlogbeat-*": "Endpoint",
            "logs-aws.cloudtrail-*": "Cloud",
            "logs-panw.panos-*": "Firewall",
        }
        for key, expected in cases.items():
            with self.subTest(key=key):
                self.assertEqual(classify_source(key)["category"], expected)

    def test_specific_rule_wins_over_generic(self):
        # "crowdstrike" (EDR) must win over the generic Endpoint rules.
        self.assertEqual(classify_source("logs-crowdstrike.fdr-*", datasets=["windows"])["category"], "EDR")

    def test_ecs_category_fallback_is_medium_confidence(self):
        result = classify_source("custom-app-*", categories=["authentication"])
        self.assertEqual(result["category"], "Identity")
        self.assertEqual(result["confidence"], "medium")

    def test_unclassified(self):
        result = classify_source("totally-unknown-*")
        self.assertEqual(result["category"], UNCLASSIFIED)
        self.assertEqual(result["confidence"], "none")
