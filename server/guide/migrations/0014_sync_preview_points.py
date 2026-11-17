from django.db import migrations


# Snapshot of the approved preview mapped to campus map version 2.
POSITIONS = {'asian-gourmet': (65.8, 152.269827),
 'bijas': (80.2, 152.269827),
 'cafe': (229.32, 231.011304),
 'centennial-gate': (70.659, 103.646582),
 'centennial-red-wall': (77, 176.855059),
 'central-podium': (79, 185.050137),
 'chiwah': (70.1, 184.785779),
 'heritage-house': (74.6, 127.15588),
 'hku-press-bookshop': (74.6, 127.15588),
 'lee-shau-kee': (94.5, 187.429353),
 'so330': (273.669, 271.740839),
 'subway': (228.273, 293.785597),
 'visitor-centre': (59.6, 122.000912)}

NEW_PLACES = [{'id': 'visitor-centre-gift-shop',
  'name': '访客中心纪念品店',
  'english': 'Visitor Centre Gift Shop',
  'abbreviation': '',
  'keywords': '访客中心纪念品 访客中心商店 百周年校园纪念品 gift shop souvenirs',
  'category': 'space',
  'entrance': '位于港大访客中心内。',
  'floor': 'G/F',
  'x': 57.3,
  'y': 122.000912},
 {'id': 'university-drive-gate',
  'name': '大学道出入口',
  'english': 'University Drive Entrance',
  'abbreviation': '',
  'keywords': '大学道校门 旭龢道 Kotewall Road university drive gate',
  'category': 'access',
  'entrance': '位于大学道与旭龢道相接处。',
  'floor': '',
  'x': 299.2,
  'y': 467.383774},
 {'id': 'lyttelton-gate',
  'name': '列堤顿道校门',
  'english': 'Lyttelton Road Gate',
  'abbreviation': '',
  'keywords': '列堤顿道出口 列堤顿道出入口 Lyttelton Road Exit',
  'category': 'access',
  'entrance': '列堤顿道出口。通行安排以现场标示为准。',
  'floor': '',
  'x': 345.9,
  'y': 305.597083}]


def sync_preview_points(apps, schema_editor):
    places = apps.get_model("guide", "CampusPlace").objects.using(schema_editor.connection.alias)
    publications = apps.get_model("guide", "Publication").objects.using(schema_editor.connection.alias)
    if not places.filter(is_builtin=True).exists():
        return
    for code, (x, y) in POSITIONS.items():
        changes = {"map_x": x, "map_y": y}
        if code == "centennial-red-wall":
            changes["entrance"] = "位于百周年校园智华馆旁。"
        places.filter(pk=code, is_builtin=True, map_version=2).update(**changes)

    for data in NEW_PLACES:
        code = data["id"]
        publication, _ = publications.get_or_create(
            key=f"builtin-{code}", defaults={"kind": "place"},
        )
        places.get_or_create(code=code, defaults={
            "publication": publication, "is_builtin": True, "map_version": 2,
            "name_zh": data["name"], "name_en": data["english"], "abbreviation_en": data["abbreviation"],
            "keywords": data["keywords"], "category": data["category"],
            "map_x": data["x"], "map_y": data["y"], "entrance": data["entrance"], "floor": data["floor"],
            "body": "",
        })


class Migration(migrations.Migration):
    dependencies = [("guide", "0013_add_campus_water_category")]
    operations = [migrations.RunPython(sync_preview_points, migrations.RunPython.noop)]
