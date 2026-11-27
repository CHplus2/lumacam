from django.contrib.auth import authenticate, get_user_model
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import LoginSerializer, RegisterSerializer, UserSerializer

User = get_user_model()


def signed_in(user, code=status.HTTP_200_OK):
    # One long-lived token per account: log in once on a device and stay logged in.
    token, _ = Token.objects.get_or_create(user=user)
    return Response({'token': token.key, 'user': UserSerializer(user).data}, status=code)


class RegisterView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = 'auth'

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return signed_in(serializer.save(), status.HTTP_201_CREATED)


class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = 'auth'

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        name = serializer.validated_data['username'].strip()
        match = User.objects.filter(username__iexact=name).first()  # usernames are case-insensitive
        user = authenticate(request, username=match.username if match else name,
                            password=serializer.validated_data['password'])
        if user is None:
            return Response({'detail': 'Wrong username or password.'}, status=status.HTTP_400_BAD_REQUEST)
        return signed_in(user)


class LogoutView(APIView):
    """Logs this account out everywhere (the token is shared by its devices).

    Its devices' phone notifications stop too.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from announcements.models import PushSubscription
        PushSubscription.objects.filter(user=request.user).delete()
        Token.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = 'auth'

    def get_throttles(self):
        # Only the password check (delete) is limited, against guessing.
        return super().get_throttles() if self.request.method == 'DELETE' else []

    def get(self, request):
        return Response(UserSerializer(request.user).data)

    def delete(self, request):
        """Erase this account and every post it made (PDPA: users can have their data deleted).

        Asks for the password again, so a token left on a shared phone can't wipe the account.
        """
        user = request.user
        if not user.check_password(request.data.get('password') or ''):
            return Response({'detail': 'Wrong password.'}, status=status.HTTP_400_BAD_REQUEST)
        if user.is_superuser:
            return Response({'detail': 'Admin accounts are removed by another admin.'}, status=status.HTTP_400_BAD_REQUEST)
        for post in user.announcements.all():
            post.delete()  # one by one: the model's delete() also erases the stored image
        user.delete()  # its login token goes with it
        return Response(status=status.HTTP_204_NO_CONTENT)


class ClaimPostsView(APIView):
    """Move posts made with a browser edit key (before accounts existed) into this account."""
    permission_classes = [IsAuthenticated]
    throttle_scope = 'auth'

    def post(self, request):
        from announcements.models import Announcement
        from announcements.ownership import hash_token
        keys = request.data.get('keys') or {}
        if not isinstance(keys, dict):
            return Response({'detail': 'Send keys as {post_id: key}.'}, status=status.HTTP_400_BAD_REQUEST)
        claimed = []
        for pk, key in list(keys.items())[:200]:
            if not str(pk).isdigit() or not isinstance(key, str) or not key:
                continue
            n = (Announcement.objects
                 .filter(pk=int(pk), publisher__isnull=True, edit_token_hash=hash_token(key))
                 .update(publisher=request.user, edit_token_hash=''))
            if n:
                claimed.append(int(pk))
        return Response({'claimed': claimed})
