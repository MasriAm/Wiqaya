"""Open Food Facts: product lookup by barcode, name search, and a local cache.

Open Food Facts allows 15 product reads and 10 searches per minute, so every answer is cached in SQLite, and
``wiqaya prefetch`` downloads the products sold in Jordan ahead of time. Only barcodes and product names are
sent; nothing about a person.

Many products sold in Jordan aren't in Open Food Facts. When someone photographs the ingredients of one of those
after scanning its barcode, and the reading passes every check (whole list, legible, two readings agree), it is
kept with the barcode: the next scan of that product, by anyone, is answered at once. Only product data is kept,
never who scanned it.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path

import httpx

from wiqaya.config import SETTINGS

FIELDS = (
    "code,product_name,product_name_en,product_name_ar,brands,lang,ingredients_text,ingredients_text_en,"
    "ingredients_text_ar,ingredients,allergens_tags,traces_tags,countries_tags"
)
NOT_FOUND = {"_not_found": True}


class Cache:
    def __init__(self, path: Path | None = None):
        SETTINGS.ensure()
        self.path = path or SETTINGS.data_dir / "products.sqlite"
        self._lock = threading.Lock()
        with self._db() as db:
            db.execute("CREATE TABLE IF NOT EXISTS products (code TEXT PRIMARY KEY, at REAL, body TEXT)")
            db.execute("CREATE TABLE IF NOT EXISTS readings (code TEXT PRIMARY KEY, at REAL, body TEXT)")

    def _db(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path)

    def get(self, code: str, max_age: float = 30 * 86400) -> dict | None:
        with self._lock, self._db() as db:
            row = db.execute("SELECT at, body FROM products WHERE code = ?", (code,)).fetchone()
        if not row or time.time() - row[0] > max_age:
            return None
        return json.loads(row[1])

    def put(self, code: str, body: dict) -> None:
        with self._lock, self._db() as db:
            db.execute("INSERT OR REPLACE INTO products VALUES (?, ?, ?)", (code, time.time(), json.dumps(body)))

    def get_reading(self, code: str, max_age: float = 365 * 86400) -> tuple[float, dict] | None:
        """A checked ingredient list read from a photo of this product, and when."""
        with self._lock, self._db() as db:
            row = db.execute("SELECT at, body FROM readings WHERE code = ?", (code,)).fetchone()
        if not row or time.time() - row[0] > max_age:
            return None
        return row[0], json.loads(row[1])

    def put_reading(self, code: str, body: dict) -> None:
        """The newest checked reading wins: a recipe can change."""
        with self._lock, self._db() as db:
            db.execute("INSERT OR REPLACE INTO readings VALUES (?, ?, ?)", (code, time.time(), json.dumps(body)))

    def count(self) -> int:
        with self._lock, self._db() as db:
            return db.execute("SELECT COUNT(*) FROM products").fetchone()[0]


def _client() -> httpx.Client:
    return httpx.Client(timeout=15.0, headers={"User-Agent": SETTINGS.user_agent}, follow_redirects=True)


def valid_barcode(code: str) -> bool:
    return code.isdigit() and 6 <= len(code) <= 14


def fetch(code: str, cache: Cache | None = None) -> dict | None:
    """The raw Open Food Facts product, or None if it isn't there."""
    if not valid_barcode(code):
        return None
    cache = cache or Cache()
    hit = cache.get(code)
    if hit is not None:
        return None if hit.get("_not_found") else hit
    with _client() as c:
        r = c.get(f"{SETTINGS.off_url}/api/v2/product/{code}.json", params={"fields": FIELDS})
    if r.status_code == 404 or (r.status_code == 200 and r.json().get("status") == 0):
        cache.put(code, NOT_FOUND)
        return None
    r.raise_for_status()
    product = r.json().get("product") or {}
    product["code"] = code
    cache.put(code, product)
    return product


def search(query: str, page_size: int = 5) -> list[dict]:
    """Products whose name matches, for Gemma's research tool: barcode, name, brand, allergen tags."""
    with _client() as c:
        r = c.get(f"{SETTINGS.off_url}/cgi/search.pl", params={
            "search_terms": query, "search_simple": 1, "json": 1, "page_size": page_size,
            "fields": "code,product_name,brands,allergens_tags,traces_tags,ingredients_text"})
    r.raise_for_status()
    return [{"barcode": p.get("code"), "name": p.get("product_name"), "brand": p.get("brands"),
             "allergens": p.get("allergens_tags") or [], "traces": p.get("traces_tags") or [],
             "ingredients": (p.get("ingredients_text") or "")[:400]} for p in r.json().get("products", [])]


def _flatten(ings: list[dict]) -> list[dict]:
    """Open Food Facts' parsed list: top-level ingredients, with sub-ingredients kept in the text."""
    out = []
    for i in ings or []:
        text = (i.get("text") or "").strip()
        if not text:
            continue
        subs = [s.get("text", "").strip() for s in i.get("ingredients") or [] if s.get("text")]
        known = bool(i.get("is_in_taxonomy")) and all(bool(s.get("is_in_taxonomy")) for s in i.get("ingredients") or [])
        out.append({"text": f"{text} ({', '.join(subs)})" if subs else text, "en": None, "known_by_off": known})
    return out


def to_facts(p: dict) -> dict:
    """The product as Wiqaya's ProductFacts (see web/src/engine/types.ts)."""
    lang = (p.get("lang") or "").lower()[:2] or None
    ingredients = _flatten(p.get("ingredients") or [])
    text = p.get("ingredients_text") or p.get(f"ingredients_text_{lang}") or p.get("ingredients_text_en") or ""
    label = None
    if ingredients:
        label = {"language": lang, "ingredients": ingredients, "contains": None, "may_contain": None,
                 "complete": True, "legible": True}
    elif text.strip():
        from wiqaya.text import split_ingredients
        label = {"language": lang, "ingredients": [{"text": t, "en": None} for t in split_ingredients(text)],
                 "contains": None, "may_contain": None, "complete": True, "legible": True}
    name = p.get("product_name") or p.get("product_name_en") or p.get("product_name_ar") or None
    return {"barcode": p.get("code"), "name": name, "brand": (p.get("brands") or None), "label": label, "sticker": None,
            "pairs": None, "off": {"allergens": p.get("allergens_tags") or [], "traces": p.get("traces_tags") or []},
            "suspicions": []}


def prefetch_jordan(cache: Cache | None = None, pages: int = 20, say=print) -> int:
    """Download the products Open Food Facts lists as sold in Jordan (about 1,250), politely: one search every 7 s."""
    cache = cache or Cache()
    total = 0
    with _client() as c:
        for page in range(1, pages + 1):
            r = c.get(f"{SETTINGS.off_url}/api/v2/search", params={
                "countries_tags_en": "jordan", "page": page, "page_size": 100, "fields": FIELDS})
            r.raise_for_status()
            products = r.json().get("products", [])
            if not products:
                break
            for p in products:
                if p.get("code"):
                    cache.put(p["code"], p)
                    total += 1
            say(f"page {page}: {total} products")
            time.sleep(7)
    return total
