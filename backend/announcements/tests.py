import io
from datetime import timedelta

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import LiveServerTestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient, APITestCase

from accounts.models import User
from announcements.models import Announcement, Category, Report

PW = 'Str0ng-Pass-123'
MEDIA = '/tmp/lumacam-test-media'


def image_file(fmt='PNG', size=(20, 20), name='pic.png'):
    buf = io.BytesIO()
    Image.new('RGB', size, 'red').save(buf, fmt)
    return SimpleUploadedFile(name, buf.getvalue(), content_type='image/png')


@override_settings(MEDIA_ROOT=MEDIA)
class BaseCase(APITestCase):
    def setUp(self):
        cache.clear()  # reset rate-limit counters
        self.cat = Category.objects.get(slug='food-drinks')
        self.other_cat = Category.objects.get(slug='events')
        self.admin = User.objects.create_user('boss', 'boss@x.com', PW, role='admin')

    def admin_client(self):
        c = APIClient()
        c.force_login(self.admin)
        return c

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


class AuthTests(BaseCase):
    def test_admin_login_logout(self):
        c = APIClient()
        self.assertEqual(c.post('/api/auth/login/', {'username': 'boss', 'password': 'wrong'}).status_code, 400)
        r = c.post('/api/auth/login/', {'username': 'boss', 'password': PW})
        self.assertEqual((r.status_code, r.data['role']), (200, 'admin'))
        self.assertEqual(c.get('/api/auth/me/').status_code, 200)
        self.assertEqual(c.post('/api/auth/logout/').status_code, 204)
        self.assertEqual(c.get('/api/auth/me/').status_code, 403)

    def test_registration_is_gone(self):
        self.assertEqual(APIClient().post('/api/auth/register/', {'username': 'x'}).status_code, 404)

    def test_password_hashed(self):
        self.assertTrue(self.admin.password.startswith('pbkdf2'))


class CreateTests(BaseCase):
    def test_anonymous_can_post_and_it_is_pending_and_hidden(self):
        c = APIClient()
        r = c.post('/api/announcements/', self.payload(status='approved'), format='multipart')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual((r.data['status'], r.data['publisher_name']), ('pending', 'Bob'))
        self.assertEqual(c.get('/api/announcements/').data['count'], 0)
        self.assertIsNone(Announcement.objects.get().publisher)

    def test_name_required(self):
        r = APIClient().post('/api/announcements/', self.payload(publisher_name=' '))
        self.assertEqual(r.status_code, 400)
        self.assertIn('publisher_name', r.data)

    def test_admin_post_is_auto_approved(self):
        r = self.admin_client().post('/api/announcements/', self.payload(), format='multipart')
        self.assertEqual(r.data['status'], 'approved')

    def test_post_rate_limit(self):
        c = APIClient()
        codes = [c.post('/api/announcements/', self.payload()).status_code for _ in range(11)]
        self.assertEqual(codes[:10], [201] * 10)
        self.assertEqual(codes[10], 429)
        self.assertEqual(c.get('/api/announcements/').status_code, 200)  # browsing unaffected

    def test_image_upload_validation(self):
        c = APIClient()
        ok = c.post('/api/announcements/', {**self.payload(), 'image': image_file()}, format='multipart')
        self.assertEqual(ok.status_code, 201, ok.data)
        self.assertTrue(ok.data['image_url'])
        fake = SimpleUploadedFile('x.png', b'not an image', content_type='image/png')
        self.assertEqual(c.post('/api/announcements/', {**self.payload(), 'image': fake}, format='multipart').status_code, 400)
        gif = io.BytesIO(); Image.new('RGB', (5, 5)).save(gif, 'GIF')
        gif_f = SimpleUploadedFile('x.gif', gif.getvalue(), content_type='image/gif')
        self.assertEqual(c.post('/api/announcements/', {**self.payload(), 'image': gif_f}, format='multipart').status_code, 400)

    @override_settings(MAX_IMAGE_BYTES=100)
    def test_image_too_large(self):
        r = APIClient().post('/api/announcements/', {**self.payload(), 'image': image_file(size=(200, 200))}, format='multipart')
        self.assertEqual(r.status_code, 400)

    def test_contact_and_url_validation(self):
        c = APIClient()
        P = self.payload
        self.assertEqual(c.post('/api/announcements/', P(contact_method='email', contact_info='nope')).status_code, 400)
        self.assertEqual(c.post('/api/announcements/', P(contact_method='whatsapp', contact_info='abc')).status_code, 400)
        self.assertEqual(c.post('/api/announcements/', P(contact_method='link', contact_info='javascript:alert(1)')).status_code, 400)
        self.assertEqual(c.post('/api/announcements/', P(external_url='javascript:alert(1)')).status_code, 400)
        r = c.post('/api/announcements/', P(contact_method='whatsapp', contact_info='+60 12-345 6789'))
        self.assertEqual((r.status_code, r.data['contact_info']), (201, '60123456789'))

    def test_past_expiry_rejected(self):
        r = APIClient().post('/api/announcements/', self.payload(expires_at=str(timezone.localdate() - timedelta(days=1))))
        self.assertEqual(r.status_code, 400)

    def test_public_cannot_modify_or_delete(self):
        ann = self.make()
        c = APIClient()
        self.assertEqual(c.patch(f'/api/announcements/{ann.id}/', {'title': 'Hacked'}).status_code, 405)
        self.assertEqual(c.delete(f'/api/announcements/{ann.id}/').status_code, 405)


