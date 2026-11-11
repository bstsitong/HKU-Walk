from django.contrib.auth import authenticate, get_user_model
from django.db import IntegrityError, transaction
from django.db.models import OuterRef, Subquery
from django.db.models.functions import Coalesce
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.urls import reverse
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import JSONParser, MultiPartParser, FormParser
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from guide.catalog import content_image, publication_map_data, published_routes
from guide.models import GuidePost, Publication

from .authentication import MobileAuthentication, create_session
from .models import Submission, SubmissionBodyImage, SubmissionStepImage, RecoveryCredential, UserProfile
from .body_content import body_blocks_data, publication_body, published_body_blocks
from .profiles import PrivacyInput, ProfileInput, author_data, privacy_data, update_privacy, update_profile
from .map_content import enrich_map_data
from .serializers import (RegisterInput, AccountInput, SubmissionInput, ChangePasswordInput,
    RecoveryCodeInput, RecoverAccountInput, check_password)
from .services import submit_new, resubmit, submit_edit
from .accounts import issue_recovery_code, change_password, rotate_recovery_code, recover_account

def user_data(request, user):
    profile = getattr(user, "profile", None)
    return {"id": str(user.pk), "username": user.username, "nickname": profile.nickname if profile else "",
        "bio": profile.bio if profile else "", "avatarUrl": author_data(request, user)["avatarUrl"],
        "hasRecoveryCode": RecoveryCredential.objects.filter(user=user).exists()}

def image_url(request, item):
    return request.build_absolute_uri(reverse("submission-image", args=[item.pk])) if item.image else item.inherited_image_url

def published_data(request, item):
    entry = item.edit_of or item.public_entry
    if not entry:
        return None
    content = entry.content
    if content is None:
        return None
    source = entry.current_submission
    location = source.location if source else ""
    body = content.body
    prefix = f"相关地点或路线：{location}\n\n"
    if location and body.startswith(prefix):
        body = body[len(prefix):]
    map_data = publication_map_data(request, entry, content)
    if source and source.map_data.get("type") in {"place_correction", "route_correction"}:
        map_data = source.map_data
    elif source and source.map_data.get("stepPhotosRequired"):
        map_data["stepPhotosRequired"] = True
    return {"title": content.title, "body": body, "location": location,
        "externalUrl": content.external_url,
        "imageUrl": content_image(request, content, entry),
        "version": entry.updated_at.isoformat(), "published": entry.published,
        "mapData": map_data, "bodyBlocks": published_body_blocks(request, content, source) if entry.kind == Publication.Kind.POST else []}

def submission_data(request, item):
    return {
        "id": str(item.pk), "kind": item.kind, "title": item.title, "body": item.body,
        "authorProfile": author_data(request, item.author),
        "location": item.location, "externalUrl": item.external_url, "imageUrl": image_url(request, item),
        "status": item.status, "reviewNote": item.review_note, "revision": item.revision,
        "createdAt": item.created_at.isoformat(), "updatedAt": item.updated_at.isoformat(),
        "publicEntryId": str(item.public_entry_id) if item.public_entry_id else None,
        "isEdit": bool(item.edit_of_id), "publishedContent": published_data(request, item),
        "openEditId": str(item.open_edit_id) if getattr(item, "open_edit_id", None) else None,
        "mapData": enrich_map_data(request, item.map_data, item),
        "bodyBlocks": body_blocks_data(request, item),
    }

class PrivateResponseView(APIView):
    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "no-store"
        return response

