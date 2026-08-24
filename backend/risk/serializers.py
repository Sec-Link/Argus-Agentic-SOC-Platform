from rest_framework import serializers
from .models import GlobalRiskConfig, NotableEvent, RiskEvent, RiskObjectProfile, RiskRuleConfig, RiskScoreEntry


class GlobalRiskConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = GlobalRiskConfig
        fields = ['id', 'risk_object_fields', 'field_aliases', 'updated_by', 'updated_at']
        read_only_fields = ['id', 'updated_at']


class RiskRuleConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = RiskRuleConfig
        fields = ['id', 'rule_uuid', 'risk_object_fields', 'field_aliases', 'base_score_override', 'enabled', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']


class RiskScoreEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = RiskScoreEntry
        fields = ['id', 'entry_type', 'delta', 'score_after', 'note', 'created_at']


class RiskEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = RiskEvent
        fields = ['id', 'alert_id', 'rule_uuid', 'rule_name', 'severity', 'score_contribution', 'occurred_at']


class RiskObjectProfileSerializer(serializers.ModelSerializer):
    recent_events = serializers.SerializerMethodField()
    score_history = serializers.SerializerMethodField()

    class Meta:
        model = RiskObjectProfile
        fields = [
            'id', 'risk_object', 'risk_object_type',
            'current_score', 'peak_score_24h', 'total_events',
            'status', 'last_seen', 'created_at', 'updated_at',
            'recent_events', 'score_history',
        ]

    def get_recent_events(self, obj):
        events = obj.events.order_by('-occurred_at')[:10]
        return RiskEventSerializer(events, many=True).data

    def get_score_history(self, obj):
        entries = obj.score_entries.order_by('-created_at')[:20]
        return RiskScoreEntrySerializer(entries, many=True).data


class RiskObjectProfileListSerializer(serializers.ModelSerializer):
    class Meta:
        model = RiskObjectProfile
        fields = ['id', 'risk_object', 'risk_object_type', 'current_score', 'peak_score_24h',
                  'total_events', 'status', 'last_seen']


class NotableEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotableEvent
        fields = [
            'id', 'risk_object', 'risk_object_type',
            'score_at_trigger', 'threshold_used', 'contributing_event_count',
            'status', 'triggered_at', 'resolved_at', 'resolved_by',
        ]
        read_only_fields = ['id', 'triggered_at', 'resolved_at']
