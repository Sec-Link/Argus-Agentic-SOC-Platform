from django.db import models

PLATFORMS = [("elk", "ELK"), ("splunk", "Splunk")]


class LogSourceCategory(models.Model):
    """A broad class of log source (Endpoint, Firewall, EDR, ...) the SOC expects to ingest."""

    platform = models.CharField(max_length=10, choices=PLATFORMS, default="elk")
    name = models.CharField(max_length=100)
    # Index or index/sourcetype patterns (wildcards allowed).
    matchers = models.JSONField(default=list, blank=True)
    # CMDB Asset.asset_type values that should be sending logs for this category.
    asset_types = models.JSONField(default=list, blank=True)
    # Field holding the originating host name, used to compare against CMDB assets.
    host_field = models.CharField(max_length=128, default="host.name", blank=True)
    enabled = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)
    # Optional custom icon: always a re-encoded PNG produced by dashboards.icon_upload (never the raw upload).
    icon_png = models.BinaryField(null=True, blank=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "dashboards_log_source_category"
        ordering = ["sort_order", "name"]
        constraints = [models.UniqueConstraint(fields=["platform", "name"], name="log_category_platform_name")]

    def __str__(self):
        return self.name


class LogSourceMapping(models.Model):
    """Manual decision for a discovered log source; overrides the auto classification.

    A row means an admin decided where `source_key` belongs (or that it should be ignored);
    deleting the row hands the source back to automatic classification.
    """

    # Wildcard form of the logical source, e.g. "logs-okta.system-*".
    platform = models.CharField(max_length=10, choices=PLATFORMS, default="elk")
    source_key = models.CharField(max_length=255)
    category = models.ForeignKey(
        LogSourceCategory, null=True, blank=True, on_delete=models.CASCADE, related_name="source_mappings"
    )
    ignored = models.BooleanField(default=False)
    note = models.CharField(max_length=255, blank=True, default="")
    updated_by = models.CharField(max_length=150, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "dashboards_log_source_mapping"
        ordering = ["source_key"]
        constraints = [models.UniqueConstraint(fields=["platform", "source_key"], name="log_mapping_platform_source")]

    def __str__(self):
        return f"{self.source_key} -> {'ignored' if self.ignored else self.category_id}"


class LogSourceScan(models.Model):
    """Snapshot of the last successful log source scan for one platform.

    Pages read this instead of scanning on every visit; an admin re-scans on demand.
    """

    platform = models.CharField(max_length=10, choices=PLATFORMS, default="elk", db_index=True)
    targets = models.JSONField(default=dict, blank=True)
    scanned_at = models.DateTimeField()
    window_days = models.IntegerField(default=7)
    truncated = models.BooleanField(default=False)
    # Discovered sources: [{source_key, index_count, docs, last_seen, hosts_approx, hints}]
    payload = models.JSONField(default=list)
    scanned_by = models.CharField(max_length=150, blank=True, default="")

    class Meta:
        db_table = "dashboards_log_source_scan"
        ordering = ["-scanned_at"]
