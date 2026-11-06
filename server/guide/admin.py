from django.contrib import admin
from .models import GuideCategory, GuideEntry

@admin.register(GuideCategory)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ("title", "key", "sort_order")

    def get_readonly_fields(self, request, obj=None):
        return ("key",) if obj else ()

@admin.register(GuideEntry)
class EntryAdmin(admin.ModelAdmin):
    list_display = ("title", "category", "published", "is_example", "sort_order", "updated_at")
    list_filter = ("category", "published", "is_example")
    search_fields = ("title", "body", "key")
    readonly_fields = ("updated_at",)
    fields = ("category", "title", "body", "map_data", "external_url", "image_url", "is_example", "published", "sort_order", "updated_at")
