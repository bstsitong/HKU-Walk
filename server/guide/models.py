import uuid
from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator, URLValidator
from django.core.exceptions import ValidationError
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

class Publication(models.Model):
    class Kind(models.TextChoices):
        POST = "post", "指南帖子"
        PLACE = "place", "校园地点"
        ROUTE = "route", "步行路线"

    kind = models.CharField(max_length=5, choices=Kind.choices, default=Kind.POST, db_default=Kind.POST)
    key = models.SlugField("内容标识", unique=True, max_length=80, default=uuid.uuid4)
    published = models.BooleanField("发布到 App", default=True)
    removed_by_author = models.BooleanField(default=False, db_default=False, editable=False)
    sort_order = models.PositiveIntegerField("显示顺序", default=0)
    updated_at = models.DateTimeField("更新时间", auto_now=True)
    current_submission = models.ForeignKey("community.Submission", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+", verbose_name="当前发布版本", editable=False)

    class Meta:
        ordering = ["sort_order", "id"]
        verbose_name = "发布记录"
        verbose_name_plural = "发布记录"
        constraints = [models.CheckConstraint(condition=models.Q(removed_by_author=False) | models.Q(published=False),
                                              name="author_removed_publication_is_hidden")]

    @property
    def content(self):
        return getattr(self, self.kind, None)

    def __str__(self):
        content = self.content
        return str(content) if content else self.key


class ContentFields(models.Model):
    body = models.TextField("正文")
    external_url = models.URLField("相关链接", blank=True, max_length=1000, validators=[http_url])
    image_url = models.URLField("封面图片链接", blank=True, max_length=1000, validators=[http_url])

    class Meta:
        abstract = True


class GuidePost(ContentFields):
    publication = models.OneToOneField(Publication, on_delete=models.CASCADE, primary_key=True, related_name="post")
    category = models.ForeignKey(GuideCategory, on_delete=models.PROTECT, related_name="posts", verbose_name="分类")
    title = models.CharField("标题", max_length=160)
    is_example = models.BooleanField("示例内容", default=False)
    contributor = models.CharField("贡献者", max_length=120, blank=True)
    published_at = models.DateTimeField("发布时间", null=True, blank=True)
    source_pages = models.JSONField("原文子页", default=dict, blank=True, editable=False)

    class Meta:
        verbose_name = "指南帖子"
        verbose_name_plural = "指南帖子"

    def __str__(self):
        return self.title


class GuideLike(models.Model):
    post = models.ForeignKey(GuidePost, on_delete=models.CASCADE, related_name="likes")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["post", "user"], name="one_like_per_guide_post")]


class GuideComment(models.Model):
    post = models.ForeignKey(GuidePost, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    body = models.TextField(max_length=1000)
    request_id = models.UUIDField()
    reply_to = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="replies")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [models.UniqueConstraint(fields=["post", "author", "request_id"], name="unique_guide_comment_request")]


class CampusPlace(ContentFields):
    class Category(models.TextChoices):
        BUILDING = "building", "教学楼"
        STUDY = "study", "学习"
        FOOD = "food", "餐饮"
        TOILET = "toilet", "洗手间"
        ACCESS = "access", "出入口"
        SPACE = "space", "校园空间"

    code = models.SlugField("地点标识", primary_key=True, max_length=80)
    publication = models.OneToOneField(Publication, on_delete=models.CASCADE, related_name="place")
    name_zh = models.CharField("中文名称", max_length=160)
    name_en = models.CharField("英文名称", max_length=160, blank=True)
    abbreviation_en = models.CharField("英文简称", max_length=40, blank=True)
    keywords = models.CharField("其他搜索词", max_length=240, blank=True)
    category = models.CharField("地点类别", max_length=10, choices=Category.choices)
    map_x = models.FloatField("地图横坐标", validators=[MinValueValidator(0), MaxValueValidator(360)])
    map_y = models.FloatField("地图纵坐标", validators=[MinValueValidator(0), MaxValueValidator(580)])
    map_version = models.PositiveSmallIntegerField("底图版本", choices=[(1, "旧版示意图"), (2, "校园地图")], default=1)
    entrance = models.TextField("入口说明", blank=True, max_length=1000)
    floor = models.CharField("楼层说明", blank=True, max_length=500)
    is_builtin = models.BooleanField("内置演示地点", default=False)

    class Meta:
        verbose_name = "校园地点"
        verbose_name_plural = "校园地点"
        constraints = [
            models.CheckConstraint(condition=models.Q(map_x__gte=0, map_x__lte=360, map_y__gte=0, map_y__lte=580), name="campus_place_map_bounds"),
        ]

    def __str__(self):
        return self.name_zh

    @property
    def title(self):
        return self.name_zh


class PlaceComment(models.Model):
    place = models.ForeignKey(CampusPlace, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    body = models.TextField(max_length=1000)
    request_id = models.UUIDField()
    reply_to = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="replies")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [models.UniqueConstraint(fields=["place", "author", "request_id"], name="unique_place_comment_request")]


class CampusRoute(ContentFields):
    publication = models.OneToOneField(Publication, on_delete=models.CASCADE, primary_key=True, related_name="route")
    title = models.CharField("路线名称", max_length=160)
    origin = models.ForeignKey(CampusPlace, on_delete=models.PROTECT, related_name="departing_routes", verbose_name="起点")
    destination = models.ForeignKey(CampusPlace, on_delete=models.PROTECT, related_name="arriving_routes", verbose_name="终点")

    class Meta:
        verbose_name = "步行路线"
        verbose_name_plural = "步行路线"
        constraints = [models.CheckConstraint(condition=~models.Q(origin=models.F("destination")), name="campus_route_distinct_endpoints")]

    def __str__(self):
        return self.title

    def clean(self):
        super().clean()
        if self.origin_id and self.origin_id == self.destination_id:
            raise ValidationError({"destination": "起点和终点不能相同。"})


class RouteStep(models.Model):
    route = models.ForeignKey(CampusRoute, on_delete=models.CASCADE, related_name="steps")
    position = models.PositiveSmallIntegerField("步骤编号", validators=[MaxValueValidator(19)])
    title = models.CharField("步骤标题", max_length=160)
    body = models.TextField("步骤说明", max_length=1500)
    photo = models.ForeignKey("community.SubmissionStepImage", on_delete=models.SET_NULL, null=True, blank=True, related_name="+", editable=False)

    class Meta:
        ordering = ["position"]
        constraints = [
            models.UniqueConstraint(fields=["route", "position"], name="one_published_step_per_position"),
            models.CheckConstraint(condition=models.Q(position__gte=0, position__lt=20), name="published_step_position_range"),
        ]

    def __str__(self):
        return self.title
