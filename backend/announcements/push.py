"""Web Push: phone and desktop notifications for followed categories.

Flow: the browser asks GET /api/push/key/ for the public key, subscribes with
the browser's push service (Google/Apple/Mozilla/Microsoft), and sends that
subscription plus the chosen categories to POST /api/push/subscribe/. When a
post is created, notify_new_announcement() sends an encrypted message to every
subscription that follows its category.
"""
import base64
import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

logger = logging.getLogger(__name__)

# The server only ever sends to real browser push services. Without this, a
# visitor could register any URL and make the server call it (SSRF).
PUSH_SERVICE_HOST_SUFFIXES = (
    'fcm.googleapis.com',          # Chrome, Edge on Android, Samsung Internet
    'android.googleapis.com',
    'push.services.mozilla.com',   # Firefox
    'push.apple.com',              # Safari / iPhone Home Screen apps
    'notify.windows.com',          # Edge on Windows
)


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


# Chromium builds also hand out Google push endpoints like https://jmt17.google.com/fcm/send/...
GOOGLE_PUSH_HOST = re.compile(r'^jmt\d+\.google\.com$')


def is_allowed_endpoint(url: str) -> bool:
    try:
        parts = urlparse(url)
    except ValueError:
        return False
    host = (parts.hostname or '').lower()
    if parts.scheme != 'https' or not host or parts.port not in (None, 443):
        return False
    if GOOGLE_PUSH_HOST.match(host):
        return True
    allowed = getattr(settings, 'PUSH_SERVICE_HOSTS', PUSH_SERVICE_HOST_SUFFIXES)
    return any(host == s or host.endswith('.' + s) for s in allowed)


def _generate_keys():
    private = ec.generate_private_key(ec.SECP256R1())
    public_raw = private.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    pem = private.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    return b64url(public_raw), pem


def get_keys():
    """(public_key_b64url, private_pem). Env vars win; else the stored pair; else create one."""
    env_pub, env_priv = settings.VAPID_PUBLIC_KEY, settings.VAPID_PRIVATE_KEY
    if env_pub and env_priv:
        return env_pub, env_priv.replace('\\n', '\n')
    from .models import PushKeys
    keys = PushKeys.objects.filter(pk=1).first()
    if keys is None:
        public, pem = _generate_keys()
        try:
            with transaction.atomic():
                keys = PushKeys.objects.create(pk=1, public_key=public, private_pem=pem)
        except IntegrityError:  # another server instance created it at the same moment
            keys = PushKeys.objects.get(pk=1)
    return keys.public_key, keys.private_pem


def _vapid():
    from py_vapid import Vapid
    _, pem = get_keys()
    return Vapid.from_pem(pem.encode())


GONE, OK, FAILED = 'gone', 'ok', 'failed'


def _deliver(subscription_info, data, vapid):
    """One HTTP request to the push service. No database access, so it is safe in worker threads."""
    from pywebpush import WebPushException, webpush
    try:
        webpush(
            subscription_info=subscription_info,
            data=data,
            vapid_private_key=vapid,
            # A fresh dict each time: pywebpush writes the push service into it.
            vapid_claims={'sub': settings.PUSH_CONTACT},
            ttl=24 * 60 * 60,
            timeout=8,
            headers={'Urgency': 'high'},
        )
        return OK
    except WebPushException as exc:
        if getattr(exc.response, 'status_code', None) in (404, 410):  # unsubscribed or expired on the phone
            return GONE
        logger.warning('Push to %s failed: %s', subscription_info['endpoint'][:40], exc)
    except Exception:
        logger.exception('Push to %s failed.', subscription_info['endpoint'][:40])
    return FAILED


def _record(results, counts_toward_limit=True):
    """Apply delivery results in the request thread: drop dead subscriptions, stamp successful ones."""
    from .models import PushSubscription
    gone = [pk for pk, r in results if r == GONE]
    ok = [pk for pk, r in results if r == OK]
    if gone:
        PushSubscription.objects.filter(pk__in=gone).delete()
    if ok and counts_toward_limit:
        PushSubscription.objects.filter(pk__in=ok).update(last_sent_at=timezone.now())


def send(subscription, payload: dict, counts_toward_limit=True):
    """Send one notification now, ignoring the device's limits. Returns True on success."""
    result = _deliver(subscription.as_subscription_info(), json.dumps(payload), _vapid())
    _record([(subscription.pk, result)], counts_toward_limit)
    return result == OK


def payload_for(announcement):
    category = announcement.category
    body = announcement.title
    if announcement.publisher_name:
        body = f'{announcement.title}\n{announcement.publisher_name}'
    return {
        'title': f'New in {category.name}',
        'body': body[:180],
        'url': f'/announcements/{announcement.pk}',
        # One notification per category: a newer post replaces the older one
        # on the phone instead of stacking up.
        'tag': f'lumacam-cat-{category.pk}',
        'icon': '/icons/icon-192.png',
        'badge': '/icons/badge-96.png',
    }


def notify_new_announcement(announcement):
    """Notify every subscription that follows this post's category. Returns how many were delivered."""
    from .models import PushSubscription
    from django.db.models import Q
    now = timezone.now()
    cat = announcement.category
    # Logged-in devices follow their account's categories; others their own.
    follows = (Q(user__isnull=True, categories=cat)
               | Q(user__isnull=False, user__notification_prefs__categories=cat))
    candidates = (PushSubscription.objects.filter(follows).distinct()
                  .select_related('user__notification_prefs')[:settings.PUSH_MAX_PER_POST])
    # Respect each device's frequency limit and quiet hours. Skipped posts still
    # show in the in-app bell; they are not sent later.
    subs = [s for s in candidates if s.may_notify(now)]
    if not subs:
        return 0
    data = json.dumps(payload_for(announcement))
    vapid = _vapid()  # read the key here, not in the worker threads
    jobs = [(s.pk, s.as_subscription_info()) for s in subs]
    # Send before the response returns: Vercel may stop background work afterwards.
    with ThreadPoolExecutor(max_workers=min(8, len(jobs))) as pool:
        results = list(zip([pk for pk, _ in jobs], pool.map(lambda j: _deliver(j[1], data, vapid), jobs)))
    _record(results)
    return sum(1 for _, r in results if r == OK)
