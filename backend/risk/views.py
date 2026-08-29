from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasDjangoPermissions

from .models import GlobalRiskConfig, NotableEvent, RiskObjectProfile, RiskRuleConfig
from .serializers import (
    GlobalRiskConfigSerializer,
    NotableEventSerializer,
    RiskObjectProfileListSerializer,
    RiskObjectProfileSerializer,
    RiskRuleConfigSerializer,
)
from .services import (
    get_ecs_preset_fields,
    get_risk_funnel,
    get_risk_sankey,
    get_top_risk_entities,
)


class EcsPresetFieldsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(get_ecs_preset_fields())


class RiskFunnelView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {'GET': 'integrations.view_integration'}

    def get(self, request):
        return Response(get_risk_funnel())


class RiskSankeyView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {'GET': 'integrations.view_integration'}

    def get(self, request):
        try:
            limit = int(request.query_params.get('limit', 12))
        except (TypeError, ValueError):
            limit = 12
        return Response(get_risk_sankey(limit=max(1, min(limit, 50))))


class RiskTopEntitiesView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {'GET': 'integrations.view_integration'}

    def get(self, request):
        try:
            limit = int(request.query_params.get('limit', 10))
        except (TypeError, ValueError):
            limit = 10
        return Response(get_top_risk_entities(limit=max(1, min(limit, 100))))


class GlobalRiskConfigView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {
        'GET': 'integrations.view_integration',
        'POST': 'integrations.view_integration',
    }

    def get(self, request):
        cfg = GlobalRiskConfig.objects.order_by('id').first()
        if not cfg:
            return Response({'risk_object_fields': [], 'updated_by': '', 'updated_at': None})
        return Response(GlobalRiskConfigSerializer(cfg).data)

    def post(self, request):
        fields = request.data.get('risk_object_fields', [])
        aliases = request.data.get('field_aliases', [])
        cfg = GlobalRiskConfig.objects.order_by('id').first()
        if cfg:
            cfg.risk_object_fields = fields
            cfg.field_aliases = aliases
            cfg.updated_by = str(request.user)
            cfg.save()
        else:
            cfg = GlobalRiskConfig.objects.create(
                risk_object_fields=fields,
                field_aliases=aliases,
                updated_by=str(request.user),
            )
        return Response(GlobalRiskConfigSerializer(cfg).data)


class RiskRuleConfigView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {
        'GET': 'integrations.view_integration',
        'POST': 'integrations.view_integration',
        'DELETE': 'integrations.view_integration',
    }

    def get(self, request):
        rule_uuid = request.query_params.get('rule_uuid')
        if rule_uuid:
            try:
                cfg = RiskRuleConfig.objects.get(rule_uuid=rule_uuid)
                return Response(RiskRuleConfigSerializer(cfg).data)
            except RiskRuleConfig.DoesNotExist:
                return Response({'rule_uuid': rule_uuid, 'risk_object_fields': [], 'enabled': False})
        configs = RiskRuleConfig.objects.all().order_by('-updated_at')
        return Response(RiskRuleConfigSerializer(configs, many=True).data)

    def post(self, request):
        rule_uuid = request.data.get('rule_uuid', '').strip()
        if not rule_uuid:
            return Response({'detail': 'rule_uuid is required'}, status=400)

        fields = request.data.get('risk_object_fields', [])
        aliases = request.data.get('field_aliases', [])
        enabled = bool(request.data.get('enabled', True))
        base_override = int(request.data.get('base_score_override', 0) or 0)

        cfg, _ = RiskRuleConfig.objects.update_or_create(
            rule_uuid=rule_uuid,
            defaults={
                'risk_object_fields': fields,
                'field_aliases': aliases,
                'enabled': enabled,
                'base_score_override': base_override,
            },
        )
        return Response(RiskRuleConfigSerializer(cfg).data)

    def delete(self, request):
        rule_uuid = request.query_params.get('rule_uuid', '').strip()
        if not rule_uuid:
            return Response({'detail': 'rule_uuid is required'}, status=400)
        deleted, _ = RiskRuleConfig.objects.filter(rule_uuid=rule_uuid).delete()
        return Response({'deleted': deleted})


class RiskProfileListView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {'GET': 'integrations.view_integration'}

    def get(self, request):
        qs = RiskObjectProfile.objects.order_by('-current_score')
        obj_type = request.query_params.get('type')
        status = request.query_params.get('status')
        if obj_type:
            qs = qs.filter(risk_object_type=obj_type)
        if status:
            qs = qs.filter(status=status)
        return Response(RiskObjectProfileListSerializer(qs[:200], many=True).data)


class RiskProfileDetailView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {'GET': 'integrations.view_integration'}

    def get(self, request, pk):
        try:
            profile = RiskObjectProfile.objects.get(pk=pk)
        except RiskObjectProfile.DoesNotExist:
            return Response({'detail': 'Not found'}, status=404)
        return Response(RiskObjectProfileSerializer(profile).data)


class NotableEventListView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {'GET': 'integrations.view_integration'}

    def get(self, request):
        qs = NotableEvent.objects.order_by('-triggered_at')
        status = request.query_params.get('status')
        if status:
            qs = qs.filter(status=status)
        return Response(NotableEventSerializer(qs[:500], many=True).data)


class NotableEventResolveView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {'POST': 'integrations.view_integration'}

    def post(self, request, pk):
        try:
            event = NotableEvent.objects.get(pk=pk)
        except NotableEvent.DoesNotExist:
            return Response({'detail': 'Not found'}, status=404)

        event.status = 'resolved'
        event.resolved_at = timezone.now()
        event.resolved_by = str(request.user)
        event.save(update_fields=['status', 'resolved_at', 'resolved_by', 'updated_at'])
        return Response(NotableEventSerializer(event).data)
