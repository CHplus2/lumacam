from django.contrib import admin

from .models import Announcement, Category, Report

admin.site.register(Category)
admin.site.register(Report)


@admin.register(Announcement)
class AnnouncementAdmin(admin.ModelAdmin):
    list_display = ('title', 'category', 'publisher', 'status', 'created_at')
    list_filter = ('status', 'category')
    search_fields = ('title', 'description')
