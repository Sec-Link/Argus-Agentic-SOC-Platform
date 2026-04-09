from rest_framework import serializers
from .models import CorrelationPolicy, CorrelationEvent


class CorrelationPolicySerializer(serializers.ModelSerializer):
    class Meta:
        model = CorrelationPolicy
        fields = [
            'enabled',
            'window_minutes',
            'match_keys',
            'match_risk_object',
            'match_detection_rule',
            'match_source_ip',
            'match_username',
            'time_window_hours',
            'match_action',
            'rules_expression',
        ]


class CorrelationEventSerializer(serializers.ModelSerializer):
    alert_count = serializers.SerializerMethodField()

    class Meta:
        model = CorrelationEvent
        fields = ['ticket_id', 'alert_ids', 'threat_object', 'matched_keys', 'occurred_at', 'alert_count']

    def get_alert_count(self, obj):
        return len(obj.alert_ids or [])
