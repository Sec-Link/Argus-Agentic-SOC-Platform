from django.contrib import admin
from .models import Integration


@admin.register(Integration)
class IntegrationAdmin(admin.ModelAdmin):
    list_display = ('name', 'type', 'created_at')
    readonly_fields = ('created_at', 'updated_at')
    search_fields = ('name', 'type')

    def config_preview(self, obj):
        cfg = obj.config or {}
        # mask passwords in preview
        cfg_masked = {k: ('***' if 'pass' in k.lower() or 'secret' in k.lower() else v) for k, v in cfg.items()}
        return str(cfg_masked)

    config_preview.short_description = 'config'
