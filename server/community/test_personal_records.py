from rest_framework.test import APIClient

from .authentication import create_session
from .tests import CommunityFixture


URL = "/api/accounts/me/records/"
PHONE = "phone-records-test-01"
TABLET = "tablet-records-test-02"


def change(collection, action, value=None):
    return {"collection": collection, "action": action, **({"value": value} if value is not None else {})}


class PersonalRecordsTests(CommunityFixture):
    def another_client(self, user):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {create_session(user)}")
        return client

    def patch(self, client, device, first, *changes):
        response = client.patch(URL, {"device": device, "first": first, "changes": changes}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["records"]

    def test_records_sync_between_devices_and_stay_private_to_account(self):
        tablet = self.another_client(self.owner)
        route = {"id": "demo:main-building>library", "originId": "main-building",
                 "destinationId": "library", "source": "demo"}
        self.patch(self.api, PHONE, 1,
                   change("saved_posts", "import", "43"),
                   change("saved_routes", "save", route),
                   change("recent_places", "visit", "library"))
        actual = self.patch(tablet, TABLET, 1, change("saved_places", "save", "main-building"))
        self.assertEqual(actual, {"saved_posts": ["43"], "saved_routes": [route],
                                  "recent_places": ["library"], "saved_places": ["main-building"]})
        response = self.api.get(URL)
        self.assertEqual(response.json()["records"], actual)
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertEqual(self.another_client(self.other).get(URL).json(), {"records": {}})
        self.assertEqual(self.anon.get(URL).status_code, 401)
        self.assertEqual(self.anon.patch(URL, {}, format="json").status_code, 401)

    def test_retries_and_legacy_import_cannot_revive_removed_items(self):
        tablet = self.another_client(self.owner)
        save = change("saved_posts", "save", "43")
        visit = change("recent_posts", "visit", "43")
        self.patch(self.api, PHONE, 1, save, visit)
        self.patch(tablet, TABLET, 1, change("saved_posts", "remove", "43"), change("recent_posts", "clear"))
        actual = self.patch(self.api, PHONE, 1, save, visit,
                            change("saved_posts", "import", "43"), change("recent_posts", "import", "43"))
        self.assertEqual(actual, {"saved_posts": [], "recent_posts": []})
        actual = self.patch(self.api, PHONE, 5, save, visit)
        self.assertEqual(actual, {"saved_posts": ["43"], "recent_posts": ["43"]})

    def test_history_is_deduplicated_ordered_and_limited(self):
        visits = [change("recent_posts", "visit", str(index)) for index in range(1, 15)]
        visits.append(change("recent_posts", "visit", "3"))
        actual = self.patch(self.api, PHONE, 1, *visits)["recent_posts"]
        self.assertEqual(actual, ["3", *map(str, range(14, 3, -1))])

    def test_invalid_route_rejects_the_entire_batch(self):
        response = self.api.patch(URL, {"device": PHONE, "first": 1, "changes": [
            change("saved_posts", "save", "43"),
            change("saved_routes", "save", {"id": "demo:other>library", "originId": "main-building",
                                           "destinationId": "library", "source": "demo"}),
        ]}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.api.get(URL).json(), {"records": {}})
