import io
import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from wiqaya import gemma, labels, menus, off
from wiqaya.app import create_app
from wiqaya.images import BadImage, clean
from wiqaya.relay import Relay, RelayError
from wiqaya.search import parse_ddg_lite
from wiqaya.text import split_ingredients


class FakeGemma:
    """Answers like Gemma would, and records every request so tests can check what Gemma was sent."""

    def __init__(self, readings=None, pairs=None, findings=None, tool_calls=None, lines=None, dishes=None):
        self.readings = list(readings or [])
        self.dishes = dishes or []
        self.lines = lines or []
        self.pairs = pairs or []
        self.findings = findings or []
        self.tool_calls = tool_calls or []
        self.sent: list[str] = []
        self.expiry = "2026-11-30"

    def status(self):
        return {"available": True, "model": "fake"}

    def json(self, system, user, schema, images=None, num_predict=0, history=None):
        self.sent.append(user)
        props = schema["properties"]
        if "labels" in props:  # the second reading of the same photo gets the next one, or the same again
            return (self.readings.pop(0) if len(self.readings) > 1 else self.readings[0]), {}
        if "dishes" in props:
            return {"restaurant": "Beit Sitti", "language": "en", "dishes": self.dishes}, {}
        if "lines" in props:
            return {"lines": self.lines}, {}
        if "pairs" in props:
            return {"pairs": self.pairs}, {}
        if "findings" in props:
            return {"findings": self.findings}, {}
        if "expiry" in props:
            return {"expiry": self.expiry, "printed": "EXP 11/2026"}, {}
        return {"items": [{"trigger": "x", "quote": "y", "text": "Malt extract is made from barley."}]}, {}

    def run_tools(self, system, user, tools, max_steps=6):
        self.sent.append(user)
        log = []
        for name, args in self.tool_calls:
            log.append({"tool": name, "args": args, "result": tools[name][1](**args)})
        return [], log


def png(color=(255, 255, 255)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), color).save(buf, format="PNG")
    return buf.getvalue()


def reading(role, lang, items, may="", complete=True):
    return {"product_name": "Biscotti", "brand": "", "labels": [
        {"role": role, "language": lang, "ingredients": [{"text": t, "en": t} for t in items], "contains": "",
         "may_contain": may, "complete": complete, "legible": True}]}


# ----------------------------------------------------------------------------- images
def test_clean_drops_exif_and_gps():
    img = Image.new("RGB", (50, 40), (200, 10, 10))
    exif = Image.Exif()
    exif[0x010F] = "PhoneMaker"  # Make
    exif[0x8825] = {2: (31.0, 57.0, 0.0)}  # GPS latitude
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif.tobytes())
    assert Image.open(io.BytesIO(buf.getvalue())).getexif()
    out = Image.open(io.BytesIO(clean(buf.getvalue())))
    assert not out.getexif()
    assert out.info.get("exif") is None


def test_clean_rejects_non_images():
    with pytest.raises(BadImage):
        clean(b"not an image")


# ----------------------------------------------------------------------------- text, search
def test_split_ingredients():
    assert split_ingredients("sugar, emulsifier (soy lecithin, E476), salt.") == ["sugar", "emulsifier (soy lecithin, E476)", "salt"]
    assert split_ingredients("سكر، دقيق القمح؛ ملح") == ["سكر", "دقيق القمح", "ملح"]


def test_parse_duckduckgo_lite():
    page = """<a rel="nofollow" href="https://example.org/e476" class='result-link'>E476 &amp; you</a></td></tr>
    <tr><td>&nbsp;</td><td class='result-snippet'>Made from <b>castor oil</b>.</td>"""
    assert parse_ddg_lite(page, 3) == [{"title": "E476 & you", "url": "https://example.org/e476", "snippet": "Made from castor oil."}]


# ----------------------------------------------------------------------------- open food facts
def test_off_facts_from_parsed_ingredients():
    p = {"code": "3017624010701", "product_name": "Nutella", "brands": "Ferrero", "lang": "en",
         "ingredients": [{"text": "sugar", "is_in_taxonomy": 1}, {"text": "emulsifier", "is_in_taxonomy": 1,
                          "ingredients": [{"text": "lecithins", "is_in_taxonomy": 1}, {"text": "soya", "is_in_taxonomy": 1}]}],
         "allergens_tags": ["en:milk", "en:nuts"], "traces_tags": ["en:gluten"]}
    f = off.to_facts(p)
    assert f["label"]["ingredients"][1] == {"text": "emulsifier (lecithins, soya)", "en": None, "known_by_off": True}
    assert f["off"] == {"allergens": ["en:milk", "en:nuts"], "traces": ["en:gluten"]}
    assert f["name"] == "Nutella"


