from django import forms
from django.contrib import admin

from .knowledge import MAX_UPLOAD, apply_upload, parse_docx
from .models import KnowledgeDocument


class KnowledgeDocumentForm(forms.ModelForm):
    document = forms.FileField(label="上传 Word 文档", required=False,
                               help_text="支持 .docx，不超过 10 MB；替换文件会重新生成检索段落。")

    class Meta:
        model = KnowledgeDocument
        fields = ("key", "title", "title_en", "title_hant", "source_date", "enabled", "document")

    def clean_document(self):
        upload = self.cleaned_data.get("document")
        if not upload:
            if not self.instance.pk or not self.instance.sha256:
                raise forms.ValidationError("请上传知识文档。")
            return None
        if not upload.name.casefold().endswith(".docx") or upload.size > MAX_UPLOAD:
            raise forms.ValidationError("请选择不超过 10 MB 的 .docx 文档。")
        raw = upload.read(MAX_UPLOAD + 1)
        try:
            self.parsed_document = (raw, upload.name, parse_docx(raw))
        except ValueError as error:
            raise forms.ValidationError(str(error)) from error
        return upload


@admin.register(KnowledgeDocument)
class KnowledgeDocumentAdmin(admin.ModelAdmin):
    form = KnowledgeDocumentForm
    list_display = ("title", "enabled", "source_date", "chunk_count", "updated_at")
    list_filter = ("enabled",)
    search_fields = ("title", "title_en", "filename", "key")
    fields = ("key", "title", "title_en", "title_hant", "source_date", "enabled", "document",
              "filename", "sha256", "chunk_count", "reference_count", "updated_at")
    readonly_fields = ("filename", "sha256", "chunk_count", "reference_count", "updated_at")

    @admin.display(description="检索段落")
    def chunk_count(self, obj):
        return len(obj.chunks)

    @admin.display(description="来源条目")
    def reference_count(self, obj):
        return len(obj.references)

    def save_model(self, request, obj, form, change):
        if hasattr(form, "parsed_document"):
            raw, filename, parsed = form.parsed_document
            apply_upload(obj, raw, filename, parsed)
        super().save_model(request, obj, form, change)
