from urllib.parse import urlsplit
from collections.abc import Mapping
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .images import clean_image
from .models import Submission
from .map_content import validate_map_data

def check_password(value, user):
    try:
        validate_password(value, user)
    except DjangoValidationError as error:
        raise serializers.ValidationError({"new_password": error.messages})

class ChangePasswordInput(serializers.Serializer):
    current_password = serializers.CharField(write_only=True, max_length=128, trim_whitespace=False)
    new_password = serializers.CharField(write_only=True, max_length=128, trim_whitespace=False)

class RecoveryCodeInput(serializers.Serializer):
    current_password = serializers.CharField(write_only=True, max_length=128, trim_whitespace=False)

class RecoverAccountInput(serializers.Serializer):
    recovery_code = serializers.CharField(max_length=100, trim_whitespace=True)
    new_password = serializers.CharField(write_only=True, max_length=128, trim_whitespace=False)

class AccountInput(serializers.Serializer):
    username = serializers.RegexField(r"^[a-z0-9_]{3,32}$", max_length=32,
        error_messages={"invalid": "账号使用 3–32 位小写字母、数字或下划线。"})
    password = serializers.CharField(write_only=True, max_length=128, trim_whitespace=False)

    def to_internal_value(self, data):
        if not isinstance(data, Mapping):
            raise serializers.ValidationError({"non_field_errors": ["请提交账号和密码。"]})
        copied = data.copy()
        if isinstance(copied.get("username"), str):
            copied["username"] = copied["username"].strip().casefold()
        return super().to_internal_value(copied)

class RegisterInput(AccountInput):
    def validate(self, data):
        user = get_user_model()(username=data["username"])
        if get_user_model().objects.filter(username=data["username"]).exists():
            raise serializers.ValidationError({"username": "这个账号已被使用。"})
        try:
            validate_password(data["password"], user)
        except DjangoValidationError as error:
            raise serializers.ValidationError({"password": error.messages})
        return data

class SubmissionInput(serializers.Serializer):
    kind = serializers.ChoiceField(choices=Submission.Kind.choices)
    title = serializers.CharField(min_length=1, max_length=160)
    body = serializers.CharField(min_length=10, max_length=8000)
    location = serializers.CharField(max_length=160, required=False, allow_blank=True, default="")
    external_url = serializers.URLField(max_length=1000, required=False, allow_blank=True, default="")
    image = serializers.FileField(required=False, allow_null=True)
    remove_image = serializers.BooleanField(required=False, default=False)
    request_key = serializers.RegexField(r"^[a-zA-Z0-9_-]{8,64}$", required=False)
    revision = serializers.IntegerField(min_value=1, required=False)
    base_version = serializers.DateTimeField(required=False)
    map_data = serializers.JSONField(required=False, default=dict)
    remove_step_images = serializers.JSONField(required=False, default=list)
    inherit_step_images = serializers.JSONField(required=False, default=dict)

    def validate_external_url(self, value):
        if value and urlsplit(value).scheme not in {"http", "https"}:
            raise serializers.ValidationError("链接需要以 http:// 或 https:// 开头。")
        return value

    def validate_image(self, value):
        return clean_image(value) if value else None

    def validate(self, data):
        if data["kind"] != Submission.Kind.NEW_PLACE and len(data["title"]) < 3:
            raise serializers.ValidationError({"title": "标题至少 3 个字。"})
        data["map_data"] = validate_map_data(data["kind"], data["map_data"])
        removed = data["remove_step_images"]
        count = len(data["map_data"].get("steps", []))
        if not isinstance(removed, list) or any(type(index) is not int or not 0 <= index < count for index in removed):
            raise serializers.ValidationError({"remove_step_images": "路线配图编号不正确。"})
        inherited = data["inherit_step_images"]
        if not isinstance(inherited, dict) or any(not str(key).isdecimal() or str(int(key)) != key or not 0 <= int(key) < count or type(value) is not int or not 0 <= value < 20 for key, value in inherited.items()):
            raise serializers.ValidationError({"inherit_step_images": "路线配图编号不正确。"})
        files = {}
        for key in self.initial_data.keys():
            if key.startswith("step_image_"):
                suffix = key[len("step_image_"):]
                if not suffix.isdecimal() or str(int(suffix)) != suffix or not 0 <= int(suffix) < count:
                    raise serializers.ValidationError({"image": "路线配图编号不正确。"})
                files[int(suffix)] = clean_image(serializers.FileField().run_validation(self.initial_data[key]))
        data["step_images"] = files
        if data["kind"] == Submission.Kind.GROUP and not data["external_url"]:
            raise serializers.ValidationError({"external_url": "娱乐群资料需要提供有效邀请链接。"})
        if data["kind"] in {Submission.Kind.PLACE, Submission.Kind.ROUTE} and not data["location"]:
            raise serializers.ValidationError({"location": "请写明相关地点或路线。"})
        return data
