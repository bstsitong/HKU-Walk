import os
import re
from pathlib import Path
from urllib.parse import urlsplit, quote
import dj_database_url

from django.core.management.utils import get_random_secret_key

BASE_DIR = Path(__file__).resolve().parent.parent
LOCAL_DIR = Path(os.environ.get("DJANGO_DATA_DIR", BASE_DIR.parent / ".local"))
LOCAL_DIR.mkdir(parents=True, exist_ok=True)
DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"
def secret_value(name):
    source = os.environ.get(name + "_FILE")
    return Path(source).read_text(encoding="utf-8").strip() if source else os.environ.get(name, "")

SECRET_KEY = secret_value("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    if not DEBUG:
        raise RuntimeError("Set DJANGO_SECRET_KEY when DJANGO_DEBUG=0.")
    key_file = LOCAL_DIR / "django-secret-key"
    if not key_file.exists():
        key_file.write_text(get_random_secret_key(), encoding="utf-8")
    SECRET_KEY = key_file.read_text(encoding="utf-8").strip()

render_hostname = os.environ.get("RENDER_EXTERNAL_HOSTNAME", "") if os.environ.get("RENDER") == "true" else ""
ALLOWED_HOSTS = [host.strip() for host in os.environ.get("DJANGO_ALLOWED_HOSTS", render_hostname or "localhost,127.0.0.1,10.0.2.2").split(",") if host.strip()]
PUBLIC_ORIGIN = os.environ.get("DJANGO_PUBLIC_ORIGIN", "https://" + render_hostname if render_hostname else "").rstrip("/")
if not DEBUG:
    if (not os.environ.get("DJANGO_ALLOWED_HOSTS") and not render_hostname) or "*" in ALLOWED_HOSTS:
        raise RuntimeError("Set explicit DJANGO_ALLOWED_HOSTS for production.")
    origin = urlsplit(PUBLIC_ORIGIN)
    if origin.scheme != "https" or not origin.hostname or origin.path or origin.query or origin.fragment or origin.username:
        raise RuntimeError("Set DJANGO_PUBLIC_ORIGIN to the HTTPS origin, without a path.")
INSTALLED_APPS = [
    "django.contrib.admin", "django.contrib.auth", "django.contrib.contenttypes",
    "django.contrib.sessions", "django.contrib.messages", "django.contrib.staticfiles",
    "guide.apps.GuideConfig",
    "rest_framework",
    "community.apps.CommunityConfig",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "config.middleware.MaintenanceMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
if not DEBUG:
    MIDDLEWARE.insert(1, "whitenoise.middleware.WhiteNoiseMiddleware")
ROOT_URLCONF = "config.urls"
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [],
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]
WSGI_APPLICATION = "config.wsgi.application"
DATABASES = {"default": {
    "ENGINE": "django.db.backends.sqlite3",
    "NAME": os.environ.get("DJANGO_DB_PATH", str(LOCAL_DIR / "hku-walk.sqlite3")),
    "OPTIONS": {"timeout": 20},
}}
database_url = secret_value("DATABASE_URL")
DATABASE_SCHEMA = os.environ.get("DJANGO_DB_SCHEMA", "")
if DATABASE_SCHEMA and not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", DATABASE_SCHEMA):
    raise RuntimeError("DJANGO_DB_SCHEMA must be a plain lowercase PostgreSQL schema name.")
if not database_url and os.environ.get("POSTGRES_PASSWORD_FILE"):
    database_password = quote(Path(os.environ["POSTGRES_PASSWORD_FILE"]).read_text(encoding="utf-8").strip(), safe="")
    database_url = f"postgresql://hku:{database_password}@db:5432/hku_walk"
if database_url:
    DATABASES["default"] = dj_database_url.parse(database_url,
        conn_max_age=60, conn_health_checks=True,
        ssl_require=os.environ.get("DJANGO_DB_SSL_REQUIRE", "0" if DEBUG else "1") == "1")
    if DATABASES["default"]["ENGINE"] != "django.db.backends.postgresql":
        raise RuntimeError("DATABASE_URL must use PostgreSQL.")
    DATABASES["default"]["DISABLE_SERVER_SIDE_CURSORS"] = os.environ.get("DJANGO_DB_DISABLE_SERVER_CURSORS", "0") == "1"
    if DATABASE_SCHEMA and str(DATABASES["default"].get("PORT")) == "6543":
        raise RuntimeError("Use the Supabase session pooler on port 5432 with a private Django schema.")
elif not DEBUG and os.environ.get("DJANGO_ALLOW_SQLITE", "0") != "1":
    raise RuntimeError("Set DATABASE_URL to a persistent PostgreSQL database for production.")
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
LANGUAGE_CODE = "zh-hans"
TIME_ZONE = "Asia/Hong_Kong"
USE_I18N = True
USE_TZ = True
STATIC_URL = "static/"
STATIC_ROOT = LOCAL_DIR / "static"
STORAGES = {"default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage" if not DEBUG
        else "django.contrib.staticfiles.storage.StaticFilesStorage"}}
