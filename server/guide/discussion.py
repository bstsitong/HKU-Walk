from collections.abc import Mapping

from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from community.views import PrivateResponseView

from .articles import ARTICLE_SCOPE
from .models import GuideComment, GuideLike, GuidePost


def published_article(pk):
    return get_object_or_404(GuidePost.objects.filter(ARTICLE_SCOPE), pk=pk, publication__published=True)


def comment_data(comment):
    return {"id": str(comment.pk), "author": comment.author.get_username(),
            "body": comment.body, "createdAt": comment.created_at.isoformat()}


class CommentsPage(PageNumberPagination):
    page_size = 20


class CommentInput(serializers.Serializer):
    body = serializers.CharField(max_length=1000)
    request_id = serializers.UUIDField()


class ArticleComments(PrivateResponseView):
    throttle_classes = [ScopedRateThrottle]

    def get_permissions(self):
        return [AllowAny()] if self.request.method in ("GET", "HEAD", "OPTIONS") else [IsAuthenticated()]

    def post(self, request, pk):
        article = published_article(pk)
        data = CommentInput(data=request.data)
        data.is_valid(raise_exception=True)
        body = data.validated_data["body"]
        comment, created = GuideComment.objects.get_or_create(post=article, author=request.user,
            request_id=data.validated_data["request_id"], defaults={"body": body})
        if comment.body != body:
            return Response({"detail": "请重新发布评论。"}, status=409)
        return Response({"comment": comment_data(comment), "commentCount": article.comments.count()}, status=201 if created else 200)

    def get(self, request, pk):
        article = published_article(pk)
        paginator = CommentsPage()
        page = paginator.paginate_queryset(article.comments.select_related("author"), request)
        return Response({"comments": [comment_data(item) for item in page], "count": paginator.page.paginator.count,
                         "nextPage": paginator.page.next_page_number() if paginator.page.has_next() else None})

    def get_throttles(self):
        self.throttle_scope = "submit" if self.request.method == "POST" else None
        return super().get_throttles()


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