class BrowseTests(BaseCase):
    def test_only_approved_and_unexpired_public(self):
        self.make(title='visible')
        self.make(title='pending', status='pending')
        self.make(title='rejected', status='rejected')
        self.make(title='expired', expires_at=timezone.localdate() - timedelta(days=1))
        r = APIClient().get('/api/announcements/')
        self.assertEqual([a['title'] for a in r.data['results']], ['visible'])

    def test_category_filter_search_and_ordering(self):
        a = self.make(title='Old pizza', category=self.cat)
        b = self.make(title='Hack night', category=self.other_cat, description='coding event')
        Announcement.objects.filter(pk=a.pk).update(created_at=timezone.now() - timedelta(days=3))
        c = APIClient()
        ids = lambda url: [x['id'] for x in c.get(url).data['results']]
        self.assertEqual(ids(f'/api/announcements/?category={self.other_cat.slug}'), [b.id])
        self.assertEqual(ids('/api/announcements/?search=pizza'), [a.id])
        self.assertEqual(ids('/api/announcements/?search=CODING'), [b.id])
        self.assertEqual(ids('/api/announcements/'), [b.id, a.id])
        self.assertEqual(ids('/api/announcements/?ordering=oldest'), [a.id, b.id])

    def test_category_counts(self):
        self.make(); self.make(status='pending')
        data = {c['slug']: c['announcement_count'] for c in APIClient().get('/api/categories/').data}
        self.assertEqual((data['food-drinks'], data['events'], len(data)), (1, 0, 6))

    def test_detail_visibility(self):
        pending = self.make(status='pending')
        self.assertEqual(APIClient().get(f'/api/announcements/{pending.id}/').status_code, 404)
        self.assertEqual(self.admin_client().get(f'/api/announcements/{pending.id}/').status_code, 200)
        live = self.make()
        self.assertEqual(APIClient().get(f'/api/announcements/{live.id}/').status_code, 200)


class AdminTests(BaseCase):
    def test_anonymous_blocked_from_admin_endpoints(self):
        c = APIClient()
        ann = self.make(status='pending')
        for method, url in [('get', '/api/admin/stats/'), ('get', '/api/admin/announcements/'),
                            ('post', f'/api/admin/announcements/{ann.id}/approve/'),
                            ('delete', f'/api/admin/announcements/{ann.id}/'), ('get', '/api/admin/reports/')]:
            self.assertIn(getattr(c, method)(url).status_code, (401, 403), url)
        self.assertTrue(Announcement.objects.filter(pk=ann.id, status='pending').exists())

    def test_non_admin_user_blocked(self):
        user = User.objects.create_user('stu', 's@x.com', PW)
        c = APIClient(); c.force_login(user)
        self.assertEqual(c.get('/api/admin/stats/').status_code, 403)

    def test_approve_makes_public_and_reject_hides(self):
        ann = self.make(status='pending')
        admin = self.admin_client()
        self.assertEqual(APIClient().get('/api/announcements/').data['count'], 0)
        self.assertEqual(admin.post(f'/api/admin/announcements/{ann.id}/approve/').data['status'], 'approved')
        self.assertEqual(APIClient().get('/api/announcements/').data['count'], 1)
        r = admin.post(f'/api/admin/announcements/{ann.id}/reject/', {'reason': 'Misleading'})
        self.assertEqual((r.data['status'], r.data['rejection_reason']), ('rejected', 'Misleading'))
        self.assertEqual(APIClient().get('/api/announcements/').data['count'], 0)

    def test_stats_delete_and_filter(self):
        self.make(status='pending'); self.make(); self.make(status='rejected')
        ann = self.make()
        admin = self.admin_client()
        s = admin.get('/api/admin/stats/').data
        self.assertEqual((s['total'], s['pending'], s['approved'], s['rejected']), (4, 1, 2, 1))
        self.assertEqual(admin.get('/api/admin/announcements/?status=pending').data['count'], 1)
        self.assertEqual(admin.delete(f'/api/admin/announcements/{ann.id}/').status_code, 204)
        self.assertEqual(admin.get('/api/admin/stats/').data['total'], 3)


