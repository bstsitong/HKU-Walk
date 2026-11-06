import json
from django import forms
from django.contrib import admin, messages
from django.http import HttpResponseRedirect
from django.urls import reverse
from django.utils.html import format_html, format_html_join

from .models import Submission
from .services import ReviewConflict, review_submission

class ReviewForm(forms.ModelForm):
    decision = forms.ChoiceField(label="审核结果", required=False, choices=[
        ("", "请选择"), ("approved", "通过并发布"), ("changes_requested", "请投稿人修改"),
    ])
    review_version = forms.IntegerField(widget=forms.HiddenInput, required=False)

    class Meta:
        model = Submission
        fields = ["review_note"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance.pk:
            self.fields["review_version"].initial = self.instance.revision

    def clean(self):
        cleaned = super().clean()
        if self.instance.status == Submission.Status.PENDING:
            if cleaned.get("review_version") != self.instance.revision:
                raise forms.ValidationError("投稿已被更新，请刷新页面后重新审核。")
            if not cleaned.get("decision"):
                self.add_error("decision", "请选择审核结果。")
            if cleaned.get("decision") == Submission.Status.CHANGES and not cleaned.get("review_note", "").strip():
                self.add_error("review_note", "请写明需要修改的内容。")
        return cleaned

@admin.register(Submission)
class SubmissionAdmin(admin.ModelAdmin):
    form = ReviewForm
    list_display = ("title", "kind", "is_edit_request", "author", "status", "created_at", "reviewer")
    list_filter = ("status", "kind")
    search_fields = ("title", "body", "author__username", "location")
    ordering = ("-created_at",)
    fields = ("author", "kind", "edit_of", "published_version", "title", "body", "map_preview", "step_images_preview", "location", "external_url", "image_preview",
        "status", "decision", "review_note", "review_version", "reviewer", "reviewed_at", "created_at", "public_entry")
    readonly_fields = ("author", "kind", "edit_of", "published_version", "title", "body", "map_preview", "step_images_preview", "location", "external_url", "image_preview",
        "status", "reviewer", "reviewed_at", "created_at", "public_entry")
    actions = None

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    @admin.display(description="修改申请", boolean=True)
    def is_edit_request(self, obj):
        return bool(obj.edit_of_id)

    @admin.display(description="当前公开内容（对照）")
    def published_version(self, obj):
        if not obj.edit_of_id:
            return "首次投稿"
        return format_html('<strong>{}</strong><p style="white-space:pre-wrap">{}</p>', obj.edit_of.title, obj.edit_of.body)

    @admin.display(description="投稿图片")
    def image_preview(self, obj):
        if not obj.image:
            return "未上传图片"
        return format_html('<a href="{}" target="_blank" rel="noopener"><img src="{}" style="max-width:320px;max-height:260px" alt="投稿配图"></a>',
            reverse("submission-image", args=[obj.pk]), reverse("submission-image", args=[obj.pk]))

    @admin.display(description="地点位置或路线步骤")
    def map_preview(self, obj):
        return format_html('<pre style="white-space:pre-wrap">{}</pre>', json.dumps(obj.map_data, ensure_ascii=False, indent=2)) if obj.map_data else "—"

    @admin.display(description="每步配图")
    def step_images_preview(self, obj):
        return format_html_join('', '<p>步骤 {}<br><a href="{}" target="_blank" rel="noopener"><img src="{}" style="max-width:280px;max-height:220px" alt="步骤配图"></a></p>',
            ((image.step_index + 1, reverse("submission-step-image", args=[image.pk]), reverse("submission-step-image", args=[image.pk])) for image in obj.step_images.all())) or "未上传步骤配图"

    def save_model(self, request, obj, form, change):
        result = review_submission(obj.pk, form.cleaned_data["review_version"],
            form.cleaned_data["decision"], form.cleaned_data.get("review_note", ""), request.user)
        obj.status = result.status
        obj.revision = result.revision
        obj.public_entry = result.public_entry

    def changeform_view(self, request, object_id=None, form_url="", extra_context=None):
        context = dict(extra_context or {})
        if object_id:
            item = self.get_object(request, object_id)
            if item and item.status != Submission.Status.PENDING:
                context.update(show_save=False, show_save_and_continue=False, show_save_and_add_another=False)
        try:
            return super().changeform_view(request, object_id, form_url, context)
        except ReviewConflict as error:
            self.message_user(request, str(error), level=messages.ERROR)
            return HttpResponseRedirect(request.path)
