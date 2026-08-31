from django.db import models
from django.utils import timezone


class GlobalRiskConfig(models.Model):
    """Singleton: platform-wide default risk_object field definitions.

    risk_object_fields format:
      [{"field": "source.ip", "type": "ip"}, {"field": "user.name", "type": "user"}]

    Per-rule RiskRuleConfig overrides these when present and enabled.
    """
    risk_object_fields = models.JSONField(default=list)
    field_aliases = models.JSONField(default=list, blank=True)
    updated_by = models.CharField(max_length=150, blank=True, default='')
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'risk_global_config'


class RiskRuleConfig(models.Model):
    """Which fields of a detection rule are risk objects, and their types.

    risk_object_fields format:
      [{"field": "src.ip", "type": "ip"}, {"field": "user.name", "type": "user"}]

    Stored separately from LocalDetectionRule so the risk module can be
    disabled/removed without touching the detections app.
    """
    rule_uuid = models.CharField(max_length=128, unique=True, db_index=True)
    risk_object_fields = models.JSONField(default=list)
    field_aliases = models.JSONField(default=list, blank=True)
    # Base score override (0 = use rule's own risk_score)
    base_score_override = models.IntegerField(default=0)
    enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'risk_rule_config'


class RiskObjectProfile(models.Model):
    """Running risk profile for a single entity (e.g. one IP address).

    current_score accumulates across all RiskEvents and decays over time.
    The profile is the authoritative source for "how risky is this entity now".
    """
    OBJECT_TYPES = [
        ('ip', 'IP Address'),
        ('user', 'User'),
        ('host', 'Host'),
        ('hash', 'File Hash'),
        ('domain', 'Domain'),
        ('other', 'Other'),
    ]
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('resolved', 'Resolved'),
    ]

    risk_object = models.CharField(max_length=512, db_index=True)
    risk_object_type = models.CharField(max_length=32, choices=OBJECT_TYPES, default='other', db_index=True)
    current_score = models.FloatField(default=0.0)
    peak_score_24h = models.FloatField(default=0.0)
    total_events = models.IntegerField(default=0)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default='active', db_index=True)
    last_seen = models.DateTimeField(default=timezone.now, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'risk_object_profile'
        unique_together = ('risk_object', 'risk_object_type')
        indexes = [
            models.Index(fields=['-current_score']),
            models.Index(fields=['status', '-current_score']),
        ]

    def __str__(self):
        return f'{self.risk_object_type}:{self.risk_object} ({self.current_score:.1f})'


class RiskEvent(models.Model):
    """One normalized risk event generated from a single alert + one risk_object.

    A single alert with two risk_object fields produces two RiskEvents.
    """
    profile = models.ForeignKey(RiskObjectProfile, on_delete=models.CASCADE, related_name='events', db_index=True)
    alert_id = models.CharField(max_length=128, db_index=True)
    rule_uuid = models.CharField(max_length=128, blank=True, default='', db_index=True)
    rule_name = models.CharField(max_length=255, blank=True, default='')
    severity = models.CharField(max_length=32, default='low')
    score_contribution = models.FloatField(default=0.0)
    raw_alert = models.JSONField(default=dict)
    occurred_at = models.DateTimeField(default=timezone.now, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'risk_event'
        indexes = [
            models.Index(fields=['profile', '-occurred_at']),
            models.Index(fields=['alert_id']),
        ]
        constraints = [
            # One contribution per (alert, entity): blocks duplicate scoring from
            # concurrent workers or multiple ingestion paths.
            models.UniqueConstraint(fields=['alert_id', 'profile'], name='uniq_riskevent_alert_profile'),
        ]


class RiskScoreEntry(models.Model):
    """Append-only score ledger for audit and decay calculations.

    Each row records a score delta (positive for new events, negative for decay).
    """
    ENTRY_TYPES = [
        ('alert', 'Alert Contribution'),
        ('decay', 'Score Decay'),
        ('manual', 'Manual Adjustment'),
    ]

    profile = models.ForeignKey(RiskObjectProfile, on_delete=models.CASCADE, related_name='score_entries', db_index=True)
    entry_type = models.CharField(max_length=16, choices=ENTRY_TYPES, default='alert')
    delta = models.FloatField()
    score_after = models.FloatField()
    note = models.CharField(max_length=255, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = 'risk_score_entry'
        indexes = [models.Index(fields=['profile', '-created_at'])]


class NotableEvent(models.Model):
    """High-risk aggregate alert generated when an entity's score crosses the threshold.

    One NotableEvent per entity per breach window — resolved when the entity
    score drops back below threshold or is manually closed.
    """
    STATUS_CHOICES = [
        ('open', 'Open'),
        ('in_review', 'In Review'),
        ('resolved', 'Resolved'),
    ]

    profile = models.ForeignKey(RiskObjectProfile, on_delete=models.CASCADE, related_name='notable_events', db_index=True)
    risk_object = models.CharField(max_length=512, db_index=True)
    risk_object_type = models.CharField(max_length=32)
    score_at_trigger = models.FloatField()
    threshold_used = models.FloatField()
    contributing_event_count = models.IntegerField(default=0)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default='open', db_index=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.CharField(max_length=150, blank=True, default='')
    triggered_at = models.DateTimeField(default=timezone.now, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'risk_notable_event'
        indexes = [
            models.Index(fields=['status', '-triggered_at']),
            models.Index(fields=['risk_object', 'status']),
        ]

    def __str__(self):
        return f'Notable({self.risk_object_type}:{self.risk_object}) score={self.score_at_trigger:.1f}'
