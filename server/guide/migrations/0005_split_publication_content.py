"""Separate published data and keep the original publication identifiers."""
import django.core.validators
import django.db.models.deletion
from django.db import migrations, models

from guide.legacy_catalog import place_fields, seed_builtin_places


def move_content(apps, schema_editor):
    using = schema_editor.connection.alias
    Publication = apps.get_model("guide", "Publication")
    CampusPlace = apps.get_model("guide", "CampusPlace")
    posts = apps.get_model("guide", "GuidePost").objects.using(using)
    routes = apps.get_model("guide", "CampusRoute").objects.using(using)
    steps = apps.get_model("guide", "RouteStep").objects.using(using)
    photos = apps.get_model("community", "SubmissionStepImage").objects.using(using)
    publications = Publication.objects.using(using)
    places = CampusPlace.objects.using(using)
    entries = list(publications.all())
    if not entries:
        return

    def common(entry):
        return {
            "publication_id": entry.pk, "body": entry.body,
            "external_url": entry.external_url, "image_url": entry.image_url,
        }

    seed_builtin_places(Publication, CampusPlace, using, legacy_defaults={"category_id": entries[0].category_id})
    route_entries = []
    for entry in entries:
        data = entry.map_data
        kind = data.get("type") if data else "post"
        if kind == "route":
            route_entries.append(entry)
        elif kind == "place":
            places.create(code=f"community-place-{entry.pk}", name_zh=entry.title, **common(entry), **place_fields(data))
        elif kind == "post":
            posts.create(category_id=entry.category_id, title=entry.title, is_example=entry.is_example, **common(entry))
        else:
            raise ValueError(f"Unknown publication type for entry {entry.pk}")
        publications.filter(pk=entry.pk).update(kind=kind)

    available = set(places.values_list("pk", flat=True))
    for entry in route_entries:
        data = entry.map_data
        endpoints = (data["originId"], data["destinationId"])
        # A legacy route could survive deletion of an endpoint. Keep it hidden
        # until an administrator restores the missing place.
        for code in endpoints:
            if code not in available:
                placeholder = publications.create(key=f"legacy-missing-{code}", kind="place", published=False,
                                                  category_id=entry.category_id)
                places.create(code=code, publication_id=placeholder.pk, name_zh="待补充地点",
                              category="space", map_x=0, map_y=0, body="")
                available.add(code)
        route = routes.create(title=entry.title, origin_id=endpoints[0], destination_id=endpoints[1], **common(entry))
        photo_ids = dict(photos.filter(submission_id=entry.current_submission_id).values_list("step_index", "pk"))
        steps.bulk_create([
            steps.model(route_id=route.pk, position=index, title=step["title"], body=step["body"],
                        photo_id=photo_ids.get(step.get("imageIndex", index)))
            for index, step in enumerate(data["steps"])
        ])



def validate_postgres_references(apps, schema_editor):
    # Drain pending FK checks before removing the legacy columns in this transaction.
    if schema_editor.connection.vendor == "postgresql":
        with schema_editor.connection.cursor() as cursor:
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")


