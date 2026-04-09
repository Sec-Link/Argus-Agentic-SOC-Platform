from django.db import models
from django.utils import timezone
from django.contrib.postgres.fields import ArrayField


class CorrelationPolicy(models.Model):
    enabled = models.BooleanField(default=False)
    window_minutes = models.IntegerField(default=30)
    match_keys = ArrayField(models.CharField(max_length=64), default=list, blank=True)
    match_risk_object = models.BooleanField(default=True)
    match_detection_rule = models.BooleanField(default=True)
    match_source_ip = models.BooleanField(default=False)
    match_username = models.BooleanField(default=False)
    time_window_hours = models.IntegerField(default=8)
    match_action = models.CharField(max_length=32, default='attach')
    # JSON expression for correlation ordering/grouping rules
    rules_expression = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

class CorrelationEvent(models.Model):
    ticket_id = models.CharField(max_length=128, null=True, blank=True, db_index=True)
    alert_ids = ArrayField(models.CharField(max_length=128), default=list, blank=True)
    threat_object = models.CharField(max_length=256, null=True, blank=True, db_index=True)
    matched_keys = ArrayField(models.CharField(max_length=64), default=list, blank=True)
    occurred_at = models.DateTimeField(default=timezone.now, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['occurred_at']),
            models.Index(fields=['threat_object', 'occurred_at']),
        ]

    @property
    def alert_count(self):
        return len(self.alert_ids or [])
