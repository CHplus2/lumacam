import io
import json
from datetime import timedelta

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import LiveServerTestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient, APITestCase

from announcements.models import Announcement, Category, StoredFile


def image_file(fmt='PNG', size=(20, 20), name='pic.png', color='red'):
    buf = io.BytesIO()
    Image.new('RGB', size, color).save(buf, fmt)
    return SimpleUploadedFile(name, buf.getvalue(), content_type='image/png')


class BaseCase(APITestCase):
    def setUp(self):
        cache.clear()  # reset rate-limit counters
        self.cat = Category.objects.get(slug='food-drinks')
        self.other_cat = Category.objects.get(slug='events')
        self.client = APIClient()

    def make(self, status='approved', **kw):
        data = dict(title='Nasi lemak', description='Delicious lunch pickup', category=self.cat,
                    publisher_name='Alice', contact_method='whatsapp', contact_info='60123456789', status=status)
        data.update(kw)
        return Announcement.objects.create(**data)

    def payload(self, **kw):
        base = {'title': 'Fresh cookies', 'description': 'Baked daily near the library.',
                'category': self.cat.id, 'publisher_name': 'Bob', 'contact_method': 'email',
                'contact_info': 'a@b.com'}
        base.update(kw)
        return base

    def public_titles(self, url='/api/announcements/'):
        return [a['title'] for a in self.client.get(url).data['results']]


class NoLoginTests(BaseCase):
    def test_auth_endpoints_are_gone(self):
        for url in ('/api/auth/login/', '/api/auth/me/', '/api/admin/stats/'):
            self.assertEqual(self.client.get(url).status_code, 404, url)

    def test_no_csrf_needed_for_writes(self):
        c = APIClient(enforce_csrf_checks=True)
        self.assertEqual(c.post('/api/announcements/', self.payload()).status_code, 201)


class CreateTests(BaseCase):
    def test_post_is_live_immediately(self):
        r = self.client.post('/api/announcements/', self.payload(), format='multipart')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(self.public_titles(), ['Fresh cookies'])

    def test_name_required(self):
        r = self.client.post('/api/announcements/', self.payload(publisher_name=' '))
        self.assertEqual(r.status_code, 400)
        self.assertIn('publisher_name', r.data)

    def test_post_rate_limit(self):
        codes = [self.client.post('/api/announcements/', self.payload()).status_code for _ in range(11)]
        self.assertEqual((codes[:10], codes[10]), ([201] * 10, 429))
        self.assertEqual(self.client.get('/api/announcements/').status_code, 200)  # browsing unaffected

    def test_image_upload_validation(self):
        ok = self.client.post('/api/announcements/', {**self.payload(), 'image': image_file()}, format='multipart')
        self.assertEqual(ok.status_code, 201, ok.data)
        self.assertTrue(ok.data['image_url'])
        fake = SimpleUploadedFile('x.png', b'not an image', content_type='image/png')
        self.assertEqual(self.client.post('/api/announcements/', {**self.payload(), 'image': fake}, format='multipart').status_code, 400)
        gif = io.BytesIO(); Image.new('RGB', (5, 5)).save(gif, 'GIF')
        gif_f = SimpleUploadedFile('x.gif', gif.getvalue(), content_type='image/gif')
        self.assertEqual(self.client.post('/api/announcements/', {**self.payload(), 'image': gif_f}, format='multipart').status_code, 400)

    @override_settings(MAX_IMAGE_BYTES=100)
    def test_image_too_large(self):
        r = self.client.post('/api/announcements/', {**self.payload(), 'image': image_file(size=(200, 200))}, format='multipart')
        self.assertEqual(r.status_code, 400)

    def test_contact_and_url_validation(self):
        P = self.payload
        self.assertEqual(self.client.post('/api/announcements/', P(contact_method='email', contact_info='nope')).status_code, 400)
        self.assertEqual(self.client.post('/api/announcements/', P(contact_method='whatsapp', contact_info='abc')).status_code, 400)
        self.assertEqual(self.client.post('/api/announcements/', P(contact_method='link', contact_info='javascript:alert(1)')).status_code, 400)
        self.assertEqual(self.client.post('/api/announcements/', P(external_url='javascript:alert(1)')).status_code, 400)
        r = self.client.post('/api/announcements/', P(contact_method='whatsapp', contact_info='+60 12-345 6789'))
        self.assertEqual((r.status_code, r.data['contact_info']), (201, '60123456789'))

    def test_past_expiry_rejected(self):
        r = self.client.post('/api/announcements/', self.payload(expires_at=str(timezone.localdate() - timedelta(days=1))))
        self.assertEqual(r.status_code, 400)


