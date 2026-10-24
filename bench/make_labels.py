"""Synthetic food labels with exact ground truth, rendered by Playwright.

Each label is an imported product's back panel (Italian, Turkish, French, German, English or Arabic) and, for
some, an Arabic sticker: a faithful one, one that drops the "may contain" line, or one that drops an ingredient.
Some photos are blurred or cut off on purpose. Ground truth (allergens contained, may-contain, what the sticker
dropped, whether the list is whole and sharp) goes to ``truth.json``.

    uv run python bench/make_labels.py --n 30 --seed 7 --out bench/out/labels
"""

from __future__ import annotations

import argparse
import html
import json
import random
from pathlib import Path

# concept: (allergens, {lang: name})
VOCAB: dict[str, tuple[list[str], dict[str, str]]] = {
    "sugar": ([], {"en": "sugar", "it": "zucchero", "tr": "şeker", "fr": "sucre", "de": "Zucker", "ar": "سكر"}),
    "wheat_flour": (["gluten"], {"en": "wheat flour", "it": "farina di frumento", "tr": "buğday unu", "fr": "farine de blé", "de": "Weizenmehl", "ar": "دقيق القمح"}),
    "palm_oil": ([], {"en": "palm oil", "it": "olio di palma", "tr": "palm yağı", "fr": "huile de palme", "de": "Palmöl", "ar": "زيت النخيل"}),
    "sunflower_oil": ([], {"en": "sunflower oil", "it": "olio di girasole", "tr": "ayçiçek yağı", "fr": "huile de tournesol", "de": "Sonnenblumenöl", "ar": "زيت دوار الشمس"}),
    "hazelnuts": (["tree_nuts"], {"en": "hazelnuts", "it": "nocciole", "tr": "fındık", "fr": "noisettes", "de": "Haselnüsse", "ar": "بندق"}),
    "almonds": (["tree_nuts"], {"en": "almonds", "it": "mandorle", "tr": "badem", "fr": "amandes", "de": "Mandeln", "ar": "لوز"}),
    "peanuts": (["peanuts"], {"en": "peanuts", "it": "arachidi", "tr": "yer fıstığı", "fr": "arachides", "de": "Erdnüsse", "ar": "فول سوداني"}),
    "skim_milk": (["milk"], {"en": "skimmed milk powder", "it": "latte scremato in polvere", "tr": "yağsız süt tozu", "fr": "lait écrémé en poudre", "de": "Magermilchpulver", "ar": "حليب خالي الدسم مجفف"}),
    "whey": (["milk"], {"en": "whey powder", "it": "siero di latte in polvere", "tr": "peyniraltı suyu tozu", "fr": "lactosérum en poudre", "de": "Molkenpulver", "ar": "مصل اللبن المجفف"}),
    "butter": (["milk"], {"en": "butter", "it": "burro", "tr": "tereyağı", "fr": "beurre", "de": "Butter", "ar": "زبدة"}),
    "eggs": (["eggs"], {"en": "whole egg powder", "it": "uova intere in polvere", "tr": "tam yumurta tozu", "fr": "œufs entiers en poudre", "de": "Volleipulver", "ar": "بيض كامل مجفف"}),
    "cocoa": ([], {"en": "fat-reduced cocoa", "it": "cacao magro", "tr": "yağı azaltılmış kakao", "fr": "cacao maigre", "de": "fettarmer Kakao", "ar": "كاكاو قليل الدسم"}),
    "soy_lecithin": (["soy"], {"en": "emulsifier: soy lecithin", "it": "emulsionante: lecitina di soia", "tr": "emülgatör: soya lesitini", "fr": "émulsifiant : lécithine de soja", "de": "Emulgator: Sojalecithin", "ar": "مستحلب: ليسيثين الصويا"}),
    "sunflower_lecithin": ([], {"en": "emulsifier: sunflower lecithin", "it": "emulsionante: lecitina di girasole", "tr": "emülgatör: ayçiçek lesitini", "fr": "émulsifiant : lécithine de tournesol", "de": "Emulgator: Sonnenblumenlecithin", "ar": "مستحلب: ليسيثين دوار الشمس"}),
    "salt": ([], {"en": "salt", "it": "sale", "tr": "tuz", "fr": "sel", "de": "Salz", "ar": "ملح"}),
    "raising": ([], {"en": "raising agent: sodium bicarbonate", "it": "agente lievitante: bicarbonato di sodio", "tr": "kabartıcı: sodyum bikarbonat", "fr": "poudre à lever : bicarbonate de sodium", "de": "Backtriebmittel: Natron", "ar": "مادة رافعة: بيكربونات الصوديوم"}),
    "vanillin": ([], {"en": "flavouring: vanillin", "it": "aroma: vanillina", "tr": "aroma: vanilin", "fr": "arôme : vanilline", "de": "Aroma: Vanillin", "ar": "منكه: فانيلين"}),
    "glucose": ([], {"en": "glucose syrup", "it": "sciroppo di glucosio", "tr": "glikoz şurubu", "fr": "sirop de glucose", "de": "Glukosesirup", "ar": "شراب الجلوكوز"}),
    "malt": (["gluten"], {"en": "barley malt extract", "it": "estratto di malto d'orzo", "tr": "arpa malt özütü", "fr": "extrait de malt d'orge", "de": "Gerstenmalzextrakt", "ar": "خلاصة الشعير"}),
    "sesame": (["sesame"], {"en": "sesame seeds", "it": "semi di sesamo", "tr": "susam", "fr": "graines de sésame", "de": "Sesamsamen", "ar": "بذور السمسم"}),
    "rice_flour": ([], {"en": "rice flour", "it": "farina di riso", "tr": "pirinç unu", "fr": "farine de riz", "de": "Reismehl", "ar": "طحين الأرز"}),
    "corn_starch": ([], {"en": "corn starch", "it": "amido di mais", "tr": "mısır nişastası", "fr": "amidon de maïs", "de": "Maisstärke", "ar": "نشا الذرة"}),
    "e476": ([], {"en": "emulsifier: E476", "it": "emulsionante: E476", "tr": "emülgatör: E476", "fr": "émulsifiant : E476", "de": "Emulgator: E476", "ar": "مستحلب: E476"}),
}

