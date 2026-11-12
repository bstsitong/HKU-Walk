from django import forms
from django.contrib import admin
from django.urls import reverse
from django.utils.html import format_html

from .models import CampusPlace, CampusRoute, GuideCategory, GuidePost, Publication, RouteStep


@admin.register(GuideCategory)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ("title", "key", "sort_order")

    def get_readonly_fields(self, request, obj=None):
        return ("key",) if obj else ()


class PublicationForm(forms.ModelForm):
    published = forms.BooleanField(label="发布到 App", required=False, initial=True)
    sort_order = forms.IntegerField(label="显示顺序", min_value=0, initial=100)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance.publication_id:
            publication = self.instance.publication
            self.initial.update(published=publication.published, sort_order=publication.sort_order)
        if getattr(self.instance, "is_builtin", False):
            self.fields["published"].disabled = True


class PostForm(PublicationForm):
    key = forms.SlugField(label="内容标识", required=False, max_length=80)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance.publication_id:
            self.initial["key"] = self.instance.publication.key
            self.fields["key"].disabled = True

    def clean_key(self):
        key = self.cleaned_data["key"]
        if key and not self.instance.publication_id and Publication.objects.filter(key=key).exists():
            raise forms.ValidationError("这个内容标识已被使用。")
        return key


class PublishedContentAdmin(admin.ModelAdmin):
    form = PublicationForm
    actions = None
    list_filter = ("publication__published",)
    readonly_fields = ("updated_at",)

    @admin.display(description="已发布", boolean=True, ordering="publication__published")
    def is_published(self, obj):
        return obj.publication.published

    @admin.display(description="更新时间", ordering="publication__updated_at")
    def updated_at(self, obj):
        return obj.publication.updated_at if obj.publication_id else None

    def get_queryset(self, request):
        return super().get_queryset(request).filter(publication__removed_by_author=False).select_related("publication")

    def save_model(self, request, obj, form, change):
        values = {field: form.cleaned_data[field] for field in ("published", "sort_order")}
        if change:
            publication = obj.publication
            for field, value in values.items():
                setattr(publication, field, value)
            publication.save(update_fields=["published", "sort_order", "updated_at"])
        else:
            key = form.cleaned_data.get("key")
            if key:
                values["key"] = key
            obj.publication = Publication.objects.create(kind=self.publication_kind, **values)
            if isinstance(obj, CampusPlace):
                obj.code = f"community-place-{obj.publication_id}"
        super().save_model(request, obj, form, change)

    def get_deleted_objects(self, objs, request):
        return super().get_deleted_objects([obj.publication for obj in objs], request)

    def delete_model(self, request, obj):
        obj.publication.delete()


@admin.register(GuidePost)
class PostAdmin(PublishedContentAdmin):
    form = PostForm
    publication_kind = Publication.Kind.POST
    list_display = ("title", "category", "is_published", "is_example", "updated_at")
    list_filter = ("category", "publication__published", "is_example")
    search_fields = ("title", "body", "publication__key")
    fields = ("key", "category", "title", "body", "contributor", "published_at", "external_url", "image_url", "is_example", "published", "sort_order", "updated_at")


@admin.register(CampusPlace)
class PlaceAdmin(PublishedContentAdmin):
    publication_kind = Publication.Kind.PLACE
    list_display = ("name_zh", "name_en", "abbreviation_en", "category", "is_published")
    list_filter = ("category", "publication__published", "is_builtin", "map_version", "has_power_outlets")
    search_fields = ("name_zh", "name_en", "abbreviation_en", "keywords")
    readonly_fields = ("code", "is_builtin", "updated_at")
    fields = (
        "code", "name_zh", "name_en", "abbreviation_en", "keywords", "category", "map_version", "map_x", "map_y",
        "entrance", "floor", "has_power_outlets", "power_outlet_location", "body", "external_url", "image_url",
        "published", "sort_order", "is_builtin", "updated_at",
    )

    def get_changeform_initial_data(self, request):
        return {**super().get_changeform_initial_data(request), "map_version": 2}

    def has_delete_permission(self, request, obj=None):
        return not (obj and obj.is_builtin) and super().has_delete_permission(request, obj)


class RouteStepInline(admin.TabularInline):
    model = RouteStep
    fields = ("position", "title", "body", "photo_link")
    readonly_fields = ("photo_link",)
    extra = 0
    min_num = 1
    max_num = 20

    def get_formset(self, request, obj=None, **kwargs):
        return super().get_formset(request, obj, validate_min=True, validate_max=True, **kwargs)

    @admin.display(description="步骤配图")
    def photo_link(self, obj):
        if obj.photo_id:
            return format_html('<a href="{}" target="_blank" rel="noopener">查看配图</a>',
                               reverse("submission-step-image", args=[obj.photo_id]))
        return "—"


@admin.register(CampusRoute)
class RouteAdmin(PublishedContentAdmin):
    publication_kind = Publication.Kind.ROUTE
    list_display = ("title", "origin", "destination", "is_published", "updated_at")
    search_fields = ("title", "origin__name_zh", "destination__name_zh")
    fields = ("title", "origin", "destination", "body", "external_url", "image_url", "published", "sort_order", "updated_at")
    inlines = (RouteStepInline,)
