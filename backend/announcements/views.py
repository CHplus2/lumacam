from datetime import date

from django.db.models import Count, F, Q
from django.db.models.functions import Coalesce
from django.http import Http404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import generics, status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny

from django.db.models import Max
from django.shortcuts import get_object_or_404

from .models import Announcement, Category
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
    return (Announcement.objects.select_related('category')
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
        qs = qs.filter(Q(title__icontains=word) | Q(description__icontains=word)
                       | Q(publisher_name__icontains=word))
    return qs


class CategoryListView(generics.ListCreateAPIView):
    """List categories; anyone can add one and it is live immediately."""
    serializer_class = CategorySerializer
    permission_classes = [AllowAny]
    pagination_class = None
    throttle_scope = 'category'

    def get_throttles(self):
        return super().get_throttles() if self.request.method == 'POST' else []

    def get_queryset(self):
        today = timezone.localdate()
        live = Q(announcements__status=Announcement.Status.APPROVED) & not_expired_q(today, 'announcements__')
        # Meta.ordering is ignored on aggregate queries, so order explicitly.
        return (Category.objects.filter(is_removed=False)
                .annotate(announcement_count=Count('announcements', filter=live))
                .order_by('sort_order', 'name'))



class CategoryDetailView(generics.RetrieveDestroyAPIView):
    """Anyone can delete a category, but only once it has no posts.

    Delete hides the category (restorable in /django-admin/); nothing is moved.
    """
    serializer_class = CategorySerializer
    permission_classes = [AllowAny]
    queryset = Category.objects.filter(is_removed=False)
    throttle_scope = 'modify'

    def get_throttles(self):
        return [] if self.request.method in ('GET', 'HEAD', 'OPTIONS') else super().get_throttles()

    def destroy(self, request, *args, **kwargs):
        cat = self.get_object()
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
    """Public browsing and posting. No account needed; posts are live immediately."""
    serializer_class = AnnouncementSerializer
    permission_classes = [AllowAny]
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
        # Several categories at once (used by "followed categories" notifications).
        if p.get('categories'):
            qs = qs.filter(category__slug__in=[c for c in p['categories'].split(',') if c][:50])
        if p.get('since'):
            since = parse_datetime(p['since'])
            if since is None:
                raise ValidationError({'since': 'Use an ISO date-time, e.g. 2026-11-21T08:00:00Z.'})
            if timezone.is_naive(since):
                since = timezone.make_aware(since, timezone.utc)
            qs = qs.filter(created_at__gt=since)
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
        serializer.save(status=Announcement.Status.APPROVED)


class AnnouncementDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Anyone can view, edit or delete a post (demo setup with no accounts).

    Delete hides the post (status "removed") rather than erasing it, so it can
    be restored from /django-admin/.
    """
    serializer_class = AnnouncementSerializer
    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    throttle_scope = 'modify'

    def get_throttles(self):
        return [] if self.request.method in ('GET', 'HEAD', 'OPTIONS') else super().get_throttles()

    def get_queryset(self):
        # Expired posts stay reachable by direct link so they can still be edited.
        return (Announcement.objects.select_related('category')
                .filter(status=Announcement.Status.APPROVED))

    def perform_destroy(self, instance):
        instance.status = Announcement.Status.REMOVED
        instance.removed_at = timezone.now()
        instance.save(update_fields=['status', 'removed_at', 'updated_at'])


# ---------------- Trash ----------------

class TrashAnnouncementListView(generics.ListAPIView):
    serializer_class = TrashedAnnouncementSerializer
    permission_classes = [AllowAny]

    def list(self, request, *args, **kwargs):
        safe_purge()  # never show items past their 30 days
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        qs = (Announcement.objects.select_related('category')
              .filter(status=Announcement.Status.REMOVED).order_by('-removed_at', '-id'))
        return apply_search(qs, self.request.query_params.get('search'))


class TrashCategoryListView(generics.ListAPIView):
    serializer_class = TrashedCategorySerializer
    permission_classes = [AllowAny]
    pagination_class = None

    def list(self, request, *args, **kwargs):
        safe_purge()
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        trashed = Q(announcements__status=Announcement.Status.REMOVED)
        return (Category.objects.filter(is_removed=True)
                .annotate(trashed_posts=Count('announcements', filter=trashed),
                          latest_post_removed_at=Max('announcements__removed_at', filter=trashed))
                .order_by('-removed_at', 'name'))


class TrashRestoreView(APIView):
    """Restore a post or category from the Trash."""
    permission_classes = [AllowAny]
    throttle_scope = 'modify'
    kind = None  # 'announcement' or 'category'

    def post(self, request, pk):
        if self.kind == 'category':
            cat = get_object_or_404(Category, pk=pk, is_removed=True)
            cat.is_removed, cat.removed_at = False, None
            cat.save(update_fields=['is_removed', 'removed_at'])
            return Response({'restored': 'category', 'id': cat.id, 'slug': cat.slug, 'name': cat.name})
        ann = get_object_or_404(Announcement.objects.select_related('category'),
                                pk=pk, status=Announcement.Status.REMOVED)
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
