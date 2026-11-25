from datetime import date
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from guide.knowledge import apply_upload, parse_docx
from guide.models import KnowledgeDocument


class Command(BaseCommand):
    help = "将 Word 文档导入 AskHKU 专用知识库，不创建指南帖子。"

    def add_arguments(self, parser):
        parser.add_argument("file")
        parser.add_argument("--key", required=True)
        parser.add_argument("--title", required=True)
        parser.add_argument("--title-en", default="")
        parser.add_argument("--title-hant", default="")
        parser.add_argument("--date", default="")
        parser.add_argument("--enable", action="store_true")
        parser.add_argument("--replace", action="store_true")

    @transaction.atomic
    def handle(self, *args, **options):
        path = Path(options["file"])
        try:
            raw = path.read_bytes()
            parsed = parse_docx(raw)
            source_date = date.fromisoformat(options["date"]) if options["date"] else None
        except (OSError, ValueError) as error:
            raise CommandError(str(error)) from error
        document = KnowledgeDocument.objects.select_for_update().filter(key=options["key"]).first()
        if document and document.sha256 != parsed["sha256"] and not options["replace"]:
            raise CommandError("这个资料标识已有不同版本；确认替换后使用 --replace。")
        document = document or KnowledgeDocument(key=options["key"])
        document.title, document.title_en, document.title_hant = options["title"], options["title_en"], options["title_hant"]
        document.source_date = source_date
        document.enabled = options["enable"]
        apply_upload(document, raw, path.name, parsed)
        document.full_clean()
        document.save()
        self.stdout.write(f"Imported {document.key}: {len(document.blocks)} blocks, {len(document.chunks)} chunks, {len(document.references)} references; enabled={document.enabled}; sha256={document.sha256}")
