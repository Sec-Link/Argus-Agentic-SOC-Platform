"""
Workflow Admin Configuration
"""
from django.contrib import admin
from django.db import transaction
from django.utils import timezone
from .models import (
    ActionTemplate,
    Workflow,
    WorkflowStep,
    WorkflowExecution,
    StepExecution,
    SavedWorkflowNode,
)


@admin.register(ActionTemplate)
class ActionTemplateAdmin(admin.ModelAdmin):
    list_display = ['name', 'action_type', 'category', 'is_active', 'created_at']
    list_filter = ['category', 'is_active']
    search_fields = ['name', 'action_type', 'description']
    readonly_fields = ['id', 'created_at', 'updated_at']

    @transaction.atomic
    def delete_queryset(self, request, queryset):
        list(Workflow.objects.select_for_update().filter(
            pk__in=WorkflowStep.objects.filter(action_template__in=queryset).values('workflow_id'),
        ).order_by('pk'))
        for template in queryset:
            template.delete()


class WorkflowStepInline(admin.TabularInline):
    model = WorkflowStep
    extra = 0
    fields = ['order', 'name', 'action_type', 'is_active']
    readonly_fields = ['id']


@admin.register(Workflow)
class WorkflowAdmin(admin.ModelAdmin):
    list_display = ['name', 'trigger_type', 'is_active', 'is_draft', 'version', 'created_by', 'created_at']
    list_filter = ['trigger_type', 'is_active', 'is_draft']
    search_fields = ['name', 'description']
    readonly_fields = ['id', 'version', 'is_draft', 'published_revision', 'created_at', 'updated_at']
    inlines = [WorkflowStepInline]

    def get_readonly_fields(self, request, obj=None):
        fields = list(super().get_readonly_fields(request, obj))
        if obj and obj.execution_engine == 'local':
            fields.append('execution_engine')
        return fields

    @transaction.atomic
    def changeform_view(self, request, object_id=None, form_url='', extra_context=None):
        if request.method == 'POST' and object_id:
            list(Workflow.objects.select_for_update().filter(pk=object_id))
        return super().changeform_view(request, object_id, form_url, extra_context)

    @transaction.atomic
    def delete_queryset(self, request, queryset):
        list(queryset.select_for_update().order_by('pk'))
        queryset.delete()


@admin.register(WorkflowStep)
class WorkflowStepAdmin(admin.ModelAdmin):
    list_display = ['name', 'workflow', 'order', 'action_type', 'is_active']
    list_filter = ['workflow', 'is_active', 'on_failure']
    search_fields = ['name', 'action_type']
    readonly_fields = ['id', 'created_at', 'updated_at']

    def get_readonly_fields(self, request, obj=None):
        return [*self.readonly_fields, *(['workflow'] if obj else [])]

    @transaction.atomic
    def delete_queryset(self, request, queryset):
        workflow_ids = set(queryset.values_list('workflow_id', flat=True))
        list(Workflow.objects.select_for_update().filter(pk__in=workflow_ids).order_by('pk'))
        queryset.delete()
        Workflow.objects.filter(pk__in=workflow_ids).update(is_draft=True, updated_at=timezone.now())


class StepExecutionInline(admin.TabularInline):
    model = StepExecution
    extra = 0
    fields = ['source_step_id', 'step_name', 'step_order', 'action_type', 'status', 'started_at', 'completed_at']
    readonly_fields = ['id', 'source_step_id', 'step_name', 'step_order', 'action_type', 'status', 'started_at', 'completed_at']
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(WorkflowExecution)
class WorkflowExecutionAdmin(admin.ModelAdmin):
    list_display = ['id', 'workflow', 'workflow_version', 'status', 'progress_percent', 'executed_by', 'started_at', 'completed_at']
    list_filter = ['status', 'workflow']
    search_fields = ['workflow__name', 'trigger_source']
    readonly_fields = ['id', 'workflow_version', 'created_at', 'updated_at']
    inlines = [StepExecutionInline]

    def has_add_permission(self, request):
        return False


@admin.register(StepExecution)
class StepExecutionAdmin(admin.ModelAdmin):
    list_display = ['id', 'step_name', 'source_step_id', 'action_type', 'status', 'attempt_number', 'started_at', 'completed_at']
    list_filter = ['status']
    readonly_fields = ['source_step_id', 'step_name', 'step_order', 'action_type']

    def has_add_permission(self, request):
        return False


@admin.register(SavedWorkflowNode)
class SavedWorkflowNodeAdmin(admin.ModelAdmin):
    list_display = ['name', 'node_type', 'node_category', 'action_type', 'created_by', 'updated_at']
    list_filter = ['node_type', 'node_category', 'is_active']
    search_fields = ['name', 'action_type']
    readonly_fields = ['id', 'created_at', 'updated_at']



