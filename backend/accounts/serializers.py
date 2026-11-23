import re

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    display_name = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = ('id', 'username', 'display_name', 'date_joined')
        read_only_fields = fields


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=30)
    display_name = serializers.CharField(max_length=60)
    password = serializers.CharField(write_only=True, style={'input_type': 'password'})

    def validate_username(self, value):
        value = value.strip()
        if not re.fullmatch(r'[A-Za-z0-9_.]{3,30}', value):
            raise serializers.ValidationError('Use 3-30 letters, numbers, dots or underscores.')
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError('That username is taken.')
        return value

    def validate_display_name(self, value):
        value = ' '.join(value.split())
        if len(value) < 2:
            raise serializers.ValidationError('Enter your name (at least 2 characters).')
        return value

    def validate(self, attrs):
        try:
            validate_password(attrs['password'], User(username=attrs['username'], first_name=attrs['display_name']))
        except DjangoValidationError as exc:
            raise serializers.ValidationError({'password': list(exc.messages)})
        return attrs

    def create(self, data):
        return User.objects.create_user(username=data['username'], password=data['password'],
                                        first_name=data['display_name'])


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(style={'input_type': 'password'})
