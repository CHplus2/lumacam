from django.core.management.base import BaseCommand

from announcements.trash import purge, trash_days


class Command(BaseCommand):
    help = 'Erase posts and categories that have been in the Trash longer than TRASH_DAYS.'

    def handle(self, *args, **opts):
        posts, cats = purge()
        self.stdout.write(self.style.SUCCESS(
            f'Erased {posts} post(s) and {cats} categor(ies) older than {trash_days()} days.'))
