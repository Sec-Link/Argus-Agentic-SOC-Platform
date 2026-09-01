from django.contrib import admin
from .models import NotableEvent, RiskEvent, RiskObjectProfile, RiskRuleConfig, RiskScoreEntry

admin.site.register(RiskRuleConfig)
admin.site.register(RiskObjectProfile)
admin.site.register(RiskEvent)
admin.site.register(RiskScoreEntry)
admin.site.register(NotableEvent)
