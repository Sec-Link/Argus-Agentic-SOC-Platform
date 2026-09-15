from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .services import build_report


class ReportGenerateView(APIView):
    # Read-only generation — GET keeps guests (readonly users) unblocked.
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(build_report(str(request.query_params.get("range", "7d"))))

    def post(self, request):
        return Response(build_report(str((request.data or {}).get("range", "7d"))))
