from django.contrib.auth import get_user_model
from django.core.files.storage import default_storage
from django.db import transaction
from django.urls import reverse
from rest_framework import serializers

from .images import clean_image
from .models import UserProfile
from .storage import MediaQuotaExceeded


def author_data(request, user):
    profile = getattr(user, "profile", None)
    return {
        "name": (profile.nickname if profile else "") or user.get_username(),
        "avatarUrl": request.build_absolute_uri(reverse("profile-avatar", args=[profile.avatar.name.split("/")[-1][:-4]]))
        if profile and profile.avatar else "",
    }


class ProfileInput(serializers.Serializer):
    nickname = serializers.CharField(max_length=32, allow_blank=True, required=False)
    bio = serializers.CharField(max_length=160, allow_blank=True, required=False)
    avatar = serializers.FileField(required=False, write_only=True)
    remove_avatar = serializers.BooleanField(required=False, default=False, write_only=True)

    def validate(self, data):
        if data.get("avatar") and data.get("remove_avatar"):
            raise serializers.ValidationError({"avatar": "请选择更换或移除头像。"})
        return data


def update_profile(user, values):
    upload = values.get("avatar")
    image = clean_image(upload, avatar=True) if upload else None
    saved = None
    try:
        with transaction.atomic():
            get_user_model().objects.select_for_update().get(pk=user.pk)
            profile, _ = UserProfile.objects.get_or_create(user=user)
            previous = profile.avatar.name
            if image:
                saved = default_storage.save("avatars/" + image.name, image)
                profile.avatar = saved
            elif values.get("remove_avatar"):
                profile.avatar = ""
            for field in ("nickname", "bio"):
                if field in values:
                    setattr(profile, field, values[field])
            profile.save(update_fields=["nickname", "bio", "avatar"])
            if previous and previous != profile.avatar.name:
                transaction.on_commit(lambda: default_storage.delete(previous), robust=True)
    except MediaQuotaExceeded as error:
        raise serializers.ValidationError({"avatar": "图片空间已满，请稍后重试。"}) from error
    except Exception:
        if saved:
            default_storage.delete(saved)
        raise
    return profile
