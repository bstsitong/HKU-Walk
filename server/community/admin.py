from django.utils.translation import gettext_lazy as _
from django import forms
from django.contrib import admin, messages
from django.http import HttpResponseRedirect
from django.template.loader import render_to_string
from django.urls import reverse
from django.utils.html import format_html

from guide.models import CampusPlace, CampusRoute

from .models import Submission
from .services import ReviewConflict, review_submission


Kind = Submission.Kind
REVIEW_TYPES = (
    (Kind.NEW_PLACE, _("新地点"), (Kind.NEW_PLACE,)),
    (Kind.PLACE, _("地点纠错"), (Kind.PLACE,)),
    (Kind.NEW_ROUTE, _("新线路"), (Kind.NEW_ROUTE,)),
    (Kind.ROUTE, _("线路纠错"), (Kind.ROUTE,)),
    (Kind.GUIDE, _("学生指南"), (Kind.GUIDE, Kind.FOOD, Kind.GROUP)),
)
KINDS_BY_FILTER = {value: kinds for value, unused_label, kinds in REVIEW_TYPES}
TYPE_LABELS = {kind: label for unused_value, label, kinds in REVIEW_TYPES for kind in kinds}


class SubmissionTypeFilter(admin.SimpleListFilter):
    title = _("投稿类型")
    parameter_name = "type"

    def lookups(self, request, model_admin):
        return [(value, label) for value, label, unused_kinds in REVIEW_TYPES]

    def queryset(self, request, queryset):
        kinds = KINDS_BY_FILTER.get(self.value())
        return queryset.filter(kind__in=kinds) if kinds else queryset


