import re

from rest_framework import serializers

from .icon_upload import icon_data_url
from .models import LogSourceCategory


class LogSourceCategorySerializer(serializers.ModelSerializer):
    # Read-only: set through the dedicated icon endpoint, which sanitizes the upload.
    icon = serializers.SerializerMethodField()

    class Meta:
        model = LogSourceCategory
        fields = ["id", "name", "matchers", "asset_types", "host_field", "enabled", "sort_order", "icon"]

    def get_icon(self, obj):
        return icon_data_url(obj.icon_png)

    def _validate_str_list(self, value, field):
        if not isinstance(value, list) or not all(isinstance(v, str) and v.strip() for v in value):
            raise serializers.ValidationError(f"{field} must be a list of non-empty strings.")
        if len(value) > 100 or any(len(v) > 255 for v in value):
            raise serializers.ValidationError(f"{field} accepts up to 100 values of at most 255 characters.")
        return [v.strip() for v in value]

    def validate_matchers(self, value):
        return self._validate_str_list(value, "matchers")

    def validate_asset_types(self, value):
        return self._validate_str_list(value, "asset_types")

    def validate_host_field(self, value):
        if self.context.get("platform") == "splunk" and value and not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.]{0,127}", value):
            raise serializers.ValidationError("Use a literal field name, not a search expression.")
        return value

    def validate(self, attrs):
        platform = self.context.get("platform", "elk")
        name = attrs.get("name", getattr(self.instance, "name", ""))
        matches = LogSourceCategory.objects.filter(platform=platform, name=name)
        if self.instance:
            matches = matches.exclude(pk=self.instance.pk)
        if matches.exists():
            raise serializers.ValidationError({"name": "This platform already has a category with this name."})
        return attrs
