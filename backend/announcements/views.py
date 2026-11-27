import logging
import time
from datetime import date, timedelta, timezone as dt_timezone

from django.db.models import Case, Count, F, Q, Value, When
from django.db.models.functions import Coalesce
from django.http import Http404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import generics, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated, IsAuthenticatedOrReadOnly

from django.db.models import Max
from django.shortcuts import get_object_or_404

from . import ai_fill, lost_found, ownership, push
from .models import (Announcement, Category, LostFoundMatch, NotificationPrefs, PickupLocation, PushSubscription,
                     UsageCount)
from .serializers import (AnnouncementSerializer, CategorySerializer, TrashedAnnouncementSerializer,
                          TrashedCategorySerializer)
from .trash import safe_purge

ORDERINGS = {
    'newest': '-created_at',
    'oldest': 'created_at',
    'expiring': 'ending',  # old name, kept for shared links
    'ending': 'ending',
    'upcoming': 'event_start',
}


def not_expired_q(today, prefix=''):
    """Still relevant today: before its expiry date, or (without one) not past its event."""
    f = lambda name: prefix + name  # noqa: E731
    return (Q(**{f('expires_at__gte'): today})
            | Q(**{f('expires_at__isnull'): True, f('event_start__isnull'): True})
            | Q(**{f('expires_at__isnull'): True, f('event_end__gte'): today})
            | Q(**{f('expires_at__isnull'): True, f('event_end__isnull'): True, f('event_start__gte'): today}))


def public_queryset():
    today = timezone.localdate()
    return (Announcement.objects.select_related('category', 'subcategory').prefetch_related('pickup_locations')
            .filter(status=Announcement.Status.APPROVED, category__is_removed=False)
            .filter(not_expired_q(today)))


def parse_day(params, name):
    raw = params.get(name)
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise ValidationError({name: 'Use the format YYYY-MM-DD.'})


def apply_date_range(qs, date_from, date_to):
    """Keep posts whose event dates overlap [date_from, date_to]; undated posts drop out."""
    if not (date_from or date_to):
        return qs
    if date_from and date_to and date_to < date_from:
        raise ValidationError({'date_to': 'The end date must be on or after the start date.'})
    qs = qs.filter(event_start__isnull=False).annotate(_event_last=Coalesce('event_end', 'event_start'))
    if date_to:
        qs = qs.filter(event_start__lte=date_to)
    if date_from:
        qs = qs.filter(_event_last__gte=date_from)
    return qs


def apply_search(qs, term):
    for word in (term or '').split()[:6]:
        # Pickup places are matched through a subquery so posts aren't duplicated.
        at_place = Announcement.objects.filter(pickup_locations__name__icontains=word).values('pk')
        qs = qs.filter(Q(title__icontains=word) | Q(description__icontains=word)
                       | Q(publisher_name__icontains=word) | Q(pk__in=at_place))
    return qs


class CategoryListView(generics.ListCreateAPIView):
    """List categories; logged-in users can add one and it is live immediately."""
    serializer_class = CategorySerializer
    permission_classes = [IsAuthenticatedOrReadOnly]
    pagination_class = None
    throttle_scope = 'category'

    def get_throttles(self):
        return super().get_throttles() if self.request.method == 'POST' else []

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def get_queryset(self):
        today = timezone.localdate()
        live = Q(announcements__status=Announcement.Status.APPROVED) & not_expired_q(today, 'announcements__')
        # Meta.ordering is ignored on aggregate queries, so order explicitly.
        return (Category.objects.filter(is_removed=False).prefetch_related('subcategories')
                .annotate(announcement_count=Count('announcements', filter=live))
                .order_by('sort_order', 'name'))



