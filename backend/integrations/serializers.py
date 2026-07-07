from rest_framework import serializers
from accounts.services import is_user_readonly
from .models import Integration


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
        if t and t not in {'elasticsearch', 'kibana'}:
            raise serializers.ValidationError('only elasticsearch and kibana integrations are supported')
        return data
