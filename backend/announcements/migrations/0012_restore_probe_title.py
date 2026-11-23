from django.db import migrations


def restore_title(apps, schema_editor):
    # A deploy check accidentally renamed demo post #1 to "probe" (2026-11-23).
    # Only touch it if it still has that exact accidental title.
    Announcement = apps.get_model('announcements', 'Announcement')
    Announcement.objects.filter(pk=1, title='probe').update(title='Homemade nasi lemak - daily pre-order')


class Migration(migrations.Migration):
    dependencies = [('announcements', '0011_owner_edit_keys')]
    operations = [migrations.RunPython(restore_title, migrations.RunPython.noop)]
