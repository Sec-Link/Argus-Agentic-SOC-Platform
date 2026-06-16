from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from django.http import HttpResponse

from accounts.permissions import HasDjangoPermissions
from .models import LocalDetectionDeployment, LocalDetectionFieldMapping, LocalDetectionRule
from .serializers import (
    DetectionDeploymentCreateSerializer,
    DetectionDeploymentSerializer,
    DetectionMappingDeleteSerializer,
    DetectionMappingSerializer,
    DetectionMappingSaveSerializer,
    DetectionRuleCompileSerializer,
    DetectionRuleSaveSerializer,
)
from .services import (
    create_deployment_record,
    export_mapping_bundle,
    export_mapping_csv,
    export_rule_bundle,
    import_mapping_files,
    import_rule_files,
    save_local_rule,
    serialize_legacy_rule,
    serialize_rule_detail,
    soft_delete_local_rule,
    user_name_from_request,
)
from .sigma import compile_queries_from_yaml


class DetectionRulesView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {"GET": "integrations.view_integration"}

    def get(self, request):
        rules = LocalDetectionRule.objects.filter(is_deleted=False).order_by("name", "id")
        return Response([serialize_legacy_rule(rule) for rule in rules])


class DetectionRuleDetailView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {
        "GET": "integrations.view_integration",
        "POST": "integrations.change_integration",
        "DELETE": "integrations.delete_integration",
    }

    def get(self, request, rule_id: str):
        rule = LocalDetectionRule.objects.filter(rule_uuid=rule_id, is_deleted=False).first()
        if not rule:
            return Response({"detail": "Rule not found"}, status=404)

        detail = serialize_rule_detail(rule)
        return Response(
            {
                **detail,
                "compiled": compile_queries_from_yaml(detail["yaml"]),
            }
        )

    def post(self, request, rule_id: str):
        serializer = DetectionRuleSaveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        actor = user_name_from_request(request)
        rule = save_local_rule(
            rule_id=rule_id,
            yaml_text=serializer.validated_data["yaml"],
            actor=actor,
            elastic_actions=serializer.validated_data.get("elastic_actions"),
            elastic_index_patterns=serializer.validated_data.get("elastic_index_patterns"),
            kibana_metadata=serializer.validated_data.get("kibana_metadata"),
        )
        return Response({"saved": True, "id": rule.rule_uuid, "version": rule.version})

    def delete(self, request, rule_id: str):
        rule = LocalDetectionRule.objects.filter(rule_uuid=rule_id, is_deleted=False).first()
        if not rule:
            return Response({"detail": "Rule not found"}, status=404)

        soft_delete_local_rule(rule=rule, actor=user_name_from_request(request))
        return Response({"deleted": True})


class DetectionRuleUploadView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {"POST": "integrations.change_integration"}

    def post(self, request):
        files = request.FILES.getlist("files")
        if not files:
            return Response({"detail": "No files uploaded. Use field name 'files'."}, status=400)
        return Response(import_rule_files(files=files, actor=user_name_from_request(request)))


class DetectionRuleExportView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {"POST": "integrations.view_integration"}

    def post(self, request):
        ids = request.data.get("ids") if isinstance(request.data.get("ids"), list) else []
        rule_ids = [str(item).strip() for item in ids if str(item).strip()]
        return Response(export_rule_bundle(rule_ids=rule_ids or None))


class DetectionMappingListView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {
        "GET": "integrations.view_integration",
        "POST": "integrations.change_integration",
        "DELETE": "integrations.delete_integration",
    }

    def get(self, request):
        rows = LocalDetectionFieldMapping.objects.order_by("mapping_profile", "sigma_field", "id")
        return Response(DetectionMappingSerializer(rows, many=True).data)

    def post(self, request):
        serializer = DetectionMappingSaveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        defaults = {
            "mapping_profile": str(data["mapping_profile"]).strip(),
            "sigma_field": str(data["sigma"]).strip(),
            "splunk_field": str(data.get("splunk") or ""),
            "elastic_field": str(data.get("elastic") or ""),
            "elastic_index_patterns": [str(item).strip() for item in data.get("elastic_index_patterns", []) if str(item).strip()],
            "category": str(data.get("category") or ""),
            "data_source": str(data.get("data_source") or ""),
            "event_category": str(data.get("event_category") or ""),
            "updated_by": user_name_from_request(request),
        }
        mapping_id = data.get("id")
        if mapping_id:
            row = LocalDetectionFieldMapping.objects.filter(id=mapping_id).first()
            if not row:
                return Response({"detail": "Mapping not found"}, status=404)
            for key, value in defaults.items():
                setattr(row, key, value)
            row.save()
            created = False
        else:
            row, created = LocalDetectionFieldMapping.objects.update_or_create(
                mapping_profile=defaults["mapping_profile"],
                sigma_field=defaults["sigma_field"],
                defaults={key: value for key, value in defaults.items() if key not in {"mapping_profile", "sigma_field"}},
            )
        if created:
            row.created_by = user_name_from_request(request)
            row.save(update_fields=["created_by"])
        return Response(DetectionMappingSerializer(row).data, status=201 if created else 200)

    def delete(self, request):
        serializer = DetectionMappingDeleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ids = [str(item).strip() for item in serializer.validated_data["ids"] if str(item).strip()]
        deleted, _ = LocalDetectionFieldMapping.objects.filter(id__in=ids).delete()
        return Response({"deleted": deleted})


class DetectionMappingUploadView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {"POST": "integrations.change_integration"}

    def post(self, request):
        files = request.FILES.getlist("files")
        if not files:
            return Response({"detail": "No files uploaded. Use field name 'files'."}, status=400)
        return Response(import_mapping_files(files=files, actor=user_name_from_request(request)))


class DetectionMappingExportView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {"POST": "integrations.view_integration"}

    def post(self, request):
        ids = request.data.get("ids") if isinstance(request.data.get("ids"), list) else []
        mapping_ids = [str(item).strip() for item in ids if str(item).strip()]
        content = export_mapping_csv(mapping_ids=mapping_ids or None)
        response = HttpResponse(content, content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="detection-mappings.csv"'
        return response


class DetectionRuleCompileView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {"POST": "integrations.view_integration"}

    def post(self, request):
        serializer = DetectionRuleCompileSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(compile_queries_from_yaml(serializer.validated_data["yaml"]))


class DetectionDeploymentListCreateView(APIView):
    permission_classes = [IsAuthenticated, HasDjangoPermissions]
    required_permissions = {
        "GET": "integrations.view_integration",
        "POST": "integrations.change_integration",
    }

    def get(self, request):
        rule_id = str(request.query_params.get("rule_id") or "").strip()
        rows = LocalDetectionDeployment.objects.select_related("rule").order_by("-created_at", "-id")
        if rule_id:
            rows = rows.filter(rule__rule_uuid=rule_id)
        return Response(DetectionDeploymentSerializer(rows, many=True).data)

    def post(self, request):
        serializer = DetectionDeploymentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        rule = LocalDetectionRule.objects.filter(rule_uuid=data["rule_id"], is_deleted=False).first()
        if not rule:
            return Response({"detail": "Rule not found"}, status=404)

        row = create_deployment_record(
            rule=rule,
            actor=user_name_from_request(request),
            target=data["target"],
            action=data["action"],
            status=data["status"],
            remote_id=str(data.get("remote_id") or ""),
            remote_rule_id=str(data.get("remote_rule_id") or ""),
            message=str(data.get("message") or ""),
            payload=data.get("payload") if isinstance(data.get("payload"), dict) else {},
        )
        return Response(DetectionDeploymentSerializer(row).data, status=201)
