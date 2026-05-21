from rest_framework import serializers
from accounts.services import is_user_readonly
from .models import Integration


SENSITIVE_CONFIG_KEYS = frozenset({"password", "token", "conn_str", "api_key", "secret"})
REDACTED_VALUE = "***"


class IntegrationSerializer(serializers.ModelSerializer):
    """
    Serializer for Integration records.

    - Maps the `Integration` model to API input/output payloads.
    - Adds validation for database integrations (postgresql/mysql) so they
      include enough connection information.
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
        # Use incoming values first, then fall back to the existing instance for updates.
        t = data.get('type') or (self.instance.type if self.instance else None)
        cfg = data.get('config') or (self.instance.config if self.instance else {})
        # Database integrations must provide conn_str, django_db, or host+user+dbname.
        if t in ('postgresql', 'mysql'):
            if not cfg:
                raise serializers.ValidationError('config required for database integrations')
            if not (cfg.get('conn_str') or cfg.get('django_db') or (cfg.get('host') and cfg.get('user') and (cfg.get('dbname') or cfg.get('database')))):
                raise serializers.ValidationError('postgresql/mysql integrations require conn_str or django_db or host+user+dbname')
        return data
