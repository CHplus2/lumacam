from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from accounts.permissions import IsAdminRole

from .models import Announcement, Category, Report
from .serializers import AnnouncementSerializer, CategorySerializer, ReportSerializer

ORDERINGS = {
    'newest': '-created_at',
    'oldest': 'created_at',
    'expiring': 'expires_at',
}


def public_queryset():
    today = timezone.localdate()
    return (Announcement.objects.select_related('category', 'publisher')
            .filter(status=Announcement.Status.APPROVED)
            .filter(Q(expires_at__isnull=True) | Q(expires_at__gte=today)))


def apply_search(qs, term):
    for word in (term or '').split()[:6]:
        qs = qs.filter(Q(title__icontains=word) | Q(description__icontains=word)
                       | Q(publisher__username__icontains=word))
    return qs


class CategoryListView(generics.ListAPIView):
    serializer_class = CategorySerializer
    permission_classes = [AllowAny]
    pagination_class = None

    def get_queryset(self):
        today = timezone.localdate()
        live = Q(announcements__status=Announcement.Status.APPROVED) & (
            Q(announcements__expires_at__isnull=True) | Q(announcements__expires_at__gte=today))
        return Category.objects.annotate(announcement_count=Count('announcements', filter=live))


class AnnouncementListCreateView(generics.ListCreateAPIView):
    serializer_class = AnnouncementSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        p = self.request.query_params
        qs = public_queryset()
        if p.get('category'):
            qs = qs.filter(category__slug=p['category'])
        qs = apply_search(qs, p.get('search'))
        order = ORDERINGS.get(p.get('ordering'), '-created_at')
        # Tie-break so pagination is stable; expiring posts without expiry go last.
        if order == 'expires_at':
            from django.db.models import F
            return qs.order_by(F('expires_at').asc(nulls_last=True), '-created_at')
        return qs.order_by(order, '-id')

    def perform_create(self, serializer):
        user = self.request.user
        initial = Announcement.Status.APPROVED if user.role == User.Role.ADMIN else Announcement.Status.PENDING
        serializer.save(publisher=user, status=initial)


class MyAnnouncementsView(generics.ListAPIView):
    serializer_class = AnnouncementSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        return (Announcement.objects.select_related('category', 'publisher')
                .filter(publisher=self.request.user).order_by('-created_at'))


class AnnouncementDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = AnnouncementSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_object(self):
        obj = get_object_or_404(Announcement.objects.select_related('category', 'publisher'), pk=self.kwargs['pk'])
        user = self.request.user
        is_owner = user.is_authenticated and obj.publisher_id == user.id
        is_admin = user.is_authenticated and user.role == User.Role.ADMIN
        if self.request.method in ('GET', 'HEAD', 'OPTIONS'):
            expired = obj.expires_at and obj.expires_at < timezone.localdate()
            visible = obj.status == Announcement.Status.APPROVED and not expired
            if not (visible or is_owner or is_admin):
                from django.http import Http404
                raise Http404
        elif not (is_owner or is_admin):
            raise PermissionDenied('You can only modify your own announcements.')
        return obj

    def perform_update(self, serializer):
        user = self.request.user
        extra = {}
        if user.role != User.Role.ADMIN:
            # Any edit by a student goes back through moderation.
            extra = {'status': Announcement.Status.PENDING, 'rejection_reason': ''}
        serializer.save(**extra)


class ReportCreateView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = 'report'

    def post(self, request, pk):
        ann = get_object_or_404(public_queryset(), pk=pk)
        if ann.publisher_id == request.user.id:
            return Response({'detail': 'You cannot report your own announcement.'}, status=status.HTTP_400_BAD_REQUEST)
        if Report.objects.filter(announcement=ann, reporter=request.user, status=Report.Status.OPEN).exists():
            return Response({'detail': 'You have already reported this announcement.'}, status=status.HTTP_400_BAD_REQUEST)
        serializer = ReportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(announcement=ann, reporter=request.user)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


# ---------------- Administrator ----------------

class AdminAnnouncementListView(generics.ListAPIView):
    serializer_class = AnnouncementSerializer
    permission_classes = [IsAdminRole]

    def get_queryset(self):
        p = self.request.query_params
        qs = (Announcement.objects.select_related('category', 'publisher')
              .annotate(open_reports=Count('reports', filter=Q(reports__status=Report.Status.OPEN))))
        if p.get('status') in Announcement.Status.values:
            qs = qs.filter(status=p['status'])
        if p.get('reported') == '1':
            qs = qs.filter(open_reports__gt=0)
        qs = apply_search(qs, p.get('search'))
        return qs.order_by('-created_at', '-id')


class AdminModerateView(APIView):
    permission_classes = [IsAdminRole]
    action = None

    def post(self, request, pk):
        ann = get_object_or_404(Announcement, pk=pk)
        if self.action == 'approve':
            ann.status, ann.rejection_reason = Announcement.Status.APPROVED, ''
        else:
            ann.status = Announcement.Status.REJECTED
            ann.rejection_reason = str(request.data.get('reason', ''))[:300].strip()
        ann.save(update_fields=['status', 'rejection_reason', 'updated_at'])
        return Response(AnnouncementSerializer(ann, context={'request': request}).data)


class AdminAnnouncementDeleteView(APIView):
    permission_classes = [IsAdminRole]

    def delete(self, request, pk):
        get_object_or_404(Announcement, pk=pk).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminStatsView(APIView):
    permission_classes = [IsAdminRole]

    def get(self, request):
        counts = dict(Announcement.objects.values_list('status').annotate(n=Count('id')))
        by_category = list(Category.objects.annotate(total=Count('announcements'))
                           .values('name', 'slug', 'total'))
        return Response({
            'total': sum(counts.values()),
            'pending': counts.get(Announcement.Status.PENDING, 0),
            'approved': counts.get(Announcement.Status.APPROVED, 0),
            'rejected': counts.get(Announcement.Status.REJECTED, 0),
            'open_reports': Report.objects.filter(status=Report.Status.OPEN).count(),
            'students': User.objects.filter(role=User.Role.STUDENT).count(),
            'by_category': by_category,
        })


class AdminReportListView(generics.ListAPIView):
    serializer_class = ReportSerializer
    permission_classes = [IsAdminRole]

    def get_queryset(self):
        qs = Report.objects.select_related('announcement', 'reporter')
        st = self.request.query_params.get('status')
        if st in Report.Status.values:
            qs = qs.filter(status=st)
        return qs


class AdminReportResolveView(APIView):
    permission_classes = [IsAdminRole]
    new_status = Report.Status.RESOLVED

    def post(self, request, pk):
        report = get_object_or_404(Report, pk=pk)
        report.status = self.new_status
        report.save(update_fields=['status'])
        return Response(ReportSerializer(report).data)
