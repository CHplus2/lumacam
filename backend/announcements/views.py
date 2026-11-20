from django.db.models import Count, F, Q
from django.http import Http404
from django.utils import timezone
from rest_framework import generics
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny

from .models import Announcement, Category
from .serializers import AnnouncementSerializer, CategorySerializer

ORDERINGS = {
    'newest': '-created_at',
    'oldest': 'created_at',
    'expiring': 'expires_at',
}


def public_queryset():
    today = timezone.localdate()
    return (Announcement.objects.select_related('category')
            .filter(status=Announcement.Status.APPROVED)
            .filter(Q(expires_at__isnull=True) | Q(expires_at__gte=today)))


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
        live = Q(announcements__status=Announcement.Status.APPROVED) & (
            Q(announcements__expires_at__isnull=True) | Q(announcements__expires_at__gte=today))
        # Meta.ordering is ignored on aggregate queries, so order explicitly.
        return (Category.objects
                .annotate(announcement_count=Count('announcements', filter=live))
                .order_by('sort_order', 'name'))



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
        qs = apply_search(qs, p.get('search'))
        order = ORDERINGS.get(p.get('ordering'), '-created_at')
        if order == 'expires_at':
            return qs.order_by(F('expires_at').asc(nulls_last=True), '-created_at')
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
        instance.save(update_fields=['status', 'updated_at'])


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
