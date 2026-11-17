import json
import re
from html.parser import HTMLParser
from unicodedata import normalize
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from django.conf import settings
from django.db.models import Q

from .articles import ARTICLE_KEYS, ARTICLE_SCOPE
from .catalog import published_routes
from .map_display import canonical_place_id
from .models import CampusPlace, GuidePost


DEEPSEEK_BASE_URL = "https://api.deepseek.com"
HKU_WEB_SITES = {"catering": "catering.hku.hk", "library": "lib.hku.hk", "estates": "estates.hku.hk"}
HKU_WEB_INDEXES = {
    "catering": ("https://catering.hku.hk/en/eateries/", "HKU Campus Eateries"),
    "library": ("https://lib.hku.hk/general/hours/weekly.html", "HKU Libraries Opening Hours"),
}


class AssistantServiceError(Exception):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def post_json(url, key, data, timeout):
    try:
        target = urlsplit(url)
        if target.scheme != "https" or not target.hostname or target.username or target.password or target.query or target.fragment:
            raise AssistantServiceError()
        request = Request(url, json.dumps(data, ensure_ascii=False).encode("utf-8"), {
            "Authorization": f"Bearer {key}", "Content-Type": "application/json",
        })
        with build_opener(NoRedirect()).open(request, timeout=timeout) as response:
            raw = response.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise AssistantServiceError()
        result = json.loads(raw)
    except HTTPError as error:
        error.close()
        raise AssistantServiceError() from None
    except (URLError, OSError, ValueError) as error:
        raise AssistantServiceError() from error
    if not isinstance(result, dict):
        raise AssistantServiceError()
    return result


def clean_excerpt(value, limit=440):
    if not isinstance(value, str):
        return ""
    value = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", value)
    value = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", value)
    return re.sub(r"\s+", " ", value).strip()[:limit]


def keywords_for(args):
    raw = args.get("keywords")
    if not isinstance(raw, list):
        return []
    return list(dict.fromkeys(term.strip()[:80] for term in raw[:6] if isinstance(term, str) and term.strip()))


def matching_any(fields, terms):
    query = Q()
    for term in terms:
        for field in fields:
            query |= Q(**{f"{field}__icontains": term})
    return query


def search_places(args, language, *, exact_name=None):
    places = CampusPlace.objects.filter(publication__published=True)
    if exact_name:
        places = places.filter(Q(name_zh__iexact=exact_name) | Q(name_en__iexact=exact_name))
    category = args.get("category")
    outlets = args.get("has_power_outlets") is True
    terms = keywords_for(args)
    if category in CampusPlace.Category.values:
        places = places.filter(category=category)
    if outlets:
        places = places.filter(has_power_outlets=True)
    if terms:
        places = places.filter(matching_any(("name_zh", "name_en", "abbreviation_en", "keywords", "body", "entrance", "floor"), terms))
    if not exact_name and not terms and not outlets and category not in CampusPlace.Category.values:
        return []
    rows = list(places.order_by("publication__sort_order", "pk"))
    rows.sort(key=lambda place: -sum(
        term.casefold() in " ".join((place.name_zh, place.name_en, place.abbreviation_en, place.keywords)).casefold()
        for term in terms
    ))
    results = []
    for place in rows[:8]:
        outlet_location = place.power_outlet_location if place.has_power_outlets else ""
        title = (place.name_en or place.name_zh) if language == "en" else place.name_zh
        results.append({
            "kind": "place", "id": place.pk, "title": title,
            "detail": clean_excerpt(outlet_location or place.floor or place.entrance or place.body, 220),
            "names": [name for name in (place.name_zh, place.name_en) if name],
            "evidence": clean_excerpt("\n".join(filter(None, (place.name_zh, place.name_en, place.floor, place.entrance, place.body)))),
            "hasPowerOutlets": place.has_power_outlets, "powerOutletLocation": outlet_location,
        })
    return results


def endpoint_names(place):
    aliases = re.split(r"[\s,，、;；|]+", place.keywords)
    return {normalize("NFKC", name).casefold() for name in (
        place.pk, place.name_zh, place.name_en, place.abbreviation_en, *aliases,
    ) if name}


def route_endpoint_query(side, term):
    return (Q(**{f"{side}_id": canonical_place_id(term.casefold())}) |
            matching_any((f"{side}__name_zh", f"{side}__name_en", f"{side}__abbreviation_en", f"{side}__keywords"), [term]))


def search_route(origin, destination):
    if any(not isinstance(term, str) or not 0 < len(term.strip()) <= 160 for term in (origin, destination)):
        return None
    origin, destination = (normalize("NFKC", term.strip()) for term in (origin, destination))
    queryset = (published_routes().filter(route_endpoint_query("origin", origin), route_endpoint_query("destination", destination))
                .select_related("origin", "destination")
                .order_by("publication__sort_order", "pk"))
    match = None
    for route in queryset:
        if not all(term.casefold() in endpoint_names(place) or canonical_place_id(term.casefold()) == place.pk
                   for term, place in ((origin, route.origin), (destination, route.destination))):
            continue
        if match is None:
            match = route
        elif (route.origin_id, route.destination_id) != (match.origin_id, match.destination_id):
            return None
    return match