MEDIA_DATABASE_MAX_BYTES = int(os.environ.get("DJANGO_MEDIA_MAX_BYTES", str(100 * 1024 * 1024)))
storage_backend = os.environ.get("DJANGO_STORAGE", "local")
if storage_backend == "database":
    STORAGES["default"] = {"BACKEND": "community.storage.DatabaseStorage"}
elif storage_backend == "s3":
    from botocore.config import Config
    storage_keys = {key: secret_value(key) for key in ("S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY")}
    if not all(storage_keys.values()) or not os.environ.get("S3_ENDPOINT_URL") or not os.environ.get("S3_BUCKET"):
        raise RuntimeError("Set the private S3 endpoint, bucket and server-side credentials.")
    STORAGES["default"] = {"BACKEND": "storages.backends.s3.S3Storage", "OPTIONS": {
        "access_key": storage_keys["S3_ACCESS_KEY_ID"], "secret_key": storage_keys["S3_SECRET_ACCESS_KEY"],
        "bucket_name": os.environ["S3_BUCKET"], "endpoint_url": os.environ["S3_ENDPOINT_URL"],
        "region_name": os.environ.get("S3_REGION", "ap-southeast-1"), "default_acl": None,
        "querystring_auth": True, "file_overwrite": False, "object_parameters": {"CacheControl": "no-store"},
        "client_config": Config(signature_version="s3v4", s3={"addressing_style": "path"},
            request_checksum_calculation="when_required", response_checksum_validation="when_required",
            connect_timeout=8, read_timeout=25, retries={"max_attempts": 2, "mode": "standard"}),
    }}
elif not DEBUG and os.environ.get("RENDER") == "true":
    raise RuntimeError("A diskless Render deployment needs database or private S3 image storage.")
elif storage_backend != "local":
    raise RuntimeError("DJANGO_STORAGE must be local, database or s3.")
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_HTTPONLY = True
CSRF_TRUSTED_ORIGINS = [item.strip() for item in os.environ.get("DJANGO_CSRF_TRUSTED_ORIGINS", PUBLIC_ORIGIN).split(",") if item.strip()]
SECURE_SSL_REDIRECT = not DEBUG
SECURE_REDIRECT_EXEMPT = [r"^api/health/$"]
SECURE_HSTS_SECONDS = 0 if DEBUG else 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = not DEBUG
SECURE_HSTS_PRELOAD = not DEBUG
if os.environ.get("DJANGO_TRUST_PROXY", "0") == "1":
    # Enable only behind a proxy that replaces this header and hides the app port.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_CONTENT_TYPE_NOSNIFF = True
MEDIA_ROOT = LOCAL_DIR / "uploads"
MAINTENANCE = os.environ.get("DJANGO_MAINTENANCE", "0") == "1"
ASSISTANT_API_BASE_URL = os.environ.get("ASSISTANT_API_BASE_URL", "https://api.deepseek.com").strip().rstrip("/")
uses_deepseek = ASSISTANT_API_BASE_URL in {"https://api.deepseek.com", "https://api.deepseek.com/v1"}
ASSISTANT_MODEL = os.environ.get("ASSISTANT_MODEL", "deepseek-flash" if uses_deepseek else "").strip()
DEEPSEEK_API_KEY = secret_value("DEEPSEEK_API_KEY").strip()
ASSISTANT_API_KEY = secret_value("ASSISTANT_API_KEY").strip() or (DEEPSEEK_API_KEY if uses_deepseek else "")
ASSISTANT_DAILY_LIMIT = max(0, int(os.environ.get("ASSISTANT_DAILY_LIMIT", "100")))
TRANSLATION_DAILY_LIMIT = max(0, int(os.environ.get("TRANSLATION_DAILY_LIMIT", "200")))
DATA_UPLOAD_MAX_MEMORY_SIZE = 6 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 6 * 1024 * 1024
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["community.authentication.MobileAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_THROTTLE_RATES": {"auth": "12/min", "submit": "12/min", "recovery": "5/min", "guide_like": "60/min", "profile": "12/min", "assistant": "5/min", "translation": "20/min", "personal_records": "180/min"},
    "EXCEPTION_HANDLER": "community.api_errors.handle_exception",
    "NUM_PROXIES": 1 if os.environ.get("DJANGO_TRUST_PROXY", "0") == "1" else 0,
}
if not DEBUG:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.db.DatabaseCache", "LOCATION": "app_cache"}}
    LOGGING = {"version": 1, "disable_existing_loggers": False,
        "handlers": {"console": {"class": "logging.StreamHandler"}},
        "root": {"handlers": ["console"], "level": "INFO"}}
