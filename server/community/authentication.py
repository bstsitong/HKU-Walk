import hashlib
import secrets
from datetime import timedelta

from django.utils import timezone
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed
from .models import MobileSession

def create_session(user):
    token = secrets.token_hex(32)
    MobileSession.objects.create(user=user, token_hash=hashlib.sha256(token.encode()).hexdigest(),
        expires_at=timezone.now() + timedelta(days=30))
    return token

class MobileAuthentication(BaseAuthentication):
    def authenticate(self, request):
        header = get_authorization_header(request).split()
        if not header or header[0].lower() != b"bearer":
            return None
        if len(header) != 2 or len(header[1]) != 64:
            raise AuthenticationFailed("登录状态已失效，请重新登录。")
        digest = hashlib.sha256(header[1]).hexdigest()
        session = MobileSession.objects.select_related("user").filter(token_hash=digest).first()
        if not session or session.expires_at <= timezone.now() or not session.user.is_active:
            raise AuthenticationFailed("登录状态已失效，请重新登录。")
        return session.user, session

    def authenticate_header(self, request):
        return "Bearer"
