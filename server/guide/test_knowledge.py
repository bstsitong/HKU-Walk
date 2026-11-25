import io
import json
from datetime import date
from tempfile import TemporaryDirectory
from pathlib import Path
from unittest.mock import patch
from xml.sax.saxutils import escape
from zipfile import ZipFile

from django.core.cache import cache
from django.core import serializers
from django.core.management import call_command
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.urls import reverse

from .knowledge import apply_upload, build_chunks, parse_docx, search_knowledge
from .knowledge_admin import KnowledgeDocumentForm
from .models import GuidePost, KnowledgeDocument, Publication


def docx(text="Library 24 Study Hub opens 24/7. [S05]"):
    body = f'''<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Campus reference</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>1  Main Library spaces</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Opening hours and charging</w:t></w:r></w:p>
    <w:p><w:r><w:t>{escape(text)}</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Room</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Seats</w:t></w:r></w:p></w:tc></w:tr>
    <w:tr><w:tc><w:p><w:r><w:t>CPD-2.14</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>13</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:pPr><w:pStyle w:val="Caption"/></w:pPr><w:r><w:t>Room source: S05</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>27  Official source register</w:t></w:r></w:p>
    <w:p><w:r><w:t>S05  Main Library facilities</w:t></w:r></w:p>
    <w:p><w:hyperlink r:id="link1"><w:r><w:t>Read original</w:t></w:r></w:hyperlink></w:p>'''
    stream = io.BytesIO()
    with ZipFile(stream, "w") as archive:
        archive.writestr("word/document.xml", f'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>{body}</w:body></w:document>')
        archive.writestr("word/_rels/document.xml.rels", '<Relationships><Relationship Id="link1" TargetMode="External" Target="https://lib.hku.hk/general/facilities.html"/></Relationships>')
    return stream.getvalue()