def test_off_facts_from_text_only():
    f = off.to_facts({"code": "1234567", "lang": "fr", "ingredients_text": "sucre, farine de blé (gluten), sel"})
    assert [i["text"] for i in f["label"]["ingredients"]] == ["sucre", "farine de blé (gluten)", "sel"]


def test_barcode_validation():
    assert off.valid_barcode("6251234567890")
    assert not off.valid_barcode("62512a")
    assert not off.valid_barcode("12")


# ----------------------------------------------------------------------------- relay
def test_relay_stores_and_lists(tmp_path):
    r = Relay(tmp_path / "relay.sqlite")
    cid = "c" * 22
    first = r.post(cid, "aaaa.bbbb")
    r.post(cid, "cccc.dddd")
    assert [m["body"] for m in r.since(cid)] == ["aaaa.bbbb", "cccc.dddd"]
    assert [m["body"] for m in r.since(cid, first["id"])] == ["cccc.dddd"]
    with pytest.raises(RelayError):
        r.post(cid, "plain text, not encrypted")
    with pytest.raises(RelayError):
        r.post("short", "aaaa.bbbb")


# ----------------------------------------------------------------------------- labels
def test_arrange_original_and_sticker():
    r1 = {"product_name": "B", "brand": None, "labels": [labels._label(reading("original", "it", ["zucchero"])["labels"][0]),
                                                        labels._label(reading("arabic_sticker", "ar", ["سكر"])["labels"][0])]}
    o, s, name, _ = labels.arrange([(r1, "")])
    assert o["language"] == "it" and s["language"] == "ar" and name == "B"
    assert "_role" not in o


def test_edge_check_only_lowers_complete():
    # the photo cuts "Gerstenmalzextrakt"; Gemma's reading finishes the word and calls the list complete
    items = ["Weizenmehl", "Gerstenmalzextrakt", "Natron"]
    g = FakeGemma(readings=[reading("only", "de", items)], lines=["Zutaten: Weizenmehl, Gerstenmalzextra", "Natron."])
    assert labels.read(g, "img")[0]["labels"][0]["complete"] is False
    # a line that wraps after a whole word is fine
    g = FakeGemma(readings=[reading("only", "de", items)], lines=["Zutaten: Weizenmehl, Gerstenmalzextrakt,", "Natron."])
    assert labels.read(g, "img")[0]["labels"][0]["complete"] is True
    # already incomplete: no second look, and nothing can make it complete
    g = FakeGemma(readings=[reading("only", "de", items, complete=False)])
    assert labels.read(g, "img")[0]["labels"][0]["complete"] is False
    assert len(g.sent) == 1


def test_two_readings_must_agree():
    # a list Gemma made up: the second reading of the same photo comes out different
    g = FakeGemma(readings=[reading("only", "tr", ["un", "şeker", "ayçiçek yağı", "kakao", "süt tozu"]),
                            reading("only", "tr", ["buğday unu", "tuz", "maya", "bitkisel yağ"])])
    lab = labels.read(g, "img")[0]["labels"][0]
    assert lab["legible"] is False and lab["complete"] is True
    # the same reading twice is fine
    g = FakeGemma(readings=[reading("only", "en", ["sugar", "cocoa", "salt"])])
    assert labels.read(g, "img")[0]["labels"][0]["legible"] is True


def test_short_list_without_contains_is_not_complete_and_lumped_lists_split():
    # the product's name read as its ingredients
    g = FakeGemma(readings=[reading("only", "en", ["Milk chocolate with hazelnut cream", "and whole hazelnuts"])])
    assert labels.read(g, "img")[0]["labels"][0]["complete"] is False
    lab = labels._label({"ingredients": [{"text": "zucchero, farina (frumento), sale", "en": "sugar, flour (wheat), salt"}]})
    assert [i["en"] for i in lab["ingredients"]] == ["sugar", "flour (wheat)", "salt"]
    lab = labels._label({"ingredients": [{"text": "İçindekiler: Şeker, süt tozu, fındık", "en": "Ingredients: sugar, milk powder, hazelnuts"}]})
    assert [i["text"] for i in lab["ingredients"]] == ["Şeker", "süt tozu", "fındık"]
    lab = labels._label({"ingredients": [{"text": "sugar", "en": "sugar"}, {"text": "Contains:", "en": "Contains:"}]})
    assert [i["text"] for i in lab["ingredients"]] == ["sugar"]
    lab = labels._label({"ingredients": [{"text": "a, b, c", "en": "a and b, c"}]})
    assert len(lab["ingredients"]) == 1  # the English splits differently: kept whole


