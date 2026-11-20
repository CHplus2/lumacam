from django.urls import path

from . import views

urlpatterns = [
    path('categories/', views.CategoryListView.as_view()),
    path('categories/<int:pk>/', views.CategoryDetailView.as_view()),
    path('announcements/', views.AnnouncementListCreateView.as_view()),
    path('announcements/<int:pk>/', views.AnnouncementDetailView.as_view()),
]
