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

from accounts.models import User
from announcements.ownership import hash_token

PW = 'Campus-pass-2026'


def image_file(fmt='PNG', size=(20, 20), name='pic.png', color='red'):
    buf = io.BytesIO()
    Image.new('RGB', size, color).save(buf, fmt)
    return SimpleUploadedFile(name, buf.getvalue(), content_type='image/png')


class BaseCase(APITestCase):
    def setUp(self):
        cache.clear()  # reset rate-limit counters
        self.cat = Category.objects.get(slug='food-drinks')
        self.other_cat = Category.objects.get(slug='events')
        # Most tests act as one logged-in student who owns the posts they make.
        self.user = User.objects.create_user('alice', password=PW, first_name='Alice')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def make(self, status='approved', **kw):
        data = dict(title='Nasi lemak', description='Delicious lunch pickup', category=self.cat,
                    publisher_name='Alice', contact_method='whatsapp', contact_info='60123456789', status=status,
                    publisher=self.user)
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


class AuthTests(BaseCase):
    def test_register_then_use_token(self):
        c = APIClient()
        r = c.post('/api/auth/register/', {'username': 'priya_k', 'display_name': '  Priya   Kumar ', 'password': PW})
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data['user']['display_name'], 'Priya Kumar')
        c.credentials(HTTP_AUTHORIZATION=f"Token {r.data['token']}")
        self.assertEqual(c.get('/api/auth/me/').data['username'], 'priya_k')
        post = c.post('/api/announcements/', self.payload())
        self.assertEqual((post.status_code, post.data['publisher_name']), (201, 'Priya Kumar'))

    def test_register_validation(self):
        c = APIClient()
        self.assertIn('username', c.post('/api/auth/register/', {'username': 'ALICE', 'display_name': 'A2', 'password': PW}).data)
        self.assertIn('username', c.post('/api/auth/register/', {'username': 'a b', 'display_name': 'Ab', 'password': PW}).data)
        self.assertIn('password', c.post('/api/auth/register/', {'username': 'newbie', 'display_name': 'New', 'password': '123'}).data)
        self.assertIn('display_name', c.post('/api/auth/register/', {'username': 'newbie', 'display_name': ' ', 'password': PW}).data)

    def test_login_is_case_insensitive_and_reuses_token(self):
        c = APIClient()
        a = c.post('/api/auth/login/', {'username': 'ALICE', 'password': PW})
        b = c.post('/api/auth/login/', {'username': 'alice', 'password': PW})
        self.assertEqual((a.status_code, a.data['token']), (200, b.data['token']))  # log in once, many devices
        self.assertEqual(c.post('/api/auth/login/', {'username': 'alice', 'password': 'nope'}).status_code, 400)

    def test_logout_invalidates_token(self):
        c = APIClient()
        token = c.post('/api/auth/login/', {'username': 'alice', 'password': PW}).data['token']
        c.credentials(HTTP_AUTHORIZATION=f'Token {token}')
        self.assertEqual(c.post('/api/auth/logout/').status_code, 204)
        self.assertEqual(c.get('/api/auth/me/').status_code, 401)

    def test_password_is_hashed(self):
        self.assertTrue(User.objects.get(username='alice').password.startswith('pbkdf2'))


class CreateTests(BaseCase):
    def test_post_is_live_immediately(self):
        r = self.client.post('/api/announcements/', self.payload(), format='multipart')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(self.public_titles(), ['Fresh cookies'])

    def test_publisher_is_the_logged_in_account(self):
        r = self.client.post('/api/announcements/', self.payload(publisher_name='Someone else'))
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data['publisher_name'], 'Alice')
        self.assertEqual(Announcement.objects.get(pk=r.data['id']).publisher, self.user)
        self.assertTrue(r.data['can_edit'])

    def test_posting_needs_login(self):
        r = APIClient().post('/api/announcements/', self.payload())
        self.assertEqual(r.status_code, 401)
        self.assertEqual(APIClient().get('/api/announcements/').status_code, 200)  # browsing stays open

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

    def test_contact_is_optional(self):
        base = self.payload()
        del base['contact_method'], base['contact_info']
        r = self.client.post('/api/announcements/', base)
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual((r.data['contact_method'], r.data['contact_info']), ('none', ''))
        r = self.client.post('/api/announcements/', self.payload(contact_method='none', contact_info='ignored@x.com'))
        self.assertEqual(r.data['contact_info'], '')

    def test_chosen_contact_method_needs_details(self):
        r = self.client.post('/api/announcements/', self.payload(contact_method='email', contact_info='  '))
        self.assertEqual(r.status_code, 400)
        self.assertIn('No contact', r.data['contact_info'][0])

    def test_edit_can_switch_contact_off(self):
        ann = self.make()
        r = self.client.patch(f'/api/announcements/{ann.id}/', {'contact_method': 'none'})
        self.assertEqual((r.status_code, r.data['contact_info']), (200, ''))

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

    def test_delete_empty_category_hides_it(self):
        cat_id = self.client.post('/api/categories/', self.new).data['id']
        self.assertEqual(self.client.delete(f'/api/categories/{cat_id}/').status_code, 204)
        self.assertNotIn('sports-fitness', [c['slug'] for c in self.client.get('/api/categories/').data])
        self.assertTrue(Category.objects.get(pk=cat_id).is_removed)  # restorable in /django-admin/
        self.assertEqual(self.client.delete(f'/api/categories/{cat_id}/').status_code, 404)

    def test_cannot_delete_category_with_posts(self):
        cat_id = self.client.post('/api/categories/', self.new).data['id']
        self.client.post('/api/announcements/', self.payload(category=cat_id))
        r = self.client.delete(f'/api/categories/{cat_id}/')
        self.assertEqual((r.status_code, r.data['announcement_count']), (400, 1))
        self.assertIn('still has 1 announcement', r.data['detail'])
        self.assertFalse(Category.objects.get(pk=cat_id).is_removed)

    def test_expired_posts_also_block_delete(self):
        cat = Category.objects.create(name='Clubs', slug='clubs', icon='tag', created_by=self.user)
        self.make(category=cat, expires_at=timezone.localdate() - timedelta(days=1))
        self.assertEqual(self.client.delete(f'/api/categories/{cat.id}/').status_code, 400)

    def test_removed_posts_do_not_block_delete(self):
        cat = Category.objects.create(name='Clubs', slug='clubs', icon='tag', created_by=self.user)
        self.make(category=cat, status='removed')
        self.assertEqual(self.client.delete(f'/api/categories/{cat.id}/').status_code, 204)

    def test_original_categories_cannot_be_deleted_in_the_app(self):
        other = Category.objects.get(slug='other')
        r = self.client.delete(f'/api/categories/{other.id}/')
        self.assertEqual(r.status_code, 403)
        self.assertIn('site admin', r.data['detail'])
        self.assertEqual(len(self.client.get('/api/categories/').data), 6)

    def test_only_creator_can_delete_category(self):
        cat_id = self.client.post('/api/categories/', self.new).data['id']
        bob = User.objects.create_user('bob', password=PW)
        other = APIClient(); other.force_authenticate(bob)
        self.assertEqual(other.delete(f'/api/categories/{cat_id}/').status_code, 403)
        self.assertIn(APIClient().delete(f'/api/categories/{cat_id}/').status_code, (401, 403))
        self.assertTrue(self.client.get('/api/categories/').data[-2]['can_delete'])
        self.assertFalse(other.get('/api/categories/').data[-2]['can_delete'])
        self.assertEqual(self.client.delete(f'/api/categories/{cat_id}/').status_code, 204)

    def test_creating_a_category_needs_login(self):
        self.assertEqual(APIClient().post('/api/categories/', self.new).status_code, 401)

    def test_cannot_post_into_deleted_category(self):
        cat = Category.objects.create(name='Clubs', slug='clubs', icon='tag', created_by=self.user)
        self.client.delete(f'/api/categories/{cat.id}/')
        r = self.client.post('/api/announcements/', self.payload(category=cat.id))
        self.assertEqual(r.status_code, 400)
        self.assertIn('no longer exists', r.data['category'][0])

    def test_recreating_deleted_category_restores_it(self):
        first = self.client.post('/api/categories/', self.new).data
        self.client.delete(f"/api/categories/{first['id']}/")
        again = self.client.post('/api/categories/', {**self.new, 'name': 'sports & fitness', 'color': 'rose'})
        self.assertEqual(again.status_code, 201, again.data)
        self.assertEqual((again.data['id'], again.data['color']), (first['id'], 'rose'))
        self.assertIn('sports-fitness', [c['slug'] for c in self.client.get('/api/categories/').data])

    def test_validation(self):
        self.assertEqual(self.client.post('/api/categories/', {**self.new, 'name': 'food & DRINKS'}).status_code, 400)
        self.assertEqual(self.client.post('/api/categories/', {**self.new, 'icon': 'skull'}).status_code, 400)
        self.assertEqual(self.client.post('/api/categories/', {**self.new, 'color': 'black'}).status_code, 400)
        self.assertEqual(self.client.post('/api/categories/', {**self.new, 'name': 'x'}).status_code, 400)

    def test_category_rate_limit(self):
        codes = [self.client.post('/api/categories/', {**self.new, 'name': f'Cat {i}'}).status_code for i in range(11)]
        self.assertEqual((codes[:10], codes[10]), ([201] * 10, 429))