class Migration(migrations.Migration):
    dependencies = [
        ("guide", "0004_guideentry_map_data"),
        ("community", "0004_submission_map_data_alter_submission_kind_and_more"),
    ]

    operations = [
        migrations.RenameModel("GuideEntry", "Publication"),
        migrations.AddField(
            model_name="publication",
            name="kind",
            field=models.CharField(
                choices=[
                    ("post", "指南帖子"),
                    ("place", "校园地点"),
                    ("route", "步行路线"),
                ],
                db_default="post",
                default="post",
                max_length=5,
            ),
        ),
        migrations.AlterField(
            model_name="publication",
            name="category",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="legacy_entries",
                to="guide.guidecategory",
                verbose_name="分类",
            ),
        ),
        migrations.CreateModel(
            name="CampusPlace",
            fields=[
                ("body", models.TextField(verbose_name="正文")),
                (
                    "external_url",
                    models.URLField(
                        blank=True,
                        max_length=1000,
                        validators=[
                            django.core.validators.URLValidator(
                                schemes=["http", "https"]
                            )
                        ],
                        verbose_name="相关链接",
                    ),
                ),
                (
                    "image_url",
                    models.URLField(
                        blank=True,
                        max_length=1000,
                        validators=[
                            django.core.validators.URLValidator(
                                schemes=["http", "https"]
                            )
                        ],
                        verbose_name="封面图片链接",
                    ),
                ),
                (
                    "code",
                    models.SlugField(
                        max_length=80,
                        primary_key=True,
                        serialize=False,
                        verbose_name="地点标识",
                    ),
                ),
                ("name_zh", models.CharField(max_length=160, verbose_name="中文名称")),
                (
                    "name_en",
                    models.CharField(
                        blank=True, max_length=160, verbose_name="英文名称"
                    ),
                ),
                (
                    "abbreviation_en",
                    models.CharField(
                        blank=True, max_length=40, verbose_name="英文简称"
                    ),
                ),
                (
                    "keywords",
                    models.CharField(
                        blank=True, max_length=240, verbose_name="其他搜索词"
                    ),
                ),
                (
                    "category",
                    models.CharField(
                        choices=[
                            ("building", "教学楼"),
                            ("study", "学习"),
                            ("food", "餐饮"),
                            ("toilet", "洗手间"),
                            ("access", "出入口"),
                            ("space", "校园空间"),
                        ],
                        max_length=10,
                        verbose_name="地点类别",
                    ),
                ),
                (
                    "map_x",
                    models.FloatField(
                        validators=[
                            django.core.validators.MinValueValidator(0),
                            django.core.validators.MaxValueValidator(360),
                        ],
                        verbose_name="地图横坐标",
                    ),
                ),
                (
                    "map_y",
                    models.FloatField(
                        validators=[
                            django.core.validators.MinValueValidator(0),
                            django.core.validators.MaxValueValidator(580),
                        ],
                        verbose_name="地图纵坐标",
                    ),
                ),
                (
                    "entrance",
                    models.TextField(
                        blank=True, max_length=1000, verbose_name="入口说明"
                    ),
                ),
                (
                    "floor",
                    models.CharField(
                        blank=True, max_length=500, verbose_name="楼层说明"
                    ),
                ),
                (
                    "is_builtin",
                    models.BooleanField(default=False, verbose_name="内置演示地点"),
                ),
                (
                    "publication",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="place",
                        to="guide.publication",
                    ),
                ),
            ],
            options={
                "verbose_name": "校园地点",
                "verbose_name_plural": "校园地点",
            },
        ),
        migrations.CreateModel(
            name="CampusRoute",
            fields=[
                ("body", models.TextField(verbose_name="正文")),
                (
                    "external_url",
                    models.URLField(
                        blank=True,
                        max_length=1000,
                        validators=[
                            django.core.validators.URLValidator(
                                schemes=["http", "https"]
                            )
                        ],
                        verbose_name="相关链接",
                    ),
                ),
                (
                    "image_url",
                    models.URLField(
                        blank=True,
                        max_length=1000,
                        validators=[
                            django.core.validators.URLValidator(
                                schemes=["http", "https"]
                            )
                        ],
                        verbose_name="封面图片链接",
                    ),
                ),
                (
                    "publication",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        primary_key=True,
                        related_name="route",
                        serialize=False,
                        to="guide.publication",
                    ),
                ),
                ("title", models.CharField(max_length=160, verbose_name="路线名称")),
                (
                    "destination",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="arriving_routes",
                        to="guide.campusplace",
                        verbose_name="终点",
                    ),
                ),
                (
                    "origin",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="departing_routes",
                        to="guide.campusplace",
                        verbose_name="起点",
                    ),
                ),
            ],
            options={
                "verbose_name": "步行路线",
                "verbose_name_plural": "步行路线",
            },
        ),
        migrations.CreateModel(
            name="GuidePost",
            fields=[
                ("body", models.TextField(verbose_name="正文")),
                (
                    "external_url",
                    models.URLField(
                        blank=True,
                        max_length=1000,
                        validators=[
                            django.core.validators.URLValidator(
                                schemes=["http", "https"]
                            )
                        ],
                        verbose_name="相关链接",
                    ),
                ),
                (
                    "image_url",
                    models.URLField(
                        blank=True,
                        max_length=1000,
                        validators=[
                            django.core.validators.URLValidator(
                                schemes=["http", "https"]
                            )
                        ],
                        verbose_name="封面图片链接",
                    ),
                ),
                (
                    "publication",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        primary_key=True,
                        related_name="post",
                        serialize=False,
                        to="guide.publication",
                    ),
                ),
                ("title", models.CharField(max_length=160, verbose_name="标题")),
                (
                    "is_example",
                    models.BooleanField(default=False, verbose_name="示例内容"),
                ),
                (
                    "category",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="posts",
                        to="guide.guidecategory",
                        verbose_name="分类",
                    ),
                ),
            ],
            options={
                "verbose_name": "指南帖子",
                "verbose_name_plural": "指南帖子",
            },
        ),
        migrations.CreateModel(
            name="RouteStep",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "position",
                    models.PositiveSmallIntegerField(
                        validators=[django.core.validators.MaxValueValidator(19)],
                        verbose_name="步骤编号",
                    ),
                ),
                ("title", models.CharField(max_length=160, verbose_name="步骤标题")),
                ("body", models.TextField(max_length=1500, verbose_name="步骤说明")),
                (
                    "photo",
                    models.ForeignKey(
                        blank=True,
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to="community.submissionstepimage",
                    ),
                ),
                (
                    "route",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="steps",
                        to="guide.campusroute",
                    ),
                ),
            ],
            options={
                "ordering": ["position"],
            },
        ),
        migrations.AddConstraint(
            model_name="campusplace",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("map_x__gte", 0),
                    ("map_x__lte", 360),
                    ("map_y__gte", 0),
                    ("map_y__lte", 580),
                ),
                name="campus_place_map_bounds",
            ),
        ),
        migrations.AddConstraint(
            model_name="campusroute",
            constraint=models.CheckConstraint(
                condition=models.Q(("origin", models.F("destination")), _negated=True),
                name="campus_route_distinct_endpoints",
            ),
        ),
        migrations.AddConstraint(
            model_name="routestep",
            constraint=models.UniqueConstraint(
                fields=("route", "position"), name="one_published_step_per_position"
            ),
        ),
        migrations.AddConstraint(
            model_name="routestep",
            constraint=models.CheckConstraint(
                condition=models.Q(("position__gte", 0), ("position__lt", 20)),
                name="published_step_position_range",
            ),
        ),
        migrations.RunPython(move_content, reverse_code=migrations.RunPython.noop),
        migrations.RunPython(validate_postgres_references, reverse_code=migrations.RunPython.noop),
        migrations.AlterModelOptions(
            name="publication",
            options={
                "ordering": ["sort_order", "id"],
                "verbose_name": "发布记录",
                "verbose_name_plural": "发布记录",
            },
        ),
        migrations.RemoveField(
            model_name="publication",
            name="body",
        ),
        migrations.RemoveField(
            model_name="publication",
            name="category",
        ),
        migrations.RemoveField(
            model_name="publication",
            name="external_url",
        ),
        migrations.RemoveField(
            model_name="publication",
            name="image_url",
        ),
        migrations.RemoveField(
            model_name="publication",
            name="is_example",
        ),
        migrations.RemoveField(
            model_name="publication",
            name="map_data",
        ),
        migrations.RemoveField(
            model_name="publication",
            name="title",
        ),
    ]
