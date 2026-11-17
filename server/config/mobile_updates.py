import json
import mimetypes
import re

from django.conf import settings
from django.http import FileResponse, Http404, HttpResponse
from django.views.decorators.http import require_safe


RUNTIME = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+")
ASSET = re.compile(r"[a-f0-9]{64}\.[a-z0-9]{1,8}")


@require_safe
def manifest(request):
    headers = {"Cache-Control": "no-store", "expo-protocol-version": "1", "expo-sfv-version": "0"}
    runtime = request.headers.get("expo-runtime-version", "")
    if request.headers.get("expo-platform") != "android" or not RUNTIME.fullmatch(runtime):
        return HttpResponse(status=204, headers=headers)
    descriptor = settings.LOCAL_DIR / "mobile-updates" / f"android-{runtime}.json"
    try:
        release = json.loads(descriptor.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return HttpResponse(status=204, headers=headers)

    if release["id"] == request.headers.get("expo-current-update-id"):
        return HttpResponse(status=204, headers=headers)
    headers["expo-signature"] = release["signature"]
    return HttpResponse(release["manifest"], content_type="application/expo+json", headers=headers)


@require_safe
def asset(request, filename):
    if not ASSET.fullmatch(filename):
        raise Http404
    try:
        payload = (settings.LOCAL_DIR / "mobile-updates" / "assets" / filename).open("rb")
    except FileNotFoundError:
        raise Http404 from None
    content_type = "application/javascript" if filename.endswith(".hbc") else mimetypes.guess_type(filename)[0]
    return FileResponse(payload, content_type=content_type or "application/octet-stream",
                        headers={"Cache-Control": "public, max-age=31536000, immutable"})
