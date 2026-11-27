"""Lost & found matching: when a lost or found post is saved, look for its other half.

1. Candidates: live posts of the opposite kind from the last DAYS days, newest first, at most 20.
2. Cheap filter, no AI: keep candidates sharing a meaningful word (colour, item, place).
3. If the AI is on, it picks the real matches among those. Only title, description, place and
   date are sent, never contact details. Ids it invents are dropped.
4. If the AI is off or fails, the word-overlap matches are used as they are.
New matches are saved once per pair, and the lost post's owner gets a phone notification.
"""
import json
import logging
import re
from datetime import timedelta

from django.utils import timezone

from . import ai_fill, push
from .models import Announcement, LostFoundMatch, PushSubscription, UsageCount

logger = logging.getLogger(__name__)

DAYS = 30
MAX_CANDIDATES = 20
AI_ATTEMPT = 5  # seconds per try: this runs while the poster waits, so keep it shorter than autofill

# Words that say nothing about which item it is.
STOP = set('''
a an and are at be been by can for from has have i if in is it its lost found me my near of on or our
please pls the this to was we with you your anyone someone somebody item thing left lose losing finder
whatsapp contact call text msg message dm thanks thank tq today yesterday morning afternoon evening night
around inside outside somewhere about seen saw kindly help if has had any who where when time day
yang dan di ke ada saya hilang jumpa terjumpa tolong
'''.split())

SYSTEM = """You match lost items with found items on a campus noticeboard.
You get one post and a list of candidate posts of the opposite kind.
Reply with json only: {"matches": [{"id": 123, "reason": "short reason, max 100 characters"}]}
Only include candidates that could really be the same item (same kind of item, no clear
contradiction in colour, brand, place or date). If none could be, reply {"matches": []}."""


def words(post):
    text = f'{post.title} {post.description} {post.lost_found_place}'.lower()
    return {w for w in re.findall(r'[a-z0-9]+', text) if len(w) >= 3 and w not in STOP}


def _brief(post):
    """What the AI may see: never contact details or who posted it."""
    return {'id': post.pk, 'title': post.title, 'description': post.description[:500],
            'place': post.lost_found_place,
            'date': post.lost_found_date.isoformat() if post.lost_found_date else None}


def _ask_ai(post, candidates):
    """Return {id: reason} picked by the AI, or None when it is off or fails."""
    if not ai_fill.enabled():
        return None
    user = json.dumps({'post': {**_brief(post), 'kind': post.lost_found},
                       'candidates': [_brief(c) for c in candidates]})
    reply = ai_fill.ask_json(SYSTEM, user, attempt=AI_ATTEMPT)
    if reply is None or not isinstance(reply[0], dict) or not isinstance(reply[0].get('matches'), list):
        return None
    allowed = {c.pk for c in candidates}
    picked = {}
    for m in reply[0]['matches']:
        if isinstance(m, dict) and m.get('id') in allowed:  # drop ids we never sent
            reason = m.get('reason')
            picked[m['id']] = reason.strip()[:200] if isinstance(reason, str) and reason.strip() else 'Looks similar'
    return picked


def find_matches(post):
    """Match `post` against the opposite kind; save and announce new matches. Returns the new ones."""
    from .views import public_queryset  # views imports this module
    if post.lost_found not in ('lost', 'found') or post.status != Announcement.Status.APPROVED:
        return []
    other = 'found' if post.lost_found == 'lost' else 'lost'
    candidates = (public_queryset().filter(lost_found=other, created_at__gte=timezone.now() - timedelta(days=DAYS))
                  .exclude(pk=post.pk).order_by('-created_at')[:MAX_CANDIDATES])
    if post.publisher_id:
        candidates = [c for c in candidates if c.publisher_id != post.publisher_id]  # your own post isn't a match
    mine = words(post)
    overlap = {c.pk: mine & words(c) for c in candidates}
    candidates = [c for c in candidates if overlap[c.pk]]
    if not candidates:
        return []
    picked = _ask_ai(post, candidates)
    if picked is None:  # AI off or failed: the shared words are the reason
        picked = {c.pk: 'Both mention ' + ', '.join(sorted(overlap[c.pk])[:4]) for c in candidates}
    new = []
    for c in candidates:
        if c.pk not in picked:
            continue
        lost, found = (post, c) if post.lost_found == 'lost' else (c, post)
        match, created = LostFoundMatch.objects.get_or_create(lost=lost, found=found,
                                                              defaults={'reason': picked[c.pk]})
        if created:
            new.append(match)
    if new:
        UsageCount.bump('lf_matches_found', len(new))
    for match in new:
        notify_owner(match)
    return new


def notify_owner(match):
    """Tell the lost post's owner on their account's phones, within their limits and quiet hours."""
    owner = match.lost.publisher_id
    if not owner:
        return 0
    now = timezone.now()
    subs = [s for s in PushSubscription.objects.filter(user_id=owner).select_related('user__notification_prefs')
            if s.may_notify(now)]
    payload = {
        'title': f'Lumi may have found your {match.lost.title[:60]}',
        'body': f'{match.found.title[:100]}\n{match.reason[:80]}',
        'url': f'/announcements/{match.lost.pk}',
        'tag': f'lumacam-lostfound-{match.lost.pk}',
        'icon': '/icons/icon-192.png',
        'badge': '/icons/badge-96.png',
    }
    sent = sum(1 for s in subs if push.send(s, payload))
    if sent:
        UsageCount.bump('lf_notifications_sent', sent)
    return sent
