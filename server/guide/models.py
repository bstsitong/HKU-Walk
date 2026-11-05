import uuid
from django.core.validators import URLValidator
from django.db import models

http_url = URLValidator(schemes=["http", "https"])

class GuideCategory(models.Model):
    key = models.SlugField("分类标识", primary_key=True, max_length=20,
        choices=[("links", "常用快捷链接"), ("tips", "新生入学小 Tips"), ("food", "美食分享"), ("groups", "娱乐群")])
    title = models.CharField("名称", max_length=80)
    subtitle = models.CharField("卡片简介", max_length=160)
    introduction = models.TextField("页面说明", blank=True)
    sort_order = models.PositiveIntegerField("显示顺序", default=0)

    class Meta:
        ordering = ["sort_order", "key"]
        verbose_name = "指南分类"
        verbose_name_plural = "指南分类"

    def __str__(self):
        return self.title

class GuideEntry(models.Model):
    key = models.SlugField("内容标识", unique=True, max_length=80, default=uuid.uuid4)
    category = models.ForeignKey(GuideCategory, on_delete=models.PROTECT, related_name="entries", verbose_name="分类")
    title = models.CharField("标题", max_length=160)
    body = models.TextField("正文")
    external_url = models.URLField("外部链接", blank=True, max_length=1000, validators=[http_url],
        help_text="填写官网、有效邀请链接等，支持 http 和 https。")
    image_url = models.URLField("图片链接", blank=True, max_length=1000, validators=[http_url])
    is_example = models.BooleanField("示例内容", default=False)
    published = models.BooleanField("发布到 App", default=True)
    sort_order = models.PositiveIntegerField("显示顺序", default=0)
    updated_at = models.DateTimeField("更新时间", auto_now=True)
    current_submission = models.ForeignKey("community.Submission", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+", verbose_name="当前发布版本", editable=False)

    class Meta:
        ordering = ["sort_order", "id"]
        verbose_name = "指南内容"
        verbose_name_plural = "指南内容"

    def __str__(self):
        return self.title
