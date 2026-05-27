from django.db import models
import uuid


"""
orchestrator.models

Persistence models for task scheduling and task execution:
- Task: stores task metadata such as name, type, schedule expression, and runtime configuration.
- TaskRun: stores execution history such as start/end timestamps, final status, and run logs.

These models are shared by the scheduler, API endpoints, and execution layer.
"""


class Task(models.Model):
    # UUID primary keys make task records safe to reference across distributed systems.
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Human-readable task name used for display and lookup.
    name = models.CharField(max_length=200, unique=True)
    # Task type, for example "sql_query" or "es_sync"; the executor decides how to handle it.
    task_type = models.CharField(max_length=100)
    # Schedule expression. Supports cron-like values and simplified aliases such as "@daily".
    schedule = models.CharField(max_length=100, default='@daily')
    # Task-specific runtime configuration, such as integration references, SQL, or ES index names.
    config = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} ({self.task_type})"


class TaskRun(models.Model):
    # Unique identifier for one task execution attempt.
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Keep run history when a task is deleted so audits and troubleshooting remain possible.
    task = models.ForeignKey(Task, on_delete=models.SET_NULL, null=True, blank=True, related_name='runs')
    # Start/end timestamps are nullable because runs may be queued, running, or interrupted.
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    # Execution status, for example "pending", "running", "success", or "failed".
    status = models.CharField(max_length=50, default='pending')
    # Execution logs and error tracebacks captured for operational debugging.
    logs = models.TextField(blank=True)

    def __str__(self):
        return f"Run {self.id} - {self.status}"


class TaskRequestLog(models.Model):
    """Audit API request payloads used to create or update tasks.

    This replaces legacy JSON-file writes on disk and keeps task configuration
    changes queryable through the application database.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    task = models.ForeignKey(Task, null=True, blank=True, on_delete=models.SET_NULL)
    user = models.CharField(max_length=200, null=True, blank=True)
    logged_at = models.DateTimeField(auto_now_add=True)
    request_body = models.JSONField(default=dict)

    def __str__(self):
        tid = getattr(self.task, 'id', None)
        return f"TaskRequestLog({tid}) @ {self.logged_at.isoformat()}"
