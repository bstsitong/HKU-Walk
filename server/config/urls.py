from django.contrib import admin
from django.http import HttpResponseRedirect
from django.urls import include, path

from guide.views import guide_content, health

admin.site.site_header = "港大漫游 · 内容维护"
admin.site.site_title = "港大漫游"
admin.site.index_title = "学生指南管理"
urlpatterns = [
    path("", lambda request: HttpResponseRedirect("/admin/")),
    path("admin/", admin.site.urls),
    path("api/guide/", guide_content, name="guide-content"),
    path("api/health/", health, name="health"),
    path("api/", include("community.urls")),
]
