"""Store uploaded files in the database.

Serverless hosts such as Vercel have a read-only, temporary filesystem, so
uploads saved to disk fail. Keeping images in the database (Postgres in
production) needs no extra service and works the same locally.
"""
import mimetypes
from urllib.parse import quote

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import Storage
from django.utils.deconstruct import deconstructible


@deconstructible
class DatabaseStorage(Storage):
    def _model(self):
        from .models import StoredFile
        return StoredFile

    def _open(self, name, mode='rb'):
        obj = self._model().objects.get(name=name)
        return ContentFile(bytes(obj.content), name=name)

    def _save(self, name, content):
        data = b''.join(content.chunks())
        ctype = getattr(content, 'content_type', None) or mimetypes.guess_type(name)[0] or 'application/octet-stream'
        self._model().objects.update_or_create(
            name=name, defaults={'content': data, 'content_type': ctype, 'size': len(data)})
        return name

    def exists(self, name):
        return self._model().objects.filter(name=name).exists()

    def delete(self, name):
        self._model().objects.filter(name=name).delete()

    def size(self, name):
        return self._model().objects.values_list('size', flat=True).get(name=name)

    def url(self, name):
        return settings.MEDIA_URL + quote(name)