class Register(PrivateResponseView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        data = RegisterInput(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                user = get_user_model().objects.create_user(**data.validated_data)
                token = create_session(user)
                recovery_code = issue_recovery_code(user)
        except IntegrityError:
            raise ValidationError({"username": "这个账号已被使用。"})
        return Response({"token": token, "user": user_data(request, user), "recoveryCode": recovery_code}, status=201)

class Login(PrivateResponseView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        data = AccountInput(data=request.data)
        data.is_valid(raise_exception=True)
        user = authenticate(request=request, **data.validated_data)
        if user is None:
            return Response({"detail": "账号或密码不正确。"}, status=401)
        return Response({"token": create_session(user), "user": user_data(request, user)})

class Me(PrivateResponseView):
    throttle_classes = [ScopedRateThrottle]

    def get_throttles(self):
        self.throttle_scope = "profile" if self.request.method == "PATCH" else None
        return super().get_throttles()

    def get(self, request):
        return Response({"user": user_data(request, request.user)})

    def patch(self, request):
        data = ProfileInput(data=request.data)
        data.is_valid(raise_exception=True)
        request.user.profile = update_profile(request.user, data.validated_data)
        return Response({"user": user_data(request, request.user)})


class PrivacySettings(PrivateResponseView):
    parser_classes = [JSONParser]
    throttle_classes = [ScopedRateThrottle]

    def get_throttles(self):
        self.throttle_scope = "profile" if self.request.method == "PATCH" else None
        return super().get_throttles()

    def get(self, request):
        return Response({"privacy": privacy_data(getattr(request.user, "profile", None))})

    def patch(self, request):
        data = PrivacyInput(data=request.data, partial=True)
        data.is_valid(raise_exception=True)
        profile = update_privacy(request.user, data.validated_data)
        return Response({"privacy": privacy_data(profile)})


class PublicProfile(PrivateResponseView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, public_id):
        profile = get_object_or_404(UserProfile.objects.select_related("user"), public_id=public_id, user__is_active=True)
        posts = []
        if profile.show_post_author:
            published = GuidePost.objects.filter(
                publication__published=True, publication__current_submission__author_id=profile.user_id,
            ).order_by("-publication__updated_at", "-pk")
            posts = [{"id": str(pk), "title": title} for pk, title in published.values_list("pk", "title")]
        return Response({"profile": {**author_data(request, profile.user), "bio": profile.bio, "posts": posts}})


class ProfileAvatar(PrivateResponseView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, key):
        profile = get_object_or_404(UserProfile, avatar=f"avatars/{key}.jpg", user__is_active=True)
        try:
            return FileResponse(profile.avatar.open("rb"), content_type="image/jpeg")
        except FileNotFoundError:
            raise Http404

class Logout(PrivateResponseView):
    def post(self, request):
        request.auth.delete()
        return Response(status=204)

class ChangePassword(PrivateResponseView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        data = ChangePasswordInput(data=request.data)
        data.is_valid(raise_exception=True)
        check_password(data.validated_data["new_password"], request.user)
        user, token = change_password(request.user, **data.validated_data)
        return Response({"token": token, "user": user_data(request, user)})

class RotateRecoveryCode(PrivateResponseView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        data = RecoveryCodeInput(data=request.data)
        data.is_valid(raise_exception=True)
        code = rotate_recovery_code(request.user, data.validated_data["current_password"])
        return Response({"recoveryCode": code, "user": user_data(request, request.user)})

class RecoverAccount(PrivateResponseView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "recovery"

    def post(self, request):
        data = RecoverAccountInput(data=request.data)
        data.is_valid(raise_exception=True)
        user, token, code = recover_account(data.validated_data["recovery_code"],
            data.validated_data["new_password"], check_password)
        return Response({"token": token, "user": user_data(request, user), "recoveryCode": code})

def owned_submissions(user):
    active = Submission.objects.filter(edit_of_id=OuterRef("target_entry_id"), status__in=["pending", "changes_requested"])
    targets = ("edit_of", "public_entry")
    return Submission.objects.filter(author=user).select_related(
        "author__profile",
        *(f"{target}__{child}" for target in targets for child in ("current_submission", "post", "place", "route")),
    ).prefetch_related(
        "step_images", "body_images", *(f"{target}__route__steps__photo" for target in targets),
        *(f"{target}__current_submission__body_images" for target in targets),
    ).annotate(
        target_entry_id=Coalesce("edit_of_id", "public_entry_id"), open_edit_id=Subquery(active.values("pk")[:1]))

class Submissions(PrivateResponseView):
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "submit"

    def get_throttles(self):
        return [] if self.request.method == "GET" else super().get_throttles()

    def get(self, request):
        paginator = PageNumberPagination()
        paginator.page_size = 20
        items = paginator.paginate_queryset(owned_submissions(request.user), request)
        return Response({"submissions": [submission_data(request, item) for item in items],
            "count": paginator.page.paginator.count,
            "nextPage": paginator.page.next_page_number() if paginator.page.has_next() else None})

    def post(self, request):
        data = SubmissionInput(data=request.data)
        data.is_valid(raise_exception=True)
        item, created = submit_new(request.user, dict(data.validated_data))
        return Response({"submission": submission_data(request, item)}, status=201 if created else 200)

class SubmissionDetail(PrivateResponseView):
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "submit"

    def get_throttles(self):
        return [] if self.request.method == "GET" else super().get_throttles()

    def get(self, request, pk):
        item = get_object_or_404(owned_submissions(request.user), pk=pk)
        return Response({"submission": submission_data(request, item)})

    def patch(self, request, pk):
        item = get_object_or_404(owned_submissions(request.user), pk=pk)
        data = SubmissionInput(data=request.data)
        data.is_valid(raise_exception=True)
        item = resubmit(item, dict(data.validated_data))
        return Response({"submission": submission_data(request, item)})

class PublishedEdit(Submissions):
    def get(self, request, pk):
        return Response(status=405)

    def post(self, request, pk):
        source = get_object_or_404(owned_submissions(request.user), pk=pk)
        data = SubmissionInput(data=request.data)
        data.is_valid(raise_exception=True)
        item, created = submit_edit(request.user, source, dict(data.validated_data))
        return Response({"submission": submission_data(request, item)}, status=201 if created else 200)

class SubmissionImage(PrivateResponseView):
    permission_classes = [AllowAny]
    authentication_classes = [MobileAuthentication, SessionAuthentication]

    def get(self, request, pk):
        item = get_object_or_404(Submission.objects.select_related(
            "public_entry__post", "public_entry__place", "public_entry__route"), pk=pk)
        publication = item.public_entry
        public = (item.status == Submission.Status.APPROVED and publication and publication.published
            and publication.current_submission_id == item.pk and publication.content and not publication.content.image_url)
        if public and publication.kind == Publication.Kind.ROUTE:
            public = published_routes().filter(pk=publication.pk).exists()
        allowed = public or (request.user.is_authenticated and (request.user.pk == item.author_id or request.user.is_staff))
        if not allowed or not item.image:
            raise Http404
        try:
            return FileResponse(item.image.open("rb"), content_type="image/jpeg")
        except FileNotFoundError:
            raise Http404

class SubmissionStepImageView(PrivateResponseView):
    permission_classes = [AllowAny]
    authentication_classes = [MobileAuthentication, SessionAuthentication]

    def get(self, request, pk):
        image = get_object_or_404(SubmissionStepImage.objects.select_related("submission__public_entry"), pk=pk)
        item = image.submission
        public = (item.status == Submission.Status.APPROVED and item.public_entry
            and item.public_entry.current_submission_id == item.pk
            and item.public_entry.kind == Publication.Kind.ROUTE
            and published_routes().filter(pk=item.public_entry_id, steps__photo_id=image.pk).exists())
        allowed = public or (request.user.is_authenticated and (request.user.pk == item.author_id or request.user.is_staff))
        if not allowed:
            raise Http404
        try:
            return FileResponse(image.image.open("rb"), content_type="image/jpeg")
        except FileNotFoundError:
            raise Http404


class SubmissionBodyImageView(PrivateResponseView):
    permission_classes = [AllowAny]
    authentication_classes = [MobileAuthentication, SessionAuthentication]

    def get(self, request, pk):
        image = get_object_or_404(SubmissionBodyImage.objects.select_related("submission__public_entry__post"), pk=pk)
        item = image.submission
        entry = item.public_entry
        public = (item.status == Submission.Status.APPROVED and entry and entry.published
            and entry.kind == Publication.Kind.POST and entry.current_submission_id == item.pk
            and entry.content and entry.content.body == publication_body(item))
        allowed = public or (request.user.is_authenticated and (request.user.pk == item.author_id or request.user.is_staff))
        if not allowed:
            raise Http404
        try:
            return FileResponse(image.image.open("rb"), content_type="image/jpeg")
        except FileNotFoundError:
            raise Http404
