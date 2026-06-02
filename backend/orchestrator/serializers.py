from rest_framework import serializers
from .models import Task, TaskRun, TaskRequestLog

# -----------------------------
# 中文注释：
# 该模块定义了 Task 与 TaskRun 的序列化器（用于 REST API 的输入/输出转换）
# - `TaskSerializer` 包含一个嵌套的 `runs` 字段，用于只读地返回相关的 TaskRun 列表
# - `TaskRunSerializer` 将 TaskRun 的所有字段序列化，以便返回执行日志、状态和时间戳等信息
#
# 本文件仅添加文档注释，不更改序列化逻辑。
# -----------------------------


class TaskRunSerializer(serializers.ModelSerializer):
    task_name = serializers.SerializerMethodField()

    class Meta:
        model = TaskRun
        fields = '__all__'

    def get_task_name(self, obj):
        task = getattr(obj, 'task', None)
        return task.name if task else 'Deleted task'


class TaskSerializer(serializers.ModelSerializer):
    runs = TaskRunSerializer(many=True, read_only=True)
    class Meta:
        model = Task
        fields = '__all__'

    def validate_name(self, value):
        qs = Task.objects.filter(name=value)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Task name already exists.")
        return value


class TaskRequestLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskRequestLog
        fields = '__all__'
