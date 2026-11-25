from django.contrib import admin
from django.http import HttpResponseRedirect
from django.urls import include, path
from django.utils.translation import gettext_lazy as _
from django.views.i18n import set_language

from guide.views import guide_content, health, campus_content
from guide.assistant import AskAssistant
from guide.knowledge_views import knowledge_source
from guide.translation import TranslatePost, TranslateRoute, TranslatePlace
from . import mobile_updates
from guide.discussion import ArticleComments, ArticleLike, DeleteArticle, DeleteArticleComment, DeletePlaceComment, PlaceComments

admin.site.site_header = _("港大漫游管理后台")
admin.site.site_title = _("港大漫游")
admin.site.index_title = _("管理首页")
admin.site.index_template = "admin/hku_index.html"
urlpatterns = [
    path("", lambda request: HttpResponseRedirect("/admin/")),
    path("admin/set-language/", set_language, name="set_language"),
    path("admin/", admin.site.urls),
    path("api/guide/", guide_content, name="guide-content"),
    path("api/guide/articles/<int:pk>/comments/", ArticleComments.as_view()),
    path("api/guide/articles/<int:pk>/comments/<int:comment_id>/", DeleteArticleComment.as_view()),
    path("api/guide/articles/<int:pk>/", DeleteArticle.as_view()),
    path("api/guide/articles/<int:pk>/like/", ArticleLike.as_view()),
    path("api/guide/articles/<int:pk>/translation/", TranslatePost.as_view(), name="post-translation"),
    path("api/health/", health, name="health"),
    path("api/mobile-updates/manifest/", mobile_updates.manifest, name="mobile-update-manifest"),
    path("api/mobile-updates/assets/<str:filename>", mobile_updates.asset, name="mobile-update-asset"),
    path("api/campus/", campus_content, name="campus-content"),
    path("api/campus/routes/<int:pk>/translation/", TranslateRoute.as_view(), name="route-translation"),
    path("api/campus/places/<slug:pk>/translation/", TranslatePlace.as_view(), name="place-translation"),
    path("api/assistant/ask/", AskAssistant.as_view(), name="assistant-ask"),
    path("api/assistant/knowledge/<uuid:document_id>/<slug:chunk_key>/", knowledge_source, name="knowledge-source"),
    path("api/campus/places/<slug:pk>/comments/", PlaceComments.as_view()),
    path("api/campus/places/<slug:pk>/comments/<int:comment_id>/", DeletePlaceComment.as_view()),
    path("api/", include("community.urls")),
]