class EditDeleteTests(BaseCase):
    def test_anyone_can_edit(self):
        ann = self.make()
        r = self.client.patch(f'/api/announcements/{ann.id}/', {'title': 'Updated title', 'category': self.other_cat.id})
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(self.public_titles(f'/api/announcements/?category={self.other_cat.slug}'), ['Updated title'])

    def test_edit_is_validated(self):
        ann = self.make()
        self.assertEqual(self.client.patch(f'/api/announcements/{ann.id}/', {'contact_info': 'not a phone'}).status_code, 400)
        self.assertEqual(self.client.patch(f'/api/announcements/{ann.id}/', {'title': 'x'}).status_code, 400)

    def test_edit_expired_post_keeps_old_expiry(self):
        ann = self.make(expires_at=timezone.localdate() - timedelta(days=2))
        r = self.client.patch(f'/api/announcements/{ann.id}/', {'title': 'Still editable'})
        self.assertEqual(r.status_code, 200, r.data)

    def test_replace_and_remove_image(self):
        r = self.client.post('/api/announcements/', {**self.payload(), 'image': image_file()}, format='multipart')
        first = r.data['image_url']
        r = self.client.patch(f"/api/announcements/{r.data['id']}/", {'image': image_file(color='blue')}, format='multipart')
        self.assertNotEqual(r.data['image_url'], first)
        self.assertEqual(StoredFile.objects.count(), 1)  # old image deleted
        r = self.client.patch(f"/api/announcements/{r.data['id']}/", {'remove_image': 'true'}, format='multipart')
        self.assertIsNone(r.data['image_url'])
        self.assertEqual(StoredFile.objects.count(), 0)

    def test_edit_without_file_keeps_image(self):
        r = self.client.post('/api/announcements/', {**self.payload(), 'image': image_file()}, format='multipart')
        url = r.data['image_url']
        r = self.client.patch(f"/api/announcements/{r.data['id']}/", {'title': 'New title'}, format='multipart')
        self.assertEqual(r.data['image_url'], url)

    def test_full_form_edit_can_clear_optional_fields(self):
        ann = self.make(external_url='https://example.com', expires_at=timezone.localdate() + timedelta(days=3))
        body = {'publisher_name': 'Alice', 'title': 'Nasi lemak', 'category': self.cat.id,
                'description': 'Delicious lunch pickup', 'contact_method': 'whatsapp',
                'contact_info': '60123456789', 'external_url': '', 'expires_at': ''}
        r = self.client.patch(f'/api/announcements/{ann.id}/', body, format='multipart')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual((r.data['external_url'], r.data['expires_at']), ('', None))

    def test_delete_hides_but_keeps_post(self):
        ann = self.make()
        self.assertEqual(self.client.delete(f'/api/announcements/{ann.id}/').status_code, 204)
        self.assertEqual(self.public_titles(), [])
        self.assertEqual(self.client.get(f'/api/announcements/{ann.id}/').status_code, 404)
        ann.refresh_from_db()
        self.assertEqual(ann.status, Announcement.Status.REMOVED)  # restorable in /django-admin/
        self.assertEqual(self.client.patch(f'/api/announcements/{ann.id}/', {'title': 'Back again'}).status_code, 404)

    def test_modify_rate_limit(self):
        ann = self.make()
        codes = [self.client.patch(f'/api/announcements/{ann.id}/', {'title': f'Title {i}'}).status_code for i in range(61)]
        self.assertEqual((codes[:60], codes[60]), ([200] * 60, 429))
        self.assertEqual(self.client.get(f'/api/announcements/{ann.id}/').status_code, 200)


