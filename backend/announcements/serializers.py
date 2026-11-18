import re

from django.conf import settings
from django.core.validators import EmailValidator, URLValidator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from rest_framework import serializers

from .models import Announcement, Category, Report

ALLOWED_IMAGE_FORMATS = {'JPEG', 'PNG', 'WEBP'}
ALLOWED_SCHEMES = ['http', 'https']


class CategorySerializer(serializers.ModelSerializer):
    announcement_count = serializers.IntegerField(read_only=True, required=False)

    class Meta:
        model = Category
        fields = ('id', 'name', 'slug', 'description', 'icon', 'color', 'announcement_count')


class AnnouncementSerializer(serializers.ModelSerializer):
    category = serializers.PrimaryKeyRelatedField(queryset=Category.objects.all())
    category_detail = CategorySerializer(source='category', read_only=True)
    image = serializers.ImageField(write_only=True, required=False, allow_null=True)
    image_url = serializers.SerializerMethodField()
    open_reports = serializers.SerializerMethodField()

    class Meta:
        model = Announcement
        fields = (
            'id', 'title', 'description', 'category', 'category_detail', 'publisher_name',
            'image', 'image_url', 'contact_method', 'contact_info', 'external_url',
            'status', 'rejection_reason', 'created_at', 'updated_at', 'expires_at', 'open_reports',
        )
        read_only_fields = ('status', 'rejection_reason', 'created_at', 'updated_at')

    def get_image_url(self, obj):
        return obj.image.url if obj.image else None

    def get_open_reports(self, obj):
        return getattr(obj, 'open_reports', None)

    # ---- validation ----
    def validate_publisher_name(self, value):
        value = value.strip()
        if len(value) < 2:
            raise serializers.ValidationError('Please enter your name (at least 2 characters).')
        return value

    def validate_title(self, value):
        value = value.strip()
        if len(value) < 3:
            raise serializers.ValidationError('Title must be at least 3 characters.')
        return value

    def validate_description(self, value):
        value = value.strip()
        if len(value) < 10:
            raise serializers.ValidationError('Description must be at least 10 characters.')
        return value

    def validate_image(self, value):
        if value is None:
            return value
        if value.size > settings.MAX_IMAGE_BYTES:
            raise serializers.ValidationError(f'Image must be {settings.MAX_IMAGE_BYTES // (1024 * 1024)}MB or smaller.')
        fmt = getattr(getattr(value, 'image', None), 'format', None)
        if fmt not in ALLOWED_IMAGE_FORMATS:
            raise serializers.ValidationError('Only JPEG, PNG or WebP images are allowed.')
        return value

    def validate_external_url(self, value):
        if value:
            try:
                URLValidator(schemes=ALLOWED_SCHEMES)(value)
            except DjangoValidationError:
                raise serializers.ValidationError('Enter a valid http(s) URL.')
        return value

    def validate_expires_at(self, value):
        if self.instance and value == self.instance.expires_at:
            return value  # unchanged; allow editing other fields of an expired post
        if value and value < timezone.localdate():
            raise serializers.ValidationError('Expiry date cannot be in the past.')
        return value

    def validate(self, attrs):
        method = attrs.get('contact_method', getattr(self.instance, 'contact_method', None))
        info = (attrs.get('contact_info', getattr(self.instance, 'contact_info', '')) or '').strip()
        if method == Announcement.ContactMethod.WHATSAPP:
            digits = re.sub(r'[\s\-+()]', '', info)
            if not digits.isdigit() or not 8 <= len(digits) <= 15:
                raise serializers.ValidationError({'contact_info': 'Enter a valid phone number (8-15 digits, with country code).'})
            info = digits
        elif method == Announcement.ContactMethod.EMAIL:
            try:
                EmailValidator()(info)
            except DjangoValidationError:
                raise serializers.ValidationError({'contact_info': 'Enter a valid email address.'})
        elif method == Announcement.ContactMethod.LINK:
            try:
                URLValidator(schemes=ALLOWED_SCHEMES)(info)
            except DjangoValidationError:
                raise serializers.ValidationError({'contact_info': 'Enter a valid http(s) URL.'})
        if 'contact_info' in attrs or 'contact_method' in attrs:
            attrs['contact_info'] = info
        return attrs


class ReportSerializer(serializers.ModelSerializer):
    announcement_title = serializers.CharField(source='announcement.title', read_only=True)
    announcement_status = serializers.CharField(source='announcement.status', read_only=True)
    reporter_name = serializers.SerializerMethodField()

    class Meta:
        model = Report
        fields = ('id', 'announcement', 'announcement_title', 'announcement_status', 'reporter_name',
                  'reason', 'status', 'created_at')
        read_only_fields = ('announcement', 'status', 'created_at')

    def get_reporter_name(self, obj):
        return obj.reporter.username if obj.reporter else 'Anonymous'

    def validate_reason(self, value):
        value = value.strip()
        if len(value) < 5:
            raise serializers.ValidationError('Please describe the problem (at least 5 characters).')
        return value
