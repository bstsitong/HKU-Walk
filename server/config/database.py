from django.conf import settings
from django.db.backends.signals import connection_created

def configure_private_schema(sender, connection, **kwargs):
    if settings.DATABASE_SCHEMA and connection.vendor == "postgresql":
        # A session-mode connection keeps this setting for its entire lifetime.
        # No public fallback: an unprepared schema must fail instead of creating public tables.
        with connection.cursor() as cursor:
            cursor.execute("SET search_path TO " + connection.ops.quote_name(settings.DATABASE_SCHEMA))

def register():
    connection_created.connect(configure_private_schema, dispatch_uid="hku-private-schema", weak=False)
