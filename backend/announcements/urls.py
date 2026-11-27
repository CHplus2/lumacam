from django.urls import path

from . import views

urlpatterns = [
    path('categories/', views.CategoryListView.as_view()),
    path('categories/<int:pk>/', views.CategoryDetailView.as_view()),
    path('announcements/', views.AnnouncementListCreateView.as_view()),
    path('announcements/<int:pk>/', views.AnnouncementDetailView.as_view()),
    path('announcements/for-you/', views.ForYouView.as_view()),
    path('usage/', views.UsageView.as_view()),
    path('pickup-locations/', views.PickupLocationListView.as_view()),
    path('ai/autofill/', views.AutofillView.as_view()),
    path('auth/prefs/', views.NotificationPrefsView.as_view()),
    path('push/key/', views.PushKeyView.as_view()),
    path('push/subscribe/', views.PushSubscribeView.as_view()),
    path('push/unsubscribe/', views.PushUnsubscribeView.as_view()),
    path('push/status/', views.PushStatusView.as_view()),
    path('push/test/', views.PushTestView.as_view()),
    path('trash/announcements/', views.TrashAnnouncementListView.as_view()),
    path('trash/announcements/<int:pk>/restore/', views.TrashRestoreView.as_view(kind='announcement')),
    path('trash/announcements/<int:pk>/', views.TrashDeleteForeverView.as_view(kind='announcement')),
    path('trash/categories/', views.TrashCategoryListView.as_view()),
    path('trash/categories/<int:pk>/restore/', views.TrashRestoreView.as_view(kind='category')),
    path('trash/categories/<int:pk>/', views.TrashDeleteForeverView.as_view(kind='category')),
]