class CategoryDetailView(generics.RetrieveUpdateDestroyAPIView):
    """The account that created a category can edit it, and delete it once it has no posts.

    Delete moves it to the Trash; nothing is moved. The original six have no creator.
    """
    serializer_class = CategorySerializer
    permission_classes = [IsAuthenticatedOrReadOnly]
    queryset = Category.objects.filter(is_removed=False).prefetch_related('subcategories')
    throttle_scope = 'modify'

    def get_throttles(self):
        return [] if self.request.method in ('GET', 'HEAD', 'OPTIONS') else super().get_throttles()

    def check_creator(self, cat, verb):
        if not ownership.owns(self.request.user, cat, 'created_by_id'):
            raise PermissionDenied(f'Only the person who created this category can {verb} it.'
                                   if cat.created_by_id else f'The original categories can only be {verb}ed by the site admin.')

    def perform_update(self, serializer):
        self.check_creator(serializer.instance, 'edit')
        serializer.save()

    def destroy(self, request, *args, **kwargs):
        cat = self.get_object()
        self.check_creator(cat, 'delete')
        # Count expired posts too: they can still be opened and edited by link.
        posts = cat.announcements.filter(status=Announcement.Status.APPROVED).count()
        if posts:
            return Response(
                {'detail': f'"{cat.name}" still has {posts} announcement{"s" if posts != 1 else ""}. '
                           'Delete them or move them to another category first.',
                 'announcement_count': posts},
                status=status.HTTP_400_BAD_REQUEST)
        cat.is_removed = True
        cat.removed_at = timezone.now()
        cat.save(update_fields=['is_removed', 'removed_at'])
        return Response(status=status.HTTP_204_NO_CONTENT)


class AnnouncementListCreateView(generics.ListCreateAPIView):
    """Anyone can browse; posting needs an account. Posts are live immediately."""
    serializer_class = AnnouncementSerializer
    permission_classes = [IsAuthenticatedOrReadOnly]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    throttle_scope = 'announce'

    def get_throttles(self):
        # Rate-limit submissions only, never browsing.
        return super().get_throttles() if self.request.method == 'POST' else []

    def get_queryset(self):
        p = self.request.query_params
        qs = public_queryset()
        if p.get('category'):
            qs = qs.filter(category__slug=p['category'])
        if str(p.get('sub', '')).isdigit():
            qs = qs.filter(subcategory_id=int(p['sub']))
        if p.get('mine') == '1':  # "My posts"
            qs = qs.filter(publisher=self.request.user) if self.request.user.is_authenticated else qs.none()
        # Several categories at once (used by "followed categories" notifications).
        if p.get('categories'):
            qs = qs.filter(category__slug__in=[c for c in p['categories'].split(',') if c][:50])
        if p.get('since'):
            since = parse_datetime(p['since'])
            if since is None:
                raise ValidationError({'since': 'Use an ISO date-time, e.g. 2026-11-21T08:00:00Z.'})
            if timezone.is_naive(since):
                since = timezone.make_aware(since, dt_timezone.utc)
            qs = qs.filter(created_at__gt=since)
        if p.get('pickup'):
            qs = qs.filter(pickup_locations__name__iexact=p['pickup'].strip())  # names are unique
        if p.get('stock') == 'in':
            qs = qs.exclude(availability=Announcement.Availability.OUT)
        qs = apply_search(qs, p.get('search'))
        date_from, date_to = parse_day(p, 'date_from'), parse_day(p, 'date_to')
        qs = apply_date_range(qs, date_from, date_to)
        # With a date filter, "what's on soonest" is the natural default order.
        default = 'upcoming' if (date_from or date_to) else 'newest'
        order = ORDERINGS.get(p.get('ordering') or default, '-created_at')
        if order == 'ending':
            # Soonest end first: "hide after" date, else the event's last day.
            qs = qs.annotate(_ends=Coalesce('expires_at', 'event_end', 'event_start'))
            return qs.order_by(F('_ends').asc(nulls_last=True), '-created_at', '-id')
        if order == 'event_start':
            return qs.order_by(F(order).asc(nulls_last=True), '-created_at', '-id')
        return qs.order_by(order, '-id')

    def perform_create(self, serializer):
        user = self.request.user
        announcement = serializer.save(status=Announcement.Status.APPROVED, publisher=user,
                                       publisher_name=user.display_name[:80])
        try:
            push.notify_new_announcement(announcement)
        except Exception:  # notifications must never block posting
            logging.getLogger(__name__).exception('Sending notifications failed.')
        match_lost_found(announcement)


def match_lost_found(announcement):
    """Run lost & found matching inside the request (Vercel may stop work after the response).
    It is fast (one short AI call, about 1 s) and can never block saving the post."""
    try:
        lost_found.find_matches(announcement)
    except Exception:
        logging.getLogger(__name__).exception('Lost & found matching failed.')


