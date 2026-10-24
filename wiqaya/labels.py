"""What Gemma does for Wiqaya. Every call gets product data only: label photos, ingredient text, product names.
Never a name, an allergy profile or a location.

* ``read``: label photo → ingredient lists (one per language on the package), "contains" and "may contain" lines,
  and whether the list is complete and legible.
* ``pair``: the original list and the Arabic sticker's list → which item is which (code finds what's missing).
* ``research``: ingredients the phone's lists don't know → which allergen groups they may contain, with sources.
  Gemma uses tools here: web search and Open Food Facts.
* ``explain``: what each finding means, in one plain sentence (facts only, no advice).
"""

from __future__ import annotations

import io
import json
import re
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from wiqaya import off
from wiqaya.gemma import Gemma, GemmaError
from wiqaya.search import web_search
from wiqaya.text import split_ingredients

TRIGGERS = {
    "gluten": "cereals containing gluten (wheat, barley, rye, oats, spelt)",
    "milk": "milk and milk products, lactose",
    "eggs": "eggs",
    "peanuts": "peanuts",
    "tree_nuts": "tree nuts (almond, hazelnut, walnut, cashew, pecan, pistachio, brazil, macadamia)",
    "pine_nuts": "pine nuts",
    "sesame": "sesame",
    "soy": "soybeans",
    "fish": "fish",
    "crustaceans": "crustaceans (shrimp, crab, lobster)",
    "molluscs": "molluscs (squid, mussels, oysters, snails)",
    "celery": "celery",
    "mustard": "mustard",
    "sulphites": "sulphur dioxide and sulphites",
    "lupin": "lupin",
    "halal": "not halal: pork, alcohol, or an animal source that may be pork",
    "vegetarian": "not vegetarian: meat, fish, gelatine, insects (carmine), animal rennet",
}

# ---------------------------------------------------------------------------------------------- read
READ_SYSTEM = """You read the ingredient sections of food packaging for an allergy checker. Copy what is printed.
Never guess, complete or add ingredients: a missed or invented ingredient can hurt a child.

Return one entry in "labels" for each ingredient list you can see:
- role: "arabic_sticker" for an Arabic translation sticker added to an imported product; "original" for the
  manufacturer's list when an Arabic sticker is also present; "only" when there is just one list.
- language: the ISO 639-1 code of the list's language (en, ar, it, fr, tr, de, es, ...).
- ingredients: every ingredient in printed order. "text" is copied word for word, keeping every word (such as
  "powder", "dried", "مجفف"), brackets with their contents, and E-numbers. "en" is a plain English translation of
  that one ingredient (repeat the text if it is already English).
- contains: the allergen statement ("Contains:", "يحتوي على:", "Contiene:"), copied exactly, or "" if there is none.
- may_contain: the precautionary statement ("May contain", "Traces of", "قد يحتوي على", "Può contenere",
  "Peut contenir", "İz miktarda", "Made in a facility that also processes ..."), copied exactly, or "" if there is
  none.
- complete: true when you can see where the list starts and where it ends (its last ingredient, usually followed by
  a full stop, a "may contain" line or another section such as nutrition). false only when the list is visibly cut
  off: text running into the photo's edge mid-word or mid-list, covered, or folded away.
- legible: true when you can read every word with certainty. false if any part is too blurry, small or shiny.
If no ingredient list is visible, return "labels": [].
product_name and brand: as printed on the package if visible, else ""."""

READ_SCHEMA = {
    "type": "object",
    "properties": {
        "product_name": {"type": "string"},
        "brand": {"type": "string"},
        "labels": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "role": {"type": "string", "enum": ["original", "arabic_sticker", "only"]},
                    "language": {"type": "string"},
                    "ingredients": {
                        "type": "array",
                        "items": {"type": "object", "properties": {"text": {"type": "string"}, "en": {"type": "string"}},
                                  "required": ["text", "en"]},
                    },
                    "contains": {"type": "string"},
                    "may_contain": {"type": "string"},
                    "complete": {"type": "boolean"},
                    "legible": {"type": "boolean"},
                },
                "required": ["role", "language", "ingredients", "contains", "may_contain", "complete", "legible"],
            },
        },
    },
    "required": ["product_name", "brand", "labels"],
}

HINTS = {
    "original": "This photo shows the manufacturer's original label.",
    "sticker": "This photo shows the Arabic sticker added to an imported product.",
    "": "",
}


