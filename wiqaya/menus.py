"""Restaurant menus: a link, photos or a PDF → the dishes on it. Gemma reads the menu and says what each dish is
usually made with; the phone decides what each person can ask for. Gemma never learns whose allergies they are.

A link is fetched by the server, carefully: http(s) only, public addresses only (no local network), a few redirects,
a size cap. A PDF with text is read as text; a scanned PDF is turned into page images.
"""

from __future__ import annotations

import html
import io
import ipaddress
import re
import socket
from urllib.parse import urljoin, urlparse

import httpx

from wiqaya.config import SETTINGS
from wiqaya.gemma import Gemma
from wiqaya.images import BadImage, b64, clean

MAX_BYTES = 12 * 1024 * 1024
MAX_PAGES = 4
CHUNK = 6000


class MenuError(ValueError):
    """``code`` is what the phone shows: url_blocked, url_failed, too_large, unreadable."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


# ---------------------------------------------------------------------------------------------- fetching a link
def _public(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            return False
    return bool(infos)


def fetch(url: str, client: httpx.Client | None = None) -> tuple[bytes, str]:
    """The link's content and its type. Only public http(s) addresses; redirects are checked the same way."""
    own = client is None
    client = client or httpx.Client(timeout=httpx.Timeout(15.0, connect=5.0),
                                    headers={"User-Agent": SETTINGS.user_agent, "Accept-Language": "en, ar"})
    try:
        for _ in range(4):
            u = urlparse(url)
            if u.scheme not in ("http", "https") or not u.hostname or not _public(u.hostname):
                raise MenuError("url_blocked")
            with client.stream("GET", url, follow_redirects=False) as r:
                if r.is_redirect and r.headers.get("location"):
                    url = urljoin(url, r.headers["location"])
                    continue
                if r.status_code != 200:
                    raise MenuError("url_failed")
                data = b""
                for part in r.iter_bytes():
                    data += part
                    if len(data) > MAX_BYTES:
                        raise MenuError("too_large")
                return data, r.headers.get("content-type", "").split(";")[0].strip().lower()
        raise MenuError("url_failed")
    except httpx.HTTPError as e:
        raise MenuError("url_failed") from e
    finally:
        if own:
            client.close()


_ARABIC = re.compile(r"[؀-ۿ]")
_DROP = re.compile(r"<(script|style|noscript|svg|head)\b.*?</\1>", re.DOTALL | re.IGNORECASE)
_BREAK = re.compile(r"<(br|/p|/div|/li|/tr|/h\d|/section|/article)\b[^>]*>", re.IGNORECASE)
_TAG = re.compile(r"<[^>]+>")


def page_text(page: str) -> str:
    """The readable text of a web page, one line per block."""
    t = _BREAK.sub("\n", _DROP.sub(" ", page))
    t = html.unescape(_TAG.sub(" ", t))
    lines = [re.sub(r"[ \t\xa0]+", " ", ln).strip() for ln in t.splitlines()]
    return "\n".join(ln for ln in lines if ln)


# ---------------------------------------------------------------------------------------------- PDFs
def pdf_parts(data: bytes) -> tuple[str, list[str]]:
    """A PDF's text, or its first pages as images: for a scanned menu (hardly any text), and for Arabic, which PDF
    text often stores in visual order (reversed), so the pictures are the faithful copy."""
    import pypdfium2 as pdfium

    try:
        doc = pdfium.PdfDocument(data)
    except pdfium.PdfiumError as e:
        raise MenuError("unreadable") from e
    try:
        pages = [doc[i] for i in range(min(len(doc), 12))]
        text = "\n".join(p.get_textpage().get_text_range() for p in pages).strip()
        if len(text) >= 200 and not _ARABIC.search(text):
            return text, []
        images = []
        for p in pages[:MAX_PAGES]:
            img = p.render(scale=2).to_pil()
            buf = io.BytesIO()
            img.convert("RGB").save(buf, format="JPEG", quality=88)
            images.append(b64(clean(buf.getvalue())))
        return "", images
    finally:
        doc.close()


