import re

from django.http import HttpResponse
from django.shortcuts import get_object_or_404, render
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from .knowledge import localized_title, safe_link
from .models import KnowledgeDocument

COPY = {
    "zh-Hans": {"source": "AskHKU 知识库来源", "compiled": "资料整理日期", "original": "文档原文",
                "note": "以下为这份文档中的相关原文和引用来源。",
                "links": "文档引用的来源", "community": "学生分享与补充资料", "official_compilation": "官方来源资料整理",
                "editorial": "资料说明", "changed": "资料已更新，请重新提问以获取最新引用。", "undated": "未注明"},
    "zh-Hant": {"source": "AskHKU 知識庫來源", "compiled": "資料整理日期", "original": "文件原文",
                "note": "以下為這份文件中的相關原文和引用來源。",
                "links": "文件引用的來源", "community": "學生分享與補充資料", "official_compilation": "官方來源資料整理",
                "editorial": "資料說明", "changed": "資料已更新，請重新提問以取得最新引用。", "undated": "未註明"},
    "en": {"source": "AskHKU knowledge source", "compiled": "Compilation date", "original": "Original document extract",
           "note": "Relevant original excerpts and cited sources from this document.",
           "links": "Sources cited by the document", "community": "Student reports and supplementary references", "official_compilation": "Compilation of official sources",
           "editorial": "Reference notes", "changed": "This document has changed. Ask again to get an up-to-date reference.", "undated": "Not recorded"},
}


@require_GET
@never_cache
def knowledge_source(request, document_id, chunk_key):
    if not request.user.is_active or not request.user.is_staff:
        return HttpResponse(status=404)
    language = request.GET.get("language", "en")
    language = language if language in COPY else "en"
    copy = COPY[language]
    document = get_object_or_404(KnowledgeDocument.objects.defer("original", "blocks"), pk=document_id, enabled=True)
    if request.GET.get("revision", document.sha256) != document.sha256:
        return HttpResponse(copy["changed"], status=410, content_type="text/plain; charset=utf-8")
    chunk = next((item for item in document.chunks if item["key"] == chunk_key), None)
    if chunk is None:
        return HttpResponse(status=404)
    keys = set(chunk["references"]) | set(re.findall(r"\b[SC]\d{2}\b", chunk["context"]))
    references = [{"id": key, **document.references[key]} for key in sorted(keys)
                  if key in document.references and safe_link(document.references[key].get("url", ""))]
    return render(request, "guide/knowledge_source.html", {
        "language": language, "copy": copy, "title": localized_title(document, language),
        "date": document.source_date.isoformat() if document.source_date else copy["undated"],
        "classification": copy.get(chunk["classification"], copy["editorial"]), "chunk": chunk, "references": references,
    })
