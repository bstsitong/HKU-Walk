"""Versioned, AI-only document evidence. No guide posts or map records are created."""
import hashlib
import io
import math
import re
from collections import Counter
from pathlib import PurePosixPath
from unicodedata import normalize
from urllib.parse import urlsplit
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZipFile

from .models import KnowledgeDocument

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
MAX_UPLOAD = 10 * 1024 * 1024
STOP_WORDS = set("a an the is are was were it its in on at to for of and or do does can how what where which when me i my hku hong kong university please tell about have has with from there this that be get use".split())
ALIASES = [
    (("智华", "智華", "知华", "知華", "chi wah", "chiwah"), ("chi wah",)),
    (("主图书馆", "主圖書館", "大学图书馆", "大學圖書館", "main library"), ("main library",)),
    (("法律图书馆", "法律圖書館", "law library"), ("law library",)),
    (("牙科", "dental"), ("dental",)), (("医学图书馆", "醫學圖書館", "medical library"), ("medical library",)),
    (("充电", "充電", "插座", "电源", "電源", "charging", "socket", "powered"), ("charging", "socket", "powered", "power")),
    (("笔记本", "筆記本", "手提电脑", "手提電腦", "laptop", "notebook"), ("laptop", "notebook")),
    (("功率", "瓦数", "瓦數", "watt", "rating"), ("rating", "watt")),
    (("打印", "列印", "影印", "uprint", "printing"), ("printing", "uprint", "print")),
    (("扫描", "掃描", "scanning"), ("scanning", "scanner",)),
    (("预约", "預約", "booking", "reservation"), ("booking", "reservation", "check-in")),
    (("讨论室", "討論室", "自修室", "研讨室", "研討室"), ("study room", "discussion room")),
    (("开放时间", "開放時間", "几点", "幾點", "关门", "關門", "通宵", "overnight", "hours"), ("hours", "opening", "overnight")),
    (("人数", "人數", "容量", "座位", "seats", "capacity"), ("capacity", "seats")),
    (("幾人", "几人", "容纳", "容納", "几个人", "幾個人"), ("capacity", "seats")),
    (("双面", "雙面", "duplex"), ("duplex",)), (("黑白", "black and white"), ("black and white",)),
    (("费用", "費用", "价格", "價格", "价钱", "價錢", "收费", "收費"), ("charges", "price", "hk$")),
    (("电梯", "電梯", "升降机", "升降機", "lift", "elevator"), ("lift",)),
    (("校巴", "穿梭", "shuttle"), ("shuttle", "bus")),
    (("淋浴", "洗澡", "冲凉", "沖涼", "shower"), ("shower",)),
    (("钢琴", "鋼琴", "piano"), ("piano", "music")),
    (("祈祷", "祈禱", "prayer"), ("prayer",)),
    (("母婴", "母嬰", "哺乳", "baby", "nursing"), ("baby care",)),
    (("医务", "醫務", "诊所", "診所", "health service"), ("university health service",)),
    (("健身", "fitness"), ("fitness",)), (("游泳", "泳池", "swimming"), ("swimming", "pool")),
    (("储物", "儲物", "locker"), ("locker",)), (("失物", "丢失", "遺失", "lost"), ("lost", "found")),
    (("餐厅", "餐廳", "食堂", "吃饭", "吃飯", "dining", "canteen"), ("dining", "canteen", "restaurant")),
    (("黄克竞", "黃克競", "haking wong"), ("haking wong",)),
    (("赛马会", "賽馬會", "jockey club"), ("jockey club",)),
    (("小红书", "小紅書", "xiaohongshu"), ("xiaohongshu",)),
]


def safe_link(value):
    try:
        parsed = urlsplit(value)
        return parsed.scheme in {"http", "https"} and bool(parsed.hostname) and not parsed.username and not parsed.password
    except ValueError:
        return False