FOR_YOU_LIMIT = 10


class ForYouView(APIView):
    """Home's "For you" row: posts from what you follow, soonest events and newest posts first.

    Score (one sentence for the judges): followed category +3, event starts in the next 7 days +2,
    posted in the last 3 days +1; ties go to the newest. Only followed categories are candidates,
    so the row never shows something you didn't pick. ?categories=slug1,slug2 from this device,
    else (logged in) the account's follows, so a new device gets the same row.
    """
    permission_classes = [AllowAny]

    def get(self, request):
        # The app sends this device's follows, which mirror the account's once logged in; sending
        # them avoids racing the debounced save right after a pick. Without them, use the account.
        slugs = [c for c in request.query_params.get('categories', '').split(',') if c][:50]
        if not slugs and request.user.is_authenticated:
            slugs = list(Category.objects.filter(followers__user=request.user).values_list('slug', flat=True))
        if not slugs:
            return Response({'results': [], 'reason': 'no_interests'})
        today, now = timezone.localdate(), timezone.now()
        score = (Value(3)
                 + Case(When(event_start__range=(today, today + timedelta(days=7)), then=Value(2)), default=Value(0))
                 + Case(When(created_at__gte=now - timedelta(days=3), then=Value(1)), default=Value(0)))
        posts = (public_queryset().filter(category__slug__in=slugs).annotate(score=score)
                 .order_by('-score', '-created_at', '-id')[:FOR_YOU_LIMIT])
        data = AnnouncementSerializer(posts, many=True, context={'request': request}).data
        return Response({'results': data, 'reason': 'interests' if data else 'nothing_new'})


class UsageView(APIView):
    """POST {event}: count one app event for the evidence table. Numbers only, no user or text."""
    permission_classes = [AllowAny]
    throttle_scope = 'usage'
    EVENTS = {'picker_completed', 'picker_skipped', 'for_you_opened'}

    def post(self, request):
        event = request.data.get('event')
        if event not in self.EVENTS:
            raise ValidationError({'event': 'Unknown event.'})
        UsageCount.bump(event)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AnnouncementDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Anyone can view a post; only the account that posted it can edit or delete it.

    Delete moves the post to the Trash, where its poster can restore it.
    """
    serializer_class = AnnouncementSerializer
    permission_classes = [ownership.IsPublisherOrReadOnly]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    throttle_scope = 'modify'

    def get_throttles(self):
        return [] if self.request.method in ('GET', 'HEAD', 'OPTIONS') else super().get_throttles()

    def get_queryset(self):
        # Expired posts stay reachable by direct link so they can still be edited.
        return (Announcement.objects.select_related('category').prefetch_related('pickup_locations')
                .filter(status=Announcement.Status.APPROVED))

    def perform_update(self, serializer):
        match_lost_found(serializer.save())

    def perform_destroy(self, instance):
        instance.status = Announcement.Status.REMOVED
        instance.removed_at = timezone.now()
        instance.save(update_fields=['status', 'removed_at', 'updated_at'])


class LostFoundMatchesView(APIView):
    """GET: possible matches for one of your lost or found posts (owner only, never contact details)."""
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        post = get_object_or_404(Announcement, pk=pk, publisher=request.user)
        live = public_queryset().values('pk')
        if post.lost_found == 'lost':
            rows = post.found_matches.filter(found__in=live).select_related('found')
            pairs = [(m, m.found) for m in rows]
        else:
            rows = post.lost_matches.filter(lost__in=live).select_related('lost')
            pairs = [(m, m.lost) for m in rows]
        return Response([
            {'id': m.pk, 'reason': m.reason, 'post': {
                'id': other.pk, 'title': other.title, 'lost_found': other.lost_found,
                'lost_found_place': other.lost_found_place, 'lost_found_date': other.lost_found_date,
                'image_url': other.image.url if other.image else None}}
            for m, other in sorted(pairs, key=lambda p: p[0].created_at, reverse=True) if not m.dismissed])


class LostFoundDismissView(APIView):
    """POST: "Not mine". Either post's owner can hide a match; it stays hidden for both."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        match = get_object_or_404(LostFoundMatch.objects.filter(Q(lost__publisher=request.user) | Q(found__publisher=request.user)), pk=pk)
        if not match.dismissed:
            match.dismissed = True
            match.save(update_fields=['dismissed'])
            UsageCount.bump('lf_matches_dismissed')
        return Response(status=status.HTTP_204_NO_CONTENT)