class LiveFlowTests(LiveServerTestCase):
    """Real HTTP requests with a real token, the way the browser talks to the API."""

    def setUp(self):
        import urllib.request
        cache.clear()
        self.urllib = urllib.request

    def call(self, method, path, body=None, token=None):
        data = json.dumps(body).encode() if body is not None else None
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Token {token}'
        req = self.urllib.Request(self.live_server_url + path, data=data, method=method, headers=headers)
        try:
            with self.urllib.urlopen(req) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else None)
        except self.urllib.HTTPError as e:
            raw = e.read()
            return e.code, (json.loads(raw) if raw else None)

    def test_sign_up_post_edit_delete(self):
        cat = Category.objects.get(slug='events')
        status, me = self.call('POST', '/api/auth/register/', {'username': 'carol', 'display_name': 'Carol', 'password': PW})
        self.assertEqual(status, 201, me)
        token = me['token']
        payload = {'title': 'Hack night', 'description': 'Join us for a coding night.', 'category': cat.id}
        self.assertEqual(self.call('POST', '/api/announcements/', payload)[0], 401)
        status, ann = self.call('POST', '/api/announcements/', payload, token)
        self.assertEqual((status, ann['publisher_name']), (201, 'Carol'))
        _, other = self.call('POST', '/api/auth/register/', {'username': 'dave', 'display_name': 'Dave', 'password': PW})
        self.assertEqual(self.call('PATCH', f"/api/announcements/{ann['id']}/", {'title': 'Stolen'}, other['token'])[0], 403)
        status, edited = self.call('PATCH', f"/api/announcements/{ann['id']}/", {'title': 'Hack night v2'}, token)
        self.assertEqual((status, edited['title']), (200, 'Hack night v2'))
        self.assertEqual(self.call('DELETE', f"/api/announcements/{ann['id']}/", token=token)[0], 204)
        self.assertEqual(self.call('GET', '/api/announcements/')[1]['count'], 0)


