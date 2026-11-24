"""Create demo users and announcements for local development.

Images are generated placeholders; real photos can be uploaded through the app.
"""
import io
import os
import secrets
from datetime import timedelta

from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand
from django.utils import timezone
from PIL import Image, ImageDraw

from accounts.models import User
from announcements.models import Announcement, Category, PickupLocation

PALETTE = {
    'food-drinks': ((251, 191, 120), (244, 114, 60)),
    'marketplace': ((147, 197, 253), (59, 130, 246)),
    'events': ((196, 181, 253), (124, 58, 237)),
    'surveys': ((153, 246, 228), (13, 148, 136)),
    'opportunities': ((110, 231, 183), (5, 150, 105)),
    'other': ((253, 164, 175), (225, 29, 72)),
}

DEMO = [
    ('food-drinks', 'Homemade nasi lemak - daily pre-order', 'Fresh nasi lemak with sambal and fried chicken, RM6 per pack. Order before 9am for lunch pickup at the Block C lobby.', 'whatsapp', '60123456789', 0),
    ('food-drinks', 'Iced coffee & brownies, Fridays only', 'Cold brew and fudge brownies baked fresh every Friday. Pickup near the library from 12pm.', 'whatsapp', '60129876543', 0),
    ('marketplace', 'Calculus textbook (9th ed.) - barely used', 'Selling my calculus textbook, no highlights, RM45 negotiable. Can meet on campus.', 'email', 'seller@example.com', 0),
    ('marketplace', 'Wireless mouse + laptop stand bundle', 'Moving out, selling a wireless mouse and an aluminium laptop stand for RM55 together.', 'whatsapp', '60171234567', 14),
    ('events', 'Campus Hackathon 2026 - register now', 'A 24-hour hackathon open to all students. Teams of 3-4, prizes for the top three. Registration closes soon.', 'link', 'https://example.com/hackathon', 21),
    ('events', 'Intro to Cloud Computing workshop', 'Free hands-on workshop run by an industry speaker. Bring your laptop. Limited seats.', 'link', 'https://example.com/cloud-workshop', 10),
    ('surveys', 'FYP survey: students and sleep habits', 'Final-year project survey on sleep and academic performance. Takes about 5 minutes, all responses are anonymous.', 'link', 'https://forms.gle/example', 30),
    ('opportunities', 'Software engineering internship (6 months)', 'A local startup is hiring interns for backend and frontend work starting next semester. Allowance provided.', 'email', 'careers@example.com', 45),
    ('opportunities', 'Volunteer: orientation week helpers', 'We need volunteers to guide new students during orientation week. Certificate provided.', 'whatsapp', '60181112222', 20),
    ('other', 'Lost: black umbrella near Lecture Hall B', 'Lost a black foldable umbrella near Lecture Hall B on Monday. Please contact me if found.', 'whatsapp', '60134445555', 0),
]


# Stock status and pickup places for the selling posts.
SELLING = {
    'Homemade nasi lemak - daily pre-order': ('limited', ['Block C lobby']),
    'Iced coffee & brownies, Fridays only': ('available', ['Library entrance']),
    'Calculus textbook (9th ed.) - barely used': ('available', ['Library entrance', 'Student centre']),
    'Wireless mouse + laptop stand bundle': ('out', ['Block C lobby']),
}

# Event windows for some demo posts: (start offset, end offset or None) in days from today.
EVENT_DAYS = {
    'Campus Hackathon 2026 - register now': (5, 6),
    'Intro to Cloud Computing workshop': (2, None),
    'FYP survey: students and sleep habits': (0, 14),
    'Volunteer: orientation week helpers': (10, 14),
}

NAMES = ['Aina', 'Daniel', 'Priya', 'Wei Jie', 'Siti']


def make_image(slug, label):
    top, bottom = PALETTE[slug]
    img = Image.new('RGB', (800, 500))
    d = ImageDraw.Draw(img)
    for y in range(500):
        t = y / 499
        d.line([(0, y), (800, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    d.text((40, 440), label[:60], fill=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, 'JPEG', quality=85)
    return ContentFile(buf.getvalue(), name='demo.jpg')


class Command(BaseCommand):
    help = 'Create the emergency admin account and sample announcements.'

    def add_arguments(self, parser):
        parser.add_argument('--no-images', action='store_true',
                            help='Skip placeholder images (use when media is not stored persistently, e.g. Vercel).')

    def handle(self, *args, **opts):
        admin, created = User.objects.get_or_create(username='admin', defaults={
            'email': 'admin@lumacam.test', 'is_staff': True, 'is_superuser': True})
        if created:
            # Never a fixed password: this repo is public. Use the env var, or a random one shown once.
            password = os.environ.get('SEED_ADMIN_PASSWORD') or secrets.token_urlsafe(12)
            admin.set_password(password)
            admin.save()
            admin_note = f'admin / {password} (shown once; change it with: manage.py changepassword admin)'
        else:
            admin_note = 'admin (already existed; password unchanged)'
        if Announcement.objects.exists():
            self.stdout.write('Demo announcements already exist; skipping.')
        else:
            today = timezone.localdate()
            for i, (slug, title, desc, method, info, days) in enumerate(DEMO):
                ann = Announcement(
                    title=title, description=desc, category=Category.objects.get(slug=slug),
                    publisher_name=NAMES[i % len(NAMES)], contact_method=method, contact_info=info,
                    status=Announcement.Status.APPROVED,
                    expires_at=today + timedelta(days=days) if days else None,
                    event_start=today + timedelta(days=EVENT_DAYS[title][0]) if title in EVENT_DAYS else None,
                    event_end=(today + timedelta(days=EVENT_DAYS[title][1])
                               if title in EVENT_DAYS and EVENT_DAYS[title][1] is not None else None),
                )
                if not opts['no_images']:
                    ann.image.save('demo.jpg', make_image(slug, title), save=False)
                ann.save()
                if title in SELLING:
                    ann.availability, places = SELLING[title]
                    ann.stock_updated_at = timezone.now()
                    ann.save(update_fields=['availability', 'stock_updated_at'])
                    ann.pickup_locations.set([PickupLocation.objects.get_or_create(name=n)[0] for n in places])
        self.stdout.write(self.style.SUCCESS(
            f'Demo data ready. Emergency admin at /django-admin/: {admin_note}'))
