from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path, re_path

from announcements.views import serve_media


def api_root(request):
    # The backend only serves the JSON API; the website itself is the frontend.
    return JsonResponse({'name': 'LumaCam API', 'status': 'ok',
                         'endpoints': ['/api/categories/', '/api/announcements/']})


urlpatterns = [
    path('', api_root),
    path('api/', api_root),
    path('django-admin/', admin.site.urls),
    path('api/', include('announcements.urls')),
    re_path(r'^media/(?P<path>.+)$', serve_media),
]
