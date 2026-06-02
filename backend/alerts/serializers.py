from rest_framework import serializers
from .models import ESIntegrationConfig, AlertSyncSchedule, ESIntegrationConfigHistory

class ESIntegrationConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = ESIntegrationConfig
        fields = ['enabled', 'hosts', 'index', 'username', 'password', 'use_ssl', 'verify_certs']

class AlertSyncScheduleSerializer(serializers.ModelSerializer):
    class Meta:
        model = AlertSyncSchedule
        fields = [
            'enabled',
            'interval_seconds',
            'batch_size',
            'fetch_all',
            'last_run_at',
            'last_status',
            'last_error',
        ]
        read_only_fields = ['last_run_at', 'last_status', 'last_error']


class ESIntegrationConfigHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ESIntegrationConfigHistory
        fields = [
            'id',
            'hosts',
            'index',
            'username',
            'use_ssl',
            'verify_certs',
            'created_at',
            'last_used_at',
        ]
