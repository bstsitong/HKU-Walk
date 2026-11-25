from .models import Submission
from .services import review_submission
from .tests import CommunityFixture


class PlaceIntroductionTests(CommunityFixture):
    def place_payload(self, **values):
        return {'kind': 'new_place', 'title': '新地点', 'body': '', 'request_key': 'place_intro_001',
                'map_data': {'category': 'building', 'x': 100, 'y': 200, 'mapVersion': 2}, **values}

    def publish(self, payload):
        response = self.api.post('/api/submissions/', payload, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        identifier = response.json()['submission']['id']
        return review_submission(identifier, 1, 'approved', '', self.admin)

    def public_place(self, item):
        places = self.anon.get('/api/campus/?mapVersion=2&classrooms=1').json()['places']
        return next(place for place in places if place['entryId'] == str(item.public_entry_id))

    def test_empty_short_and_multiline_introductions_publish_without_fallback(self):
        for index, introduction in enumerate(('', '静', '适合自习。', '第一段地点介绍。\n第二段交通信息。')):
            item = self.publish(self.place_payload(body=introduction, request_key=f'place_intro_{index:03}'))
            self.assertEqual(item.body, introduction)
            self.assertEqual(item.public_entry.place.body, introduction)
            self.assertEqual(self.public_place(item)['description'], introduction)

    def test_omitted_introduction_is_optional(self):
        payload = self.place_payload()
        del payload['body']
        item = self.publish(payload)
        self.assertEqual(self.public_place(item)['description'], '')

    def test_intro_is_not_prefixed_with_unrelated_location_metadata(self):
        item = self.publish(self.place_payload(body='地点简介', location='旧版位置字段'))
        self.assertEqual(self.public_place(item)['description'], '地点简介')

    def test_edit_can_clear_intro_without_changing_place_identity(self):
        original = self.publish(self.place_payload(body='已有简介'))
        entry = original.public_entry
        response = self.api.post(f'/api/submissions/{original.pk}/edits/', self.place_payload(
            body='', request_key='clear_place_intro_002', base_version=entry.updated_at.isoformat()), format='json')
        self.assertEqual(response.status_code, 201, response.content)
        edit = review_submission(response.json()['submission']['id'], 1, 'approved', '', self.admin)
        self.assertEqual(edit.public_entry_id, entry.pk)
        self.assertEqual(self.public_place(edit)['description'], '')
        self.assertEqual(Submission.objects.get(pk=original.pk).body, '已有简介')
