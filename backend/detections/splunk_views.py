from django.db import DatabaseError
from django.shortcuts import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import DenyReadonlyUser, HasDjangoPermissions
from integrations.models import Integration

from .models import LocalDetectionRule, SplunkRulePublication
from .services import user_name_from_request
from .splunk_serializers import SplunkPublicationActionSerializer, SplunkPublicationSaveSerializer, SplunkPublicationSerializer
from .splunk_service import execute_publication, save_publication


class SplunkPublicationsView(APIView):
    permission_classes = [IsAuthenticated, DenyReadonlyUser, HasDjangoPermissions]
    required_permissions = {'GET': 'integrations.view_integration', 'POST': 'integrations.change_integration'}

    def get(self, request, rule_id):
        rule = get_object_or_404(LocalDetectionRule, rule_uuid=rule_id)
        rows = rule.splunk_publications.select_related('rule', 'integration').order_by('integration__name')
        return Response(SplunkPublicationSerializer(rows, many=True).data)

    def post(self, request, rule_id):
        rule = get_object_or_404(LocalDetectionRule, rule_uuid=rule_id, is_deleted=False)
        serializer = SplunkPublicationSaveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        integration = get_object_or_404(Integration, pk=serializer.validated_data['integration_id'], type='splunk_rule_publisher')
        publication = save_publication(rule, integration, serializer.validated_data['config'], user_name_from_request(request))
        return Response(SplunkPublicationSerializer(publication).data)


class SplunkPublicationDetailView(APIView):
    permission_classes = [IsAuthenticated, DenyReadonlyUser, HasDjangoPermissions]
    required_permissions = {'POST': 'integrations.change_integration', 'DELETE': 'integrations.delete_integration'}

    def _execute(self, request, rule_id, publication_id, action, expected_version=None):
        publication = get_object_or_404(SplunkRulePublication, pk=publication_id, rule__rule_uuid=rule_id)
        try:
            result = execute_publication(publication, action, request, expected_version)
        except DatabaseError:
            return Response({'detail': 'Publication state could not be saved. The remote operation may have succeeded; refresh before retrying.'}, status=503)
        return Response(SplunkPublicationSerializer(result).data if result else {'deleted': True})

    def post(self, request, rule_id, publication_id):
        serializer = SplunkPublicationActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self._execute(request, rule_id, publication_id, **serializer.validated_data)

    def delete(self, request, rule_id, publication_id):
        return self._execute(request, rule_id, publication_id, 'delete')
