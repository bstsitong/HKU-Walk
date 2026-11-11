from django.shortcuts import get_object_or_404
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from guide.articles import ARTICLE_KEYS

from .models import InboxMessage
from .profiles import public_author_data
from .views import PrivateResponseView


def message_data(request, message):
    result = {"id": str(message.pk), "kind": message.kind, "read": message.is_read,
              "createdAt": message.created_at.isoformat()}
    if message.kind == InboxMessage.Kind.REVIEW:
        return {**result, "submissionId": str(message.submission_id), "title": message.review_title,
                "reviewStatus": message.review_status, "reviewNote": message.review_note}

    comment = message.guide_comment or message.place_comment
    is_guide = message.guide_comment_id is not None
    target = comment.post if is_guide else comment.place
    publication = target.publication
    if not publication.published or (is_guide and publication.key not in ARTICLE_KEYS and not publication.current_submission_id):
        return {**result, "target": None}
    return {**result, "author": public_author_data(request, comment.author, "show_comment_author"), "body": comment.body,
            "target": {"kind": "guide" if is_guide else "place", "id": str(target.pk),
                       "commentId": str(comment.pk), "title": target.title}}


class InboxPage(PageNumberPagination):
    page_size = 20


class Inbox(PrivateResponseView):
    def get(self, request):
        messages = InboxMessage.objects.filter(recipient=request.user)
        unread = messages.filter(is_read=False).count()
        if request.query_params.get("summary") == "1":
            return Response({"unread": unread})
        paginator = InboxPage()
        items = paginator.paginate_queryset(messages.select_related(
            "guide_comment__post__publication", "guide_comment__author__profile",
            "place_comment__place__publication", "place_comment__author__profile"), request)
        return Response({"messages": [message_data(request, item) for item in items], "unread": unread,
                         "nextPage": paginator.page.next_page_number() if paginator.page.has_next() else None})


class MarkInboxRead(PrivateResponseView):
    def patch(self, request, pk):
        messages = InboxMessage.objects.filter(recipient=request.user)
        get_object_or_404(messages.only("id"), pk=pk)
        messages.filter(pk=pk, is_read=False).update(is_read=True)
        return Response({"unread": messages.filter(is_read=False).count()})