# an ingredient list's heading, in the languages on packs sold in Jordan
_HEADING = re.compile(r"^\s*(ingredients?|ingr[eé]dients?|ingredienti|ingredientes|zutaten|i̇?çindekiler|"
                      r"składniki|sastojci|složení|ingrediente|المكونات|مكونات|المحتويات)\s*[:：]\s*", re.IGNORECASE)


# an item that is only a heading ("Contains:", "Ingredients:"), read as if it were an ingredient
_ONLY_HEADING = re.compile(r"^\W*(contains|may contain|ingredients?|يحتوي على|قد يحتوي على|المكونات|مكونات)\W*$",
                           re.IGNORECASE)


def _unheaded(text: str | None) -> str | None:
    return _HEADING.sub("", text) if text else text


def _split(ing: dict) -> list[dict]:
    """Gemma sometimes returns a whole list as one ingredient. Split it on its top-level commas, keeping each English
    translation only when the two split the same way (otherwise the whole item stays as it is)."""
    parts = split_ingredients(ing["text"])
    if len(parts) < 3:
        return [ing]
    en = split_ingredients(ing["en"] or "")
    if len(en) != len(parts):
        return [ing]
    return [{"text": t, "en": e} for t, e in zip(parts, en)]


def _label(raw: dict) -> dict:
    ings = [{"text": str(i.get("text", "")).strip(), "en": (str(i.get("en", "")).strip() or None)}
            for i in raw.get("ingredients") or [] if str(i.get("text", "")).strip()]
    # "Ingredients: sugar" is sugar; then a whole list given as one item is split
    ings = [{"text": _unheaded(i["text"]), "en": _unheaded(i["en"])} if k == 0 else i for k, i in enumerate(ings)]
    ings = [part for ing in ings if ing["text"] and not _ONLY_HEADING.match(ing["text"]) for part in _split(ing)]
    lang = str(raw.get("language") or "").strip().lower()[:2] or None
    return {"language": lang, "ingredients": ings,
            "contains": (str(raw.get("contains") or "").strip() or None),
            "may_contain": (str(raw.get("may_contain") or "").strip() or None),
            "complete": bool(raw.get("complete")), "legible": bool(raw.get("legible")),
            "_role": raw.get("role") or "only"}


LINES_SYSTEM = """You copy text from photos of food packaging. Copy the ingredient list line by line, exactly as each
line is printed in the photo, including a word that is only partly visible. Do not complete or correct anything."""

LINES_SCHEMA = {
    "type": "object",
    "properties": {"lines": {"type": "array", "items": {"type": "string"}}},
    "required": ["lines"],
}


def _words(text: str | None) -> list[str]:
    plain = "".join(c for c in unicodedata.normalize("NFKD", (text or "").casefold()) if not unicodedata.combining(c))
    return re.findall(r"\w+", plain)


def cut_off(gemma: Gemma, image_b64: str, labels: list[dict]) -> bool:
    """A second look, for lists Gemma called complete. Asked whether a list is cut off, Gemma often says no; reading
    it, Gemma quietly finishes a word the photo's edge cut ("Gerstenmalzextra" becomes "Gerstenmalzextrakt"). So Gemma
    copies the printed lines as they are, and code checks them: a line that ends in the start of a word Gemma read
    whole ran into the edge of the photo."""
    try:
        answer, _ = gemma.json(LINES_SYSTEM, "The photo:", LINES_SCHEMA, images=[image_b64], num_predict=1536)
        lines = list(answer.get("lines") or [])[:-1]  # the last line ends the list; a wrapped line's end is the edge
    except GemmaError as e:
        # a big panel in many languages can run past the length limit: check the lines that came through whole
        # (all of them: the answer stopped, not the list). Nothing came through: there is nothing to check.
        lines = [json.loads(f'"{m}"') for m in re.findall(r'"((?:[^"\\]|\\.)*)"\s*[,\]]', e.text)]
    read: set[str] = set()
    for lab in labels:
        for text in [i["text"] for i in lab["ingredients"]] + [lab["contains"], lab["may_contain"]]:
            read.update(_words(text))
    for line in lines:
        words = _words(str(line))
        last = words[-1] if words else ""
        if len(last) >= 3 and last not in read and any(w.startswith(last) for w in read):
            return True
    return False


