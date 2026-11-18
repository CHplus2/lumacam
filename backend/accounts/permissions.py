from rest_framework.permissions import BasePermission


class IsAdminRole(BasePermission):
    """Only authenticated users with the administrator role."""

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.role == 'admin')
