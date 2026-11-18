import io
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient, APITestCase

from accounts.models import User
from announcements.models import Announcement, Category, Report

PW = 'Str0ng-Pass-123'


def image_file(fmt='PNG', size=(20, 20), name='pic.png'):
    buf = io.BytesIO()
    Image.new('RGB', size, 'red').save(buf, fmt)
    return SimpleUploadedFile(name, buf.getvalue(), content_type='image/png')


@override_settings(MEDIA_ROOT='/tmp/lumacam-test-media')
class BaseCase(APITestCase):
    def setUp(self):
        self.cat = Category.objects.get(slug='food-drinks')
        self.other_cat = Category.objects.get(slug='events')
        self.student = User.objects.create_user('alice', 'alice@x.com', PW)
        self.student2 = User.objects.create_user('bob', 'bob@x.com', PW)
        self.admin = User.objects.create_user('boss', 'boss@x.com', PW, role='admin')

    def login(self, user):
        c = APIClient(enforce_csrf_checks=False)
        c.force_login(user)
        return c

    def make(self, publisher=None, status='approved', **kw):
        data = dict(title='Nasi lemak', description='Delicious lunch pickup', category=self.cat,
                    publisher=publisher or self.student, contact_method='whatsapp',
                    contact_info='60123456789', status=status)
        data.update(kw)
        return Announcement.objects.create(**data)

    payload = {'title': 'Fresh cookies', 'description': 'Baked daily near the library.',
               'contact_method': 'email', 'contact_info': 'a@b.com'}


class AuthTests(BaseCase):
    def test_register_login_logout(self):
        c = APIClient()
        r = c.post('/api/auth/register/', {'username': 'newbie', 'email': 'n@x.com', 'password': PW})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data['role'], 'student')
        self.assertEqual(c.get('/api/auth/me/').status_code, 200)
        self.assertEqual(c.post('/api/auth/logout/').status_code, 204)
        self.assertEqual(c.get('/api/auth/me/').status_code, 403)
        r = c.post('/api/auth/login/', {'username': 'newbie', 'password': PW})
        self.assertEqual(r.status_code, 200)

    def test_cannot_self_assign_admin(self):
        r = APIClient().post('/api/auth/register/', {'username': 'sneaky', 'email': 's@x.com',
                                                     'password': PW, 'role': 'admin'})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(User.objects.get(username='sneaky').role, 'student')

    def test_duplicate_email_and_weak_password(self):
        c = APIClient()
        self.assertEqual(c.post('/api/auth/register/', {'username': 'x1', 'email': 'ALICE@x.com', 'password': PW}).status_code, 400)
        self.assertEqual(c.post('/api/auth/register/', {'username': 'x2', 'email': 'x2@x.com', 'password': '123'}).status_code, 400)

    def test_bad_login(self):
        r = APIClient().post('/api/auth/login/', {'username': 'alice', 'password': 'wrong'})
        self.assertEqual(r.status_code, 400)

    def test_password_not_stored_plain(self):
        self.assertNotEqual(self.student.password, PW)
        self.assertTrue(self.student.password.startswith('pbkdf2'))


