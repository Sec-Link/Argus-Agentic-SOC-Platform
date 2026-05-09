# accounts/urls.py — mounted at /api/v1/accounts/
from django.urls import include, path
from rest_framework.routers import SimpleRouter

from accounts.api.views import GroupAdminViewSet, UserAdminViewSet
from accounts.views import (
    AuditLogListAPIView,
    GuestEmailStatusAPIView,
    LoginAPIView,
    LogoutAPIView,
    OTPRequestAPIView,
    OTPVerifyAPIView,
    PasswordChangeAPIView,
    RegisterAPIView,
    RegisterEmailAPIView,
    RegistrationApproveAPIView,
    RegistrationRejectAPIView,
    RegistrationRequestListAPIView,
    SystemSettingsAPIView,
)

app_name = 'accounts'

router = SimpleRouter()
router.register(r'users', UserAdminViewSet, basename='user')
router.register(r'groups', GroupAdminViewSet, basename='group')

urlpatterns = [
    # auth endpoints — /api/v1/accounts/auth/...
    path('auth/login/', LoginAPIView.as_view(), name='login'),
    path('auth/logout/', LogoutAPIView.as_view(), name='logout'),
    path('auth/register/', RegisterAPIView.as_view(), name='register'),
    path('auth/register-email/', RegisterEmailAPIView.as_view(), name='register_email'),
    path('auth/guest-email-status/', GuestEmailStatusAPIView.as_view(), name='guest_email_status'),
    path('auth/otp/request/', OTPRequestAPIView.as_view(), name='otp_request'),
    path('auth/otp/verify/', OTPVerifyAPIView.as_view(), name='otp_verify'),
    # admin / management endpoints
    path('change-password/', PasswordChangeAPIView.as_view(), name='change_password'),
    path('registration-requests/', RegistrationRequestListAPIView.as_view(), name='registration_requests'),
    path(
        'registration-requests/<uuid:request_id>/approve/',
        RegistrationApproveAPIView.as_view(),
        name='registration_approve',
    ),
    path(
        'registration-requests/<uuid:request_id>/reject/',
        RegistrationRejectAPIView.as_view(),
        name='registration_reject',
    ),
    path('audit-logs/', AuditLogListAPIView.as_view(), name='audit_logs'),
    path('system-settings/', SystemSettingsAPIView.as_view(), name='system_settings'),
    path('', include(router.urls)),
]
