from django.contrib import admin
from django.http import HttpResponseRedirect
from django.urls import include, path

from guide.views import guide_content, health, campus_content
from guide.assistant import AskAssistant
from guide.discussion import ArticleComments, ArticleLike, DeleteArticle, DeleteArticleComment, DeletePlaceComment, PlaceComments

admin.site.site_header = "港大漫游管理后台"
admin.site.site_title = "港大漫游"
admin.site.index_title = "管理首页"
admin.site.index_template = "admin/hku_index.html"
urlpatterns = [
    path("", lambda request: HttpResponseRedirect("/admin/")),
    path("admin/", admin.site.urls),
    path("api/guide/", guide_content, name="guide-content"),
    path("api/guide/articles/<int:pk>/comments/", ArticleComments.as_view()),
    path("api/guide/articles/<int:pk>/comments/<int:comment_id>/", DeleteArticleComment.as_view()),
    path("api/guide/articles/<int:pk>/", DeleteArticle.as_view()),
    path("api/guide/articles/<int:pk>/like/", ArticleLike.as_view()),
    path("api/health/", health, name="health"),
    path("api/campus/", campus_content, name="campus-content"),
    path("api/assistant/ask/", AskAssistant.as_view(), name="assistant-ask"),
    path("api/campus/places/<slug:pk>/comments/", PlaceComments.as_view()),
    path("api/campus/places/<slug:pk>/comments/<int:comment_id>/", DeletePlaceComment.as_view()),
    path("api/", include("community.urls")),
]