def parse_docx(raw):
    """Read paragraphs, hyperlinks and tables in their original body order."""
    if not raw or len(raw) > MAX_UPLOAD:
        raise ValueError("请选择不超过 10 MB 的 Word 文档。")
    try:
        with ZipFile(io.BytesIO(raw)) as archive:
            if len(archive.infolist()) > 2000 or sum(item.file_size for item in archive.infolist()) > 25 * 1024 * 1024:
                raise ValueError("文档解压后的内容过大。")
            xml = archive.read("word/document.xml")
            if b"<!DOCTYPE" in xml or b"<!ENTITY" in xml:
                raise ValueError("文档包含不支持的 XML 定义。")
            root = ET.fromstring(xml)
            links = {}
            if "word/_rels/document.xml.rels" in archive.namelist():
                rel_xml = archive.read("word/_rels/document.xml.rels")
                if b"<!DOCTYPE" in rel_xml or b"<!ENTITY" in rel_xml:
                    raise ValueError("文档链接格式不受支持。")
                for node in ET.fromstring(rel_xml):
                    target = node.get("Target", "")
                    if node.get("TargetMode") == "External" and safe_link(target):
                        links[node.get("Id")] = target
            body = root.find("w:body", NS)
            if body is None:
                raise ValueError("文档没有正文。")

            def paragraph(node):
                text = "".join(item.text or "" for item in node.findall(".//w:t", NS)).strip()
                urls = [links.get(item.get("{" + REL + "}id")) for item in node.findall(".//w:hyperlink", NS)]
                urls = [url for url in urls if url and url not in text]
                return text + ("\n" + "\n".join(dict.fromkeys(urls)) if urls else "")

            blocks = []
            for position, node in enumerate(body):
                if node.tag == "{" + NS["w"] + "}p":
                    text = paragraph(node)
                    style = node.find("w:pPr/w:pStyle", NS)
                    if text:
                        blocks.append({"position": position, "type": "paragraph", "text": text,
                                       "style": style.get("{" + NS["w"] + "}val", "") if style is not None else ""})
                elif node.tag == "{" + NS["w"] + "}tbl":
                    rows = [["\n".join(filter(None, (paragraph(p) for p in cell.findall("w:p", NS))))
                             for cell in row.findall("w:tc", NS)] for row in node.findall("w:tr", NS)]
                    blocks.append({"position": position, "type": "table", "rows": rows})
    except (BadZipFile, KeyError, ET.ParseError, OSError) as error:
        raise ValueError("无法读取这份 Word 文档，请检查文件格式。") from error
    if not blocks:
        raise ValueError("文档没有可检索的文字。")
    references = {}
    current = None
    for block in blocks:
        if block["type"] != "paragraph":
            continue
        for line in block["text"].splitlines():
            source = re.match(r"^([SC]\d{2})\s{2,}(.+)$", line)
            if source:
                current = source[1]
                references[current] = {"title": source[2], "url": "", "notes": []}
            elif current and safe_link(line.strip()):
                references[current]["url"] = line.strip()
                current = None
            elif current and not block.get("style", "").startswith("Heading"):
                references[current]["notes"].append(line)
            elif block.get("style", "").startswith("Heading"):
                current = None
    return {"sha256": hashlib.sha256(raw).hexdigest(), "blocks": blocks, "references": references,
            "chunks": build_chunks(blocks)}


def build_chunks(blocks):
    chunks, chapter, heading, intro, buffer = [], "Document", "", [], []

    def flush():
        nonlocal buffer
        if not buffer:
            return
        text = "\n\n".join(item[1] for item in buffer)
        number = re.match(r"(\d+)\s", chapter)
        number = int(number[1]) if number else 0
        chunks.append({"key": f"p{buffer[0][0]}", "chapter": chapter, "heading": heading,
                       "body": text, "context": "\n\n".join(intro)[:1800],
                       "references": sorted(set(re.findall(r"\b[SC]\d{2}\b", text))),
                       "classification": "community" if 28 <= number <= 32 else "editorial" if number in {0, 25, 26, 27} else "official_compilation"})
        buffer = []

    for index, block in enumerate(blocks):
        if block["type"] == "paragraph":
            text, style = block["text"], block.get("style", "")
            if style == "Heading1":
                flush()
                chapter, heading, intro = text, "", []
            elif style.startswith("Heading"):
                flush()
                heading = text
            else:
                if not heading:
                    intro.append(text)
                if buffer and sum(len(item[1]) for item in buffer) + len(text) > 1800:
                    flush()
                buffer.append((block["position"], text))
        else:
            flush()
            rows = block["rows"]
            if not rows:
                continue
            headers = rows[0]
            caption = blocks[index + 1] if index + 1 < len(blocks) else {}
            caption = caption.get("text", "") if caption.get("style") == "Caption" else ""
            table_intro = blocks[index - 1].get("text", "") if index else ""
            groups, group, length, first_row = [], [], 0, 1
            for row_number, row in enumerate(rows[1:], 1):
                row_length = sum(len(value) + len(headers[i] if i < len(headers) else 'Value') + 5 for i, value in enumerate(row))
                if group and length + row_length > 2400:
                    groups.append((first_row, group))
                    group, length, first_row = [], 0, row_number
                group.append(row)
                length += row_length
            if group:
                groups.append((first_row, group))
            for row_number, group in groups:
                text = "\n".join(filter(None, [table_intro, caption, *[
                    " | ".join(f"{headers[i] if i < len(headers) else 'Value'}: {value}" for i, value in enumerate(row))
                    for row in group]]))
                buffer = [(f"{block['position']}-r{row_number}", text)]
                flush()
    flush()
    return chunks


