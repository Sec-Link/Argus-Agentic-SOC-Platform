from rest_framework import serializers

from .models import LogSourceCategory


class LogSourceCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = LogSourceCategory
        fields = ["id", "name", "matchers", "asset_types", "host_field", "enabled", "sort_order"]

    def _validate_str_list(self, value, field):
        if not isinstance(value, list) or not all(isinstance(v, str) and v.strip() for v in value):
            raise serializers.ValidationError(f"{field} must be a list of non-empty strings.")
        return [v.strip() for v in value]

    def validate_matchers(self, value):
        return self._validate_str_list(value, "matchers")

    def validate_asset_types(self, value):
        return self._validate_str_list(value, "asset_types")
