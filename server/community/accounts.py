import hashlib
import re
import secrets

from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework.exceptions import ValidationError

from .authentication import create_session
from .models import MobileSession, RecoveryCredential


def code_digest(code):
    normalized = re.sub(r"[\s-]", "", code).upper()
    return hashlib.sha256(normalized.encode()).hexdigest()


def issue_recovery_code(user):
    raw = secrets.token_hex(16).upper()
    RecoveryCredential.objects.update_or_create(user=user, defaults={"token_hash": code_digest(raw)})
    return "-".join(raw[index:index + 4] for index in range(0, len(raw), 4))


@transaction.atomic
def change_password(user, current_password, new_password):
    locked = get_user_model().objects.select_for_update().get(pk=user.pk)
    if not locked.check_password(current_password):
        raise ValidationError({"current_password": "当前密码不正确。"})
    if locked.check_password(new_password):
        raise ValidationError({"new_password": "新密码需要与当前密码不同。"})
    locked.set_password(new_password)
    locked.save(update_fields=["password"])
    MobileSession.objects.filter(user=locked).delete()
    return locked, create_session(locked)


@transaction.atomic
def rotate_recovery_code(user, current_password):
    locked = get_user_model().objects.select_for_update().get(pk=user.pk)
    if not locked.check_password(current_password):
        raise ValidationError({"current_password": "当前密码不正确。"})
    return issue_recovery_code(locked)


@transaction.atomic
def recover_account(code, new_password, validate):
    # Find the owner first, then use the same user -> credential lock order as rotation.
    candidate = RecoveryCredential.objects.filter(token_hash=code_digest(code)).values_list("user_id", flat=True).first()
    if not candidate:
        raise ValidationError("恢复码无效或已被替换，请检查后重试。")
    user = get_user_model().objects.select_for_update().get(pk=candidate)
    credential = RecoveryCredential.objects.select_for_update().filter(user=user, token_hash=code_digest(code)).first()
    if not credential or not user.is_active:
        raise ValidationError("恢复码无效或已被替换，请检查后重试。")
    validate(new_password, user)
    user.set_password(new_password)
    user.save(update_fields=["password"])
    MobileSession.objects.filter(user=user).delete()
    fresh_code = issue_recovery_code(user)
    return user, create_session(user), fresh_code