def apply_upload(document, raw, filename, parsed=None):
    parsed = parsed or parse_docx(raw)
    document.original = raw
    document.filename = PurePosixPath(filename.replace("\\", "/")).name[:240]
    for field in ("sha256", "blocks", "references", "chunks"):
        setattr(document, field, parsed[field])


def localized_title(document, language):
    if language == "en":
        return document.title_en or f"Knowledge reference · {document.filename}"
    if language == "zh-Hant":
        return document.title_hant or f"知識庫資料 · {document.filename}"
    return document.title


def query_terms(keywords):
    inputs = [normalize("NFKC", item).casefold() for item in keywords if isinstance(item, str) and item.strip()][:6]
    phrases = [item.strip() for item in inputs if len(item) <= 100 and item.count(" ") <= 5]
    for keys, values in ALIASES:
        if any(key in item for item in inputs for key in keys):
            phrases.extend(values)
    words = re.findall(r"[a-z][a-z0-9]*(?:[-.][a-z0-9]+)*", " ".join(inputs + phrases))
    return list(dict.fromkeys(term for term in [*phrases, *words] if term not in STOP_WORDS and len(term) > 1))


def public_citations(document, chunk, language):
    """Expose only original public HKU pages, never the internal document."""
    title = {"zh-Hans": "港大官网", "zh-Hant": "港大官網", "en": "HKU official website"}[language]
    keys = chunk["references"] or sorted(set(re.findall(r"\b[SC]\d{2}\b", chunk["context"])))
    citations, seen = [], set()
    for key in keys:
        url = document.references.get(key, {}).get("url", "")
        if not safe_link(url):
            continue
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.netloc != parsed.hostname or not (parsed.hostname == "hku.hk" or parsed.hostname.endswith(".hku.hk")):
            continue
        if url not in seen:
            citations.append({"kind": "web", "id": url, "title": title, "detail": parsed.hostname, "url": url})
            seen.add(url)
    return citations[:3]


def search_knowledge(args, language):
    raw_terms = args.get("keywords", [])
    if not isinstance(raw_terms, list):
        return []
    terms = query_terms(raw_terms)
    if not terms:
        return []
    corpus = []
    for document in KnowledgeDocument.objects.filter(enabled=True).defer("original", "blocks"):
        for chunk in document.chunks:
            if chunk["classification"] == "editorial":
                continue
            title = " ".join((chunk["chapter"], chunk["heading"])).casefold()
            body = chunk["body"].casefold()
            room_codes = [f"cpd-{level}.{number}" for level, numbers in
                          re.findall(r"level: cpd-(\d+) \| room numbers: ([\d, ]+)", body)
                          for number in re.findall(r"\d+", numbers)]
            body += " " + " ".join(room_codes)
            matched = {term for term in terms if term in title or term in body}
            if matched:
                corpus.append((document, chunk, title, body, matched))
    frequencies = Counter(term for *_, matched in corpus for term in matched)
    scored = []
    for document, chunk, title, body, matched in corpus:
        score = sum((1 + math.log(1 + len(corpus) / frequencies[term])) *
                    ((3 if term in title else 0) + min(body.count(term), 3)) * (1.6 if " " in term else 1) for term in matched)
        if chunk["classification"] == "editorial" or re.match(r"^[SC]\d{2}\s{2,}", chunk["body"]):
            score *= 0.18
        elif chunk["classification"] == "community":
            score *= 0.55
        scored.append((score, document, chunk))
    scored.sort(key=lambda value: (-value[0], str(value[1].pk), value[2]["key"]))
    selected, per_chapter = [], Counter()
    for _, document, chunk in scored:
        group = (document.pk, chunk["chapter"])
        if per_chapter[group] >= 2:
            continue
        per_chapter[group] += 1
        selected.append({"kind": "knowledge", "id": f"{document.pk}:{chunk['key']}",
                         "_public_sources": public_citations(document, chunk, language),
                         "evidence": f"Section: {chunk['chapter']} / {chunk['heading']}\nContext: {chunk['context']}\nExtract:\n{chunk['body']}",
                         "provenance": {"type": "uploaded_document", "section": chunk["chapter"], "sourceRevision": document.sha256,
                                        "classification": chunk["classification"], "sourceIDs": chunk["references"], "retrievedLive": False}})
        if len(selected) == 6:
            break
    return selected
