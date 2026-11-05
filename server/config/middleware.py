from django.conf import settings
from django.http import JsonResponse

class MaintenanceMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if (settings.MAINTENANCE and request.method not in {"GET", "HEAD", "OPTIONS"}
                and request.path not in {"/api/accounts/logout/", "/admin/logout/"}):
            response = JsonResponse({"detail": "系统正在维护，请稍后再提交。已有内容仍可浏览。"}, status=503,
                json_dumps_params={"ensure_ascii": False})
            response["Retry-After"] = "120"
            response["Cache-Control"] = "no-store"
            return response
        return self.get_response(request)
