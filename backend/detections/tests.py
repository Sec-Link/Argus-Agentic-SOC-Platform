from unittest.mock import patch

from django.test import SimpleTestCase

from .serializers import DetectionRuleSaveSerializer
from .services import build_local_rule_payload
from .sigma import compile_queries_from_yaml, extract_rule_id, extract_rule_meta


VALUE_SUM_CORRELATION_SIGMA = """
title: Entity Risk Score Over 100
id: 7e54c3b6-9b95-4ac7-91f0-100000000001
status: test
description: Aggregate normalized risk events by risk object.
logsource:
  product: argus
  category: risk
correlation:
  type: value_sum
  rules:
    - argus_risk_events
  group-by:
    - risk_object_type
    - risk_object
  timespan: 15m
  condition:
    field: risk_score
    gt: 100
level: high
"""


class ValueSumCorrelationCompilationTests(SimpleTestCase):
    @patch("detections.sigma._elastic_field_mapping_for_profiles", return_value={})
    @patch("detections.sigma._elastic_multivalue_fields_for_profiles", return_value=[])
    @patch("detections.sigma._elastic_index_patterns_for_profiles", return_value=["argus-risk-events"])
    @patch(
        "detections.sigma._sigma_runtime",
        return_value={"ESQLBackend": object(), "LuceneBackend": object()},
    )
    def test_compiles_value_sum_correlation_to_grouped_esql(
        self,
        _runtime,
        _index_patterns,
        _multivalue_fields,
        _field_mapping,
    ):
        compiled = compile_queries_from_yaml(VALUE_SUM_CORRELATION_SIGMA)

        self.assertEqual(compiled["language"], "esql")
        self.assertEqual(compiled["elastic_index_patterns"], ["argus-risk-events"])
        self.assertIn("FROM argus-risk-events METADATA", compiled["esql"])
        self.assertNotIn("event_kind", compiled["esql"])
        self.assertIn("@timestamp >= NOW() - 15 minutes", compiled["esql"])
        self.assertIn(
            "STATS risk_score = SUM(risk_score), risk_event_count = COUNT(*) "
            "BY risk_object_type, risk_object",
            compiled["esql"],
        )
        self.assertIn("WHERE risk_score > 100", compiled["esql"])
        self.assertEqual(compiled["risk_incident"]["group_by"], ["risk_object_type", "risk_object"])
        self.assertEqual(compiled["risk_incident"]["source"], "sigma_correlation")
        self.assertEqual(compiled["risk_incident"]["correlation_type"], "value_sum")
        self.assertNotIn("suppression", compiled["risk_incident"])

    @patch("detections.sigma._elastic_multivalue_fields_for_profiles", return_value=[])
    @patch("detections.sigma._elastic_index_patterns_for_profiles", return_value=["argus-risk-events"])
    def test_rejects_invalid_value_sum_timespan(self, _index_patterns, _multivalue_fields):
        compiled = compile_queries_from_yaml(VALUE_SUM_CORRELATION_SIGMA.replace("timespan: 15m", "timespan: fifteen"))

        self.assertEqual(compiled["esql"], "*")
        self.assertIn("value_sum correlation timespan", compiled["error"])

    def test_correlation_document_controls_rule_identity_and_metadata(self):
        self.assertEqual(extract_rule_id(VALUE_SUM_CORRELATION_SIGMA), "7e54c3b6-9b95-4ac7-91f0-100000000001")
        meta = extract_rule_meta(VALUE_SUM_CORRELATION_SIGMA)
        self.assertEqual(meta["title"], "Entity Risk Score Over 100")
        self.assertEqual(meta["profile"], "argus_risk")


class EntityRiskConfigurationTests(SimpleTestCase):
    def test_new_rule_has_no_implicit_entity_risk(self):
        payload = build_local_rule_payload(
            rule_id="rule-without-risk",
            yaml_text="title: No Risk\nid: rule-without-risk\nlogsource:\n  product: linux\ndetection:\n  selection:\n    test: value\n  condition: selection\n",
        )

        self.assertFalse(payload["entity_risk_enabled"])
        self.assertEqual(payload["risk_entities"], [])

    def test_empty_entities_are_valid_when_entity_risk_is_disabled(self):
        serializer = DetectionRuleSaveSerializer(data={
            "yaml": "title: No Risk",
            "entity_risk_enabled": False,
            "risk_entities": [],
        })

        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_entity_risk_requires_an_entity_when_enabled(self):
        serializer = DetectionRuleSaveSerializer(data={
            "yaml": "title: Invalid Risk",
            "entity_risk_enabled": True,
            "risk_entities": [],
        })

        self.assertFalse(serializer.is_valid())
        self.assertIn("risk_entities", serializer.errors)

    def test_schedule_uses_kibana_interval_and_lookback_formats(self):
        serializer = DetectionRuleSaveSerializer(data={
            "yaml": "title: Scheduled Risk",
            "schedule_interval": "1m",
            "schedule_from": "now-16m",
        })

        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_manual_esql_is_persisted_with_source(self):
        payload = build_local_rule_payload(
            rule_id="manual-esql",
            yaml_text="title: Manual ES|QL",
            esql="FROM logs-* | WHERE event.action == \"login\"",
            esql_source="manual",
        )

        self.assertEqual(payload["esql_source"], "manual")
        self.assertEqual(payload["esql"], 'FROM logs-* | WHERE event.action == "login"')

    def test_autogenerated_esql_source_clears_manual_override(self):
        payload = build_local_rule_payload(
            rule_id="manual-esql",
            yaml_text="title: Manual ES|QL",
            esql="FROM logs-*",
            esql_source="manual",
        )
        refreshed = build_local_rule_payload(
            rule_id="manual-esql",
            yaml_text="title: Manual ES|QL",
            current_rule=type("Rule", (), {
                "payload": payload,
                "rule_uuid": "manual-esql",
                "name": "manual-esql",
                "rule_type": "query",
                "enabled": False,
                "severity": "low",
                "risk_score": 50,
            })(),
            esql_source="autogenerated",
        )

        self.assertEqual(refreshed["esql_source"], "autogenerated")
        self.assertNotIn("esql", refreshed)

    def test_risk_object_entity_uses_the_standard_entity_configuration(self):
        serializer = DetectionRuleSaveSerializer(data={
            "yaml": "title: Dynamic Risk Object",
            "entity_risk_enabled": True,
            "risk_entities": [{
                "entity_type": "risk_object",
                "entity_field": "risk_object",
                "risk_score": 64,
                "output": "notable",
            }],
        })

        self.assertTrue(serializer.is_valid(), serializer.errors)
