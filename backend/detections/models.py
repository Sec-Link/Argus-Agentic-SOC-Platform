import uuid

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
    change_summary = models.JSONField(default=list)
    changed_by = models.CharField(max_length=150, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "detection_rule_version"
        unique_together = ("rule", "version")
        indexes = [
            models.Index(fields=["rule", "-version"]),
        ]


class LocalDetectionRuleMitreAttack(models.Model):
    """MITRE ATT&CK mappings parsed from a detection rule's Sigma tags."""

    rule_id = models.CharField(max_length=128, db_index=True)
    kibana_rule_id = models.CharField(max_length=128, blank=True, default="", db_index=True)
    tactic_id = models.CharField(max_length=32, db_index=True)
    tactic_name = models.CharField(max_length=128)
    technique_id = models.CharField(max_length=32, db_index=True)
    technique_name = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "detection_rule_mitre_attack"
        unique_together = ("rule_id", "tactic_id", "technique_id")
        indexes = [
            models.Index(fields=["rule_id", "tactic_id"]),
            models.Index(fields=["tactic_id", "technique_id"]),
        ]


class MitreAttackTactic(models.Model):
    tactic_id = models.CharField(max_length=32, unique=True, db_index=True)
    name = models.CharField(max_length=128)
    shortname = models.CharField(max_length=128, unique=True, db_index=True)
    reference_url = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "mitre_attack_tactic"


class MitreAttackTechnique(models.Model):
    technique_id = models.CharField(max_length=32, unique=True, db_index=True)
    name = models.CharField(max_length=255)
    reference_url = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "mitre_attack_technique"


class MitreAttackTechniqueTactic(models.Model):
    technique = models.ForeignKey(MitreAttackTechnique, on_delete=models.CASCADE, related_name="tactic_links")
    tactic = models.ForeignKey(MitreAttackTactic, on_delete=models.CASCADE, related_name="technique_links")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "mitre_attack_technique_tactic"
        unique_together = ("technique", "tactic")
        indexes = [
            models.Index(fields=["technique", "tactic"]),
            models.Index(fields=["tactic", "technique"]),
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
    elastic_is_multivalue = models.BooleanField(default=False)
    elastic_index_patterns = models.JSONField(default=list, blank=True)
    created_by = models.CharField(max_length=150, blank=True, default="")
    updated_by = models.CharField(max_length=150, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "detection_field_mapping"
        unique_together = ("mapping_profile", "sigma_field")


class LocalDetectionDeployment(models.Model):
    """Persisted detection publish/deployment audit record."""

    deployment_uuid = models.UUIDField(default=uuid.uuid4, unique=True, editable=False, db_index=True)
    rule = models.ForeignKey(LocalDetectionRule, on_delete=models.CASCADE, related_name="deployments")
    rule_name = models.CharField(max_length=255, blank=True, default="")
    target = models.CharField(max_length=64, db_index=True)
    action = models.CharField(max_length=64, db_index=True)
    status = models.CharField(max_length=32, db_index=True)
    remote_id = models.CharField(max_length=128, blank=True, default="")
    remote_rule_id = models.CharField(max_length=128, blank=True, default="")
    message = models.TextField(blank=True, default="")
    payload = models.JSONField(default=dict)
    created_by = models.CharField(max_length=150, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "detection_deployment"
        indexes = [
            models.Index(fields=["rule", "-created_at"]),
            models.Index(fields=["target", "status"]),
        ]
