from django.core.management.base import BaseCommand
from django.db.models import Sum

from announcements.models import UsageCount


class Command(BaseCommand):
    help = 'Print evidence counts (totals, then per day). Numbers only.'

    def handle(self, *args, **opts):
        for row in UsageCount.objects.values('name').annotate(total=Sum('count')).order_by('name'):
            self.stdout.write(f"{row['name']:<28} {row['total']}")
        self.stdout.write('')
        for row in UsageCount.objects.order_by('day', 'name'):
            self.stdout.write(f'{row.day}  {row.name:<28} {row.count}')
