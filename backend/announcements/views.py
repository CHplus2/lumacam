import logging
from datetime import date, timezone as dt_timezone

from django.db.models import Count, F, Q
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

from . import ownership, push
from .models import Announcement, Category, PickupLocation, PushSubscription
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
    return (Announcement.objects.select_related('category').prefetch_related('pickup_locations')
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
        return (Category.objects.filter(is_removed=False)
                .annotate(announcement_count=Count('announcements', filter=live))
                .order_by('sort_order', 'name'))



class CategoryDetailView(generics.RetrieveDestroyAPIView):
    """The account that created a category can delete it, once it has no posts.

    Delete moves it to the Trash; nothing is moved. The original six have no creator.
    """
    serializer_class = CategorySerializer
    permission_classes = [IsAuthenticatedOrReadOnly]
    queryset = Category.objects.filter(is_removed=False)
    throttle_scope = 'modify'

    def get_throttles(self):
        return [] if self.request.method in ('GET', 'HEAD', 'OPTIONS') else super().get_throttles()

    def destroy(self, request, *args, **kwargs):
        cat = self.get_object()
        if not ownership.owns(request.user, cat, 'created_by_id'):
            raise PermissionDenied('Only the person who created this category can delete it.'
                                   if cat.created_by_id else 'The original categories can only be removed by the site admin.')
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

    def perform_destroy(self, instance):
        instance.status = Announcement.Status.REMOVED
        instance.removed_at = timezone.now()
        instance.save(update_fields=['status', 'removed_at', 'updated_at'])


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
        if not isinstance(slugs, list):
            raise ValidationError({'categories': 'Send a list of category slugs.'})
        frequency = str(request.data.get('frequency') or PushSubscription.Frequency.HOURLY)
        if frequency not in PushSubscription.Frequency.values:
            raise ValidationError({'frequency': f'Choose one of: {", ".join(PushSubscription.Frequency.values)}.'})
        try:
            offset = int(request.data.get('utc_offset_minutes') or 0)
        except (TypeError, ValueError):
            raise ValidationError({'utc_offset_minutes': 'Send a whole number of minutes.'})
        if not -14 * 60 <= offset <= 14 * 60:
            raise ValidationError({'utc_offset_minutes': 'Out of range.'})
        categories = Category.objects.filter(slug__in=[str(s) for s in slugs][:50], is_removed=False)
        obj, created = PushSubscription.objects.update_or_create(
            endpoint=endpoint, defaults={
                'p256dh': p256dh, 'auth': auth, 'frequency': frequency,
                'quiet_hours': request.data.get('quiet_hours', True) not in (False, 'false', '0', 0),
                'utc_offset_minutes': offset})
        obj.categories.set(categories)
        return Response(push_settings(obj), status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


def push_settings(sub):
    return {'subscribed': True, 'categories': sorted(sub.categories.values_list('slug', flat=True)),
            'frequency': sub.frequency, 'quiet_hours': sub.quiet_hours,
            'utc_offset_minutes': sub.utc_offset_minutes}


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