@override_settings(PUBLIC_ORIGIN="https://47.239.18.183", ASSISTANT_MODEL="test-only", ASSISTANT_API_KEY="test-only", DEEPSEEK_API_KEY="")
class KnowledgeTests(TestCase):
    def setUp(self):
        cache.clear()
        self.document = KnowledgeDocument(key="campus-test", title="校园知识", title_en="Campus knowledge", title_hant="校園知識",
                                          source_date=date(2026, 11, 23), enabled=True)
        apply_upload(self.document, docx(), "campus.docx")
        self.document.save()

    def test_order_tables_hyperlinks_and_original_are_preserved(self):
        parsed = parse_docx(docx())
        self.assertEqual([b["type"] for b in parsed["blocks"]][3:6], ["paragraph", "table", "paragraph"])
        self.assertEqual(parsed["references"]["S05"]["url"], "https://lib.hku.hk/general/facilities.html")
        row = next(c for c in parsed["chunks"] if "CPD-2.14" in c["body"])
        self.assertIn("Seats: 13", row["body"])
        self.assertIn("S05", row["references"])
        self.assertEqual(bytes(KnowledgeDocument.objects.get(pk=self.document.pk).original), docx())

    def test_retrieval_keeps_internal_metadata_private_and_localizes_public_citations(self):
        from .assistant import assistant_reply
        for language, title in [("zh-Hans", "港大官网"), ("zh-Hant", "港大官網"), ("en", "HKU official website")]:
            with self.subTest(language=language):
                sources = search_knowledge({"keywords": ["主图书馆开放时间", "充电"]}, language)
                self.assertTrue(sources)
                self.assertEqual(sources[0]["kind"], "knowledge")
                self.assertIn("24/7", sources[0]["evidence"])
                self.assertNotIn("url", sources[0])
                public = assistant_reply("Answer", sources)
                self.assertEqual(public["sources"][0]["title"], title)
                self.assertEqual(public["sources"][0]["kind"], "web")
                self.assertEqual(public["sources"][0]["url"], "https://lib.hku.hk/general/facilities.html")
                encoded = json.dumps(public, ensure_ascii=False)
                for secret in [self.document.title, self.document.title_en, self.document.title_hant, self.document.filename, str(self.document.pk), self.document.sha256, "2026-11-23", "/assistant/knowledge/", "evidence", "provenance"]:
                    self.assertNotIn(secret, encoded)
                self.assertEqual(sources[0]["provenance"]["retrievedLive"], False)

    def test_disabled_and_replaced_documents_update_immediately(self):
        self.document.enabled = False
        self.document.save()
        self.assertEqual(search_knowledge({"keywords": ["Main Library"]}, "en"), [])
        self.document.enabled = True
        apply_upload(self.document, docx("Replacement content; charging cable Type-C 60 W."), "new.docx")
        self.document.save()
        result = search_knowledge({"keywords": ["charging", "60 W"]}, "en")
        self.assertTrue(any("60 W" in item["evidence"] for item in result))
        self.assertFalse(any("24/7" in item["evidence"] for item in result))

    def test_laptop_query_prefers_specifications_over_source_register(self):
        self.document.chunks = [
            {"key": "spec", "chapter": "34  Main Library charging", "heading": "", "body": "Cable 1 notebook charging: 60 W", "context": "", "references": ["S05"], "classification": "official_compilation"},
            {"key": "register", "chapter": "34  Main Library charging", "heading": "", "body": "S05  Main Library laptop notebook charging charging power sockets", "context": "", "references": ["S05"], "classification": "official_compilation"},
        ]
        self.document.save()
        result = search_knowledge({"keywords": ["主图书馆给笔记本充电"]}, "zh-Hans")
        self.assertIn("60 W", result[0]["evidence"])

    def test_portable_backup_keeps_original_and_index(self):
        payload = serializers.serialize("json", [self.document])
        restored = next(serializers.deserialize("json", payload)).object
        self.assertEqual(bytes(restored.original), docx())
        self.assertEqual(restored.chunks, self.document.chunks)
        self.assertEqual(restored.references, self.document.references)

    def test_room_codes_match_grouped_table_rows(self):
        self.document.chunks = [{"key": "room-table", "chapter": "4  Chi Wah", "heading": "", "body": "Level: CPD-2 | Room numbers: 18, 19, 20, 21 | Seats each: 5", "context": "", "references": [], "classification": "official_compilation"}]
        self.document.save()
        result = search_knowledge({"keywords": ["CPD-2.18"]}, "en")
        self.assertEqual(len(result), 1)
        self.assertIn("Seats each: 5", result[0]["evidence"])

    def test_small_equipment_tables_stay_complete_in_one_extract(self):
        rows = [['Cable', 'Maximum power']] + [[str(i), str(w) + ' W'] for i, w in enumerate([60, 25, 18, 18, 18, 35, 15], 1)]
        chunks = build_chunks([{'type': 'table', 'position': 1, 'rows': rows}])
        self.assertEqual(len(chunks), 1)
        self.assertIn('60 W', chunks[0]['body'])
        self.assertIn('35 W', chunks[0]['body'])

    def test_source_view_is_localized_escaped_and_revision_checked(self):
        apply_upload(self.document, docx('<script>alert("x")</script> Library charging station [S05]'), "campus.docx")
        self.document.save()
        chunk = next(item for item in self.document.chunks if "<script>" in item["body"])
        url = reverse("knowledge-source", args=[self.document.pk, chunk["key"]]) + "?language=zh-Hans&revision=" + self.document.sha256
        self.assertEqual(self.client.get(url).status_code, 404)
        member = get_user_model().objects.create_user(username="ordinary", password="test-only")
        self.client.force_login(member)
        self.assertEqual(self.client.get(url).status_code, 404)
        member.is_staff = True
        member.save()
        response = self.client.get(url)
        self.assertContains(response, "AskHKU 知识库来源")
        self.assertContains(response, "&lt;script&gt;")
        self.assertNotContains(response, '<script>alert("x")</script>')
        self.assertContains(response, 'https://lib.hku.hk/general/facilities.html')
        self.assertEqual(self.client.get(url.replace(self.document.sha256, "old-version")).status_code, 410)
        self.document.enabled = False
        self.document.save()
        self.assertEqual(self.client.get(url).status_code, 404)

    def test_external_and_internal_links_never_become_public_citations(self):
        from .assistant import assistant_reply
        for link in ["https://47.239.18.183/api/assistant/knowledge/secret/", "https://hku.hk.attacker.example/", "https://example.com/", "https://user:password@lib.hku.hk/", "http://lib.hku.hk/"]:
            self.document.references["S05"]["url"] = link
            self.document.save()
            result = search_knowledge({"keywords": ["Library"]}, "en")
            self.assertTrue(result)
            self.assertEqual(assistant_reply("Answer", result)["sources"], [])

    def test_editorial_document_sections_are_not_retrieved(self):
        self.document.chunks = [{"key": "internal", "chapter": "25  AI facility records", "heading": "", "body": "Internal schema and filename", "context": "", "references": [], "classification": "editorial"}]
        self.document.save()
        self.assertEqual(search_knowledge({"keywords": ["Internal schema"]}, "en"), [])

    def test_import_is_repeatable_without_new_guide_posts(self):
        before = (GuidePost.objects.count(), Publication.objects.count())
        with TemporaryDirectory() as temp:
            path = Path(temp) / "test.docx"
            path.write_bytes(docx())
            kwargs = {"key": "command-test", "title": "导入测试", "title_en": "Import test", "title_hant": "匯入測試", "date": "2026-11-23", "enable": True, "stdout": io.StringIO()}
            call_command("import_knowledge", str(path), **kwargs)
            call_command("import_knowledge", str(path), **kwargs)
        self.assertEqual(KnowledgeDocument.objects.filter(key="command-test").count(), 1)
        self.assertEqual((GuidePost.objects.count(), Publication.objects.count()), before)

    def test_admin_requires_a_readable_document(self):
        form = KnowledgeDocumentForm(data={"key": "new", "title": "新资料"})
        self.assertFalse(form.is_valid())
        self.assertIn("document", form.errors)
        with self.assertRaises(ValueError):
            parse_docx(b"not a docx")

    def test_answer_pipeline_uses_document_tool_evidence_and_citations(self):
        messages = [
            {"content": "", "tool_calls": [{"id": "k1", "type": "function", "function": {"name": "find_knowledge", "arguments": json.dumps({"keywords": ["Main Library", "hours"]})}}]},
            {"content": json.dumps({"answer": "Library 24 Study Hub opens 24/7.", "sources": [1]})},
        ]
        with patch("guide.assistant.model_message", side_effect=messages) as model:
            response = self.client.post(reverse("assistant-ask"), {"question": "主图书馆有什么通宵学习区域", "language": "en"}, content_type="application/json")
        self.assertEqual(response.status_code, 200)
        self.assertIn("24/7", response.json()["answer"])
        self.assertEqual(response.json()["sources"][0]["kind"], "web")
        self.assertNotIn("/assistant/knowledge/", response.content.decode())
        tool_message = model.call_args_list[1].args[0][-1]
        self.assertEqual(tool_message["role"], "tool")
        self.assertIn("Library 24 Study Hub", tool_message["content"])
        for secret in [self.document.title, self.document.title_en, self.document.filename, str(self.document.pk), self.document.sha256, "2026-11-23", "_public_sources"]:
            self.assertNotIn(secret, tool_message["content"])
