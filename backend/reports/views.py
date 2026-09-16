from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.permissions import IsAuthenticatedOrReadOnly
from rest_framework.response import Response
from rest_framework.views import APIView

from .services import generate_soc_report_md


class ReportGenerateView(APIView):
    permission_classes = [IsAuthenticatedOrReadOnly]
    http_method_names = ["post", "options"]

    def post(self, request):
        payload = request.data if isinstance(request.data, dict) else {}
        time_range = str(payload.get("time_range", "7d")).lower()
        if time_range not in {"24h", "7d", "30d", "custom"}:
            return Response({"detail": "time_range must be one of: 24h, 7d, 30d, custom."}, status=status.HTTP_400_BAD_REQUEST)
        start_time = parse_datetime(str(payload.get("start_time"))) if payload.get("start_time") else None
        end_time = parse_datetime(str(payload.get("end_time"))) if payload.get("end_time") else None
        if time_range == "custom" and (start_time is None or end_time is None):
            return Response({"detail": "start_time and end_time are required for a custom range."}, status=status.HTTP_400_BAD_REQUEST)
        if start_time and end_time and start_time >= end_time:
            return Response({"detail": "start_time must be earlier than end_time."}, status=status.HTTP_400_BAD_REQUEST)
        return Response(generate_soc_report_md(time_range, start_time, end_time), status=status.HTTP_200_OK)
