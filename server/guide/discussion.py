from collections.abc import Mapping

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from community.views import PrivateResponseView
from community.models import InboxMessage
from community.profiles import public_author_data

from .articles import ARTICLE_SCOPE
from .models import CampusPlace, GuideLike, GuidePost, Publication


def published_article(pk):
    posts = GuidePost.objects.filter(ARTICLE_SCOPE).select_related("publication__current_submission")
    return get_object_or_404(posts, pk=pk, publication__published=True)


def comment_data(request, comment):
    author = public_author_data(request, comment.author, "show_comment_author")
    parent = comment.reply_to
    reply_to = {"id": str(parent.pk), "author": public_author_data(request, parent.author, "show_comment_author")} if parent else None
    return {"id": str(comment.pk), "author": author["name"], "authorProfile": author,
            "body": comment.body, "createdAt": comment.created_at.isoformat(), "replyTo": reply_to,
            "canDelete": request.user.is_authenticated and comment.author_id == request.user.pk}


class CommentsPage(PageNumberPagination):
    page_size = 20


class CommentInput(serializers.Serializer):
    body = serializers.CharField(max_length=1000)
    request_id = serializers.UUIDField()
    reply_to = serializers.IntegerField(min_value=1, max_value=9223372036854775807, required=False)


class Comments(PrivateResponseView):
    throttle_classes = [ScopedRateThrottle]

    def get_permissions(self):
        return [AllowAny()] if self.request.method in ("GET", "HEAD", "OPTIONS") else [IsAuthenticated()]

    @transaction.atomic
    def post(self, request, pk):
        target = self.target(pk)
        data = CommentInput(data=request.data)
        data.is_valid(raise_exception=True)
        body = data.validated_data["body"]
        parent_id = data.validated_data.get("reply_to")
        parent = None
        if parent_id:
            parent = target.comments.select_for_update().filter(pk=parent_id).first()
            if not parent:
                raise serializers.ValidationError({"reply_to": "这条评论已不可用，请刷新后重试。"})
        comment, created = target.comments.get_or_create(author=request.user,
            request_id=data.validated_data["request_id"], defaults={"body": body, "reply_to": parent})
        if comment.body != body or comment.reply_to_id != parent_id:
            return Response({"detail": "请重新发布评论。"}, status=409)
        if created:
            recipients = {}
            if target.publication.current_submission_id:
                recipients[target.publication.current_submission.author_id] = InboxMessage.Kind.COMMENT
            if parent:
                recipients[parent.author_id] = InboxMessage.Kind.REPLY
            recipients.pop(request.user.pk, None)
            InboxMessage.objects.bulk_create([
                InboxMessage(recipient_id=recipient_id, kind=kind, **{self.inbox_field: comment})
                for recipient_id, kind in recipients.items()
            ])
        return Response({"comment": comment_data(request, comment), "commentCount": target.comments.count()}, status=201 if created else 200)

    def get(self, request, pk):
        target = self.target(pk)
        comments = target.comments.select_related("author__profile", "reply_to__author__profile")
        focus = request.query_params.get("focus")
        focused = None
        if focus is not None:
            identifier = serializers.IntegerField(min_value=1, max_value=9223372036854775807).run_validation(focus)
            focused = comments.filter(pk=identifier).first()
            if focused:
                comments = comments.exclude(pk=focused.pk)
        paginator = CommentsPage()
        page = paginator.paginate_queryset(comments, request)
        return Response({"comments": [comment_data(request, item) for item in page],
                         "focusedComment": comment_data(request, focused) if focused else None,
                         "count": paginator.page.paginator.count + (1 if focused else 0),
                         "nextPage": paginator.page.next_page_number() if paginator.page.has_next() else None})

    def get_throttles(self):
        self.throttle_scope = "submit" if self.request.method == "POST" else None
        return super().get_throttles()


class ArticleComments(Comments):
    target = staticmethod(published_article)
    inbox_field = "guide_comment"


class PlaceComments(Comments):
    inbox_field = "place_comment"

    @staticmethod
    def target(pk):
        return get_object_or_404(CampusPlace.objects.select_related("publication__current_submission"), pk=pk, publication__published=True)


class DeleteComment(PrivateResponseView):
    @transaction.atomic
    def delete(self, request, pk, comment_id):
        target = self.target(pk)
        owned = target.comments.select_for_update().filter(author=request.user)
        get_object_or_404(owned, pk=comment_id).delete()
        return Response({"commentCount": target.comments.count()})


class DeleteArticleComment(DeleteComment):
    target = staticmethod(published_article)


class DeletePlaceComment(DeleteComment):
    target = staticmethod(PlaceComments.target)


class DeleteArticle(PrivateResponseView):
    @transaction.atomic
    def delete(self, request, pk):
        publication = get_object_or_404(Publication.objects.select_for_update(of=("self",)).filter(
            kind=Publication.Kind.POST, current_submission__author=request.user, post__isnull=False), pk=pk)
        if not publication.removed_by_author:
            publication.published = False
            publication.removed_by_author = True
            publication.save(update_fields=["published", "removed_by_author", "updated_at"])
        return Response(status=204)


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
