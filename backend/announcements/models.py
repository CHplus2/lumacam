from django.conf import settings
from django.db import models
from django.utils import timezone


class Category(models.Model):
    name = models.CharField(max_length=60, unique=True)
    slug = models.SlugField(max_length=60, unique=True)
    description = models.CharField(max_length=200, blank=True)
    icon = models.CharField(max_length=40, help_text='Lucide icon identifier, e.g. "utensils"')
    color = models.CharField(max_length=20, default='blue', help_text='Theme colour key used by the frontend')
    sort_order = models.PositiveSmallIntegerField(default=50)
    # Kept for a future moderation step; new categories are live immediately.
    is_approved = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, null=True)
    # "Delete" in the app moves a category to the Trash (only once it has no
    # live posts). It is erased for good TRASH_DAYS after removed_at.
    is_removed = models.BooleanField(default=False, db_index=True)
    removed_at = models.DateTimeField(null=True, blank=True)
    # Categories where students sell food or items get a stock status and
    # pickup place tags on their posts.
    sells_items = models.BooleanField(default=False)
    # Only the account that created a category can delete it (the original six have none).
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                   on_delete=models.SET_NULL, related_name='categories')

    class Meta:
        ordering = ['sort_order', 'name']
        verbose_name_plural = 'categories'

    def __str__(self):
        return self.name


class PickupLocation(models.Model):
    """A hostel or campus spot where buyers collect food or items, e.g. "Block C lobby"."""
    name = models.CharField(max_length=40, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


def announcement_image_path(instance, filename):
    import uuid
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else 'jpg'
    return f'announcements/{timezone.now():%Y/%m}/{uuid.uuid4().hex}.{ext}'


class Announcement(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        APPROVED = 'approved', 'Live'
        REJECTED = 'rejected', 'Rejected'
        # "Delete" in the app moves a post to the Trash; it is erased for good
        # TRASH_DAYS after removed_at, and can be restored until then.
        REMOVED = 'removed', 'In trash'

    class Availability(models.TextChoices):
        NONE = '', 'Not applicable'
        AVAILABLE = 'available', 'Available'
        LIMITED = 'limited', 'Limited stock'
        OUT = 'out', 'Out of stock'

    class ContactMethod(models.TextChoices):
        WHATSAPP = 'whatsapp', 'WhatsApp'
        EMAIL = 'email', 'Email'
        LINK = 'link', 'External link'
        NONE = 'none', 'No contact'

    title = models.CharField(max_length=120)
    description = models.TextField(max_length=3000)
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name='announcements')
    # The account that posted it; only this account can edit, delete or restore it.
    publisher = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                  on_delete=models.SET_NULL, related_name='announcements')
    publisher_name = models.CharField(max_length=80, default='')
    image = models.ImageField(upload_to=announcement_image_path, blank=True)
    contact_method = models.CharField(max_length=10, choices=ContactMethod.choices, default=ContactMethod.NONE)
    contact_info = models.CharField(max_length=254, blank=True)
    external_url = models.URLField(blank=True, help_text='Optional registration / Google Forms link')
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.APPROVED, db_index=True)
    rejection_reason = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    expires_at = models.DateField(null=True, blank=True)
    # When the thing happens (event, deadline, preorder window). Optional.
    # Without an expiry date, the post is hidden the day after the event ends.
    event_start = models.DateField(null=True, blank=True, db_index=True)
    event_end = models.DateField(null=True, blank=True)
    removed_at = models.DateTimeField(null=True, blank=True, db_index=True)
    # Only used in categories that sell items (Category.sells_items).
    availability = models.CharField(max_length=10, choices=Availability.choices, blank=True, default='')
    stock_updated_at = models.DateTimeField(null=True, blank=True)
    pickup_locations = models.ManyToManyField(PickupLocation, blank=True, related_name='announcements')
    # Posts made before accounts used a browser edit key; its SHA-256 lets the poster
    # claim the post into their account (accounts/views.py). Cleared once claimed.
    edit_token_hash = models.CharField(max_length=64, blank=True, default='', editable=False)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['status', 'category', '-created_at'])]

    def __str__(self):
        return self.title

    def delete(self, *args, **kwargs):
        image = self.image
        super().delete(*args, **kwargs)
        if image:
            image.delete(save=False)


class StoredFile(models.Model):
    """Binary file content for DatabaseStorage (uploaded images)."""
    name = models.CharField(max_length=255, unique=True)
    content = models.BinaryField()
    content_type = models.CharField(max_length=100)
    size = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class PushKeys(models.Model):
    """The site's Web Push (VAPID) key pair, created automatically on first use.

    Stored in the database so phone notifications work without extra setup on
    Vercel. VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY environment variables override it.
    """
    public_key = models.CharField(max_length=120)
    private_pem = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = 'push keys'


class PushSubscription(models.Model):
    """One browser or phone that wants notifications for some categories (no account needed).

    Anti-spam limits are enforced here on the server, so a busy category can't
    flood a phone: `frequency` caps how often this device is notified, and
    `quiet_hours` holds notifications back overnight in the device's timezone.
    """
    class Frequency(models.TextChoices):
        EVERY = 'every', 'Every new post'
        HOURLY = 'hourly', 'At most one an hour'
        DAILY = 'daily', 'At most one a day'

    QUIET_START, QUIET_END = 22, 7  # 10pm to 7am, device local time

    endpoint = models.CharField(max_length=500, unique=True)
    p256dh = models.CharField(max_length=200)
    auth = models.CharField(max_length=100)
    categories = models.ManyToManyField(Category, blank=True, related_name='push_subscriptions')
    frequency = models.CharField(max_length=10, choices=Frequency.choices, default=Frequency.HOURLY)
    quiet_hours = models.BooleanField(default=True)
    # Minutes to add to UTC to get the device's local time (UTC+8 -> 480).
    utc_offset_minutes = models.SmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    last_sent_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return self.endpoint[:60]

    def local_now(self, now):
        """This device's wall-clock time, whatever the server's TIME_ZONE is."""
        from datetime import timedelta, timezone as dt_timezone
        return now.astimezone(dt_timezone.utc) + timedelta(minutes=self.utc_offset_minutes)

    def in_quiet_hours(self, now):
        hour = self.local_now(now).hour
        return self.quiet_hours and (hour >= self.QUIET_START or hour < self.QUIET_END)

    def may_notify(self, now):
        """True if a new-post notification is allowed right now under this device's limits."""
        from datetime import timedelta
        if self.in_quiet_hours(now):
            return False
        last = self.last_sent_at
        if last is None or self.frequency == self.Frequency.EVERY:
            return True
        if self.frequency == self.Frequency.HOURLY:
            return now - last >= timedelta(hours=1)
        return self.local_now(last).date() < self.local_now(now).date()  # DAILY: once per local day

    def as_subscription_info(self):
        return {'endpoint': self.endpoint, 'keys': {'p256dh': self.p256dh, 'auth': self.auth}}

