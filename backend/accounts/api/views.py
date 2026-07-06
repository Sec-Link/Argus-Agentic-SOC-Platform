from rest_framework import viewsets, permissions
from rest_framework.exceptions import PermissionDenied
from django.contrib.auth.models import User, Group
from .serializers import UserAdminSerializer, GroupSerializer


class UserAdminViewSet(viewsets.ModelViewSet):
    serializer_class = UserAdminSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        # Staff/superusers see all users; standard users see only themselves
        if user.is_staff or user.is_superuser:
            return User.objects.all().prefetch_related('groups', 'user_permissions', 'user_auth_profile')
        return User.objects.filter(pk=user.pk).prefetch_related('groups', 'user_permissions', 'user_auth_profile')

    def get_object(self):
        obj = super().get_object()
        user = self.request.user
        # Object-level: non-staff may only access their own profile
        if not (user.is_staff or user.is_superuser) and obj.pk != user.pk:
            raise PermissionDenied()
        return obj

    def create(self, request, *args, **kwargs):
        if not (request.user.is_staff or request.user.is_superuser):
            raise PermissionDenied()
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        if not (request.user.is_staff or request.user.is_superuser):
            raise PermissionDenied()
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        if not (request.user.is_staff or request.user.is_superuser):
            raise PermissionDenied()
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if not (request.user.is_staff or request.user.is_superuser):
            raise PermissionDenied()
        return super().destroy(request, *args, **kwargs)


class GroupAdminViewSet(viewsets.ModelViewSet):
    queryset = Group.objects.all().prefetch_related('permissions')
    serializer_class = GroupSerializer
    permission_classes = [permissions.IsAdminUser]