class EventDateTests(BaseCase):
    def day(self, n):
        return timezone.localdate() + timedelta(days=n)

    def ids(self, query=''):
        r = self.client.get(f'/api/announcements/{query}')
        self.assertEqual(r.status_code, 200, r.data)
        return [a['id'] for a in r.data['results']]

    # ---- validation ----
    def test_create_with_event_range(self):
        r = self.client.post('/api/announcements/', self.payload(event_start=str(self.day(2)), event_end=str(self.day(4))))
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual((r.data['event_start'], r.data['event_end']), (str(self.day(2)), str(self.day(4))))

    def test_same_day_end_is_dropped(self):
        r = self.client.post('/api/announcements/', self.payload(event_start=str(self.day(2)), event_end=str(self.day(2))))
        self.assertIsNone(r.data['event_end'])

    def test_event_validation(self):
        post = lambda **kw: self.client.post('/api/announcements/', self.payload(**kw))  # noqa: E731
        self.assertIn('event_start', post(event_end=str(self.day(3))).data)
        self.assertIn('event_end', post(event_start=str(self.day(3)), event_end=str(self.day(1))).data)
        self.assertIn('event_start', post(event_start=str(self.day(-3)), event_end=str(self.day(-1))).data)
        self.assertIn('event_end', post(event_start=str(self.day(1)), event_end=str(self.day(400))).data)
        # Started already but still running: allowed.
        self.assertEqual(post(event_start=str(self.day(-2)), event_end=str(self.day(2))).status_code, 201)

    def test_editing_other_fields_of_past_event_is_allowed(self):
        ann = self.make(event_start=self.day(-5), expires_at=self.day(3))
        r = self.client.patch(f'/api/announcements/{ann.id}/', {'title': 'Recap and photos'})
        self.assertEqual(r.status_code, 200, r.data)

    def test_edit_can_clear_event_dates(self):
        ann = self.make(event_start=self.day(1), event_end=self.day(3))
        r = self.client.patch(f'/api/announcements/{ann.id}/', {'event_start': '', 'event_end': ''}, format='multipart')
        self.assertEqual((r.status_code, r.data['event_start'], r.data['event_end']), (200, None, None))

    # ---- auto-expiry ----
    def test_hidden_after_event_ends_without_expiry(self):
        ended = self.make(title='ended', event_start=self.day(-3), event_end=self.day(-1))
        single_past = self.make(title='single past', event_start=self.day(-1))
        today = self.make(title='today', event_start=self.day(0))
        running = self.make(title='running', event_start=self.day(-2), event_end=self.day(0))
        undated = self.make(title='undated')
        visible = set(self.ids())
        self.assertEqual(visible, {today.id, running.id, undated.id})
        self.assertNotIn(ended.id, visible)
        self.assertNotIn(single_past.id, visible)
        counts = {c['slug']: c['announcement_count'] for c in self.client.get('/api/categories/').data}
        self.assertEqual(counts['food-drinks'], 3)

    def test_expiry_date_takes_precedence(self):
        keep = self.make(event_start=self.day(-3), expires_at=self.day(2))
        drop = self.make(event_start=self.day(5), expires_at=self.day(-1))
        self.assertEqual(self.ids(), [keep.id])
        self.assertNotIn(drop.id, self.ids())

    # ---- date filter ----
    def test_date_range_overlap(self):
        a = self.make(title='A', event_start=self.day(1))
        b = self.make(title='B', event_start=self.day(3), event_end=self.day(5))
        self.make(title='C undated')
        d = self.day
        self.assertEqual(self.ids(f'?date_from={d(4)}&date_to={d(10)}'), [b.id])
        self.assertEqual(self.ids(f'?date_from={d(1)}&date_to={d(1)}'), [a.id])
        self.assertEqual(set(self.ids(f'?date_from={d(0)}&date_to={d(30)}')), {a.id, b.id})
        self.assertEqual(self.ids(f'?date_from={d(6)}&date_to={d(9)}'), [])
        self.assertEqual(self.ids(f'?date_from={d(2)}'), [b.id])
        self.assertEqual(self.ids(f'?date_to={d(2)}'), [a.id])

    def test_date_filter_combines_with_category_and_search(self):
        hit = self.make(title='Pizza night', event_start=self.day(2))
        self.make(title='Pizza sale', event_start=self.day(20))
        self.make(title='Hack night', category=self.other_cat, event_start=self.day(2))
        q = f'?category=food-drinks&search=pizza&date_from={self.day(0)}&date_to={self.day(6)}'
        self.assertEqual(self.ids(q), [hit.id])

    def test_bad_dates_are_rejected(self):
        self.assertEqual(self.client.get('/api/announcements/?date_from=28-11-2026').status_code, 400)
        r = self.client.get(f'/api/announcements/?date_from={self.day(5)}&date_to={self.day(1)}')
        self.assertEqual(r.status_code, 400)

    # ---- ordering ----
    def test_upcoming_ordering_puts_undated_last(self):
        later = self.make(title='later', event_start=self.day(9))
        undated = self.make(title='undated')
        sooner = self.make(title='sooner', event_start=self.day(1))
        self.assertEqual(self.ids('?ordering=upcoming'), [sooner.id, later.id, undated.id])

    def test_date_filter_defaults_to_upcoming_order(self):
        later = self.make(title='later', event_start=self.day(5))
        sooner = self.make(title='sooner', event_start=self.day(1))
        Announcement.objects.filter(pk=sooner.pk).update(created_at=timezone.now() - timedelta(days=2))
        q = f'?date_from={self.day(0)}&date_to={self.day(6)}'
        self.assertEqual(self.ids(q), [sooner.id, later.id])
        self.assertEqual(self.ids(q + '&ordering=newest'), [later.id, sooner.id])


class TrashTests(BaseCase):
    def trash_posts(self):
        ids = ','.join(str(i) for i in Announcement.objects.values_list('pk', flat=True))
        return [a['id'] for a in self.client.get(f'/api/trash/announcements/?ids={ids}').data['results']]

    def trash_cats(self):
        return [c['id'] for c in self.client.get('/api/trash/categories/').data]

    def age(self, obj, days):
        type(obj).objects.filter(pk=obj.pk).update(removed_at=timezone.now() - timedelta(days=days))

    def test_deleted_post_goes_to_trash_with_purge_date(self):
        ann = self.make()
        self.client.delete(f'/api/announcements/{ann.id}/')
        r = self.client.get(f'/api/trash/announcements/?ids={ann.id}')
        self.assertEqual([a['id'] for a in r.data['results']], [ann.id])
        item = r.data['results'][0]
        self.assertTrue(item['removed_at'] and item['purge_at'])
        self.assertGreater(item['purge_at'], item['removed_at'])
        self.assertEqual(self.public_titles(), [])

    def test_restore_post(self):
        ann = self.make()
        self.client.delete(f'/api/announcements/{ann.id}/')
        r = self.client.post(f'/api/trash/announcements/{ann.id}/restore/')
        self.assertEqual((r.status_code, r.data['restored_category']), (200, None))
        self.assertEqual(self.public_titles(), ['Nasi lemak'])
        self.assertEqual(self.trash_posts(), [])
        ann.refresh_from_db()
        self.assertIsNone(ann.removed_at)
        self.assertEqual(self.client.post(f'/api/trash/announcements/{ann.id}/restore/').status_code, 404)

    def test_restoring_post_also_restores_its_trashed_category(self):
        cat_id = self.client.post('/api/categories/', {'name': 'Clubs', 'icon': 'music', 'color': 'blue'}).data['id']
        ann_id = self.client.post('/api/announcements/', self.payload(category=cat_id)).data['id']
        self.client.delete(f'/api/announcements/{ann_id}/')
        self.assertEqual(self.client.delete(f'/api/categories/{cat_id}/').status_code, 204)
        trashed = self.client.get('/api/trash/categories/').data
        self.assertEqual([(c['id'], c['trashed_posts']) for c in trashed], [(cat_id, 1)])
        r = self.client.post(f'/api/trash/announcements/{ann_id}/restore/')
        self.assertEqual(r.data['restored_category'], 'Clubs')
        self.assertIn('clubs', [c['slug'] for c in self.client.get('/api/categories/').data])
        self.assertEqual(self.public_titles('/api/announcements/?category=clubs'), ['Fresh cookies'])

    def test_restore_category(self):
        cat = Category.objects.create(name='Clubs', slug='clubs', icon='tag', created_by=self.user)
        self.client.delete(f'/api/categories/{cat.id}/')
        self.assertEqual(self.trash_cats(), [cat.id])
        bob = APIClient(); bob.force_authenticate(User.objects.create_user('bob', password=PW))
        self.assertEqual(bob.get('/api/trash/categories/').data, [])
        self.assertEqual(bob.post(f'/api/trash/categories/{cat.id}/restore/').status_code, 403)
        r = self.client.post(f'/api/trash/categories/{cat.id}/restore/')
        self.assertEqual((r.status_code, r.data['slug']), (200, 'clubs'))
        self.assertEqual(self.trash_cats(), [])

    def test_old_items_are_purged(self):
        old, recent = self.make(title='old'), self.make(title='recent')
        for a in (old, recent):
            self.client.delete(f'/api/announcements/{a.id}/')
        self.age(old, 31)
        self.age(recent, 29)
        self.assertEqual(self.trash_posts(), [recent.id])  # listing runs the purge
        self.assertFalse(Announcement.objects.filter(pk=old.id).exists())

    def test_purge_removes_image(self):
        r = self.client.post('/api/announcements/', {**self.payload(), 'image': image_file()}, format='multipart')
        self.client.delete(f"/api/announcements/{r.data['id']}/")
        self.age(Announcement.objects.get(pk=r.data['id']), 31)
        self.trash_posts()
        self.assertEqual(StoredFile.objects.count(), 0)

    def test_category_waits_for_its_trashed_posts(self):
        cat = Category.objects.create(name='Temp', slug='temp', icon='tag', created_by=self.user)
        ann = self.make(category=cat)
        self.client.delete(f'/api/announcements/{ann.id}/')
        self.client.delete(f'/api/categories/{cat.id}/')
        self.age(cat, 40)
        self.age(ann, 10)
        self.assertEqual(self.trash_cats(), [cat.id])  # its post still has 20 days left
        item = self.client.get('/api/trash/categories/').data[0]
        self.assertGreater(item['purge_at'], (timezone.now() + timedelta(days=19)).isoformat())
        self.age(ann, 31)
        self.assertEqual(self.trash_cats(), [])
        self.assertFalse(Category.objects.filter(pk=cat.id).exists())

    def test_purge_command(self):
        from io import StringIO
        from django.core.management import call_command
        ann = self.make()
        self.client.delete(f'/api/announcements/{ann.id}/')
        self.age(ann, 31)
        out = StringIO()
        call_command('purge_trash', stdout=out)
        self.assertIn('Erased 1 post(s)', out.getvalue())

    def test_recreating_trashed_category_takes_it_out_of_trash(self):
        cat_id = self.client.post('/api/categories/', {'name': 'Clubs', 'icon': 'music', 'color': 'blue'}).data['id']
        self.client.delete(f'/api/categories/{cat_id}/')
        self.client.post('/api/categories/', {'name': 'Clubs', 'icon': 'music', 'color': 'blue'})
        self.assertEqual(self.trash_cats(), [])
        self.assertIsNone(Category.objects.get(pk=cat_id).removed_at)

    def test_trash_search(self):
        a, b = self.make(title='Pizza night'), self.make(title='Book sale')
        for x in (a, b):
            self.client.delete(f'/api/announcements/{x.id}/')
        r = self.client.get(f'/api/trash/announcements/?search=pizza&ids={a.id},{b.id}')
        self.assertEqual([x['id'] for x in r.data['results']], [a.id])


