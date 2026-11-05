from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection

class Command(BaseCommand):
    help = "准备独立 PostgreSQL schema；迁移后可封闭 Data API 访问并启用 RLS。"

    def add_arguments(self, parser):
        parser.add_argument("--seal", action="store_true")

    def handle(self, *args, **options):
        schema = settings.DATABASE_SCHEMA
        if not schema:
            self.stdout.write("使用默认数据库命名空间。")
            return
        if connection.vendor != "postgresql":
            raise CommandError("独立 schema 仅用于 PostgreSQL。")
        quoted = connection.ops.quote_name(schema)
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM pg_namespace WHERE nspname = %s", [schema])
            if not cursor.fetchone():
                # A limited service role may own an existing schema without CREATE on the database.
                cursor.execute("CREATE SCHEMA " + quoted)
            cursor.execute("REVOKE ALL ON SCHEMA " + quoted + " FROM PUBLIC")
            cursor.execute("SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')")
            roles = [row[0] for row in cursor.fetchall()]
            for role in ["PUBLIC", *roles]:
                target = "PUBLIC" if role == "PUBLIC" else connection.ops.quote_name(role)
                cursor.execute(f"REVOKE ALL ON SCHEMA {quoted} FROM {target}")
                cursor.execute(f"REVOKE ALL ON ALL TABLES IN SCHEMA {quoted} FROM {target}")
                cursor.execute(f"REVOKE ALL ON ALL SEQUENCES IN SCHEMA {quoted} FROM {target}")
                cursor.execute(f"ALTER DEFAULT PRIVILEGES IN SCHEMA {quoted} REVOKE ALL ON TABLES FROM {target}")
                cursor.execute(f"ALTER DEFAULT PRIVILEGES IN SCHEMA {quoted} REVOKE ALL ON SEQUENCES FROM {target}")
            if options["seal"]:
                cursor.execute("SELECT tablename FROM pg_tables WHERE schemaname = %s", [schema])
                for (table,) in cursor.fetchall():
                    cursor.execute(f"ALTER TABLE {quoted}.{connection.ops.quote_name(table)} ENABLE ROW LEVEL SECURITY")
        self.stdout.write("独立数据库命名空间已准备，未授予前端直连访问权限。")
