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
        self.make(expires_at=timezone.localdate() - timedelta(days=1))
        self.assertEqual(self.client.delete(f'/api/categories/{self.cat.id}/').status_code, 400)

    def test_removed_posts_do_not_block_delete(self):
        self.make(status='removed')
        self.assertEqual(self.client.delete(f'/api/categories/{self.cat.id}/').status_code, 204)

    def test_builtin_categories_can_be_deleted_when_empty(self):
        other = Category.objects.get(slug='other')
        self.assertEqual(self.client.delete(f'/api/categories/{other.id}/').status_code, 204)
        self.assertEqual(len(self.client.get('/api/categories/').data), 5)

    def test_cannot_post_into_deleted_category(self):
        self.client.delete(f'/api/categories/{self.other_cat.id}/')
        r = self.client.post('/api/announcements/', self.payload(category=self.other_cat.id))
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
        return [a['id'] for a in self.client.get('/api/trash/announcements/').data['results']]

    def trash_cats(self):
        return [c['id'] for c in self.client.get('/api/trash/categories/').data]

    def age(self, obj, days):
        type(obj).objects.filter(pk=obj.pk).update(removed_at=timezone.now() - timedelta(days=days))

    def test_deleted_post_goes_to_trash_with_purge_date(self):
        ann = self.make()
        self.client.delete(f'/api/announcements/{ann.id}/')
        r = self.client.get('/api/trash/announcements/')
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
        self.client.delete(f'/api/categories/{self.other_cat.id}/')
        self.assertEqual(self.trash_cats(), [self.other_cat.id])
        r = self.client.post(f'/api/trash/categories/{self.other_cat.id}/restore/')
        self.assertEqual((r.status_code, r.data['slug']), (200, 'events'))
        self.assertEqual(self.trash_cats(), [])
        self.assertIn('events', [c['slug'] for c in self.client.get('/api/categories/').data])

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
        cat = Category.objects.create(name='Temp', slug='temp', icon='tag')
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
        r = self.client.get('/api/trash/announcements/?search=pizza')
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
