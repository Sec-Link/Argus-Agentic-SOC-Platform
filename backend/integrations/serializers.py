from urllib.parse import urlsplit

from rest_framework import serializers
from accounts.services import is_user_readonly
from .models import Integration


class SplunkConnectionConfigSerializer(serializers.Serializer):
    host = serializers.URLField(max_length=512)
    auth_type = serializers.ChoiceField(choices=['basic', 'token'], default='basic')
    token_type = serializers.ChoiceField(choices=['bearer', 'session'], default='session')
    username = serializers.CharField(required=False, allow_blank=True, max_length=256)
    password = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False, max_length=4096)
    token = serializers.CharField(required=False, allow_blank=True, max_length=4096)
    verify_certs = serializers.BooleanField(default=True)

    def validate_host(self, value):
        parsed = urlsplit(value)
        try:
            port = parsed.port
        except ValueError:
            raise serializers.ValidationError('Invalid port.')
        if (parsed.scheme not in {'http', 'https'} or not parsed.hostname
                or parsed.username is not None or parsed.password is not None
                or parsed.path not in {'', '/'} or parsed.query or parsed.fragment
                or port == 0):
            raise serializers.ValidationError('Use an HTTP(S) origin without credentials, path, or query.')
        return value.rstrip('/')


class SplunkConfigSerializer(SplunkConnectionConfigSerializer):
    index = serializers.RegexField(r'^[A-Za-z0-9_.-]+$', max_length=64)
    lookback_hours = serializers.IntegerField(min_value=1, max_value=168, default=24)


class SplunkPublisherConfigSerializer(SplunkConnectionConfigSerializer):
    auth_type = serializers.ChoiceField(choices=['basic', 'token'], default='token')
    token_type = serializers.ChoiceField(choices=['bearer', 'session'], default='bearer')
    app = serializers.RegexField(r'^[A-Za-z0-9_-]+$', max_length=100, default='search')
    owner = serializers.RegexField(r'^[A-Za-z0-9_][A-Za-z0-9_@.-]*$', max_length=100)

    def validate_host(self, value):
        value = super().validate_host(value)
        if not value.startswith('https://'):
            raise serializers.ValidationError('Splunk publishing requires HTTPS.')
        return value


def validate_splunk_config(config, previous=None, *, publisher=False):
    if not isinstance(config, dict):
        raise serializers.ValidationError({'config': 'Expected an object.'})
    previous = previous or {}
    merged = {**previous, **config}
    for key in ('password', 'token'):
        if config.get(key) == '***':
            raise serializers.ValidationError({'config': {key: 'Enter a new credential or leave blank to keep it.'}})
        if not config.get(key) and previous.get(key):
            merged[key] = previous[key]
    validator_class = SplunkPublisherConfigSerializer if publisher else SplunkConfigSerializer
    validator = validator_class(data=merged)
    validator.is_valid(raise_exception=True)
    result = dict(validator.validated_data)
    credential = 'password' if result['auth_type'] == 'basic' else 'token'
    target_changed = previous and any(
        result.get(key) != previous.get(key) for key in ('host', 'auth_type', 'username')
    )
    target_changed = target_changed or (previous and result['token_type'] != previous.get('token_type', 'bearer' if publisher else 'session'))
    if target_changed and not config.get(credential):
        raise serializers.ValidationError({'config': {credential: 'Re-enter the credential when changing the connection identity.'}})
    if not result.get(credential) or (credential == 'password' and not result.get('username')):
        raise serializers.ValidationError({'config': 'Supply a username/password or a Splunk management token.'})
    if credential == 'password':
        result.pop('token', None)
    else:
        result.pop('username', None)
        result.pop('password', None)
    return result


class SplunkFetchSerializer(serializers.Serializer):
    size = serializers.IntegerField(min_value=1, max_value=1000, default=500)


SENSITIVE_CONFIG_KEYS = frozenset({"password", "token", "conn_str", "api_key", "secret"})
REDACTED_VALUE = "***"


class IntegrationSerializer(serializers.ModelSerializer):
    """
    Serializer for Integration records.

    - Maps the `Integration` model to API input/output payloads.
    - Redacts sensitive config fields (password/token/conn_str, etc.) for
      readonly guest users.
    """
    class Meta:
        model = Integration
        fields = '__all__'

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request') if hasattr(self, 'context') else None
        user = getattr(request, 'user', None) if request else None
        if instance.type in {'splunk_search', 'splunk_rule_publisher'}:
            cfg = dict(data.get('config') or {})
            for key in SENSITIVE_CONFIG_KEYS:
                value = cfg.pop(key, None)
                cfg[f'{key}_configured'] = bool(value)
            data['config'] = cfg
            return data
        if is_user_readonly(user):
            cfg = data.get('config')
            if isinstance(cfg, dict):
                data['config'] = {
                    k: (REDACTED_VALUE if (k in SENSITIVE_CONFIG_KEYS and v) else v)
                    for k, v in cfg.items()
                }
        return data

    def validate(self, data):
        t = data.get('type') or (self.instance.type if self.instance else None)
        if t and t not in {'elasticsearch', 'kibana', 'splunk_search', 'splunk_rule_publisher'}:
            raise serializers.ValidationError('Unsupported integration type.')
        if self.instance and self.instance.type != t and {self.instance.type, t} & {'splunk_search', 'splunk_rule_publisher'}:
            raise serializers.ValidationError('Create a separate integration to change connector type.')
        if t in {'splunk_search', 'splunk_rule_publisher'}:
            previous = self.instance.config if self.instance else None
            data['config'] = validate_splunk_config(data.get('config', {}), previous, publisher=t == 'splunk_rule_publisher')
            if self.instance and t == 'splunk_rule_publisher':
                if any(data['config'].get(key) != previous.get(key) for key in ('host', 'app', 'owner')):
                    if self.instance.detection_publications.exists():
                        raise serializers.ValidationError('Remove Splunk rule bindings before changing the publisher target.')
        return data