class ReportTests(BaseCase):
    def test_anonymous_report_flow(self):
        ann = self.make()
        r = APIClient().post(f'/api/announcements/{ann.id}/report/', {'reason': 'This is misleading'})
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data['reporter_name'], 'Anonymous')
        self.assertEqual(APIClient().post(f'/api/announcements/{ann.id}/report/', {'reason': 'x'}).status_code, 400)
        admin = self.admin_client()
        self.assertEqual(admin.get('/api/admin/stats/').data['open_reports'], 1)
        rep = Report.objects.get()
        self.assertEqual(admin.post(f'/api/admin/reports/{rep.id}/dismiss/').data['status'], 'dismissed')
        self.assertEqual(admin.get('/api/admin/stats/').data['open_reports'], 0)

    def test_cannot_report_unpublished(self):
        ann = self.make(status='pending')
        self.assertEqual(APIClient().post(f'/api/announcements/{ann.id}/report/', {'reason': 'whatever'}).status_code, 404)


@override_settings(MEDIA_ROOT=MEDIA)
class LiveFlowTests(LiveServerTestCase):
    """Real HTTP + cookies + CSRF header, the way the browser (Axios) talks to the API."""

    def setUp(self):
        import http.cookiejar, json, urllib.request
        cache.clear()
        self.json, self.urllib = json, urllib.request
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def call(self, method, path, body=None, csrf=True):
        headers = {'Content-Type': 'application/json'}
        token = next((c.value for c in self.jar if c.name == 'csrftoken'), None)
        if csrf and token:
            headers['X-CSRFToken'] = token
        data = self.json.dumps(body).encode() if body is not None else None
        req = self.urllib.Request(self.live_server_url + path, data=data, method=method, headers=headers)
        try:
            with self.opener.open(req) as r:
                raw = r.read()
                return r.status, (self.json.loads(raw) if raw else None)
        except self.urllib.HTTPError as e:
            raw = e.read()
            return e.code, (self.json.loads(raw) if raw else None)

    def test_public_post_then_admin_approves(self):
        cat = Category.objects.get(slug='events')
        User.objects.create_user('root', 'root@x.com', PW, role='admin')
        payload = {'title': 'Hack night', 'description': 'Join us for a coding night.', 'category': cat.id,
                   'publisher_name': 'Carol', 'contact_method': 'link', 'contact_info': 'https://example.com/signup'}

        # Anonymous visitor posts with no cookies/CSRF at all.
        status, ann = self.call('POST', '/api/announcements/', payload, csrf=False)
        self.assertEqual((status, ann['status']), (201, 'pending'))
        self.assertEqual(self.call('GET', '/api/announcements/')[1]['count'], 0)
        self.assertEqual(self.call('POST', f'/api/admin/announcements/{ann["id"]}/approve/', csrf=False)[0], 403)

        # Admin logs in (CSRF header required once authenticated) and approves.
        self.call('GET', '/api/auth/csrf/')
        self.assertEqual(self.call('POST', '/api/auth/login/', {'username': 'root', 'password': PW})[0], 200)
        self.assertEqual(self.call('POST', f'/api/admin/announcements/{ann["id"]}/approve/', csrf=False)[0], 403)  # no CSRF token
        self.assertEqual(self.call('POST', f'/api/admin/announcements/{ann["id"]}/approve/')[1]['status'], 'approved')
        listing = self.call('GET', '/api/announcements/?category=events&search=hack')[1]
        self.assertEqual([a['id'] for a in listing['results']], [ann['id']])
