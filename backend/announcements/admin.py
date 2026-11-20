from django.contrib import admin

from .models import Announcement, Category

admin.site.register(Category)


@admin.register(Announcement)
class AnnouncementAdmin(admin.ModelAdmin):
    list_display = ('title', 'category', 'publisher_name', 'status', 'created_at')
    list_filter = ('status', 'category')
    search_fields = ('title', 'description', 'publisher_name')
    actions = ['restore']

    @admin.action(description='Restore selected posts (make them live again)')
    def restore(self, request, queryset):
        queryset.update(status=Announcement.Status.APPROVED)