def test_edge_check_survives_a_cut_short_answer():
    class Cut(FakeGemma):
        def json(self, system, user, schema, images=None, num_predict=0, history=None):
            if "lines" in schema["properties"]:
                raise gemma.GemmaError("not JSON", '{"lines": ["Zutaten: Weizenmehl, Gerstenmalzextra", "Natron, Zu')
            return super().json(system, user, schema, images, num_predict, history)
    items = ["Weizenmehl", "Gerstenmalzextrakt", "Natron"]
    assert labels.read(Cut(readings=[reading("only", "de", items)]), "img")[0]["labels"][0]["complete"] is False


def test_pair_checks_indices():
    g = FakeGemma(pairs=[{"original": 0, "arabic": 0}, {"original": 1, "arabic": 0}, {"original": 7, "arabic": 1}])
    o = {"language": "it", "ingredients": [{"text": "a"}, {"text": "b"}, {"text": "c"}]}
    s = {"language": "ar", "ingredients": [{"text": "x"}, {"text": "y"}]}
    pairs, _ = labels.pair(g, o, s)
    # Arabic item 0 used once; original 2 was skipped by Gemma, so it counts as unpaired
    assert pairs == [[0, 0], [1, None], [2, None]]


def test_research_keeps_only_sources_gemma_saw(monkeypatch):
    monkeypatch.setattr(labels, "web_search", lambda q, n=5: [{"title": "t", "url": "https://real.example/e476", "snippet": "s"}])
    g = FakeGemma(tool_calls=[("web_search", {"query": "E476 source"})], findings=[
        {"ingredient": "E476", "triggers": ["soy", "not_a_group"], "reason": "r",
         "sources": ["https://real.example/e476", "https://invented.example"]},
        {"ingredient": "salt", "triggers": [], "reason": "", "sources": []}])
    out, log = labels.research(g, ["E476", "salt"])
    assert out == [{"ingredient": "E476", "triggers": ["soy"], "reason": "r", "sources": ["https://real.example/e476"]}]
    assert log[0]["tool"] == "web_search"


def test_gemma_falls_back_to_an_installed_gemma4(monkeypatch):
    class R:
        def __init__(self, j):
            self.j = j

        def json(self):
            return self.j

    tags = {"models": [{"name": "llama3:8b", "model": "llama3:8b"}, {"name": "gemma4:e4b", "model": "gemma4:e4b"}]}
    monkeypatch.setattr(gemma.httpx, "get", lambda url, timeout: R(tags if url.endswith("/tags") else {"version": "0.40"}))
    g = gemma.Gemma(model="gemma4:e4b-it-qat")
    assert g.status() == {"available": True, "model": "gemma4:e4b", "ollama": "0.40"}
    assert gemma.fallback({"gemma4:e2b", "gemma4:e4b-it-qat"}) == "gemma4:e4b-it-qat"
    assert gemma.fallback({"llama3:8b"}) is None


# ----------------------------------------------------------------------------- the API
@pytest.fixture
def client(tmp_path):
    def make(gemma):
        return TestClient(create_app(gemma=gemma, relay=Relay(tmp_path / "r.sqlite"), cache=off.Cache(tmp_path / "p.sqlite")))
    return make


def test_scan_two_photos_original_and_sticker(client):
    g = FakeGemma(readings=[reading("only", "it", ["zucchero", "farina di frumento"], may="Può contenere frutta a guscio"),
                            reading("only", "ar", ["سكر", "دقيق القمح"])],
                  pairs=[{"original": 0, "arabic": 0}, {"original": 1, "arabic": 1}])
    c = client(g)
    r = c.post("/api/scan", files=[("photos", ("a.png", png(), "image/png")), ("photos", ("b.png", png(), "image/png"))],
               data={"hints": ["original", "sticker"]})
    assert r.status_code == 200, r.text
    f = r.json()
    assert f["label"]["language"] == "it" and f["label"]["may_contain"] == "Può contenere frutta a guscio"
    assert f["sticker"]["language"] == "ar" and f["sticker"]["may_contain"] is None
    assert f["pairs"] == [[0, 0], [1, 1]]