HEAD = {"en": "Ingredients", "it": "Ingredienti", "tr": "İçindekiler", "fr": "Ingrédients", "de": "Zutaten", "ar": "المكونات"}
MAY = {"en": "May contain {x}.", "it": "Può contenere {x}.", "tr": "{x} içerebilir.", "fr": "Peut contenir des traces de {x}.",
       "de": "Kann Spuren von {x} enthalten.", "ar": "قد يحتوي على آثار من {x}."}
TRACE = {"tree_nuts": {"en": "nuts", "it": "frutta a guscio", "tr": "sert kabuklu meyveler", "fr": "fruits à coque", "de": "Schalenfrüchten", "ar": "المكسرات"},
         "peanuts": {"en": "peanuts", "it": "arachidi", "tr": "yer fıstığı", "fr": "arachides", "de": "Erdnüssen", "ar": "الفول السوداني"},
         "sesame": {"en": "sesame", "it": "sesamo", "tr": "susam", "fr": "sésame", "de": "Sesam", "ar": "السمسم"},
         "milk": {"en": "milk", "it": "latte", "tr": "süt", "fr": "lait", "de": "Milch", "ar": "الحليب"},
         "eggs": {"en": "egg", "it": "uova", "tr": "yumurta", "fr": "œuf", "de": "Ei", "ar": "البيض"}}
PRODUCTS = {"en": ["Choco Wafer", "Crunchy Biscuits", "Cocoa Cream Bars"], "it": ["Wafer al Cacao", "Biscotti Frollini", "Crema Croccante"],
            "tr": ["Kakaolu Gofret", "Bisküvi", "Fındıklı Kremalı"], "fr": ["Gaufrettes Cacao", "Biscuits Sablés", "Barres Croquantes"],
            "de": ["Kakaowaffeln", "Butterkekse", "Knusperriegel"], "ar": ["ويفر بالكاكاو", "بسكويت", "أصابع مقرمشة"]}
RECIPES = [
    ["sugar", "wheat_flour", "palm_oil", "cocoa", "hazelnuts", "skim_milk", "soy_lecithin", "salt", "vanillin"],
    ["wheat_flour", "sugar", "butter", "eggs", "glucose", "raising", "salt"],
    ["rice_flour", "sugar", "sunflower_oil", "cocoa", "corn_starch", "sunflower_lecithin", "salt"],
    ["sugar", "palm_oil", "peanuts", "whey", "cocoa", "sunflower_lecithin", "vanillin"],
    ["wheat_flour", "sugar", "sunflower_oil", "malt", "sesame", "salt", "raising"],
    ["sugar", "almonds", "glucose", "cocoa", "e476", "vanillin"],
    ["corn_starch", "sugar", "sunflower_oil", "rice_flour", "salt"],
]

PAGE = """<!doctype html><html><head><meta charset="utf-8"><style>
body{{margin:0;background:{bg};font-family:'DejaVu Sans',Arial,sans-serif}}
.pack{{position:relative;width:760px;padding:26px 30px;background:{panel};color:#222;{filter}}}
h1{{font-size:26px;margin:0 0 4px}} .brand{{font-size:14px;color:#666;margin-bottom:14px}}
.ing{{font-size:{size}px;line-height:1.45}} .ing b{{font-weight:700}} .may{{font-size:{size}px;margin-top:8px;font-weight:700}}
.nut{{margin-top:16px;border:2px solid #333;width:300px;font-size:13px}} .nut div{{display:flex;justify-content:space-between;padding:3px 6px;border-top:1px solid #999}}
.sticker{{direction:rtl;text-align:right;margin-top:18px;background:#fff;border:1px solid #bbb;padding:12px 16px;
box-shadow:2px 3px 6px rgba(0,0,0,.25);transform:rotate(-1.2deg);font-size:{size}px;line-height:1.6;width:640px}}
.sticker .t{{font-weight:700;margin-bottom:4px}}
</style></head><body><div class="pack" id="pack">
<h1>{name}</h1><div class="brand">{brand}</div>
<div class="ing" {dir}><b>{head}:</b> {items}.</div>{may}
<div class="nut"><div><b>{nutri}</b><span>100 g</span></div><div><span>Energy</span><span>2140 kJ</span></div><div><span>Fat</span><span>27 g</span></div><div><span>Sugars</span><span>38 g</span></div></div>
{sticker}</div></body></html>"""


