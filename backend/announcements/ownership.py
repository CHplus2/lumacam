"""Who may change a post or category: the account that created it.

Posts made before accounts existed were owned by a browser "edit key"; the
key's SHA-256 is kept so the poster can claim the post into their account
(POST /api/auth/claim/). Posts with no owner can only be changed in /django-admin/.
"""
import hashlib

from rest_framework.permissions import SAFE_METHODS, BasePermission

NOT_OWNER = 'Only the person who posted this can change it.'
LEGACY = 'This post has no owner account, so it can only be changed by the site admin.'
LOG_IN = 'Log in to change your posts.'


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def owns(user, obj, field='publisher_id') -> bool:
    return bool(user and user.is_authenticated and getattr(obj, field) == user.id)


class IsPublisherOrReadOnly(BasePermission):
    message = LOG_IN

    def has_permission(self, request, view):
        return request.method in SAFE_METHODS or bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True
        if not obj.publisher_id:
            self.message = LEGACY
            return False
        self.message = NOT_OWNER
        return owns(request.user, obj)
