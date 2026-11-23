from django.contrib import admin

from .models import Announcement, Category, PickupLocation, PushSubscription

admin.site.register(PickupLocation)


@admin.register(PushSubscription)
class PushSubscriptionAdmin(admin.ModelAdmin):
    list_display = ('__str__', 'frequency', 'quiet_hours', 'last_sent_at', 'created_at')
    filter_horizontal = ('categories',)



@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'is_removed', 'sort_order')
    list_filter = ('is_removed',)
    actions = ['restore']

    @admin.action(description='Restore selected categories')
    def restore(self, request, queryset):
        queryset.update(is_removed=False, removed_at=None)


@admin.register(Announcement)
class AnnouncementAdmin(admin.ModelAdmin):
    list_display = ('title', 'category', 'publisher_name', 'status', 'created_at')
    list_filter = ('status', 'category')
    search_fields = ('title', 'description', 'publisher_name')
    actions = ['restore']

    @admin.action(description='Restore selected posts (make them live again)')
    def restore(self, request, queryset):
        queryset.update(status=Announcement.Status.APPROVED, removed_at=None)
