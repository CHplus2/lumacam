"""Apply pending database migrations when the server starts.

On serverless hosts (Vercel) there is no shell to run `manage.py migrate`, so
production instances apply migrations themselves on cold start. When nothing
is pending this is a quick no-op. Disabled when DEBUG is on (local
development) or when AUTO_MIGRATE=0.
"""
import logging
import os

logger = logging.getLogger(__name__)


def run():
    from django.conf import settings
    if settings.DEBUG or os.environ.get('AUTO_MIGRATE', '1').lower() in ('0', 'false', 'no'):
        return
    from django.core.management import call_command
    try:
        call_command('migrate', interactive=False, verbosity=0)
    except Exception:  # e.g. another instance migrating at the same moment
        logger.exception('Automatic migration failed; continuing to serve requests.')
        return
    from announcements.trash import safe_purge
    safe_purge()  # erase Trash items past their 30 days