class FeedbackFilterTests(BaseCase):
    def ids(self, query):
        r = self.client.get(f'/api/announcements/{query}')
        self.assertEqual(r.status_code, 200, r.data)
        return [a['id'] for a in r.data['results']]

    def test_multiple_categories(self):
        food = self.make(title='food')
        ev = self.make(title='event', category=self.other_cat)
        self.make(title='survey', category=Category.objects.get(slug='surveys'))
        self.assertEqual(set(self.ids('?categories=food-drinks,events')), {food.id, ev.id})

    def test_since(self):
        old, new = self.make(title='old'), self.make(title='new')
        Announcement.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=2))
        since = (timezone.now() - timedelta(days=1)).isoformat()
        self.assertEqual(self.ids(f"?since={since.replace('+', '%2B')}"), [new.id])
        self.assertEqual(self.client.get('/api/announcements/?since=yesterday').status_code, 400)

    def test_ending_soon_uses_expiry_or_event_end(self):
        d = lambda n: timezone.localdate() + timedelta(days=n)  # noqa: E731
        by_expiry = self.make(title='expiry in 5', expires_at=d(5))
        by_event = self.make(title='event ends in 2', event_start=d(1), event_end=d(2))
        single = self.make(title='single day in 3', event_start=d(3))
        open_ended = self.make(title='no end')
        expected = [by_event.id, single.id, by_expiry.id, open_ended.id]
        self.assertEqual(self.ids('?ordering=ending'), expected)
        self.assertEqual(self.ids('?ordering=expiring'), expected)  # old name still works


class SellingTests(BaseCase):
    """Stock status and pickup places for categories that sell items."""

    def setUp(self):
        super().setUp()
        self.market = Category.objects.get(slug='marketplace')

    def post(self, **kw):
        r = self.client.post('/api/announcements/', self.payload(**kw), format='json')
        self.assertEqual(r.status_code, 201, r.data)
        return r.data

    def ids(self, query):
        r = self.client.get(f'/api/announcements/{query}')
        self.assertEqual(r.status_code, 200, r.data)
        return [a['id'] for a in r.data['results']]

    def test_selling_categories_flagged(self):
        flags = {c['slug']: c['sells_items'] for c in self.client.get('/api/categories/').data}
        self.assertEqual({k for k, v in flags.items() if v}, {'food-drinks', 'marketplace'})

    def test_defaults_to_available_with_timestamp(self):
        a = self.post()
        self.assertEqual(a['availability'], 'available')
        self.assertTrue(a['stock_updated_at'])

    def test_non_selling_category_ignores_stock_and_pickups(self):
        a = self.post(category=self.other_cat.id, availability='limited', pickup_locations=['Block C'])
        self.assertEqual((a['availability'], a['pickup_locations'], a['stock_updated_at']), ('', [], None))

    def test_one_tap_stock_update(self):
        a = self.post()
        first = a['stock_updated_at']
        r = self.client.patch(f"/api/announcements/{a['id']}/", {'availability': 'out'}, format='json')
        self.assertEqual((r.status_code, r.data['availability']), (200, 'out'))
        self.assertGreater(r.data['stock_updated_at'], first)
        same = self.client.patch(f"/api/announcements/{a['id']}/", {'title': 'Renamed post'}, format='json')
        self.assertEqual(same.data['stock_updated_at'], r.data['stock_updated_at'])  # unchanged stock
        self.assertEqual(self.client.patch(f"/api/announcements/{a['id']}/", {'availability': 'gone'}, format='json').status_code, 400)

    def test_pickup_tags_are_cleaned_deduplicated_and_shared(self):
        a = self.post(pickup_locations=['  Block  C lobby ', 'block c lobby', 'Library'])
        self.assertEqual(a['pickup_locations'], ['Block C lobby', 'Library'])
        b = self.post(pickup_locations=['BLOCK C LOBBY'])
        self.assertEqual(b['pickup_locations'], ['Block C lobby'])  # reuses the existing tag
        from announcements.models import PickupLocation
        self.assertEqual(PickupLocation.objects.count(), 2)

    def test_pickup_validation(self):
        bad = lambda tags: self.client.post('/api/announcements/', self.payload(pickup_locations=tags), format='json')  # noqa: E731
        self.assertEqual(bad(['x']).status_code, 400)
        self.assertEqual(bad(['p' * 41]).status_code, 400)
        self.assertEqual(bad([f'Place {i}' for i in range(6)]).status_code, 400)
        self.assertEqual(bad('not a list').status_code, 400)

    def test_pickups_via_multipart_json_string_and_clearing(self):
        r = self.client.post('/api/announcements/', {**self.payload(), 'pickup_locations': '["Hostel A", "Gate 2"]'}, format='multipart')
        self.assertEqual(r.data['pickup_locations'], ['Gate 2', 'Hostel A'])
        r = self.client.patch(f"/api/announcements/{r.data['id']}/", {'pickup_locations': '[]'}, format='multipart')
        self.assertEqual(r.data['pickup_locations'], [])

    def test_edit_without_pickups_keeps_them(self):
        a = self.post(pickup_locations=['Hostel A'])
        r = self.client.patch(f"/api/announcements/{a['id']}/", {'title': 'Updated title'}, format='json')
        self.assertEqual(r.data['pickup_locations'], ['Hostel A'])

    def test_moving_to_non_selling_category_clears_selling_fields(self):
        a = self.post(pickup_locations=['Hostel A'], availability='limited')
        r = self.client.patch(f"/api/announcements/{a['id']}/", {'category': self.other_cat.id}, format='json')
        self.assertEqual((r.data['availability'], r.data['pickup_locations']), ('', []))

    def test_filters_and_search(self):
        a = self.post(title='Kuih at Hostel A', pickup_locations=['Hostel A'])
        b = self.post(title='Fried rice', category=self.market.id, pickup_locations=['Gate 2'], availability='out')
        c = self.post(title='Laksa')
        self.assertEqual(self.ids('?pickup=hostel%20a'), [a['id']])
        self.assertEqual(set(self.ids('?stock=in')), {a['id'], c['id']})
        self.assertEqual(self.ids('?search=gate'), [b['id']])  # pickup places are searchable
        self.assertEqual(self.ids('?search=hostel'), [a['id']])  # no duplicates from the join

    def test_pickup_location_list(self):
        self.post(pickup_locations=['Hostel A', 'Gate 2'])
        self.post(pickup_locations=['Hostel A'])
        self.post(category=self.market.id, pickup_locations=['Library'])
        trashed = self.post(pickup_locations=['Old spot'])
        self.client.delete(f"/api/announcements/{trashed['id']}/")
        data = self.client.get('/api/pickup-locations/').data
        self.assertEqual([(r['name'], r['count']) for r in data], [('Hostel A', 2), ('Gate 2', 1), ('Library', 1)])
        food = self.client.get('/api/pickup-locations/?category=food-drinks').data
        self.assertEqual([r['name'] for r in food], ['Hostel A', 'Gate 2'])

    def test_user_category_can_sell_items(self):
        cat = self.client.post('/api/categories/', {'name': 'Preloved Clothes', 'icon': 'shirt', 'color': 'rose',
                                                    'sells_items': True}).data
        self.assertTrue(cat['sells_items'])
        a = self.post(category=cat['id'], pickup_locations=['Hostel B'])
        self.assertEqual((a['availability'], a['pickup_locations']), ('available', ['Hostel B']))


