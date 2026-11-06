import json
import tempfile
import zipfile
from pathlib import Path
from django.contrib.auth import get_user_model
from django.core.files.storage import default_storage
from django.core.management import call_command
from django.test import TransactionTestCase, override_settings
from rest_framework.test import APIClient
from .tests import CommunityFixture, photo
from .models import Submission, SubmissionStepImage, StoredMedia, MediaQuota
from .services import review_submission, ReviewConflict
from .images import clean_image

class CampusContributionTests(CommunityFixture):
    def image_status(self, client, path):
        response = client.get(path)
        if response.streaming:
            # Django's test iterator closes the response without closing the test transaction.
            b''.join(response.streaming_content)
        return response.status_code
    def route_data(self, **extra):
        return {**self.payload, "kind": "new_route", "title": "图书馆入口路线", "map_data": {
            "originId": "gate", "destinationId": "library", "steps": [
                {"title": "从校园入口出发", "body": "沿有顶通道前进，到路口右转。"},
                {"title": "到达图书馆入口", "body": "对照入口照片确认位置。"},
            ]}, **extra}

    def route(self, images=True):
        values = self.route_data()
        if images:
            values["map_data"] = json.dumps(values["map_data"])
            values.update(step_image_0=photo(), step_image_1=photo())
        response = self.api.post('/api/submissions/', values, format='multipart' if images else 'json')
        self.assertEqual(response.status_code, 201, response.content)
        return Submission.objects.get(pk=response.json()['submission']['id'])

    def test_place_enters_catalog_only_after_approval_and_can_be_unpublished(self):
        item = self.submit(kind='new_place', title='饭堂', map_data={"category": "food", "x": 110, "y": 320, "english": "New canteen", "entrance": "从前方入口进入。", "floor": "G/F"})
        self.assertEqual(self.anon.get('/api/campus/').json(), {'places': [], 'routes': []})
        item = review_submission(item.pk, 1, 'approved', '', self.admin)
        place = self.anon.get('/api/campus/').json()['places'][0]
        self.assertEqual(place['id'], 'community-place-' + str(item.public_entry_id))
        self.assertEqual((place['name'], place['x'], place['category']), ('饭堂', 110, 'food'))
        item.public_entry.published = False
        item.public_entry.save()
        self.assertEqual(self.anon.get('/api/campus/').json()['places'], [])

    def test_invalid_coordinates_and_route_fields_are_rejected(self):
        for patch in [{'x': -1}, {'x': 'abc'}, {'y': 581}, {'x': True}, {'x': 10**400}, {'category': 'all'}, {'category': []}]:
            data = {**self.payload, 'kind': 'new_place', 'map_data': {'category': 'food', 'x': 10, 'y': 20, **patch}}
            self.assertEqual(self.api.post('/api/submissions/', data, format='json').status_code, 400)
        for route in [ {'originId': 'gate', 'destinationId': 'gate', 'steps': []},
            {'originId': 'invented', 'destinationId': 'main', 'steps': [{'title': '出发', 'body': '前进'}]},
            {'originId': 'gate', 'destinationId': 'main', 'steps': [{'title': '', 'body': '前进'}]} ]:
            self.assertEqual(self.api.post('/api/submissions/', self.route_data(map_data=route), format='json').status_code, 400)
        self.assertEqual(Submission.objects.count(), 0)

    def test_step_images_are_private_sanitized_then_public_and_follow_unpublishing(self):
        item = self.route()
        content = self.api.get(f'/api/submissions/{item.pk}/').json()['submission']
        path = content['mapData']['steps'][0]['imageUrl']
        self.assertEqual(self.image_status(self.anon, path), 404)
        self.assertEqual(self.image_status(self.api, path), 200)
        self.api.credentials(HTTP_AUTHORIZATION='Bearer ' + self.token)
        other = APIClient()
        from .authentication import create_session
        other.credentials(HTTP_AUTHORIZATION='Bearer ' + create_session(self.other))
        self.assertEqual(self.image_status(other, path), 404)
        image = item.step_images.first()
        from PIL import Image
        with Image.open(image.image.path) as decoded:
            self.assertLessEqual(max(decoded.size), 1600)
            self.assertFalse(decoded.getexif())
        item = review_submission(item.pk, 1, 'approved', '', self.admin)
        result = self.anon.get('/api/campus/').json()['routes'][0]
        self.assertEqual(len(result['steps']), 2)
        self.assertEqual(self.image_status(self.anon, path), 200)
        item.public_entry.published = False
        item.public_entry.save()
        self.assertEqual(self.image_status(self.anon, path), 404)
        self.assertEqual(self.anon.get('/api/campus/').json()['routes'], [])

    def test_route_edit_keeps_old_public_version_and_inherits_photos_in_new_order(self):
        item = review_submission(self.route().pk, 1, 'approved', '', self.admin)
        previous = list(item.step_images.all())
        public = self.api.get(f'/api/submissions/{item.pk}/').json()['submission']['publishedContent']
        old_url = public['mapData']['steps'][0]['imageUrl']
        data = self.route_data(request_key='new_route_version', base_version=public['version'],
            inherit_step_images={'0': 1, '1': 0})
        data['map_data']['steps'].reverse()
        response = self.api.post(f'/api/submissions/{item.pk}/edits/', data, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        edit = Submission.objects.get(pk=response.json()['submission']['id'])
        self.assertEqual(edit.step_images.get(step_index=0).image.name, previous[1].image.name)
        pending_url = response.json()['submission']['mapData']['steps'][0]['imageUrl']
        self.assertEqual(self.image_status(self.anon, pending_url), 404)
        self.assertEqual(self.image_status(self.anon, old_url), 200)
        old_route = self.anon.get('/api/campus/').json()['routes'][0]
        edit = review_submission(edit.pk, 1, 'approved', '', self.admin)
        new_route = self.anon.get('/api/campus/').json()['routes'][0]
        self.assertEqual(new_route['id'], old_route['id'])
        self.assertEqual(new_route['steps'][0]['title'], '到达图书馆入口')
        self.assertEqual(self.image_status(self.anon, pending_url), 200)
        self.assertEqual(self.image_status(self.anon, old_url), 404)

    def test_resubmission_reorders_photos_and_removes_deleted_steps(self):
        item = self.route()
        before = list(item.step_images.all())
        item = review_submission(item.pk, 1, 'changes_requested', '补充步骤', self.admin)
        data = self.route_data(revision=item.revision, inherit_step_images={'0': 1})
        data['map_data']['steps'] = [data['map_data']['steps'][1]]
        with self.captureOnCommitCallbacks(execute=True):
            response = self.api.patch(f'/api/submissions/{item.pk}/', data, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(item.step_images.count(), 1)
        self.assertEqual(item.step_images.first().image.name, before[1].image.name)
        self.assertFalse(default_storage.exists(before[0].image.name))

    def test_step_upload_retry_does_not_duplicate_and_bad_file_indexes_fail(self):
        item = self.route()
        payload = self.route_data()
        payload['map_data'] = json.dumps(payload['map_data'])
        response = self.api.post('/api/submissions/', {**payload, 'step_image_0': photo(), 'step_image_1': photo()}, format='multipart')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['submission']['id'], str(item.pk))
        self.assertEqual(SubmissionStepImage.objects.count(), 2)
        self.assertEqual(self.api.post('/api/submissions/', {**payload, 'request_key': 'bad_step_index', 'step_image_20': photo()}, format='multipart').status_code, 400)

    def test_unknown_inherited_photo_cannot_create_an_edit(self):
        item = review_submission(self.route().pk, 1, 'approved', '', self.admin)
        version = item.public_entry.updated_at.isoformat()
        response = self.api.post(f'/api/submissions/{item.pk}/edits/', self.route_data(request_key='missing_image_key', base_version=version, inherit_step_images={'0': 19}), format='json')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Submission.objects.count(), 1)

    def test_route_endpoints_are_checked_again_at_approval(self):
        place = review_submission(self.submit(kind='new_place', map_data={'category': 'building', 'x': 10, 'y': 20}).pk, 1, 'approved', '', self.admin)
        values = self.route_data(request_key='route_new_endpoint')
        values['map_data']['destinationId'] = 'community-place-' + str(place.public_entry_id)
        response = self.api.post('/api/submissions/', values, format='json')
        self.assertEqual(response.status_code, 201)
        item = Submission.objects.get(pk=response.json()['submission']['id'])
        place.public_entry.published = False
        place.public_entry.save()
        with self.assertRaises(ReviewConflict):
            review_submission(item.pk, 1, 'approved', '', self.admin)
        item.refresh_from_db()
        self.assertEqual(item.status, 'pending')

    def test_admin_reordering_preserves_photo_association_and_removed_photos_stop_being_public(self):
        item = review_submission(self.route().pk, 1, 'approved', '', self.admin)
        old = self.anon.get('/api/campus/').json()['routes'][0]
        entry = item.public_entry
        entry.map_data['steps'].reverse()
        entry.full_clean()
        entry.save()
        reordered = self.anon.get('/api/campus/').json()['routes'][0]
        self.assertEqual(reordered['steps'][0]['imageUrl'], old['steps'][1]['imageUrl'])
        entry.map_data['steps'].pop(0)
        entry.full_clean()
        entry.save()
        self.assertEqual(self.image_status(self.anon, old['steps'][1]['imageUrl']), 404)
        self.assertEqual(self.image_status(self.anon, old['steps'][0]['imageUrl']), 200)

    def test_capacity_failure_cleans_all_prepared_step_images(self):
        size = clean_image(photo()).size
        with override_settings(STORAGES={'default': {'BACKEND': 'community.storage.DatabaseStorage'}, 'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'}}, MEDIA_DATABASE_MAX_BYTES=size + 10):
            data = self.route_data()
            data['map_data'] = json.dumps(data['map_data'])
            response = self.api.post('/api/submissions/', {**data, 'step_image_0': photo(), 'step_image_1': photo()}, format='multipart')
            self.assertEqual(response.status_code, 400)
            self.assertFalse(Submission.objects.exists())
            self.assertFalse(StoredMedia.objects.exists())
            self.assertEqual(MediaQuota.objects.get(pk=1).used_bytes, 0)


class CampusBackupTests(TransactionTestCase):
    def test_step_photos_are_included_in_portable_backup(self):
        # The command starts its own repeatable-read transaction on PostgreSQL.
        with tempfile.TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=Path(directory) / 'media'):
            author = get_user_model().objects.create_user('campus_backup_fixture')
            item = Submission.objects.create(author=author, kind=Submission.Kind.NEW_ROUTE, title='Backup route')
            step_photo = SubmissionStepImage.objects.create(submission=item, step_index=0, image=photo())
            output = Path(directory) / 'backup.zip'
            call_command('backup_project', output=str(output), verbosity=0)
            with zipfile.ZipFile(output) as backup:
                self.assertTrue(backup.read('uploads/' + step_photo.image.name).startswith(b'\xff\xd8'))