class CreateTests(BaseCase):
    def test_anonymous_cannot_create(self):
        r = APIClient().post('/api/announcements/', {**self.payload, 'category': self.cat.id})
        self.assertIn(r.status_code, (401, 403))

    def test_student_create_is_pending_and_hidden(self):
        c = self.login(self.student)
        r = c.post('/api/announcements/', {**self.payload, 'category': self.cat.id, 'status': 'approved'}, format='multipart')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data['status'], 'pending')
        self.assertEqual(APIClient().get('/api/announcements/').data['count'], 0)

    def test_admin_create_is_auto_approved(self):
        r = self.login(self.admin).post('/api/announcements/', {**self.payload, 'category': self.cat.id}, format='multipart')
        self.assertEqual(r.data['status'], 'approved')

    def test_image_upload_validation(self):
        c = self.login(self.student)
        data = {**self.payload, 'category': self.cat.id}
        ok = c.post('/api/announcements/', {**data, 'image': image_file()}, format='multipart')
        self.assertEqual(ok.status_code, 201, ok.data)
        self.assertTrue(ok.data['image_url'])
        fake = SimpleUploadedFile('x.png', b'not an image', content_type='image/png')
        self.assertEqual(c.post('/api/announcements/', {**data, 'image': fake}, format='multipart').status_code, 400)
        gif = io.BytesIO(); Image.new('RGB', (5, 5)).save(gif, 'GIF')
        gif_f = SimpleUploadedFile('x.gif', gif.getvalue(), content_type='image/gif')
        self.assertEqual(c.post('/api/announcements/', {**data, 'image': gif_f}, format='multipart').status_code, 400)

    @override_settings(MAX_IMAGE_BYTES=100)
    def test_image_too_large(self):
        c = self.login(self.student)
        r = c.post('/api/announcements/', {**self.payload, 'category': self.cat.id,
                                           'image': image_file(size=(200, 200))}, format='multipart')
        self.assertEqual(r.status_code, 400)

    def test_contact_and_url_validation(self):
        c = self.login(self.student)
        base = {**self.payload, 'category': self.cat.id}
        self.assertEqual(c.post('/api/announcements/', {**base, 'contact_method': 'email', 'contact_info': 'nope'}).status_code, 400)
        self.assertEqual(c.post('/api/announcements/', {**base, 'contact_method': 'whatsapp', 'contact_info': 'abc'}).status_code, 400)
        self.assertEqual(c.post('/api/announcements/', {**base, 'contact_method': 'link', 'contact_info': 'javascript:alert(1)'}).status_code, 400)
        self.assertEqual(c.post('/api/announcements/', {**base, 'external_url': 'javascript:alert(1)'}).status_code, 400)
        r = c.post('/api/announcements/', {**base, 'contact_method': 'whatsapp', 'contact_info': '+60 12-345 6789'})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data['contact_info'], '60123456789')

    def test_past_expiry_rejected(self):
        c = self.login(self.student)
        r = c.post('/api/announcements/', {**self.payload, 'category': self.cat.id,
                                           'expires_at': str(timezone.localdate() - timedelta(days=1))})
        self.assertEqual(r.status_code, 400)


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
        self.assertEqual([x['id'] for x in c.get(f'/api/announcements/?category={self.other_cat.slug}').data['results']], [b.id])
        self.assertEqual([x['id'] for x in c.get('/api/announcements/?search=pizza').data['results']], [a.id])
        self.assertEqual([x['id'] for x in c.get('/api/announcements/?search=CODING').data['results']], [b.id])
        self.assertEqual([x['id'] for x in c.get('/api/announcements/').data['results']], [b.id, a.id])
        self.assertEqual([x['id'] for x in c.get('/api/announcements/?ordering=oldest').data['results']], [a.id, b.id])

    def test_category_counts(self):
        self.make(); self.make(status='pending')
        data = {c['slug']: c['announcement_count'] for c in APIClient().get('/api/categories/').data}
        self.assertEqual(data['food-drinks'], 1)
        self.assertEqual(data['events'], 0)
        self.assertEqual(len(data), 6)

    def test_detail_visibility(self):
        pending = self.make(status='pending')
        self.assertEqual(APIClient().get(f'/api/announcements/{pending.id}/').status_code, 404)
        self.assertEqual(self.login(self.student2).get(f'/api/announcements/{pending.id}/').status_code, 404)
        self.assertEqual(self.login(self.student).get(f'/api/announcements/{pending.id}/').status_code, 200)
        self.assertEqual(self.login(self.admin).get(f'/api/announcements/{pending.id}/').status_code, 200)


class OwnershipTests(BaseCase):
    def test_owner_can_edit_and_goes_back_to_pending(self):
        ann = self.make()
        r = self.login(self.student).patch(f'/api/announcements/{ann.id}/', {'title': 'Updated title'})
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data['status'], 'pending')

    def test_other_student_cannot_edit_or_delete(self):
        ann = self.make()
        c = self.login(self.student2)
        self.assertEqual(c.patch(f'/api/announcements/{ann.id}/', {'title': 'Hacked'}).status_code, 403)
        self.assertEqual(c.delete(f'/api/announcements/{ann.id}/').status_code, 403)
        self.assertTrue(Announcement.objects.filter(pk=ann.id).exists())

    def test_owner_can_delete(self):
        ann = self.make()
        self.assertEqual(self.login(self.student).delete(f'/api/announcements/{ann.id}/').status_code, 204)

    def test_mine_lists_only_own_all_statuses(self):
        self.make(status='pending'); self.make(status='rejected'); self.make(publisher=self.student2)
        r = self.login(self.student).get('/api/announcements/mine/')
        self.assertEqual(len(r.data), 2)
        self.assertIn(APIClient().get('/api/announcements/mine/').status_code, (401, 403))