class CampusTimeZoneTests(BaseCase):
    def test_ended_event_hidden_after_midnight_malaysia_time(self):
        # 01:00 on 23 Nov in Malaysia is still 22 Nov in UTC. An event that ended on
        # 22 Nov must already be gone, not linger until 08:00.
        from datetime import date, datetime, timezone as dt_timezone
        from unittest import mock
        self.make(title='Sunday bazaar', event_start=date(2026, 11, 22))
        now = datetime(2026, 11, 22, 17, 0, tzinfo=dt_timezone.utc)
        with mock.patch('django.utils.timezone.now', return_value=now):
            self.assertEqual(self.public_titles(), [])

    def test_since_without_timezone_is_accepted(self):
        r = self.client.get('/api/announcements/?since=2026-11-21T08:00:00')
        self.assertEqual(r.status_code, 200)


class PushTests(BaseCase):
    """Phone notifications (Web Push) for followed categories."""
    FCM = 'https://fcm.googleapis.com/fcm/send/'

    def setUp(self):
        super().setUp()
        import base64
        import os
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec
        # A real subscriber key pair, as a browser would create.
        self.sub_key = ec.generate_private_key(ec.SECP256R1())
        raw = self.sub_key.public_key().public_bytes(serialization.Encoding.X962,
                                                     serialization.PublicFormat.UncompressedPoint)
        self.auth_secret = os.urandom(16)
        b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b'=').decode()  # noqa: E731
        self.keys = {'p256dh': b64(raw), 'auth': b64(self.auth_secret)}

    def subscribe(self, endpoint=None, categories=('food-drinks',), **settings):
        # Tests default to no limits so they don't depend on the time of day they run.
        body = {'subscription': {'endpoint': endpoint or self.FCM + 'device-1', 'keys': self.keys},
                'categories': list(categories), 'frequency': 'every', 'quiet_hours': False}
        body.update(settings)
        return self.client.post('/api/push/subscribe/', body, format='json')

    def test_public_key_is_stable_p256_point(self):
        import base64
        a = self.client.get('/api/push/key/').data['public_key']
        b = self.client.get('/api/push/key/').data['public_key']
        self.assertEqual(a, b)
        raw = base64.urlsafe_b64decode(a + '=' * (-len(a) % 4))
        self.assertEqual((len(raw), raw[0]), (65, 4))

    def test_subscribe_upserts_and_ignores_unknown_categories(self):
        from announcements.models import PushSubscription
        r = self.subscribe(categories=['food-drinks', 'nope'])
        self.assertEqual((r.status_code, r.data['categories']), (201, ['food-drinks']))
        self.assertEqual((r.data['frequency'], r.data['quiet_hours']), ('every', False))
        r = self.subscribe(categories=['events', 'marketplace'])
        self.assertEqual((r.status_code, r.data['categories']), (200, ['events', 'marketplace']))
        self.assertEqual(PushSubscription.objects.count(), 1)

    def test_only_real_push_services_are_accepted(self):
        for bad in ('http://fcm.googleapis.com/x', 'https://evil.example/x', 'https://fcm.googleapis.com.evil.example/x',
                    'https://127.0.0.1/x', 'https://localhost/x', 'not a url', 'https://fcm.googleapis.com:8443/x',
                    'https://jmt17.google.com.evil.example/x', 'https://sites.google.com/x', 'https://jmtx.google.com/x'):
            self.assertEqual(self.subscribe(endpoint=bad).status_code, 400, bad)
        for good in ('https://web.push.apple.com/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc',
                     'https://jmt17.google.com/fcm/send/abc',
                     'https://wns2-par02p.notify.windows.com/w/?token=abc'):
            self.assertEqual(self.subscribe(endpoint=good).status_code, 201, good)

    def test_bad_keys_and_categories_rejected(self):
        r = self.client.post('/api/push/subscribe/', {'subscription': {'endpoint': self.FCM + 'x', 'keys': {}}}, format='json')
        self.assertEqual(r.status_code, 400)
        r = self.client.post('/api/push/subscribe/', {'subscription': {'endpoint': self.FCM + 'x', 'keys': self.keys},
                                                      'categories': 'food-drinks'}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_unsubscribe(self):
        from announcements.models import PushSubscription
        self.subscribe()
        r = self.client.post('/api/push/unsubscribe/', {'endpoint': self.FCM + 'device-1'}, format='json')
        self.assertTrue(r.data['unsubscribed'])
        self.assertEqual(PushSubscription.objects.count(), 0)

    def test_new_post_notifies_followers_only(self):
        from unittest import mock
        self.subscribe(endpoint=self.FCM + 'food-fan', categories=['food-drinks'])
        self.subscribe(endpoint=self.FCM + 'events-fan', categories=['events'])
        with mock.patch('announcements.push._deliver', return_value='ok') as deliver:
            r = self.client.post('/api/announcements/', self.payload(title='Kuih lapis today'))
        self.assertEqual(r.status_code, 201)
        self.assertEqual([c.args[0]['endpoint'] for c in deliver.call_args_list], [self.FCM + 'food-fan'])
        payload = json.loads(deliver.call_args.args[1])
        self.assertEqual(payload['title'], 'New in Food & Drinks')
        self.assertIn('Kuih lapis today', payload['body'])
        self.assertEqual(payload['url'], f"/announcements/{r.data['id']}")

    def test_posting_still_works_if_push_breaks(self):
        from unittest import mock
        self.subscribe()
        with mock.patch('announcements.push.notify_new_announcement', side_effect=RuntimeError('boom')):
            self.assertEqual(self.client.post('/api/announcements/', self.payload()).status_code, 201)

    def test_real_encrypted_push_is_decryptable_and_signed(self):
        """End to end through pywebpush: encrypt for the subscriber, sign with our VAPID key."""
        import base64
        from unittest import mock
        import http_ece
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
        self.subscribe()
        resp = mock.Mock(status_code=201, text='', headers={})
        with mock.patch('requests.post', return_value=resp) as post:
            r = self.client.post('/api/announcements/', self.payload(title='Brownies at Block C'))
        self.assertEqual(r.status_code, 201)
        url = post.call_args.args[0]
        kw = post.call_args.kwargs
        self.assertEqual(url, self.FCM + 'device-1')
        # 1. The phone can decrypt it.
        plain = http_ece.decrypt(kw['data'], private_key=self.sub_key, auth_secret=self.auth_secret, version='aes128gcm')
        msg = json.loads(plain)
        self.assertEqual((msg['title'], msg['url']), ('New in Food & Drinks', f"/announcements/{r.data['id']}"))
        # 2. The push service can verify it came from us (VAPID JWT for its own origin).
        auth = kw['headers']['Authorization']
        token = auth.split('t=')[1].split(',')[0]
        head, body, sig = token.split('.')
        pad = lambda s: base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))  # noqa: E731
        claims = json.loads(pad(body))
        self.assertEqual(claims['aud'], 'https://fcm.googleapis.com')
        pub = self.client.get('/api/push/key/').data['public_key']
        self.assertIn(f'k={pub}', auth)
        raw_sig = pad(sig)
        der = encode_dss_signature(int.from_bytes(raw_sig[:32], 'big'), int.from_bytes(raw_sig[32:], 'big'))
        key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), pad(pub))
        key.verify(der, f'{head}.{body}'.encode(), ec.ECDSA(hashes.SHA256()))  # raises if invalid

    def test_each_send_is_signed_for_its_own_push_service(self):
        """pywebpush writes 'aud' into the claims dict; reusing one dict would sign for the wrong service."""
        import base64
        from unittest import mock
        self.subscribe(endpoint=self.FCM + 'a')
        self.subscribe(endpoint='https://web.push.apple.com/b')
        resp = mock.Mock(status_code=201, text='', headers={})
        with mock.patch('requests.post', return_value=resp) as post:
            self.client.post('/api/announcements/', self.payload())
        auds = set()
        for call in post.call_args_list:
            token = call.kwargs['headers']['Authorization'].split('t=')[1].split(',')[0]
            body = token.split('.')[1]
            auds.add(json.loads(base64.urlsafe_b64decode(body + '=' * (-len(body) % 4)))['aud'])
        self.assertEqual(auds, {'https://fcm.googleapis.com', 'https://web.push.apple.com'})

    def test_expired_subscription_is_removed(self):
        from unittest import mock
        from announcements.models import PushSubscription
        self.subscribe()
        resp = mock.Mock(status_code=410, text='gone', headers={})
        with mock.patch('requests.post', return_value=resp):
            self.client.post('/api/announcements/', self.payload())
        self.assertEqual(PushSubscription.objects.count(), 0)

    def test_test_notification(self):
        from unittest import mock
        self.assertEqual(self.client.post('/api/push/test/', {'endpoint': self.FCM + 'unknown'}, format='json').status_code, 404)
        self.subscribe()
        with mock.patch('announcements.push.send', return_value=True):
            r = self.client.post('/api/push/test/', {'endpoint': self.FCM + 'device-1'}, format='json')
        self.assertEqual((r.status_code, r.data), (200, {'sent': True}))

    # ---- anti-spam limits ----
    def sub(self, **kw):
        from announcements.models import PushSubscription
        return PushSubscription(endpoint=self.FCM + 'x', p256dh='p', auth='a', **kw)

    def at(self, hhmm, day=21):
        from datetime import datetime, timezone as tz
        h, m = map(int, hhmm.split(':'))
        return datetime(2026, 11, day, h, m, tzinfo=tz.utc)

    def test_defaults_are_conservative(self):
        from announcements.models import PushSubscription
        r = self.client.post('/api/push/subscribe/', {
            'subscription': {'endpoint': self.FCM + 'd', 'keys': self.keys}, 'categories': ['events']}, format='json')
        self.assertEqual((r.data['frequency'], r.data['quiet_hours']), ('hourly', True))
        self.assertEqual(PushSubscription.objects.get().frequency, 'hourly')

    def test_invalid_settings_rejected(self):
        self.assertEqual(self.subscribe(frequency='always').status_code, 400)
        self.assertEqual(self.subscribe(utc_offset_minutes=99999).status_code, 400)
        self.assertEqual(self.subscribe(utc_offset_minutes='abc').status_code, 400)

    def test_quiet_hours_use_device_local_time(self):
        my = self.sub(quiet_hours=True, utc_offset_minutes=480, frequency='every')  # Malaysia, UTC+8
        self.assertFalse(my.may_notify(self.at('15:00')))   # 23:00 local
        self.assertFalse(my.may_notify(self.at('22:30')))   # 06:30 local
        self.assertTrue(my.may_notify(self.at('23:00')))    # 07:00 local
        self.assertTrue(my.may_notify(self.at('13:59')))    # 21:59 local
        off = self.sub(quiet_hours=False, utc_offset_minutes=480, frequency='every')
        self.assertTrue(off.may_notify(self.at('15:00')))
        from zoneinfo import ZoneInfo
        kuching = self.at('15:00').astimezone(ZoneInfo('Asia/Kuching'))  # same instant, 23:00 Kuching time
        self.assertFalse(my.may_notify(kuching))
        london = self.sub(quiet_hours=True, utc_offset_minutes=0, frequency='every')
        self.assertTrue(london.may_notify(kuching))  # 15:00 in London

    def test_hourly_and_daily_limits(self):
        from datetime import timedelta
        now = self.at('04:00')  # 12:00 in Malaysia
        hourly = self.sub(frequency='hourly', quiet_hours=False, utc_offset_minutes=480, last_sent_at=now - timedelta(minutes=59))
        self.assertFalse(hourly.may_notify(now))
        hourly.last_sent_at = now - timedelta(minutes=61)
        self.assertTrue(hourly.may_notify(now))
        # "Once a day" follows the device's calendar day, not UTC's.
        daily = self.sub(frequency='daily', quiet_hours=False, utc_offset_minutes=480,
                         last_sent_at=self.at('15:30', day=20))   # 23:30 local yesterday
        self.assertTrue(daily.may_notify(now))
        daily.last_sent_at = self.at('16:30', day=20)             # 00:30 local today (still the 20th in UTC)
        self.assertFalse(daily.may_notify(now))
        every = self.sub(frequency='every', quiet_hours=False, last_sent_at=now)
        self.assertTrue(every.may_notify(now))

    def test_second_post_within_the_hour_is_not_pushed(self):
        from unittest import mock
        self.subscribe(frequency='hourly')
        with mock.patch('announcements.push._deliver', return_value='ok') as deliver:
            self.client.post('/api/announcements/', self.payload(title='First post'))
            self.client.post('/api/announcements/', self.payload(title='Second post'))
        self.assertEqual(deliver.call_count, 1)
        self.assertIn('First post', json.loads(deliver.call_args.args[1])['body'])

    def test_test_notification_does_not_use_up_the_limit(self):
        from unittest import mock
        self.subscribe(frequency='hourly')
        with mock.patch('announcements.push._deliver', return_value='ok') as deliver:
            self.client.post('/api/push/test/', {'endpoint': self.FCM + 'device-1'}, format='json')
            self.client.post('/api/announcements/', self.payload(title='Real post'))
        self.assertEqual(deliver.call_count, 2)

    def test_notifications_replace_per_category(self):
        from announcements.push import payload_for
        a = self.make(title='One')
        b = self.make(title='Two')
        c = self.make(title='Three', category=self.other_cat)
        self.assertEqual(payload_for(a)['tag'], payload_for(b)['tag'])
        self.assertNotEqual(payload_for(a)['tag'], payload_for(c)['tag'])

    def test_status(self):
        self.assertEqual(self.client.post('/api/push/status/', {'endpoint': self.FCM + 'nope'}, format='json').data,
                         {'subscribed': False})
        self.subscribe(categories=['events'], frequency='daily', quiet_hours=True, utc_offset_minutes=480)
        r = self.client.post('/api/push/status/', {'endpoint': self.FCM + 'device-1'}, format='json')
        self.assertEqual(r.data, {'subscribed': True, 'categories': ['events'], 'frequency': 'daily',
                                  'quiet_hours': True, 'utc_offset_minutes': 480})



