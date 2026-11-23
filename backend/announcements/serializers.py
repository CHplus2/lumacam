import json
import re

from django.conf import settings
from django.core.validators import EmailValidator, URLValidator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import serializers

from .models import Announcement, Category, PickupLocation

ALLOWED_IMAGE_FORMATS = {'JPEG', 'PNG', 'WEBP'}
ALLOWED_SCHEMES = ['http', 'https']


# Must match the icon/colour maps in the frontend (src/utils.js, index.css).
CATEGORY_ICONS = [
    'utensils', 'shopping-bag', 'calendar-days', 'clipboard-list', 'briefcase-business', 'megaphone',
    'tag', 'book-open', 'music', 'dumbbell', 'heart-handshake', 'laptop', 'gamepad-2', 'house',
    'bus', 'shirt', 'palette', 'trophy', 'sparkles',
]
CATEGORY_COLORS = ['orange', 'blue', 'violet', 'teal', 'emerald', 'rose']


class CategorySerializer(serializers.ModelSerializer):
    announcement_count = serializers.IntegerField(read_only=True, required=False)
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = Category
        fields = ('id', 'name', 'slug', 'description', 'icon', 'color', 'sells_items', 'announcement_count',
                  'can_delete')
        read_only_fields = ('slug',)
        extra_kwargs = {'name': {'validators': []}}  # uniqueness checked case-insensitively below

    def get_can_delete(self, obj):
        from .ownership import owns
        request = self.context.get('request')
        return owns(getattr(request, 'user', None), obj, 'created_by_id')

    def validate_name(self, value):
        value = ' '.join(value.split())
        if not 2 <= len(value) <= 40:
            raise serializers.ValidationError('Category name must be 2-40 characters.')
        if Category.objects.filter(name__iexact=value, is_removed=False).exists():
            raise serializers.ValidationError('A category with this name already exists.')
        return value

    def validate_description(self, value):
        value = value.strip()
        if len(value) > 200:
            raise serializers.ValidationError('Description must be 200 characters or fewer.')
        return value

    def validate_icon(self, value):
        if value not in CATEGORY_ICONS:
            raise serializers.ValidationError('Choose one of the available icons.')
        return value

    def validate_color(self, value):
        if value not in CATEGORY_COLORS:
            raise serializers.ValidationError('Choose one of the available colours.')
        return value

    def create(self, validated_data):
        # Re-creating a deleted category brings it back (names are unique in the database).
        removed = Category.objects.filter(name__iexact=validated_data['name'], is_removed=True).first()
        if removed:
            for key, val in validated_data.items():
                setattr(removed, key, val)
            removed.is_removed = False
            removed.removed_at = None
            removed.save()
            return removed
        base = slugify(validated_data['name'])[:50] or 'category'
        slug, n = base, 2
        while Category.objects.filter(slug=slug).exists():
            slug, n = f'{base}-{n}', n + 1
        return Category.objects.create(slug=slug, **validated_data)


MAX_PICKUPS = 5


def clean_place(raw):
    return ' '.join(str(raw).split())


class PickupTagsField(serializers.Field):
    """Pickup places as a list of names.

    Accepts a JSON list, or (from multipart forms) a JSON string such as
    '["Block C lobby"]'. Sending an empty list clears the tags.
    """
    default_error_messages = {'invalid': 'Send pickup places as a list of names.'}

    def to_internal_value(self, data):
        if isinstance(data, str):
            data = data.strip()
            if not data:
                return []
            try:
                data = json.loads(data)
            except ValueError:
                self.fail('invalid')
        if not isinstance(data, list):
            self.fail('invalid')
        names, seen = [], set()
        for raw in data:
            name = clean_place(raw)
            if not name or name.lower() in seen:
                continue
            if not 2 <= len(name) <= 40:
                raise serializers.ValidationError(f'"{name[:40]}": pickup places must be 2-40 characters.')
            seen.add(name.lower())
            names.append(name)
        if len(names) > MAX_PICKUPS:
            raise serializers.ValidationError(f'Add at most {MAX_PICKUPS} pickup places.')
        return names

    def to_representation(self, value):
        return [p.name for p in value.all()]


