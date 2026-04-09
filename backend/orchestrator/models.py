from django.db import models
import uuid


"""
orchestrator.models

中文说明：
定义调度与任务执行相关的持久化模型：
- Task: 保存任务的元信息（名称、类型、调度表达式、配置等）
- TaskRun: 保存任务的执行记录（开始/结束时间、状态、日志）

这些模型由调度器（management command scheduler）、API 端点以及执行器（实际运行任务的代码）共同使用。
"""


class Task(models.Model):
    # 使用 UUID 作为主键，方便跨系统引用与合并
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # 任务名称（用于展示与查找）
    name = models.CharField(max_length=200, unique=True)
    # 任务类型（例如 'sql_query', 'es_sync' 等），由执行器决定如何处理
    task_type = models.CharField(max_length=100)
    # 调度表达式（可为 cron 或简化表达，如 '@daily'）
    schedule = models.CharField(max_length=100, default='@daily')
    # 存放任务特定配置的 JSON 字段（例如数据源、SQL、ES index 等）
    config = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} ({self.task_type})"


class TaskRun(models.Model):
    # 每次任务执行的唯一标识
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # 关联到对应的 Task，Task 被删除时同时删除其运行记录
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='runs')
    # 开始/结束时间，可为 null（未开始或未结束）
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    # 状态字段（例如 'pending','running','success','failed'）
    status = models.CharField(max_length=50, default='pending')
    # 执行日志或错误堆栈信息
    logs = models.TextField(blank=True)

    def __str__(self):
        return f"Run {self.id} - {self.status}"


class TaskRequestLog(models.Model):
    """存储创建/更新 Task 时 API 请求的审计日志，替代磁盘上的 JSON 文件写入。"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    task = models.ForeignKey(Task, null=True, blank=True, on_delete=models.SET_NULL)
    user = models.CharField(max_length=200, null=True, blank=True)
    logged_at = models.DateTimeField(auto_now_add=True)
    request_body = models.JSONField(default=dict)

    def __str__(self):
        tid = getattr(self.task, 'id', None)
        return f"TaskRequestLog({tid}) @ {self.logged_at.isoformat()}"
