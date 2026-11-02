from django.db import models


class LogSourceCategory(models.Model):
    """A broad class of log source (Endpoint, Firewall, EDR, ...) the SOC expects to ingest."""

    name = models.CharField(max_length=100, unique=True)
    # ES index patterns (wildcards allowed) that carry this category's logs.
    matchers = models.JSONField(default=list, blank=True)
    # CMDB Asset.asset_type values that should be sending logs for this category.
    asset_types = models.JSONField(default=list, blank=True)
    # ES field holding the originating host name, used to compare against CMDB assets.
    host_field = models.CharField(max_length=128, default="host.name", blank=True)
    enabled = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "dashboards_log_source_category"
        ordering = ["sort_order", "name"]

    def __str__(self):
        return self.name


class LogSourceMapping(models.Model):
    """Manual decision for a discovered ES log source; overrides the auto classification.

    A row means an admin decided where `source_key` belongs (or that it should be ignored);
    deleting the row hands the source back to automatic classification.
    """

    # Wildcard form of the logical source, e.g. "logs-okta.system-*".
    source_key = models.CharField(max_length=255, unique=True)
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

    def __str__(self):
        return f"{self.source_key} -> {'ignored' if self.ignored else self.category_id}"


class LogSourceScan(models.Model):
    """Snapshot of the last successful Elasticsearch log source scan.

    Pages read this instead of scanning ES on every visit; an admin re-scans on demand.
    """

    scanned_at = models.DateTimeField()
    window_days = models.IntegerField(default=7)
    truncated = models.BooleanField(default=False)
    # Discovered sources: [{source_key, index_count, docs, last_seen, hosts_approx, hints}]
    payload = models.JSONField(default=list)
    scanned_by = models.CharField(max_length=150, blank=True, default="")

    class Meta:
        db_table = "dashboards_log_source_scan"
        ordering = ["-scanned_at"]