class AnnouncementSerializer(serializers.ModelSerializer):
    category = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.filter(is_removed=False),
        error_messages={'does_not_exist': 'This category no longer exists. Please choose another one.',
                        'incorrect_type': 'Please choose a category.'})
    category_detail = CategorySerializer(source='category', read_only=True)
    image = serializers.ImageField(write_only=True, required=False, allow_null=True)
    remove_image = serializers.BooleanField(write_only=True, required=False, default=False)
    image_url = serializers.SerializerMethodField()
    pickup_locations = PickupTagsField(required=False)
    can_edit = serializers.SerializerMethodField()

    class Meta:
        model = Announcement
        fields = (
            'id', 'title', 'description', 'category', 'category_detail', 'publisher_name',
            'image', 'remove_image', 'image_url', 'contact_method', 'contact_info', 'external_url',
            'created_at', 'updated_at', 'expires_at', 'event_start', 'event_end',
            'availability', 'stock_updated_at', 'pickup_locations', 'can_edit',
        )
        read_only_fields = ('created_at', 'updated_at', 'stock_updated_at', 'publisher_name')

    def get_can_edit(self, obj):
        """True when the logged-in account posted this."""
        from .ownership import owns
        request = self.context.get('request')
        return owns(getattr(request, 'user', None), obj)

    def get_image_url(self, obj):
        return obj.image.url if obj.image else None

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

    MAX_EVENT_DAYS = 366

    def _validate_event(self, attrs):
        inst = self.instance
        start = attrs.get('event_start', getattr(inst, 'event_start', None))
        end = attrs.get('event_end', getattr(inst, 'event_end', None))
        if end and not start:
            raise serializers.ValidationError({'event_start': 'Add a start date, or clear the end date.'})
        if start and end and end < start:
            raise serializers.ValidationError({'event_end': 'End date must be on or after the start date.'})
        if start and end and (end - start).days > self.MAX_EVENT_DAYS:
            raise serializers.ValidationError({'event_end': 'Events can last at most a year.'})
        changed = inst is None or start != inst.event_start or end != inst.event_end
        if start and changed and (end or start) < timezone.localdate():
            raise serializers.ValidationError({'event_start': 'This date has already passed.'})
        if end == start:
            attrs['event_end'] = None  # store single-day events with no end date

    def _validate_selling(self, attrs):
        """Stock status and pickup places only exist in categories that sell items."""
        inst = self.instance
        category = attrs.get('category', getattr(inst, 'category', None))
        if category is None or not category.sells_items:
            attrs['availability'] = ''
            attrs['pickup_locations'] = []
            return
        current = getattr(inst, 'availability', '')
        new = attrs.get('availability', current) or Announcement.Availability.AVAILABLE
        attrs['availability'] = new
        if inst is None or new != current:
            attrs['stock_updated_at'] = timezone.now()

    def validate(self, attrs):
        self._validate_event(attrs)
        self._validate_selling(attrs)
        method = attrs.get('contact_method', getattr(self.instance, 'contact_method', Announcement.ContactMethod.NONE))
        info = (attrs.get('contact_info', getattr(self.instance, 'contact_info', '')) or '').strip()
        if method == Announcement.ContactMethod.NONE:
            info = ''  # contact is optional
        elif not info:
            raise serializers.ValidationError({'contact_info': 'Enter your contact details, or choose "No contact".'})
        elif method == Announcement.ContactMethod.WHATSAPP:
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

    @staticmethod
    def _set_pickups(instance, names):
        if names is None:
            return
        places = []
        for name in names:
            place = PickupLocation.objects.filter(name__iexact=name).first()
            places.append(place or PickupLocation.objects.create(name=name))
        instance.pickup_locations.set(places)

    def create(self, validated_data):
        validated_data.pop('remove_image', None)
        pickups = validated_data.pop('pickup_locations', None)
        instance = super().create(validated_data)
        self._set_pickups(instance, pickups)
        return instance

    def update(self, instance, validated_data):
        pickups = validated_data.pop('pickup_locations', None)
        remove = validated_data.pop('remove_image', False)
        old_image = instance.image.name if instance.image else None
        replacing = 'image' in validated_data and validated_data['image'] is not None
        if remove and not replacing:
            validated_data['image'] = ''
        elif 'image' in validated_data and validated_data['image'] is None:
            validated_data.pop('image')  # an empty file field means "keep the current image"
        instance = super().update(instance, validated_data)
        self._set_pickups(instance, pickups)
        if old_image and old_image != (instance.image.name or None):
            instance.image.storage.delete(old_image)
        return instance


def _iso(dt):
    # Same format as DRF's DateTimeField, so removed_at and purge_at match.
    return serializers.DateTimeField().to_representation(dt) if dt else None


class TrashedAnnouncementSerializer(AnnouncementSerializer):
    purge_at = serializers.SerializerMethodField()
    category_in_trash = serializers.BooleanField(source='category.is_removed', read_only=True)

    class Meta(AnnouncementSerializer.Meta):
        fields = AnnouncementSerializer.Meta.fields + ('removed_at', 'purge_at', 'category_in_trash')
        read_only_fields = fields

    def get_purge_at(self, obj):
        from .trash import purge_at
        return _iso(purge_at(obj.removed_at))


class TrashedCategorySerializer(CategorySerializer):
    purge_at = serializers.SerializerMethodField()
    trashed_posts = serializers.IntegerField(read_only=True)

    class Meta(CategorySerializer.Meta):
        fields = CategorySerializer.Meta.fields + ('removed_at', 'purge_at', 'trashed_posts')
        read_only_fields = fields

    def get_purge_at(self, obj):
        from datetime import timedelta

        from .trash import trash_days
        # A category waits for its newest trashed post before it can be erased.
        latest = max(filter(None, [obj.removed_at, getattr(obj, 'latest_post_removed_at', None)]), default=None)
        return _iso(latest + timedelta(days=trash_days()) if latest else None)