class ReviewForm(forms.ModelForm):
    decision = forms.ChoiceField(label=_("审核结果"), required=False, choices=[
        ("", _("请选择")), ("approved", _("通过并发布")), ("changes_requested", _("请投稿人修改")), ("rejected", _("拒绝投稿")),
    ])
    review_version = forms.IntegerField(widget=forms.HiddenInput, required=False)

    class Meta:
        model = Submission
        fields = ["review_note"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance.pk:
            self.fields["review_version"].initial = self.instance.revision
        if "review_note" in self.fields:
            note = self.fields["review_note"]
            note.label = _("给投稿人的审核意见")
            note.help_text = _("退回修改或拒绝时必填。投稿人可在 App 内查看；被拒绝的稿件不能直接重交。")
            note.widget.attrs["rows"] = 4

    def clean(self):
        cleaned = super().clean()
        if self.instance.status == Submission.Status.PENDING:
            if cleaned.get("review_version") != self.instance.revision:
                raise forms.ValidationError(_("投稿已被更新，请刷新页面后重新审核。"))
            if not cleaned.get("decision"):
                self.add_error("decision", _("请选择审核结果。"))
            if cleaned.get("decision") == Submission.Status.CHANGES and not cleaned.get("review_note", "").strip():
                self.add_error("review_note", _("请写明需要修改的内容。"))
            if cleaned.get("decision") == Submission.Status.REJECTED and not cleaned.get("review_note", "").strip():
                self.add_error("review_note", _("请写明拒绝原因。"))
        return cleaned


@admin.register(Submission)
class SubmissionAdmin(admin.ModelAdmin):
    form = ReviewForm
    change_list_template = "admin/community/submission/review_list.html"
    change_form_template = "admin/community/submission/review_form.html"
    list_display = ("title", "display_kind", "related_target", "status_badge", "author", "created_at", "reviewer")
    list_filter = ("status", SubmissionTypeFilter)
    list_select_related = ("author", "reviewer")
    search_fields = ("title", "body", "author__username", "location")
    search_help_text = _("可按标题、正文、投稿人账号或纠错对象搜索。")
    ordering = ("-created_at",)
    readonly_fields = ("author", "display_kind", "status_badge", "created_at", "submission_content",
                       "published_version", "reviewer", "reviewed_at")
    actions = None

    def has_add_permission(self, request):
        return False

    def get_queryset(self, request):
        return super().get_queryset(request).exclude(public_entry__removed_by_author=True).exclude(edit_of__removed_by_author=True)

    def has_delete_permission(self, request, obj=None):
        return False

    def get_fieldsets(self, request, obj=None):
        fields = [
            (_("稿件信息"), {"fields": (("display_kind", "status_badge"), ("author", "created_at"))}),
            (_("稿件预览"), {"fields": ("submission_content",)}),
        ]
        if obj and obj.edit_of_id:
            fields.append((_("已发布版本"), {"fields": ("published_version",)}))
        if obj and obj.status == Submission.Status.PENDING:
            fields.append((_("审核"), {"fields": ("decision", "review_note", "review_version")}))
        else:
            fields.append((_("审核记录"), {"fields": (("reviewer", "reviewed_at"), "review_note")}))
        return fields

    def get_readonly_fields(self, request, obj=None):
        if obj and obj.status != Submission.Status.PENDING:
            return (*self.readonly_fields, "review_note")
        return self.readonly_fields

    def changelist_view(self, request, extra_context=None):
        return super().changelist_view(request, {**(extra_context or {}), "title": _("投稿审核")})

    @admin.display(description=_("投稿类型"), ordering="kind")
    def display_kind(self, obj):
        label = TYPE_LABELS.get(obj.kind, obj.get_kind_display())
        return _("%(type)s · 修改申请") % {"type": label} if obj.edit_of_id else label

    @admin.display(description=_("纠错对象"), empty_value="—")
    def related_target(self, obj):
        return obj.location if obj.kind in (Kind.PLACE, Kind.ROUTE) else None

    @admin.display(description=_("审核状态"), ordering="status")
    def status_badge(self, obj):
        return format_html('<span class="review-status review-status--{}">{}</span>', obj.status, obj.get_status_display())

    @admin.display(description=_("当前公开内容"))
    def published_version(self, obj):
        content = obj.edit_of.content
        if content is None:
            return _("该版本已不可用。")
        title = content.name_zh if isinstance(content, CampusPlace) else content.title
        url = reverse(f"admin:{content._meta.app_label}_{content._meta.model_name}_change", args=[content.pk])
        return format_html('<div class="review-copy"><a href="{}">{}</a><p>{}</p></div>', url, title, content.body)

    @admin.display(description=_("稿件"))
    def submission_content(self, obj):
        data = obj.map_data or {}
        place_fields = []
        targets = []
        route = None
        if obj.kind == Kind.NEW_PLACE:
            category = dict(CampusPlace.Category.choices).get(data.get("category"))
            coordinates = None
            if data.get("x") is not None and data.get("y") is not None:
                coordinates = _("X %(x)s · Y %(y)s（底图版本 %(version)s）") % {"x": data["x"], "y": data["y"], "version": data.get("mapVersion", 1)}
            place_fields = [
                (_("地点类别"), category), (_("英文名称"), data.get("english")), (_("英文简称"), data.get("abbreviation")),
                (_("地图选点"), coordinates),
            ]
        elif obj.kind in (Kind.PLACE, Kind.ROUTE, Kind.NEW_ROUTE):
            keys = ((_("纠错地点"), "placeId"),) if obj.kind == Kind.PLACE else ((_("起点"), "originId"), (_("终点"), "destinationId"))
            places = CampusPlace.objects.select_related("publication").in_bulk(data[key] for unused_label, key in keys if data.get(key))
            targets = [(label, data[key], places.get(data[key])) for label, key in keys if data.get(key)]
            if obj.kind == Kind.ROUTE and data.get("routeId"):
                route = CampusRoute.objects.select_related("publication").filter(pk=data["routeId"]).first()

        body_photos = {photo.block_index: photo.pk for photo in obj.body_images.all()} if obj.body_blocks else {}
        blocks = []
        for index, block in enumerate(obj.body_blocks):
            items = [line.strip() for line in block["text"].splitlines() if line.strip()] if block["type"] == "list" else []
            blocks.append({**block, "photo": body_photos.get(index), "items": items})

        steps = []
        if obj.kind == Kind.NEW_ROUTE:
            photos = {photo.step_index: photo.pk for photo in obj.step_images.all()}
            steps = [{**step, "photo": photos.get(step.get("imageIndex", index))}
                     for index, step in enumerate(data.get("steps", []))]

        body_heading = {
            Kind.NEW_PLACE: _("地点介绍"), Kind.NEW_ROUTE: _("线路简介"),
            Kind.PLACE: _("纠错说明"), Kind.ROUTE: _("纠错说明"),
        }.get(obj.kind, _("正文"))
        return render_to_string("admin/community/submission/content.html", {
            "submission": obj, "place_fields": place_fields, "targets": targets, "route": route,
            "route_id": data.get("routeId"), "blocks": blocks, "steps": steps, "body_heading": body_heading,
            "image_label": _("路线总览图") if obj.kind == Kind.NEW_ROUTE else _("投稿配图"),
        })

    def save_model(self, request, obj, form, change):
        if obj.status != Submission.Status.PENDING:
            raise ReviewConflict(_("这条投稿已处理，请返回审核列表。"))
        result = review_submission(obj.pk, form.cleaned_data["review_version"],
            form.cleaned_data["decision"], form.cleaned_data.get("review_note", ""), request.user)
        obj.status = result.status
        obj.revision = result.revision
        obj.public_entry = result.public_entry

    def changeform_view(self, request, object_id=None, form_url="", extra_context=None):
        try:
            return super().changeform_view(request, object_id, form_url, extra_context)
        except ReviewConflict as error:
            self.message_user(request, str(error), level=messages.ERROR)
            return HttpResponseRedirect(request.path)