class BrowseTests(BaseCase):
    def test_only_live_and_unexpired_listed(self):
        self.make(title='visible')
        self.make(title='removed', status='removed')
        self.make(title='expired', expires_at=timezone.localdate() - timedelta(days=1))
        self.assertEqual(self.public_titles(), ['visible'])

    def test_category_filter_search_and_ordering(self):
        a = self.make(title='Old pizza', category=self.cat)
        b = self.make(title='Hack night', category=self.other_cat, description='coding event', publisher_name='Zara')
        Announcement.objects.filter(pk=a.pk).update(created_at=timezone.now() - timedelta(days=3))
        ids = lambda url: [x['id'] for x in self.client.get(url).data['results']]
        self.assertEqual(ids(f'/api/announcements/?category={self.other_cat.slug}'), [b.id])
        self.assertEqual(ids('/api/announcements/?search=pizza'), [a.id])
        self.assertEqual(ids('/api/announcements/?search=CODING'), [b.id])
        self.assertEqual(ids('/api/announcements/?search=zara'), [b.id])
        self.assertEqual(ids('/api/announcements/'), [b.id, a.id])
        self.assertEqual(ids('/api/announcements/?ordering=oldest'), [a.id, b.id])

    def test_category_counts(self):
        self.make(); self.make(status='removed')
        data = {c['slug']: c['announcement_count'] for c in self.client.get('/api/categories/').data}
        self.assertEqual((data['food-drinks'], data['events'], len(data)), (1, 0, 6))


class ImageStorageTests(BaseCase):
    def test_uploaded_image_is_stored_in_db_and_served(self):
        r = self.client.post('/api/announcements/', {**self.payload(), 'image': image_file()}, format='multipart')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(StoredFile.objects.count(), 1)
        url = r.data['image_url']
        self.assertTrue(url.startswith('/media/announcements/'))
        resp = self.client.get(url)
        self.assertEqual((resp.status_code, resp['Content-Type']), (200, 'image/png'))
        self.assertTrue(resp.content.startswith(b'\x89PNG'))
        self.assertEqual(self.client.get('/media/announcements/missing.png').status_code, 404)


class CategoryTests(BaseCase):
    new = {'name': 'Sports & Fitness', 'description': 'Games and gym buddies', 'icon': 'dumbbell', 'color': 'teal'}

    def test_new_category_is_live_and_usable(self):
        r = self.client.post('/api/categories/', self.new)
        self.assertEqual((r.status_code, r.data['slug']), (201, 'sports-fitness'))
        slugs = [c['slug'] for c in self.client.get('/api/categories/').data]
        self.assertEqual((slugs[0], slugs[-2], slugs[-1]), ('food-drinks', 'sports-fitness', 'other'))
        self.client.post('/api/announcements/', self.payload(category=r.data['id']))
        self.assertEqual(self.public_titles('/api/announcements/?category=sports-fitness'), ['Fresh cookies'])

    def test_validation(self):
        self.assertEqual(self.client.post('/api/categories/', {**self.new, 'name': 'food & DRINKS'}).status_code, 400)
        self.assertEqual(self.client.post('/api/categories/', {**self.new, 'icon': 'skull'}).status_code, 400)
        self.assertEqual(self.client.post('/api/categories/', {**self.new, 'color': 'black'}).status_code, 400)
        self.assertEqual(self.client.post('/api/categories/', {**self.new, 'name': 'x'}).status_code, 400)

    def test_category_rate_limit(self):
        codes = [self.client.post('/api/categories/', {**self.new, 'name': f'Cat {i}'}).status_code for i in range(11)]
        self.assertEqual((codes[:10], codes[10]), ([201] * 10, 429))


class LiveFlowTests(LiveServerTestCase):
    """Real HTTP requests, the way the browser talks to the API."""

    def setUp(self):
        import urllib.request
        cache.clear()
        self.urllib = urllib.request

    def call(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = self.urllib.Request(self.live_server_url + path, data=data, method=method,
                                  headers={'Content-Type': 'application/json'})
        try:
            with self.urllib.urlopen(req) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else None)
        except self.urllib.HTTPError as e:
            raw = e.read()
            return e.code, (json.loads(raw) if raw else None)

    def test_post_edit_delete_without_login(self):
        cat = Category.objects.get(slug='events')
        payload = {'title': 'Hack night', 'description': 'Join us for a coding night.', 'category': cat.id,
                   'publisher_name': 'Carol', 'contact_method': 'link', 'contact_info': 'https://example.com/signup'}
        status, ann = self.call('POST', '/api/announcements/', payload)
        self.assertEqual(status, 201, ann)
        listing = self.call('GET', '/api/announcements/?category=events&search=hack')[1]
        self.assertEqual([a['id'] for a in listing['results']], [ann['id']])
        status, edited = self.call('PATCH', f"/api/announcements/{ann['id']}/", {'title': 'Hack night v2'})
        self.assertEqual((status, edited['title']), (200, 'Hack night v2'))
        self.assertEqual(self.call('DELETE', f"/api/announcements/{ann['id']}/")[0], 204)
        self.assertEqual(self.call('GET', '/api/announcements/')[1]['count'], 0)
