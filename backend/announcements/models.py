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
    # Unused while the app has no accounts; kept for a future login system.
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