def render_case(rng: random.Random, i: int) -> dict:
    lang = rng.choice(["it", "it", "tr", "fr", "de", "en", "ar"])
    recipe = list(rng.choice(RECIPES))
    allergens = sorted({a for c in recipe for a in VOCAB[c][0]})
    may = rng.choice([None, None, "tree_nuts", "peanuts", "sesame", "milk", "eggs"])
    if may in allergens:
        may = None
    sticker_kind = None if lang == "ar" else rng.choice(["none", "faithful", "drops_may", "drops_item"])
    if sticker_kind == "drops_may" and not may:
        may = "tree_nuts" if "tree_nuts" not in allergens else "peanuts"
    defect = rng.choices(["none", "blur", "cut"], weights=[8, 1, 1])[0]
    name = rng.choice(PRODUCTS[lang])
    items = [VOCAB[c][1][lang] for c in recipe]
    may_text = MAY[lang].format(x=TRACE[may][lang]) if may else ""
    sticker_html, dropped_item = "", None
    if sticker_kind and sticker_kind != "none":
        ar_items = [VOCAB[c][1]["ar"] for c in recipe]
        if sticker_kind == "drops_item":
            # drop an allergen-carrying ingredient if there is one: the case that matters
            idx = next((k for k, c in enumerate(recipe) if VOCAB[c][0]), len(recipe) - 1)
            dropped_item = recipe[idx]
            ar_items.pop(idx)
        ar_may = "" if sticker_kind == "drops_may" or not may else MAY["ar"].format(x=TRACE[may]["ar"])
        sticker_html = (f'<div class="sticker"><div class="t">{name if lang == "ar" else "بيان المكونات"}</div>'
                        f'<b>المكونات:</b> {html.escape("، ".join(ar_items))}.'
                        + (f'<div style="font-weight:700;margin-top:6px">{html.escape(ar_may)}</div>' if ar_may else "")
                        + "</div>")
    page = PAGE.format(
        bg="#e9e4da", panel=rng.choice(["#fffdf6", "#f7fbff", "#fff7ef"]), name=html.escape(name),
        brand=html.escape(rng.choice(["Dolciaria Rossi S.p.A.", "Ülker", "Biscuiterie du Nord", "Kessler GmbH", "Sunny Foods Ltd", "شركة الريف"])),
        head=HEAD[lang], items=html.escape(", ".join(items)), dir='dir="rtl" style="text-align:right"' if lang == "ar" else "",
        may=f'<div class="may" {"dir=rtl" if lang == "ar" else ""}>{html.escape(may_text)}</div>' if may_text else "",
        nutri="القيمة الغذائية" if lang == "ar" else "Nutrition", size=rng.choice([15, 16, 17]),
        filter="filter:blur(2.2px);" if defect == "blur" else "", sticker=sticker_html)
    sticker_drops = []
    if sticker_kind == "drops_may" and may:
        sticker_drops.append({"what": "may_contain", "trigger": may})
    if dropped_item:
        sticker_drops += [{"what": "ingredient", "trigger": a} for a in VOCAB[dropped_item][0]]
    return {"id": f"label-{i:03d}", "html": page, "defect": defect, "truth": {
        "language": lang, "name": name, "recipe": recipe, "contains": allergens, "may_contain": [may] if may else [],
        "sticker": sticker_kind if sticker_kind not in (None, "none") else None, "sticker_drops": sticker_drops,
        "unknown": [c for c in recipe if c == "e476"], "complete": defect != "cut", "legible": defect != "blur"}}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=30)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default="bench/out/labels")
    a = ap.parse_args()
    from playwright.sync_api import sync_playwright

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(a.seed)
    truth = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(viewport={"width": 820, "height": 900}, device_scale_factor=1.5)
        for i in range(a.n):
            case = render_case(rng, i)
            page.set_content(case["html"])
            box = page.locator("#pack").bounding_box()
            clip = dict(box)
            if case["defect"] == "cut":  # the photo misses the end of the list
                clip["width"] = box["width"] * 0.62
            page.screenshot(path=str(out / f"{case['id']}.png"), clip=clip)
            truth.append({"id": case["id"], "file": f"{case['id']}.png", **case["truth"]})
        b.close()
    (out / "truth.json").write_text(json.dumps(truth, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(truth)} labels in {out}")


if __name__ == "__main__":
    main()
