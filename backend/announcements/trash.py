"""Trash: deleted posts and categories are kept for TRASH_DAYS, then erased.

Vercel has no always-on scheduler, so purge() runs lazily: when a server
instance starts and whenever someone opens the Trash. `manage.py purge_trash`
does the same from a shell or a cron job.
"""
import logging
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)


def trash_days():
    return settings.TRASH_DAYS


def purge_at(removed_at):
    return removed_at + timedelta(days=trash_days()) if removed_at else None


@transaction.atomic
def purge(now=None):
    """Erase trashed items older than TRASH_DAYS. Returns (posts, categories) erased."""
    from .models import Announcement, Category
    cutoff = (now or timezone.now()) - timedelta(days=trash_days())
    posts = 0
    for ann in Announcement.objects.filter(status=Announcement.Status.REMOVED, removed_at__lt=cutoff):
        ann.delete()  # model delete() also removes the stored image
        posts += 1
    # A category is only erased once nothing points at it any more; a trashed
    # post younger than TRASH_DAYS keeps its category in the Trash until then.
    cats = (Category.objects.filter(is_removed=True, removed_at__lt=cutoff, announcements__isnull=True)
            .delete()[1].get('announcements.Category', 0))
    if posts or cats:
        logger.info('Trash purge erased %s post(s) and %s categor(ies).', posts, cats)
    return posts, cats


def safe_purge():
    try:
        return purge()
    except Exception:  # never break a request because of clean-up
        logger.exception('Trash purge failed.')
        return 0, 0