class PickupLocationListView(APIView):
    """Pickup places used by live posts, most used first (for suggestions and filters).

    ?category=<slug> limits it to one category.
    """
    permission_classes = [AllowAny]

    def get(self, request):
        live = public_queryset()
        if request.query_params.get('category'):
            live = live.filter(category__slug=request.query_params['category'])
        rows = (PickupLocation.objects
                .filter(announcements__in=live.values('pk'))
                .annotate(count=Count('announcements', filter=Q(announcements__in=live.values('pk'))))
                .order_by('-count', 'name')
                .values('name', 'count')[:30])
        return Response(list(rows))


# ---------------- Phone notifications (Web Push) ----------------

class PushKeyView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({'public_key': push.get_keys()[0]})


class PushSubscribeView(APIView):
    """Create or update this device's subscription and the categories it follows."""
    permission_classes = [AllowAny]
    throttle_scope = 'push'

    def post(self, request):
        sub = request.data.get('subscription') or {}
        endpoint = str(sub.get('endpoint') or '')
        keys = sub.get('keys') or {}
        p256dh, auth = str(keys.get('p256dh') or ''), str(keys.get('auth') or '')
        if not push.is_allowed_endpoint(endpoint) or len(endpoint) > 500:
            raise ValidationError({'subscription': 'This browser\'s push service is not supported.'})
        if not (20 <= len(p256dh) <= 200 and 8 <= len(auth) <= 100):
            raise ValidationError({'subscription': 'Missing or invalid push keys.'})
        slugs = request.data.get('categories') or []
        categories, frequency, quiet = parse_prefs(request.data)
        try:
            offset = int(request.data.get('utc_offset_minutes') or 0)
        except (TypeError, ValueError):
            raise ValidationError({'utc_offset_minutes': 'Send a whole number of minutes.'})
        if not -14 * 60 <= offset <= 14 * 60:
            raise ValidationError({'utc_offset_minutes': 'Out of range.'})
        user = request.user if request.user.is_authenticated else None
        obj, created = PushSubscription.objects.update_or_create(
            endpoint=endpoint, defaults={
                'p256dh': p256dh, 'auth': auth, 'frequency': frequency, 'quiet_hours': quiet,
                'utc_offset_minutes': offset,
                # Logged in: this device now follows the account's settings.
                # Logged out: it is a device-only subscription again.
                'user': user})
        obj.categories.set(categories)
        if user:
            save_prefs(user, categories, frequency, quiet)
        return Response(push_settings(obj), status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


def parse_prefs(data):
    """(categories queryset, frequency, quiet_hours) from a request body."""
    slugs = data.get('categories') or []
    if not isinstance(slugs, list):
        raise ValidationError({'categories': 'Send a list of category slugs.'})
    frequency = str(data.get('frequency') or PushSubscription.Frequency.HOURLY)
    if frequency not in PushSubscription.Frequency.values:
        raise ValidationError({'frequency': f'Choose one of: {", ".join(PushSubscription.Frequency.values)}.'})
    quiet = data.get('quiet_hours', True) not in (False, 'false', '0', 0)
    categories = Category.objects.filter(slug__in=[str(s) for s in slugs][:50], is_removed=False)
    return categories, frequency, quiet


def save_prefs(user, categories, frequency, quiet):
    prefs, _ = NotificationPrefs.objects.update_or_create(
        user=user, defaults={'frequency': frequency, 'quiet_hours': quiet})
    prefs.categories.set(categories)
    return prefs


def prefs_data(prefs):
    if prefs is None:
        return {'saved': False, 'categories': [], 'frequency': PushSubscription.Frequency.HOURLY, 'quiet_hours': True}
    return {'saved': True, 'categories': sorted(prefs.categories.values_list('slug', flat=True)),
            'frequency': prefs.frequency, 'quiet_hours': prefs.quiet_hours}


class NotificationPrefsView(APIView):
    """The logged-in account's notification settings (shared by all its devices)."""
    permission_classes = [IsAuthenticated]
    throttle_scope = 'push'

    def get_throttles(self):
        return [] if self.request.method == 'GET' else super().get_throttles()

    def get(self, request):
        return Response(prefs_data(NotificationPrefs.objects.filter(user=request.user).first()))

    def put(self, request):
        return Response(prefs_data(save_prefs(request.user, *parse_prefs(request.data))))


def push_settings(sub):
    frequency, quiet = sub.effective()
    categories = (sub.user.notification_prefs.categories if sub.user_id and hasattr(sub.user, 'notification_prefs')
                  else sub.categories)
    return {'subscribed': True, 'linked_to_account': bool(sub.user_id),
            'categories': sorted(categories.values_list('slug', flat=True)),
            'frequency': frequency, 'quiet_hours': quiet, 'utc_offset_minutes': sub.utc_offset_minutes}


class PushStatusView(APIView):
    """What the server has for this device (so the app can show the real state)."""
    permission_classes = [AllowAny]

    def post(self, request):
        sub = PushSubscription.objects.filter(endpoint=str(request.data.get('endpoint') or '')).first()
        return Response(push_settings(sub) if sub else {'subscribed': False})


class PushUnsubscribeView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = 'push'

    def post(self, request):
        deleted, _ = PushSubscription.objects.filter(endpoint=str(request.data.get('endpoint') or '')).delete()
        return Response({'unsubscribed': bool(deleted)})


class PushTestView(APIView):
    """Send a test notification to this device only."""
    permission_classes = [AllowAny]
    throttle_scope = 'push'

    def post(self, request):
        sub = get_object_or_404(PushSubscription, endpoint=str(request.data.get('endpoint') or ''))
        ok = push.send(sub, {
            'title': 'LumaCam notifications are on',
            'body': 'You will get a notification like this when someone posts in a category you follow.',
            'url': '/', 'tag': 'lumacam-test',
            'icon': '/icons/icon-192.png', 'badge': '/icons/badge-96.png',
        }, counts_toward_limit=False)
        if not ok:
            return Response({'detail': 'Could not reach this device. Try turning notifications off and on again.'},
                            status=status.HTTP_502_BAD_GATEWAY)
        return Response({'sent': True})


# ---------------- Trash ----------------

class TrashAnnouncementListView(generics.ListAPIView):
    serializer_class = TrashedAnnouncementSerializer
    permission_classes = [AllowAny]

    def list(self, request, *args, **kwargs):
        safe_purge()  # never show items past their 30 days
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        # Only your own deleted posts.
        user = self.request.user
        if not user.is_authenticated:
            return Announcement.objects.none()
        qs = (Announcement.objects.select_related('category').prefetch_related('pickup_locations')
              .filter(status=Announcement.Status.REMOVED, publisher=user).order_by('-removed_at', '-id'))
        return apply_search(qs, self.request.query_params.get('search'))


class TrashCategoryListView(generics.ListAPIView):
    serializer_class = TrashedCategorySerializer
    permission_classes = [AllowAny]
    pagination_class = None

    def list(self, request, *args, **kwargs):
        safe_purge()
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        if not self.request.user.is_authenticated:
            return Category.objects.none()
        trashed = Q(announcements__status=Announcement.Status.REMOVED)
        return (Category.objects.filter(is_removed=True, created_by=self.request.user)
                .annotate(trashed_posts=Count('announcements', filter=trashed),
                          latest_post_removed_at=Max('announcements__removed_at', filter=trashed))
                .order_by('-removed_at', 'name'))


class TrashRestoreView(APIView):
    """Restore your own post or category from the Trash."""
    permission_classes = [IsAuthenticated]
    throttle_scope = 'modify'
    kind = None  # 'announcement' or 'category'

    def post(self, request, pk):
        if self.kind == 'category':
            cat = get_object_or_404(Category, pk=pk, is_removed=True)
            if not ownership.owns(request.user, cat, 'created_by_id'):
                raise PermissionDenied('Only the person who created this category can restore it.')
            cat.is_removed, cat.removed_at = False, None
            cat.save(update_fields=['is_removed', 'removed_at'])
            return Response({'restored': 'category', 'id': cat.id, 'slug': cat.slug, 'name': cat.name})
        ann = get_object_or_404(Announcement.objects.select_related('category'),
                                pk=pk, status=Announcement.Status.REMOVED)
        if not ownership.owns(request.user, ann):
            raise PermissionDenied(ownership.NOT_OWNER if ann.publisher_id else ownership.LEGACY)
        restored_category = None
        if ann.category.is_removed:  # a post can't live in a trashed category
            ann.category.is_removed, ann.category.removed_at = False, None
            ann.category.save(update_fields=['is_removed', 'removed_at'])
            restored_category = ann.category.name
        ann.status, ann.removed_at = Announcement.Status.APPROVED, None
        ann.save(update_fields=['status', 'removed_at', 'updated_at'])
        return Response({'restored': 'announcement', 'id': ann.id, 'title': ann.title,
                         'restored_category': restored_category})


class TrashDeleteForeverView(APIView):
    """Erase your own deleted post or category now, instead of waiting 30 days."""
    permission_classes = [IsAuthenticated]
    throttle_scope = 'modify'
    kind = None  # 'announcement' or 'category'

    def delete(self, request, pk):
        if self.kind == 'category':
            cat = get_object_or_404(Category, pk=pk, is_removed=True)
            if not ownership.owns(request.user, cat, 'created_by_id'):
                raise PermissionDenied('Only the person who created this category can delete it.')
            left = cat.announcements.count()  # only deleted posts can still point at it
            if left:
                mine = cat.announcements.filter(publisher=request.user).count()
                detail = (f'{mine} of your deleted posts still use{"s" if mine == 1 else ""} this category. '
                          'Delete them forever first.' if mine else
                          'Other people\'s deleted posts still use this category. '
                          'It will be erased automatically when they are.')
                return Response({'detail': detail}, status=status.HTTP_400_BAD_REQUEST)
            cat.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        ann = get_object_or_404(Announcement, pk=pk, status=Announcement.Status.REMOVED)
        if not ownership.owns(request.user, ann):
            raise PermissionDenied(ownership.NOT_OWNER if ann.publisher_id else ownership.LEGACY)
        ann.delete()  # also erases its stored image
        return Response(status=status.HTTP_204_NO_CONTENT)


def serve_media(request, path):
    """Serve images kept in the database (see storage.DatabaseStorage)."""
    from django.http import HttpResponse
    from .models import StoredFile
    obj = StoredFile.objects.filter(name=path).only('content', 'content_type').first()
    if obj is None:
        raise Http404
    resp = HttpResponse(bytes(obj.content), content_type=obj.content_type)
    # Keep caching short (also on Vercel's CDN) so replaced images stop being
    # served within a few minutes.
    resp['Cache-Control'] = 'public, max-age=300, s-maxage=300'
    resp['X-Content-Type-Options'] = 'nosniff'
    return resp


class AutofillView(APIView):
    """Paste-to-post. GET: is it switched on? POST {text}: AI-suggested form fields (logged in only).

    Always answers 200 with {ok: false} when the AI can't help, so the form simply stays manual.
    """
    throttle_scope = 'ai'

    def get_permissions(self):
        return [AllowAny()] if self.request.method == 'GET' else [IsAuthenticated()]

    def get_throttles(self):
        return super().get_throttles() if self.request.method == 'POST' else []

    def get(self, request):
        return Response({'enabled': ai_fill.enabled()})

    def post(self, request):
        if not ai_fill.enabled():
            return Response({'ok': False, 'detail': 'Auto-fill is switched off right now.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        text = str(request.data.get('text') or '').strip()
        if not text:
            raise ValidationError({'text': 'Paste your message first.'})
        categories = dict(Category.objects.filter(is_removed=False, is_approved=True).values_list('slug', 'name'))
        started = time.monotonic()
        fields = ai_fill.autofill(text, categories, today=timezone.localdate())
        # Evidence: tries, successes and total time (average = autofill_ms / autofill_ok).
        UsageCount.bump('autofill_tries')
        if fields:
            UsageCount.bump('autofill_ok')
            UsageCount.bump('autofill_ms', round((time.monotonic() - started) * 1000))
        if not fields:
            return Response({'ok': False, 'detail': "Couldn't fill it in automatically. Please fill in the form below."})
        return Response({'ok': True, 'fields': fields})