class OwnershipTests(BaseCase):
    """Only the account that posted can change a post."""

    def setUp(self):
        super().setUp()
        self.bob = APIClient()
        self.bob.force_authenticate(User.objects.create_user('bob', password=PW, first_name='Bob'))

    def test_others_cannot_edit_delete_or_change_stock(self):
        a = self.client.post('/api/announcements/', self.payload(title='Brownies', availability='out'), format='json').data
        url = f"/api/announcements/{a['id']}/"
        r = self.bob.patch(url, {'availability': 'available'}, format='json')
        self.assertEqual(r.status_code, 403)
        self.assertIn('Only the person who posted this', r.data['detail'])
        self.assertEqual(self.bob.delete(url).status_code, 403)
        self.assertEqual(APIClient().patch(url, {'title': 'x'}, format='json').status_code, 401)
        self.assertFalse(self.bob.get(url).data['can_edit'])
        a2 = Announcement.objects.get(pk=a['id'])
        self.assertEqual((a2.title, a2.availability, a2.status), ('Brownies', 'out', 'approved'))

    def test_owner_can_edit_stock_and_delete(self):
        a = self.client.post('/api/announcements/', self.payload(availability='out'), format='json').data
        url = f"/api/announcements/{a['id']}/"
        self.assertEqual(self.client.patch(url, {'availability': 'available'}, format='json').data['availability'], 'available')
        self.assertEqual(self.client.delete(url).status_code, 204)

    def test_posts_without_an_owner_are_admin_only(self):
        legacy = Announcement.objects.create(title='Old post', description='Made before accounts.', category=self.cat,
                                             publisher_name='Priya', status='approved')
        r = self.client.patch(f'/api/announcements/{legacy.id}/', {'title': 'x'}, format='json')
        self.assertEqual(r.status_code, 403)
        self.assertIn('site admin', r.data['detail'])

    def test_trash_is_per_account(self):
        mine = self.make(title='Mine')
        self.client.delete(f'/api/announcements/{mine.id}/')
        self.assertEqual(self.bob.get('/api/trash/announcements/').data['count'], 0)
        self.assertEqual(APIClient().get('/api/trash/announcements/').data['count'], 0)
        self.assertEqual(self.bob.post(f'/api/trash/announcements/{mine.id}/restore/').status_code, 403)
        self.assertEqual(self.client.post(f'/api/trash/announcements/{mine.id}/restore/').status_code, 200)

    def test_my_posts_filter(self):
        self.make(title='Mine')
        Announcement.objects.create(title='Theirs', description='Someone else posted this.', category=self.cat,
                                    publisher_name='Bob', status='approved')
        self.assertEqual(self.public_titles('/api/announcements/?mine=1'), ['Mine'])
        self.assertEqual(APIClient().get('/api/announcements/?mine=1').data['count'], 0)

    def test_claim_posts_made_with_a_browser_key(self):
        key = 'browser-edit-key-123456'
        keyed = Announcement.objects.create(title='Keyed', description='Made with an edit key.', category=self.cat,
                                            publisher_name='Kiro', status='approved', edit_token_hash=hash_token(key))
        r = self.bob.post('/api/auth/claim/', {'keys': {str(keyed.id): 'wrong'}}, format='json')
        self.assertEqual(r.data['claimed'], [])
        r = self.client.post('/api/auth/claim/', {'keys': {str(keyed.id): key, 'x': 'y'}}, format='json')
        self.assertEqual(r.data['claimed'], [keyed.id])
        keyed.refresh_from_db()
        self.assertEqual((keyed.publisher, keyed.edit_token_hash), (self.user, ''))
        self.assertEqual(self.bob.post('/api/auth/claim/', {'keys': {str(keyed.id): key}}, format='json').data['claimed'], [])
        self.assertEqual(APIClient().post('/api/auth/claim/', {'keys': {}}, format='json').status_code, 401)