def test_a_checked_photo_reading_answers_the_next_barcode_scan(client, monkeypatch):
    monkeypatch.setattr(off, "fetch", lambda code, cache=None: None)  # not in Open Food Facts
    good = reading("only", "ar", ["سكر", "دقيق القمح", "ملح"])
    c = client(FakeGemma(readings=[good]))
    assert c.get("/api/product/6251234567890").status_code == 404
    r = c.post("/api/scan", files=[("photos", ("a.png", png(), "image/png"))], data={"barcode": "6251234567890"})
    assert r.status_code == 200, r.text
    again = c.get("/api/product/6251234567890").json()
    assert [i["text"] for i in again["label"]["ingredients"]] == ["سكر", "دقيق القمح", "ملح"]
    assert again["read_from_photo"] > 0
    # a list that didn't pass the checks is never kept
    c = client(FakeGemma(readings=[reading("only", "ar", ["سكر", "دقيق القمح", "ملح"], complete=False)]))
    c.post("/api/scan", files=[("photos", ("a.png", png(), "image/png"))], data={"barcode": "6250000000017"})
    assert c.get("/api/product/6250000000017").status_code == 404


def test_scan_rejects_bad_input(client):
    c = client(FakeGemma())
    assert c.post("/api/scan", files=[("photos", ("a.txt", b"hello", "text/plain"))]).json()["error"] == "not_an_image"


def test_gemma_only_ever_gets_product_data(client):
    """The API has no field for a person; what Gemma receives is label text and ingredient names only."""
    g = FakeGemma(readings=[reading("only", "en", ["sugar", "E476"])], findings=[])
    c = client(g)
    c.post("/api/scan", files=[("photos", ("a.png", png(), "image/png"))])
    c.post("/api/research", json={"ingredients": ["E476"], "product_name": "Wafer"})
    c.post("/api/explain", json={"findings": [{"trigger": "gluten", "quote": "malt extract"}], "lang": "en"})
    sent = json.dumps(g.sent)
    for word in ("Sara", "allerg", "member", "profile", "latitude"):
        assert word.lower() not in sent.lower().replace("allergy checker", "")


DISH = {"name": "Moutabal", "en": "Moutabal", "section": "Mezze", "description": "", "usual": ["aubergine", "tahini"]}


def test_menu_from_a_photo_and_a_scanned_pdf(client):
    g = FakeGemma(dishes=[DISH, {**DISH, "name": "moutabal"}, {**DISH, "name": ""}])
    c = client(g)
    buf = io.BytesIO()
    Image.new("RGB", (300, 400), "white").save(buf, format="PDF")
    for name, data, kind in [("menu.png", png(), "image/png"), ("menu.pdf", buf.getvalue(), "application/pdf")]:
        r = c.post("/api/menu", files=[("files", (name, data, kind))])
        assert r.status_code == 200, r.text
        # the same dish twice and an empty one are dropped
        assert [d["name"] for d in r.json()["dishes"]] == ["Moutabal"]
    # Gemma got the menu and nothing else
    assert all(u.startswith("The menu") for u in g.sent)


def test_menu_link_to_a_local_address_is_refused(client):
    c = client(FakeGemma(dishes=[DISH]))
    for url in ("http://127.0.0.1:8000/", "http://localhost/menu", "file:///etc/passwd", "http://192.168.1.1/"):
        assert c.post("/api/menu", data={"url": url}).json()["error"] == "url_blocked", url
    assert c.post("/api/menu").json()["error"] == "nothing_to_read"


def test_menu_page_text():
    page = "<html><head><title>x</title><script>var a=1</script></head><body><h2>Mezze</h2><p>Hummus &amp; bread</p></body>"
    assert menus.page_text(page) == "Mezze\nHummus & bread"


def test_relay_api(client):
    c = client(FakeGemma())
    cid = "AbCdEfGhIjKlMnOpQrStUv"
    assert c.post(f"/api/circle/{cid}", json={"body": "aaa.bbb"}).status_code == 200
    assert c.get(f"/api/circle/{cid}").json()["messages"][0]["body"] == "aaa.bbb"
    assert c.post(f"/api/circle/{cid}", json={"body": "hello there"}).status_code == 400


def test_health(client):
    j = client(FakeGemma()).get("/api/health").json()
    assert j["gemma"]["available"] is True


def test_expiry_date_from_a_box_photo(client):
    g = FakeGemma()
    c = client(g)
    r = c.post("/api/expiry", files={"photo": ("box.png", png(), "image/png")})
    assert r.json() == {"expiry": "2026-11-30", "printed": "EXP 11/2026"}
    g.expiry = "next year"  # anything that isn't a date is dropped
    assert c.post("/api/expiry", files={"photo": ("box.png", png(), "image/png")}).json()["expiry"] is None
    assert c.post("/api/expiry", files={"photo": ("x.png", b"not an image", "image/png")}).status_code == 400
