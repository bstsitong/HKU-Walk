from django.utils.translation import gettext_lazy as _
import uuid
from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator, URLValidator
from django.core.exceptions import ValidationError
from django.db import models
from .map_display import DISPLAY_LEVELS

http_url = URLValidator(schemes=["http", "https"])

class GuideCategory(models.Model):
    key = models.SlugField(_("分类标识"), primary_key=True, max_length=20,
        choices=[("links", _("常用快捷链接")), ("tips", _("新生入学小 Tips")), ("food", _("美食分享")), ("groups", _("娱乐群"))])
    title = models.CharField(_("名称"), max_length=80)
    subtitle = models.CharField(_("卡片简介"), max_length=160)
    introduction = models.TextField(_("页面说明"), blank=True)
    sort_order = models.PositiveIntegerField(_("显示顺序"), default=0)

    class Meta:
        ordering = ["sort_order", "key"]
        verbose_name = _("指南分类")
        verbose_name_plural = _("指南分类")

    def __str__(self):
        return self.title

class Publication(models.Model):
    class Kind(models.TextChoices):
        POST = "post", _("指南帖子")
        PLACE = "place", _("校园地点")
        ROUTE = "route", _("步行路线")

    kind = models.CharField(max_length=5, choices=Kind.choices, default=Kind.POST, db_default=Kind.POST)
    key = models.SlugField(_("内容标识"), unique=True, max_length=80, default=uuid.uuid4)
    published = models.BooleanField(_("发布到 App"), default=True)
    removed_by_author = models.BooleanField(default=False, db_default=False, editable=False)
    sort_order = models.PositiveIntegerField(_("显示顺序"), default=0)
    updated_at = models.DateTimeField(_("更新时间"), auto_now=True)
    current_submission = models.ForeignKey("community.Submission", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+", verbose_name=_("当前发布版本"), editable=False)

    class Meta:
        ordering = ["sort_order", "id"]
        verbose_name = _("发布记录")
        verbose_name_plural = _("发布记录")
        constraints = [models.CheckConstraint(condition=models.Q(removed_by_author=False) | models.Q(published=False),
                                              name="author_removed_publication_is_hidden")]

    @property
    def content(self):
        return getattr(self, self.kind, None)

    def __str__(self):
        content = self.content
        return str(content) if content else self.key


class ContentFields(models.Model):
    body = models.TextField(_("正文"))
    external_url = models.URLField(_("相关链接"), blank=True, max_length=1000, validators=[http_url])
    image_url = models.URLField(_("封面图片链接"), blank=True, max_length=1000, validators=[http_url])

    class Meta:
        abstract = True


class GuidePost(ContentFields):
    publication = models.OneToOneField(Publication, on_delete=models.CASCADE, primary_key=True, related_name="post")
    category = models.ForeignKey(GuideCategory, on_delete=models.PROTECT, related_name="posts", verbose_name=_("分类"))
    title = models.CharField(_("标题"), max_length=160)
    is_example = models.BooleanField(_("示例内容"), default=False)
    contributor = models.CharField(_("贡献者"), max_length=120, blank=True)
    published_at = models.DateTimeField(_("发布时间"), null=True, blank=True)
    source_pages = models.JSONField(_("原文子页"), default=dict, blank=True, editable=False)

    class Meta:
        verbose_name = _("指南帖子")
        verbose_name_plural = _("指南帖子")

    def __str__(self):
        return self.title


class KnowledgeDocument(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    key = models.SlugField(_("资料标识"), max_length=100, unique=True)
    title = models.CharField(_("简体标题"), max_length=200)
    title_en = models.CharField(_("英文标题"), max_length=200, blank=True)
    title_hant = models.CharField(_("繁体标题"), max_length=200, blank=True)
    source_date = models.DateField(_("资料整理日期"), null=True, blank=True)
    enabled = models.BooleanField(_("供 AskHKU 检索"), default=False)
    filename = models.CharField(_("原文件名"), max_length=240, editable=False)
    sha256 = models.CharField(_("文件校验值"), max_length=64, editable=False)
    original = models.BinaryField(_("原文件"), editable=False)
    blocks = models.JSONField(_("完整原文"), default=list, editable=False)
    references = models.JSONField(_("来源登记"), default=dict, editable=False)
    chunks = models.JSONField(_("检索段落"), default=list, editable=False)
    updated_at = models.DateTimeField(_("更新时间"), auto_now=True)

    class Meta:
        verbose_name = _("AskHKU 知识库资料")
        verbose_name_plural = _("AskHKU 知识库资料")
        ordering = ["title", "id"]

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
        BUILDING = "building", _("教学楼")
        STUDY = "study", _("学习")
        FOOD = "food", _("餐饮")
        TOILET = "toilet", _("洗手间")
        WATER = "water", _("饮水点")
        ACCESS = "access", _("出入口")
        SPACE = "space", _("校园空间")

    code = models.SlugField(_("地点标识"), primary_key=True, max_length=80)
    publication = models.OneToOneField(Publication, on_delete=models.CASCADE, related_name="place")
    name_zh = models.CharField(_("中文名称"), max_length=160)
    name_en = models.CharField(_("英文名称"), max_length=160, blank=True)
    abbreviation_en = models.CharField(_("英文简称"), max_length=40, blank=True)
    keywords = models.CharField(_("其他搜索词"), max_length=240, blank=True)
    category = models.CharField(_("地点类别"), max_length=10, choices=Category.choices)
    display_level = models.PositiveSmallIntegerField(_("地图显示层级"), choices=DISPLAY_LEVELS, db_default=4, default=4)
    map_x = models.FloatField(_("地图横坐标"), validators=[MinValueValidator(0), MaxValueValidator(360)])
    map_y = models.FloatField(_("地图纵坐标"), validators=[MinValueValidator(0), MaxValueValidator(580)])
    map_version = models.PositiveSmallIntegerField(_("底图版本"), choices=[(1, _("旧版示意图")), (2, _("校园地图"))], default=1)
    entrance = models.TextField(_("入口说明"), blank=True, max_length=1000)
    floor = models.CharField(_("楼层说明"), blank=True, max_length=500)
    has_power_outlets = models.BooleanField(_("有可用插座"), null=True, blank=True, default=None)
    power_outlet_location = models.CharField(_("插座位置"), blank=True, max_length=300, db_default="")
    is_builtin = models.BooleanField(_("内置演示地点"), default=False)

    class Meta:
        verbose_name = _("校园地点")
        verbose_name_plural = _("校园地点")
        constraints = [
            models.CheckConstraint(condition=models.Q(map_x__gte=0, map_x__lte=360, map_y__gte=0, map_y__lte=580), name="campus_place_map_bounds"),
            models.CheckConstraint(condition=models.Q(display_level__in=(1, 2, 3, 4)), name="campus_place_display_level"),
        ]

    def __str__(self):
        return self.name_zh

    @property
    def title(self):
        return self.name_zh


class CampusFacility(models.Model):
    class Kind(models.TextChoices):
        LIFT = "lift", _("升降机")
        STAIRS = "stairs", _("楼梯")
        BRIDGE = "bridge", _("行人天桥")
        RAMP = "ramp", _("坡道")
        PARKING = "parking", _("停车场")
        ACCESSIBLE_PARKING = "accessibleParking", _("无障碍车位")

    code = models.SlugField(_("设施标识"), primary_key=True, max_length=80)
    kind = models.CharField(_("设施类型"), choices=Kind.choices, max_length=20)
    title = models.CharField(_("名称"), max_length=160)
    name_en = models.CharField(_("英文名称"), max_length=160)
    detail = models.TextField(_("说明"), blank=True)
    map_x = models.FloatField(_("横坐标"), validators=[MinValueValidator(0), MaxValueValidator(360)])
    map_y = models.FloatField(_("纵坐标"), validators=[MinValueValidator(0), MaxValueValidator(219.4)])
    display_level = models.PositiveSmallIntegerField(_("地图显示层级"), choices=DISPLAY_LEVELS, default=4)
    overview = models.BooleanField(_("设施总览显示"), default=False)
    approximate = models.BooleanField(_("位置为示意"), default=False)
    image_url = models.URLField(_("设施照片链接"), blank=True, db_default="", max_length=1000, validators=[http_url])

    class Meta:
        verbose_name = _("校园地图设施")
        verbose_name_plural = _("校园地图设施")
        constraints = [
            models.CheckConstraint(condition=models.Q(display_level__in=(1, 2, 3, 4)), name="campus_facility_display_level"),
            models.CheckConstraint(condition=models.Q(map_x__gte=0, map_x__lte=360, map_y__gte=0, map_y__lte=219.4), name="campus_facility_map_bounds"),
        ]

    def __str__(self):
        return self.title


class AssistantUsage(models.Model):
    day = models.DateField(primary_key=True)
    requests = models.PositiveIntegerField(default=0)


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
    title = models.CharField(_("路线名称"), max_length=160)
    origin = models.ForeignKey(CampusPlace, on_delete=models.PROTECT, related_name="departing_routes", verbose_name=_("起点"))
    destination = models.ForeignKey(CampusPlace, on_delete=models.PROTECT, related_name="arriving_routes", verbose_name=_("终点"))

    class Meta:
        verbose_name = _("步行路线")
        verbose_name_plural = _("步行路线")
        constraints = [models.CheckConstraint(condition=~models.Q(origin=models.F("destination")), name="campus_route_distinct_endpoints")]

    def __str__(self):
        return self.title

    def clean(self):
        super().clean()
        if self.origin_id and self.origin_id == self.destination_id:
            raise ValidationError({"destination": _("起点和终点不能相同。")})


class RouteStep(models.Model):
    route = models.ForeignKey(CampusRoute, on_delete=models.CASCADE, related_name="steps")
    position = models.PositiveSmallIntegerField(_("步骤编号"), validators=[MaxValueValidator(19)])
    title = models.CharField(_("步骤标题"), max_length=160)
    body = models.TextField(_("步骤说明"), max_length=1500, blank=True)
    photo = models.ForeignKey("community.SubmissionStepImage", on_delete=models.SET_NULL, null=True, blank=True, related_name="+", editable=False)

    class Meta:
        ordering = ["position"]
        constraints = [
            models.UniqueConstraint(fields=["route", "position"], name="one_published_step_per_position"),
            models.CheckConstraint(condition=models.Q(position__gte=0, position__lt=20), name="published_step_position_range"),
        ]

    def __str__(self):
        return self.title