class SeedDemoAdminTests(APITestCase):
    """The repo is public, so seed_demo must never create the admin with a fixed password."""

    def run_seed(self, **env):
        from unittest import mock
        from django.core.management import call_command
        out = io.StringIO()
        with mock.patch.dict('os.environ', env, clear=False):
            call_command('seed_demo', '--no-images', stdout=out)
        return out.getvalue(), User.objects.get(username='admin')

    def test_random_password_is_printed_once_and_works(self):
        import os
        os.environ.pop('SEED_ADMIN_PASSWORD', None)
        out, admin = self.run_seed()
        self.assertFalse(admin.check_password('Admin12345!'))
        password = out.split('admin / ', 1)[1].split(' ', 1)[0]
        self.assertTrue(admin.check_password(password))
        out2, _ = self.run_seed()  # second run leaves the password alone and doesn't print it
        self.assertNotIn(password, out2)

    def test_password_from_environment(self):
        _, admin = self.run_seed(SEED_ADMIN_PASSWORD='Env-pass-2026!')
        self.assertTrue(admin.check_password('Env-pass-2026!'))


class GuestContactTests(BaseCase):
    """Phone numbers and emails are only shown to signed-in students (stops scraping)."""

    def test_guest_sees_no_phone_or_email_but_keeps_links(self):
        wa = self.make()
        mail = self.make(contact_method='email', contact_info='seller@example.com')
        link = self.make(contact_method='link', contact_info='https://forms.gle/abc')
        guest = APIClient()
        for post, want in ((wa, ''), (mail, ''), (link, 'https://forms.gle/abc')):
            self.assertEqual(guest.get(f'/api/announcements/{post.id}/').data['contact_info'], want)
        listed = {p['id']: p['contact_info'] for p in guest.get('/api/announcements/').data['results']}
        self.assertEqual(listed[wa.id], '')
        # Any signed-in student sees it, not only the owner.
        bob = APIClient(); bob.force_authenticate(User.objects.create_user('bob', password=PW))
        self.assertEqual(bob.get(f'/api/announcements/{wa.id}/').data['contact_info'], '60123456789')


