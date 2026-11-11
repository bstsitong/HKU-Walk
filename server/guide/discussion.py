from collections.abc import Mapping

from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from community.views import PrivateResponseView
from community.profiles import public_author_data

from .articles import ARTICLE_SCOPE
from .models import CampusPlace, GuideLike, GuidePost


def published_article(pk):
    return get_object_or_404(GuidePost.objects.filter(ARTICLE_SCOPE), pk=pk, publication__published=True)


def comment_data(request, comment):
    author = public_author_data(request, comment.author, "show_comment_author")
    return {"id": str(comment.pk), "author": author["name"], "authorProfile": author,
            "body": comment.body, "createdAt": comment.created_at.isoformat()}


class CommentsPage(PageNumberPagination):
    page_size = 20


class CommentInput(serializers.Serializer):
    body = serializers.CharField(max_length=1000)
    request_id = serializers.UUIDField()


class Comments(PrivateResponseView):
    throttle_classes = [ScopedRateThrottle]

    def get_permissions(self):
        return [AllowAny()] if self.request.method in ("GET", "HEAD", "OPTIONS") else [IsAuthenticated()]

    def post(self, request, pk):
        target = self.target(pk)
        data = CommentInput(data=request.data)
        data.is_valid(raise_exception=True)
        body = data.validated_data["body"]
        comment, created = target.comments.get_or_create(author=request.user,
            request_id=data.validated_data["request_id"], defaults={"body": body})
        if comment.body != body:
            return Response({"detail": "请重新发布评论。"}, status=409)
        return Response({"comment": comment_data(request, comment), "commentCount": target.comments.count()}, status=201 if created else 200)

    def get(self, request, pk):
        target = self.target(pk)
        paginator = CommentsPage()
        page = paginator.paginate_queryset(target.comments.select_related("author__profile"), request)
        return Response({"comments": [comment_data(request, item) for item in page], "count": paginator.page.paginator.count,
                         "nextPage": paginator.page.next_page_number() if paginator.page.has_next() else None})

    def get_throttles(self):
        self.throttle_scope = "submit" if self.request.method == "POST" else None
        return super().get_throttles()


class ArticleComments(Comments):
    target = staticmethod(published_article)


class PlaceComments(Comments):
    @staticmethod
    def target(pk):
        return get_object_or_404(CampusPlace, pk=pk, publication__published=True)


class ArticleLike(PrivateResponseView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "guide_like"

    def put(self, request, pk):
        article = published_article(pk)
        liked = request.data.get("liked") if isinstance(request.data, Mapping) else None
        if type(liked) is not bool:
            raise serializers.ValidationError({"liked": "Expected a boolean."})
        if liked:
            GuideLike.objects.get_or_create(post=article, user=request.user)
        else:
            article.likes.filter(user=request.user).delete()
        return Response({"liked": liked, "likeCount": article.likes.count()})
