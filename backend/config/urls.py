from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path


def api_root(request):
    # The backend only serves the JSON API; the website itself is the frontend.
    return JsonResponse({'name': 'LumaCam API', 'status': 'ok',
                         'endpoints': ['/api/categories/', '/api/announcements/']})


urlpatterns = [
    path('', api_root),
    path('api/', api_root),
    path('django-admin/', admin.site.urls),
    path('api/', include('accounts.urls')),
    path('api/', include('announcements.urls')),
]
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
