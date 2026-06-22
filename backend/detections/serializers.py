from rest_framework import serializers

from .models import LocalDetectionDeployment, LocalDetectionFieldMapping


class DetectionRuleSaveSerializer(serializers.Serializer):
    yaml = serializers.CharField(required=True, allow_blank=False)
    elastic_actions = serializers.ListField(required=False)
    elastic_index_patterns = serializers.ListField(
        child=serializers.CharField(allow_blank=False),
        required=False,
    )
    kibana_metadata = serializers.DictField(required=False)


class DetectionRuleCompileSerializer(serializers.Serializer):
    yaml = serializers.CharField(required=True, allow_blank=False)


class DetectionMappingSerializer(serializers.ModelSerializer):
    sigma = serializers.CharField(source="sigma_field")
    splunk = serializers.CharField(source="splunk_field")
    elastic = serializers.CharField(source="elastic_field")

    class Meta:
        model = LocalDetectionFieldMapping
        fields = (
            "id",
            "category",
            "data_source",
            "event_category",
            "mapping_profile",
            "sigma",
            "splunk",
            "elastic",
        )


class DetectionMappingSaveSerializer(serializers.Serializer):
    mapping_profile = serializers.CharField(required=True, allow_blank=False)
    sigma = serializers.CharField(required=True, allow_blank=False)
    splunk = serializers.CharField(required=False, allow_blank=True, default="")
    elastic = serializers.CharField(required=False, allow_blank=True, default="")
    category = serializers.CharField(required=False, allow_blank=True, default="")
    data_source = serializers.CharField(required=False, allow_blank=True, default="")
    event_category = serializers.CharField(required=False, allow_blank=True, default="")


class DetectionMappingDeleteSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.CharField(allow_blank=False), required=True, allow_empty=False)


class DetectionDeploymentSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(source="deployment_uuid", read_only=True)
    rule_id = serializers.CharField(source="rule.rule_uuid", read_only=True)

    class Meta:
        model = LocalDetectionDeployment
        fields = (
            "id",
            "rule_id",
            "rule_name",
            "target",
            "action",
            "status",
            "remote_id",
            "remote_rule_id",
            "message",
            "payload",
            "created_by",
            "created_at",
        )


class DetectionDeploymentCreateSerializer(serializers.Serializer):
    rule_id = serializers.CharField(required=True, allow_blank=False)
    target = serializers.CharField(required=True, allow_blank=False)
    action = serializers.CharField(required=True, allow_blank=False)
    status = serializers.CharField(required=True, allow_blank=False)
    remote_id = serializers.CharField(required=False, allow_blank=True)
    remote_rule_id = serializers.CharField(required=False, allow_blank=True)
    message = serializers.CharField(required=False, allow_blank=True)
    payload = serializers.JSONField(required=False)


class KibanaPublishedRuleListQuerySerializer(serializers.Serializer):
    page = serializers.IntegerField(required=False, min_value=1, default=1)
    per_page = serializers.IntegerField(required=False, min_value=1, max_value=10000, default=20)
    filter = serializers.CharField(required=False, allow_blank=True, default="")
    sort_field = serializers.CharField(required=False, allow_blank=True, default="updated_at")
    sort_order = serializers.ChoiceField(required=False, choices=["asc", "desc"], default="desc")


class KibanaRollbackSerializer(serializers.Serializer):
    version = serializers.IntegerField(required=True, min_value=1)
