import hashlib
from urllib.parse import urlsplit

from croniter import croniter
from rest_framework import serializers

from .models import SplunkRulePublication


class SplunkRuleConfigSerializer(serializers.Serializer):
    index = serializers.RegexField(r'^[A-Za-z0-9_.-]{1,64}$')
    sourcetype = serializers.RegexField(r'^[A-Za-z0-9_:.-]{1,100}$', required=False, allow_blank=True, default='')
    cron_schedule = serializers.CharField(max_length=100, default='*/5 * * * *')
    lookback_minutes = serializers.IntegerField(min_value=1, max_value=10080, default=15)
    comparator = serializers.ChoiceField(choices=['greater than', 'less than', 'equal to'], default='greater than')
    threshold = serializers.IntegerField(min_value=0, max_value=1000000, default=0)
    digest_mode = serializers.BooleanField(default=True)
    suppress_seconds = serializers.IntegerField(min_value=0, max_value=86400, default=0)
    webhook_url = serializers.URLField(required=False, allow_blank=True, default='', max_length=512)
    email_to = serializers.ListField(child=serializers.EmailField(), max_length=10, default=list)

    def validate_cron_schedule(self, value):
        if len(value.split()) != 5 or not croniter.is_valid(value):
            raise serializers.ValidationError('Enter a valid five-field cron expression.')
        return ' '.join(value.split())

    def validate_webhook_url(self, value):
        if value:
            parsed = urlsplit(value)
            if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.query or parsed.fragment:
                raise serializers.ValidationError('Use an HTTPS webhook URL without credentials, query, or fragment.')
        return value

    def validate(self, data):
        if not data['digest_mode'] and data['suppress_seconds']:
            raise serializers.ValidationError('Suppression currently requires once-per-search triggering.')
        return data


class SplunkPublicationSaveSerializer(serializers.Serializer):
    integration_id = serializers.UUIDField()
    config = SplunkRuleConfigSerializer()


class SplunkPublicationActionSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=['publish', 'enable', 'disable', 'refresh'])
    expected_version = serializers.IntegerField(min_value=1, required=False)

    def validate(self, data):
        if data['action'] == 'publish' and 'expected_version' not in data:
            raise serializers.ValidationError({'expected_version': 'The current local rule version is required.'})
        return data


class SplunkPublicationSerializer(serializers.ModelSerializer):
    integration_id = serializers.UUIDField(read_only=True)
    integration_name = serializers.CharField(source='integration.name', read_only=True)
    rule_version = serializers.IntegerField(source='rule.version', read_only=True)
    config_changed = serializers.SerializerMethodField()
    rule_changed = serializers.SerializerMethodField()

    class Meta:
        model = SplunkRulePublication
        fields = ['id', 'integration_id', 'integration_name', 'rule_version', 'config', 'remote_name',
                  'published_version', 'published_query', 'enabled', 'status', 'message', 'config_changed', 'rule_changed', 'updated_at']

    def get_config_changed(self, instance):
        return instance.config != instance.published_config

    def get_rule_changed(self, instance):
        source = str(instance.rule.payload.get('yaml') or '')
        return hashlib.sha256(source.encode()).hexdigest() != instance.published_source_hash
