"""Owner-only editing without accounts.

Creating a post returns a random secret (the "edit key") once. The browser that
posted keeps it and sends it in the X-Edit-Token header to edit, delete, change
stock or restore the post. Only a SHA-256 hash is stored, so a database leak
doesn't reveal working keys.

Posts created before this existed have no hash and can only be changed in
/django-admin/.
"""
import hashlib
import hmac
import secrets

from rest_framework.permissions import SAFE_METHODS, BasePermission

HEADER = 'HTTP_X_EDIT_TOKEN'


def new_token() -> str:
    return secrets.token_urlsafe(24)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def token_from(request) -> str:
    return (request.META.get(HEADER) or '').strip()[:200]


def is_owner(announcement, token: str) -> bool:
    stored = getattr(announcement, 'edit_token_hash', '')
    return bool(stored and token) and hmac.compare_digest(stored, hash_token(token))


NOT_OWNER = 'Only the person who posted this can change it.'
LEGACY = 'This post was made before owner-only editing, so it can only be changed by the site admin.'


class IsOwnerOrReadOnly(BasePermission):
    message = NOT_OWNER

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True
        if not obj.edit_token_hash:
            self.message = LEGACY
            return False
        return is_owner(obj, token_from(request))