def search_guides(args):
    terms = keywords_for(args)
    if not terms:
        return []
    posts = (GuidePost.objects.filter(publication__published=True).filter(ARTICLE_SCOPE)
             .filter(matching_any(("title", "body"), terms) | Q(publication__key__in=ARTICLE_KEYS))
             .order_by("publication__sort_order", "pk")[:35])
    results = []
    for post in posts:
        segments = [("", post.title, post.body)]
        if isinstance(post.source_pages, dict):
            segments.extend((key, str(page.get("title", "")), str(page.get("body", "")))
                            for key, page in post.source_pages.items() if isinstance(page, dict))
        page_key, best_title, best_body = max(segments, key=lambda part: sum(
            3 * (term.casefold() in part[1].casefold()) + (term.casefold() in part[2].casefold()) for term in terms
        ))
        positions = [best_body.casefold().find(term.casefold()) for term in terms]
        if all(pos < 0 for pos in positions) and not any(term.casefold() in best_title.casefold() for term in terms):
            continue
        start = max(0, min((pos for pos in positions if pos >= 0), default=0) - 100)
        results.append({"kind": "guide", "id": str(post.publication_id), "title": post.title, "pageKey": page_key,
                        "detail": clean_excerpt(best_title, 160) if best_title != post.title else "",
                        "evidence": clean_excerpt(best_body[start:start + 1300], 800)})
    results.sort(key=lambda item: -sum(term.casefold() in (item["title"] + " " + item["detail"]).casefold() for term in terms))
    return results[:5]


def official_url(value):
    if not isinstance(value, str) or len(value) > 2048:
        return False
    try:
        url = urlsplit(value)
        host = url.hostname or ""
        return (url.scheme == "https" and not url.username and not url.password and url.port in (None, 443)
                and (host == "hku.hk" or host.endswith(".hku.hk")))
    except ValueError:
        return False


def page_excerpt(body, terms):
    if not isinstance(body, str):
        return ""
    positions = [body.casefold().find(term.casefold()) for term in terms]
    match = min((position for position in positions if position >= 0), default=None)
    if terms and match is None:
        return ""
    start = max(0, (match or 0) - 250)
    return clean_excerpt(body[start:start + 3800], 2600)


class PageText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "noscript"}:
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript"} and self.hidden:
            self.hidden -= 1

    def handle_data(self, data):
        if not self.hidden and data.strip():
            self.parts.append(data.strip())


def read_hku_index(url):
    try:
        with build_opener(NoRedirect()).open(Request(url, headers={"Accept": "text/html"}), timeout=5) as response:
            raw = response.read(512 * 1024)
            encoding = response.headers.get_content_charset() or "utf-8"
    except HTTPError as error:
        error.close()
        return ""
    except (URLError, OSError):
        return ""
    parser = PageText()
    try:
        parser.feed(raw.decode(encoding, errors="replace"))
    except (LookupError, ValueError):
        return ""
    return "\n".join(parser.parts)


def search_web(query, site=None, required_terms=()):
    key = settings.DEEPSEEK_API_KEY
    if not key or not isinstance(query, str) or not query.strip():
        return []
    domain = HKU_WEB_SITES.get(site, "hku.hk") if isinstance(site, str) else "hku.hk"
    query = re.sub(r"(?:^|\s)-?site:\S+", " ", query, flags=re.IGNORECASE)
    query = " ".join(query.split())[:128 - len(domain) - 6]
    if not query:
        return []
    response = post_json(f"{DEEPSEEK_BASE_URL}/v1/tools/search", key, {
        "query": f"{query} site:{domain}", "count": 10, "need_content": False,
    }, timeout=5)
    results = []
    for row in response.get("results") or []:
        if not isinstance(row, dict) or not official_url(row.get("url")):
            continue
        url = row["url"]
        host = urlsplit(url).hostname
        if host != domain and not host.endswith("." + domain):
            continue
        text = " ".join(str(row.get(field) or "") for field in ("title", "snippet", "summary")).casefold()
        if required_terms and not any(term.casefold() in text for term in required_terms):
            continue
        title = clean_excerpt(row.get("title"), 180) or host
        results.append({"kind": "web", "id": url, "url": url, "title": title,
                        "detail": clean_excerpt(row.get("snippet"), 190),
                        "evidence": clean_excerpt(row.get("summary") or row.get("snippet"), 700)})
        if len(results) == 3:
            break
    index = HKU_WEB_INDEXES.get(site) if isinstance(site, str) else None
    if results:
        try:
            page = post_json(f"{DEEPSEEK_BASE_URL}/v1/tools/fetch", key, {"url": results[0]["url"]}, timeout=4)
            content = page_excerpt(page.get("content"), required_terms)
            if content:
                results[0]["evidence"] += " " + content
        except AssistantServiceError:
            pass
    elif index:
        page_url, page_title = index
        content = page_excerpt(read_hku_index(page_url), required_terms)
        if content:
            results.append({"kind": "web", "id": page_url, "url": page_url, "title": page_title,
                            "detail": "", "evidence": content})
    return results