class AdminTests(BaseCase):
    def test_student_blocked_from_admin_endpoints(self):
        c = self.login(self.student)
        ann = self.make(status='pending')
        for method, url in [('get', '/api/admin/stats/'), ('get', '/api/admin/announcements/'),
                            ('post', f'/api/admin/announcements/{ann.id}/approve/'),
                            ('delete', f'/api/admin/announcements/{ann.id}/'), ('get', '/api/admin/reports/')]:
            self.assertEqual(getattr(c, method)(url).status_code, 403, url)
        self.assertIn(APIClient().get('/api/admin/stats/').status_code, (401, 403))

    def test_approve_makes_public_and_reject_hides(self):
        ann = self.make(status='pending')
        admin = self.login(self.admin)
        self.assertEqual(APIClient().get('/api/announcements/').data['count'], 0)
        self.assertEqual(admin.post(f'/api/admin/announcements/{ann.id}/approve/').data['status'], 'approved')
        self.assertEqual(APIClient().get('/api/announcements/').data['count'], 1)
        r = admin.post(f'/api/admin/announcements/{ann.id}/reject/', {'reason': 'Misleading'})
        self.assertEqual((r.data['status'], r.data['rejection_reason']), ('rejected', 'Misleading'))
        self.assertEqual(APIClient().get('/api/announcements/').data['count'], 0)

    def test_stats_and_delete(self):
        self.make(status='pending'); self.make(); self.make(status='rejected')
        ann = self.make()
        admin = self.login(self.admin)
        s = admin.get('/api/admin/stats/').data
        self.assertEqual((s['total'], s['pending'], s['approved'], s['rejected']), (4, 1, 2, 1))
        self.assertEqual(admin.delete(f'/api/admin/announcements/{ann.id}/').status_code, 204)
        self.assertEqual(admin.get('/api/admin/stats/').data['total'], 3)

    def test_admin_status_filter(self):
        self.make(status='pending'); self.make()
        r = self.login(self.admin).get('/api/admin/announcements/?status=pending')
        self.assertEqual(r.data['count'], 1)


class ReportTests(BaseCase):
    def test_report_flow(self):
        ann = self.make()
        bob = self.login(self.student2)
        r = bob.post(f'/api/announcements/{ann.id}/report/', {'reason': 'This is misleading'})
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(bob.post(f'/api/announcements/{ann.id}/report/', {'reason': 'again again'}).status_code, 400)
        self.assertEqual(self.login(self.student).post(f'/api/announcements/{ann.id}/report/', {'reason': 'my own post'}).status_code, 400)
        admin = self.login(self.admin)
        self.assertEqual(admin.get('/api/admin/stats/').data['open_reports'], 1)
        rep = Report.objects.get()
        self.assertEqual(admin.post(f'/api/admin/reports/{rep.id}/dismiss/').data['status'], 'dismissed')
        self.assertEqual(admin.get('/api/admin/stats/').data['open_reports'], 0)


@override_settings(MEDIA_ROOT='/tmp/lumacam-test-media')
class LiveFlowTests(__import__('django.test', fromlist=['LiveServerTestCase']).LiveServerTestCase):
    """Real HTTP + cookies + CSRF header, the way the browser (Axios) talks to the API."""

    def setUp(self):
        import http.cookiejar, json, urllib.request
        self.json = json
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.urllib = urllib.request

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

    def test_full_flow_with_csrf(self):
        cat = Category.objects.get(slug='events')
        admin = User.objects.create_user('root', 'root@x.com', PW, role='admin')
        self.assertEqual(self.call('GET', '/api/auth/csrf/')[0], 200)

        status, user = self.call('POST', '/api/auth/register/', {'username': 'carol', 'email': 'c@x.com', 'password': PW})
        self.assertEqual(status, 201, user)
        payload = {'title': 'Hack night', 'description': 'Join us for a coding night.', 'category': cat.id,
                   'contact_method': 'link', 'contact_info': 'https://example.com/signup'}

        # Missing CSRF header is rejected for an authenticated session.
        self.assertEqual(self.call('POST', '/api/announcements/', payload, csrf=False)[0], 403)
        status, ann = self.call('POST', '/api/announcements/', payload)
        self.assertEqual((status, ann['status']), (201, 'pending'))

        # Not visible publicly until approved.
        self.assertEqual(self.call('GET', '/api/announcements/')[1]['count'], 0)
        self.assertEqual(self.call('POST', f'/api/admin/announcements/{ann["id"]}/approve/')[0], 403)
        self.call('POST', '/api/auth/logout/')

        self.call('GET', '/api/auth/csrf/')
        self.assertEqual(self.call('POST', '/api/auth/login/', {'username': 'root', 'password': PW})[0], 200)
        self.assertEqual(self.call('POST', f'/api/admin/announcements/{ann["id"]}/approve/')[1]['status'], 'approved')
        listing = self.call('GET', f'/api/announcements/?category=events&search=hack')[1]
        self.assertEqual([a['id'] for a in listing['results']], [ann['id']])