def _variant(image_b64: str) -> str:
    """The same photo, cropped a little and scaled down: what is printed reads the same; what is guessed changes."""
    import base64

    from PIL import Image

    try:
        img = Image.open(io.BytesIO(base64.b64decode(image_b64)))
    except (ValueError, OSError):
        return image_b64
    w, h = img.size
    img = img.crop((w // 25, h // 25, w - w // 25, h - h // 25)).resize((w * 17 // 20, h * 17 // 20))
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode("ascii")


AGREE = 0.6  # share of ingredient words two readings of the same photo must have in common


def _ingredient_words(labels: list[dict]) -> set[str]:
    return {w for lab in labels for i in lab["ingredients"] for w in _words(i["text"]) if len(w) >= 3}


def agree(a: list[dict], b: list[dict]) -> float:
    x, y = _ingredient_words(a), _ingredient_words(b)
    return len(x & y) / max(1, len(x | y))


def read(gemma: Gemma, image_b64: str, hint: str = "") -> tuple[dict, dict]:
    """One photo → ``{"product_name", "brand", "labels": [...]}`` and Gemma's stats.

    Then two checks that can only lower "complete" and "legible", never raise them. On real photos (small, curved,
    shiny print) Gemma sometimes writes a plausible list that isn't there, or reads the product's name as one; a
    reading only counts as whole and legible when a second reading, of a slightly changed copy of the photo, agrees
    with it, and when it has at least three ingredients or a "contains" line. And the edge check: a list that runs
    off the photo."""
    user = ("Read every ingredient list on this package. " + HINTS.get(hint, "")).strip()
    answer, stats = gemma.json(READ_SYSTEM, user, READ_SCHEMA, images=[image_b64], num_predict=3072)
    labels = [_label(lab) for lab in answer.get("labels") or []]
    labels = [lab for lab in labels if lab["ingredients"] or lab["contains"] or lab["may_contain"]]
    for lab in labels:
        if len(lab["ingredients"]) < 3 and not lab["contains"]:
            lab["complete"] = False
    # the second reading only lowers "legible" and the edge check only lowers "complete", so they run side by side
    def second_reading() -> list[dict]:
        try:
            again, _ = gemma.json(READ_SYSTEM, user, READ_SCHEMA, images=[_variant(image_b64)], num_predict=3072)
        except GemmaError:
            return []
        return [_label(lab) for lab in again.get("labels") or []]

    with ThreadPoolExecutor(max_workers=2) as pool:
        second = pool.submit(second_reading) if any(lab["complete"] and lab["legible"] for lab in labels) else None
        edge = pool.submit(cut_off, gemma, image_b64, labels) if any(lab["complete"] for lab in labels) else None
        if second and agree(labels, second.result()) < AGREE:
            for lab in labels:
                lab["legible"] = False
        if edge and edge.result():
            for lab in labels:
                lab["complete"] = False
    return {"product_name": (answer.get("product_name") or "").strip() or None,
            "brand": (answer.get("brand") or "").strip() or None, "labels": labels}, stats


def arrange(readings: list[tuple[dict, str]]) -> tuple[dict | None, dict | None, str | None, str | None]:
    """From all lists read on all photos: the original list and the Arabic sticker's (if there is one)."""
    labels: list[tuple[dict, str]] = []
    name = brand = None
    for reading, hint in readings:
        name = name or reading["product_name"]
        brand = brand or reading["brand"]
        for lab in reading["labels"]:
            labels.append((lab, hint))
    if not labels:
        return None, None, name, brand

    def is_sticker(lab: dict, hint: str) -> bool:
        return lab["_role"] == "arabic_sticker" or hint == "sticker"

    stickers = [lab for lab, h in labels if is_sticker(lab, h)]
    originals = [lab for lab, h in labels if not is_sticker(lab, h)]
    if not originals:  # only an Arabic list: that is the label
        originals, stickers = stickers[:1], []
    original = next((lab for lab in originals if lab["language"] != "ar"), originals[0])
    sticker = None
    if stickers:
        sticker = stickers[0]
    elif original["language"] != "ar":
        sticker = next((lab for lab in originals if lab is not original and lab["language"] == "ar"), None)
    for lab in (original, sticker):
        if lab:
            lab.pop("_role", None)
    return original, sticker, name, brand


# ---------------------------------------------------------------------------------------------- pair
PAIR_SYSTEM = """You compare an imported product's original ingredient list with the Arabic sticker's list, for an
allergy checker. For every ORIGINAL item, give the index of the ARABIC item that names the same ingredient, or -1
if the Arabic list has nothing for it. Each Arabic item can be used once. Do not pair different ingredients just
because they are related: milk powder is not whey, wheat flour is not starch. Return one entry per original index."""

PAIR_SCHEMA = {
    "type": "object",
    "properties": {"pairs": {"type": "array", "items": {
        "type": "object", "properties": {"original": {"type": "integer"}, "arabic": {"type": "integer"}},
        "required": ["original", "arabic"]}}},
    "required": ["pairs"],
}


def pair(gemma: Gemma, original: dict, sticker: dict) -> tuple[list[list[int | None]], dict]:
    """``[[original_index, arabic_index or None], ...]``, checked: indices in range, each Arabic item used once."""
    o = "\n".join(f"{i}: {x['text']}" + (f" ({x['en']})" if x.get("en") and x["en"] != x["text"] else "")
                  for i, x in enumerate(original["ingredients"]))
    a = "\n".join(f"{i}: {x['text']}" for i, x in enumerate(sticker["ingredients"]))
    answer, stats = gemma.json(PAIR_SYSTEM, f"ORIGINAL ({original['language']}):\n{o}\n\nARABIC:\n{a}", PAIR_SCHEMA,
                               num_predict=1024)
    used: set[int] = set()
    by_original: dict[int, int | None] = {}
    for p in answer.get("pairs") or []:
        oi, ai = p.get("original"), p.get("arabic")
        if not isinstance(oi, int) or not 0 <= oi < len(original["ingredients"]) or oi in by_original:
            continue
        if isinstance(ai, int) and 0 <= ai < len(sticker["ingredients"]) and ai not in used:
            used.add(ai)
            by_original[oi] = ai
        else:
            by_original[oi] = None
    # an original item Gemma skipped counts as unpaired: the engine then checks it as "missing from the sticker"
    return [[i, by_original.get(i)] for i in range(len(original["ingredients"]))], stats


# ---------------------------------------------------------------------------------------------- research
RESEARCH_SYSTEM = """You help a food allergy checker with ingredients its lists do not know. For each ingredient,
find out which of these groups it can contain or be made from:
{groups}
Use the tools: web_search for what an ingredient or E-number is made from (for example "E476 source",
"what is kishk made of"), search_products or lookup_product for a branded product. Prefer food-safety, food-science
and encyclopedia sources. Report a group only when a source says the ingredient can contain or come from it.
You never decide that something is safe; you only list possible groups."""

RESEARCH_SCHEMA = {
    "type": "object",
    "properties": {"findings": {"type": "array", "items": {
        "type": "object",
        "properties": {
            "ingredient": {"type": "string"},
            "triggers": {"type": "array", "items": {"type": "string", "enum": list(TRIGGERS)}},
            "reason": {"type": "string"},
            "sources": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["ingredient", "triggers", "reason", "sources"]}}},
    "required": ["findings"],
}


def research_tools() -> dict[str, tuple[dict, Any]]:
    return {
        "web_search": ({"description": "Search the web. Returns titles, URLs and snippets.",
                        "parameters": {"type": "object", "properties": {"query": {"type": "string"}},
                                       "required": ["query"]}},
                       lambda query: web_search(query, 5)),
        "search_products": ({"description": "Search Open Food Facts for a product by name and brand.",
                             "parameters": {"type": "object", "properties": {"query": {"type": "string"}},
                                            "required": ["query"]}},
                            lambda query: off.search(query, 5)),
        "lookup_product": ({"description": "Get a product from Open Food Facts by its barcode.",
                            "parameters": {"type": "object", "properties": {"barcode": {"type": "string"}},
                                           "required": ["barcode"]}},
                           lambda barcode: _lookup(barcode)),
    }


def _lookup(barcode: str) -> dict:
    p = off.fetch(barcode)
    if not p:
        return {"found": False}
    return {"found": True, "name": p.get("product_name"), "ingredients": (p.get("ingredients_text") or "")[:600],
            "allergens": p.get("allergens_tags") or [], "traces": p.get("traces_tags") or []}


def research(gemma: Gemma, ingredients: list[str], product_name: str | None = None) -> tuple[list[dict], list[dict]]:
    """Possible allergen groups for unknown ingredients, each with sources Gemma actually looked at.
    Returns ``(suspicions, tool_log)``."""
    ingredients = [i.strip()[:120] for i in ingredients if i.strip()][:12]
    if not ingredients:
        return [], []
    groups = "\n".join(f"- {k}: {v}" for k, v in TRIGGERS.items())
    system = RESEARCH_SYSTEM.format(groups=groups)
    user = ("Ingredients to check:\n" + "\n".join(f"- {i}" for i in ingredients)
            + (f"\n\n(They are from: {product_name})" if product_name else ""))
    history, log = gemma.run_tools(system, user, research_tools(), max_steps=6)
    seen_urls = [r.get("url") for call in log if isinstance(call.get("result"), list) for r in call["result"]
                 if isinstance(r, dict) and r.get("url")]
    final = "Now give your findings for every ingredient listed, as JSON."
    if seen_urls:
        final += " In \"sources\", copy the exact URLs you relied on from these search results:\n" + "\n".join(
            dict.fromkeys(seen_urls))
    answer, _ = gemma.json(system, final, RESEARCH_SCHEMA, history=history, num_predict=1536)
    out = []
    for f in answer.get("findings") or []:
        triggers = [t for t in f.get("triggers") or [] if t in TRIGGERS]
        if not triggers:
            continue
        # only sources Gemma really saw in a tool result; a made-up link is dropped
        sources = [u for u in f.get("sources") or [] if u in seen_urls][:3]
        out.append({"ingredient": str(f.get("ingredient", ""))[:120], "triggers": triggers,
                    "reason": str(f.get("reason", ""))[:300], "sources": sources})
    return out, log


# ---------------------------------------------------------------------------------------------- explain
EXPLAIN_SYSTEM = """You explain an allergy checker's findings to a parent, in {lang}. For each item, write one short,
plain sentence saying what the quoted label text is or is made from, and how it relates to the named group.
Facts only. Do not give medical advice and do not say whether anyone may eat it."""

EXPLAIN_SCHEMA = {
    "type": "object",
    "properties": {"items": {"type": "array", "items": {
        "type": "object",
        "properties": {"trigger": {"type": "string"}, "quote": {"type": "string"}, "text": {"type": "string"}},
        "required": ["trigger", "quote", "text"]}}},
    "required": ["items"],
}


def explain(gemma: Gemma, findings: list[dict], lang: str = "en") -> list[dict]:
    """``[{"trigger", "quote", "text"}]`` for findings ``[{"trigger", "quote"}]`` (all of the product's, so the request
    doesn't reveal which allergy a family has)."""
    findings = [f for f in findings if f.get("trigger") in TRIGGERS and f.get("quote")][:20]
    if not findings:
        return []
    language = "Arabic (Modern Standard, simple words)" if lang == "ar" else "English"
    user = "\n".join(f"- group: {TRIGGERS[f['trigger']]} | label text: {f['quote'][:160]}" for f in findings)
    try:
        answer, _ = gemma.json(EXPLAIN_SYSTEM.format(lang=language), user, EXPLAIN_SCHEMA, num_predict=1024)
    except GemmaError:
        return []
    out = []
    for item, f in zip(answer.get("items") or [], findings):
        text = str(item.get("text") or "").strip()
        if text:
            out.append({"trigger": f["trigger"], "quote": f["quote"], "text": text[:300]})
    return out


# ---------------------------------------------------------------------------------------------- expiry date
EXPIRY_SYSTEM = """You read the expiry date printed on a medicine box or auto-injector, for a reminder. Copy the date
that follows EXP, Expiry, Use by, or انتهاء. Ignore the manufacturing date (MFG, Mfd, LOT). If no expiry date is
readable, answer null. Write the date as YYYY-MM-DD; a date with only a month and year means the last day of that
month."""

EXPIRY_SCHEMA = {
    "type": "object",
    "properties": {"expiry": {"type": ["string", "null"]}, "printed": {"type": ["string", "null"]}},
    "required": ["expiry", "printed"],
}


def expiry(gemma: Gemma, image_b64: str) -> dict:
    """``{"expiry": "YYYY-MM-DD" | None, "printed": the text as printed}``. The phone asks the parent to confirm."""
    answer, _ = gemma.json(EXPIRY_SYSTEM, "The photo:", EXPIRY_SCHEMA, images=[image_b64], num_predict=128)
    date = str(answer.get("expiry") or "")
    ok = re.fullmatch(r"20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])", date)
    return {"expiry": date if ok else None, "printed": (str(answer.get("printed") or "")[:40] or None)}
