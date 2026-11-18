from django.urls import path

from . import views

urlpatterns = [
    path('categories/', views.CategoryListView.as_view()),
    path('announcements/', views.AnnouncementListCreateView.as_view()),
    path('announcements/<int:pk>/', views.AnnouncementDetailView.as_view()),
    path('announcements/<int:pk>/report/', views.ReportCreateView.as_view()),

    path('admin/stats/', views.AdminStatsView.as_view()),
    path('admin/announcements/', views.AdminAnnouncementListView.as_view()),
    path('admin/announcements/<int:pk>/approve/', views.AdminModerateView.as_view(action='approve')),
    path('admin/announcements/<int:pk>/reject/', views.AdminModerateView.as_view(action='reject')),
    path('admin/announcements/<int:pk>/', views.AdminAnnouncementDeleteView.as_view()),
    path('admin/categories/', views.AdminCategoryListView.as_view()),
    path('admin/categories/<int:pk>/approve/', views.AdminCategoryApproveView.as_view()),
    path('admin/categories/<int:pk>/', views.AdminCategoryDeleteView.as_view()),
    path('admin/reports/', views.AdminReportListView.as_view()),
    path('admin/reports/<int:pk>/resolve/', views.AdminReportResolveView.as_view(new_status='resolved')),
    path('admin/reports/<int:pk>/dismiss/', views.AdminReportResolveView.as_view(new_status='dismissed')),
]