class DeleteAccountTests(BaseCase):
    """Users can erase their account and posts themselves."""

    def test_wrong_password_keeps_everything(self):
        self.make()
        self.assertEqual(self.client.delete('/api/auth/me/', {'password': 'nope'}).status_code, 400)
        self.assertTrue(User.objects.filter(pk=self.user.pk).exists())
        self.assertEqual(Announcement.objects.count(), 1)

    def test_deletes_account_posts_images_and_token(self):
        bob = User.objects.create_user('bob', password=PW)
        theirs = self.make(publisher=bob)
        mine = self.make(image=image_file())
        self.make(status='removed')  # posts in the Trash go too
        stored = mine.image.name
        self.assertEqual(self.client.delete('/api/auth/me/', {'password': PW}).status_code, 204)
        self.assertFalse(User.objects.filter(username='alice').exists())
        self.assertEqual(list(Announcement.objects.values_list('id', flat=True)), [theirs.id])
        self.assertFalse(StoredFile.objects.filter(name=stored).exists())


class AiAutofillTests(BaseCase):
    """Paste-to-post with DeepSeek mocked out: the AI only ever suggests clean, known fields."""
    CATS = {'food-drinks': 'Food & Drinks', 'marketplace': 'Student Marketplace'}

    def test_clean_keeps_only_valid_fields(self):
        from announcements.ai_fill import _clean
        out = _clean({
            'title': '  Nasi lemak  ', 'category': 'food-drinks', 'event_start': '2026-11-28',
            'event_end': '2026-11-27', 'pickup_locations': ['Block C lobby', 'x', 3],
            'contact_method': 'whatsapp', 'contact_info': '+60 12-345 6789', 'price': 'RM6', 'hack': '<b>',
        }, self.CATS)
        self.assertEqual(out, {'title': 'Nasi lemak', 'category': 'food-drinks', 'event_start': '2026-11-28',
                               'pickup_locations': ['Block C lobby'], 'contact_method': 'whatsapp',
                               'contact_info': '60123456789'})

    def test_clean_rejects_unknown_category_bad_date_and_bad_contact(self):
        from announcements.ai_fill import _clean
        out = _clean({'title': 'Talk', 'category': 'nope', 'event_start': 'Friday',
                      'contact_method': 'email', 'contact_info': 'not-an-email'}, self.CATS)
        self.assertEqual(out, {'title': 'Talk'})
        self.assertIsNone(_clean([1, 2], self.CATS))
        self.assertIsNone(_clean({}, self.CATS))

    def run_autofill(self, reply=None, error=None, key='test-key'):
        import os
        from unittest import mock
        from announcements import ai_fill
        def fake_call(system, user, timeout):
            if error:
                raise error
            return reply, {'prompt_tokens': 10, 'completion_tokens': 5}
        with mock.patch.dict(os.environ, {'DEEPSEEK_API_KEY': key} if key else {}, clear=False), \
                mock.patch.object(ai_fill, '_call', side_effect=fake_call):
            if not key:
                os.environ.pop('DEEPSEEK_API_KEY', None)
            return ai_fill.autofill('Nasi lemak RM6, Block C lobby, WhatsApp 0123456789', self.CATS)

    def test_autofill_good_blank_timeout_and_off(self):
        good = self.run_autofill(reply='{"title": "Nasi lemak", "category": "food-drinks"}')
        self.assertEqual(good, {'title': 'Nasi lemak', 'category': 'food-drinks'})
        self.assertIsNone(self.run_autofill(reply='   '))           # DeepSeek's known blank-JSON reply
        self.assertIsNone(self.run_autofill(error=TimeoutError()))  # slow or busy
        self.assertIsNone(self.run_autofill(reply='{"title": "x"}', key=''))  # no key = switched off

    def test_endpoint(self):
        import os
        from unittest import mock
        from announcements import ai_fill
        with mock.patch.dict(os.environ, {'DEEPSEEK_API_KEY': 'test-key'}):
            self.assertEqual(APIClient().get('/api/ai/autofill/').data, {'enabled': True})
            self.assertEqual(APIClient().post('/api/ai/autofill/', {'text': 'hi'}, format='json').status_code, 401)
            self.assertEqual(self.client.post('/api/ai/autofill/', {'text': '  '}, format='json').status_code, 400)
            with mock.patch.object(ai_fill, 'autofill', return_value={'title': 'Nasi lemak'}) as fake:
                r = self.client.post('/api/ai/autofill/', {'text': 'Nasi lemak RM6'}, format='json')
            self.assertEqual(r.data, {'ok': True, 'fields': {'title': 'Nasi lemak'}})
            self.assertIn('food-drinks', fake.call_args.args[1])  # real categories are passed in
            with mock.patch.object(ai_fill, 'autofill', return_value=None):
                self.assertFalse(self.client.post('/api/ai/autofill/', {'text': 'x'}, format='json').data['ok'])
        os.environ.pop('DEEPSEEK_API_KEY', None)
        self.assertEqual(APIClient().get('/api/ai/autofill/').data, {'enabled': False})
        self.assertEqual(self.client.post('/api/ai/autofill/', {'text': 'x'}, format='json').status_code, 503)


class AiRetryTests(BaseCase):
    def test_retries_once_after_a_failed_try(self):
        import os
        from unittest import mock
        from announcements import ai_fill
        replies = iter([TimeoutError(), ('{"title": "Lost umbrella"}', {})])
        def fake_call(system, user, timeout):
            r = next(replies)
            if isinstance(r, Exception):
                raise r
            return r
        with mock.patch.dict(os.environ, {'DEEPSEEK_API_KEY': 'test-key'}), mock.patch.object(ai_fill, '_call', side_effect=fake_call) as call:
            out = ai_fill.autofill('Lost black umbrella', {'other': 'Other'})
        self.assertEqual(out, {'title': 'Lost umbrella'})
        self.assertEqual(call.call_count, 2)
