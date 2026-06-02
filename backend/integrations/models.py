"""
integrations.models

Stores Elasticsearch integration records and persisted ES mapping metadata.
"""

from django.db import models
import uuid


class Integration(models.Model):
    """
    Integration model.

    Fields:
    - id: UUID primary key
    - name: human-readable integration name
    - type: integration type; currently only 'elasticsearch' is supported
    - config: connection settings and metadata
    - created_at / updated_at: managed timestamps
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    type = models.CharField(max_length=100)
    config = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} ({self.type})"

class ESMapping(models.Model):
    """Persisted mapping between an Elasticsearch index and a target SQL table.

    Fields:
    - index: ES index name
    - table: target SQL table name
    - columns: list of column descriptors [{ orig_name, colname, sql_type }, ...]
    - created_at
    """
    index = models.CharField(max_length=256, db_index=True)
    table = models.CharField(max_length=256, db_index=True)
    columns = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('index', 'table')

    def __str__(self):
        return f"ESMapping({self.index} -> {self.table})"
