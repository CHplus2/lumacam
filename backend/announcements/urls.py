from django.urls import path

from . import views

urlpatterns = [
    path('categories/', views.CategoryListView.as_view()),
    path('categories/<int:pk>/', views.CategoryDetailView.as_view()),
    path('announcements/', views.AnnouncementListCreateView.as_view()),
    path('announcements/<int:pk>/', views.AnnouncementDetailView.as_view()),
    path('trash/announcements/', views.TrashAnnouncementListView.as_view()),
    path('trash/announcements/<int:pk>/restore/', views.TrashRestoreView.as_view(kind='announcement')),
    path('trash/categories/', views.TrashCategoryListView.as_view()),
    path('trash/categories/<int:pk>/restore/', views.TrashRestoreView.as_view(kind='category')),
]
