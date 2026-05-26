from django.db import models


class LocalDetectionRule(models.Model):
    """Locally persisted detection rule with current snapshot."""

    rule_uuid = models.CharField(max_length=128, unique=True, db_index=True)
    name = models.CharField(max_length=255, db_index=True)
    enabled = models.BooleanField(default=False, db_index=True)
    rule_type = models.CharField(max_length=64, default="query", db_index=True)
    severity = models.CharField(max_length=32, default="low", db_index=True)
    risk_score = models.IntegerField(default=50)
    version = models.IntegerField(default=1)
    payload = models.JSONField(default=dict)
    is_deleted = models.BooleanField(default=False, db_index=True)
    created_by = models.CharField(max_length=150, blank=True, default="")
    updated_by = models.CharField(max_length=150, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "detection_rule"


class LocalDetectionRuleVersion(models.Model):
    """Immutable version history for LocalDetectionRule."""

    rule = models.ForeignKey(LocalDetectionRule, on_delete=models.CASCADE, related_name="versions")
    version = models.IntegerField()
    change_type = models.CharField(max_length=20, default="update")
    payload = models.JSONField(default=dict)
    changed_by = models.CharField(max_length=150, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "detection_rule_version"
        unique_together = ("rule", "version")
        indexes = [
            models.Index(fields=["rule", "-version"]),
        ]


class LocalDetectionFieldMapping(models.Model):
    """Persisted field mapping rows (Sigma -> Splunk/Elastic)."""

    category = models.CharField(max_length=64, blank=True, default="")
    data_source = models.CharField(max_length=128, blank=True, default="")
    event_category = models.CharField(max_length=128, blank=True, default="")
    mapping_profile = models.CharField(max_length=128, db_index=True)
    sigma_field = models.CharField(max_length=255)
    splunk_field = models.CharField(max_length=255, blank=True, default="")
    elastic_field = models.CharField(max_length=255, blank=True, default="")
    created_by = models.CharField(max_length=150, blank=True, default="")
    updated_by = models.CharField(max_length=150, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "detection_field_mapping"
        unique_together = ("mapping_profile", "sigma_field")