# ---------------------------------------------------------------------------------------------- reading
READ_SYSTEM = """You read restaurant menus for a food allergy checker. List every dish or drink on the menu.

For each dish:
- name: the dish's name as printed, without the price. en: a plain English name.
- section: the menu section it is in ("Starters", "مقبلات"), or "".
- description: the words printed under or after the name, word for word, or "" if there are none.
- usual: what this dish is usually made with and served with, from your knowledge of the dish, in English. Always
  fill it, even when nothing is printed: a parent needs to know what to ask about. Include sauces, breads, toppings,
  cheese, butter, nuts and pastry. Example: "Moutabal" → ["aubergine", "tahini", "garlic", "lemon", "olive oil"];
  "Knafeh" → ["semolina or wheat pastry", "cheese", "butter", "sugar syrup", "pistachios"].
Menus in Jordan are often in Arabic, English or both: list every dish in whichever language it is printed, including
dishes printed only in Arabic (give "en" for those). If a dish is printed in both languages, list it once.
Skip prices, opening hours and anything that is not food or drink. If there is no menu, return "dishes": [].
restaurant: its name if printed, else "". language: the ISO 639-1 code of the menu's main language."""

READ_SCHEMA = {
    "type": "object",
    "properties": {
        "restaurant": {"type": "string"},
        "language": {"type": "string"},
        "dishes": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "en": {"type": "string"},
                "section": {"type": "string"},
                "description": {"type": "string"},
                "usual": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["name", "en", "section", "description", "usual"]}},
    },
    "required": ["restaurant", "language", "dishes"],
}


def _chunks(text: str) -> list[str]:
    out, cur = [], ""
    for line in text.splitlines():
        if len(cur) + len(line) > CHUNK and cur:
            out.append(cur)
            cur = ""
        cur += line[:CHUNK] + "\n"
    if cur.strip():
        out.append(cur)
    return out[:MAX_PAGES]


def read(gemma: Gemma, text: str = "", images: list[str] | None = None) -> dict:
    """Menu text and/or page images → ``{"restaurant", "language", "dishes": [...]}``, dishes merged by name."""
    answers = []
    for part in _chunks(text):
        answers.append(gemma.json(READ_SYSTEM, "The menu:\n" + part, READ_SCHEMA, num_predict=4096)[0])
    for img in (images or [])[:MAX_PAGES]:
        answers.append(gemma.json(READ_SYSTEM, "The menu:", READ_SCHEMA, images=[img], num_predict=4096)[0])
    dishes: dict[str, dict] = {}
    restaurant = language = ""
    for a in answers:
        restaurant = restaurant or str(a.get("restaurant") or "").strip()
        language = language or str(a.get("language") or "").strip().lower()[:2]
        for d in a.get("dishes") or []:
            name = str(d.get("name") or "").strip()[:120]
            if not name or name.lower() in dishes:
                continue
            dishes[name.lower()] = {
                "name": name,
                "en": (str(d.get("en") or "").strip()[:120] or None),
                "section": str(d.get("section") or "").strip()[:80],
                "description": str(d.get("description") or "").strip()[:400],
                "usual": [str(u).strip()[:60] for u in (d.get("usual") or []) if str(u).strip()][:20],
            }
    return {"restaurant": restaurant or None, "language": language or None, "dishes": list(dishes.values())[:120]}


def _image(data: bytes) -> str:
    """A cleaned menu photo. A small one (a screenshot) is enlarged first: Gemma misses small Arabic print."""
    from PIL import Image

    img = Image.open(io.BytesIO(clean(data)))
    if max(img.size) < 1400:
        scale = 1600 / max(img.size)
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90)
        return b64(buf.getvalue())
    return b64(clean(data))


def parts_of(data: bytes, kind: str) -> tuple[str, list[str]]:
    """Fetched or uploaded content → (text, images) for Gemma."""
    if data[:5] == b"%PDF-" or kind == "application/pdf":
        return pdf_parts(data)
    if kind.startswith("image/"):
        return "", [_image(data)]
    if kind in ("text/html", "application/xhtml+xml", "text/plain", "") or kind.startswith("text/"):
        text = page_text(data.decode("utf-8", "replace")) if kind != "text/plain" else data.decode("utf-8", "replace")
        if len(text) < 40:
            raise MenuError("unreadable")
        return text, []
    try:  # an image sent without a proper type
        return "", [_image(data)]
    except BadImage as e:
        raise MenuError("unreadable") from e
