"""Walk through Wiqaya in two phone-sized browsers, the way a family would, and save screenshots.

    uv run wiqaya serve --port 8010 &
    uv run python scripts/ui_flow.py http://127.0.0.1:8010 --label bench/out/labels/label-006.png

Parent: consents, sets up the family (Sara: peanuts and tree nuts; Omar: gluten, halal, cautious about traces), checks
Nutella by barcode. Grandma: joins with the invite link and checks Philadelphia (amber for Omar), asks; the parent
approves and saves the recipe; grandma sees the answer; the safe list has it. Then emergency, profile, cook card,
child mode, Arabic; Omar joins on his own phone and adds an allergy, which reaches the parent's phone; and a desktop
pass.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import Page, expect, sync_playwright

PHONE = {"viewport": {"width": 390, "height": 844}, "device_scale_factor": 2, "is_mobile": True, "has_touch": True}
DESKTOP = {"viewport": {"width": 1366, "height": 900}}
NUTELLA = "3017624010701"  # hazelnuts: red for Sara, nothing for Omar
PHILADELPHIA = "7622300441937"  # carob seed flour: amber for Omar
fails: list[str] = []


def check(name: str, fn, page: Page | None = None, out: Path | None = None) -> None:
    try:
        fn()
        print(f"PASS  {name}")
    except Exception as e:  # noqa: BLE001  keep going: report every failure at the end
        print(f"FAIL  {name}  <- {str(e).splitlines()[0][:200]}")
        fails.append(name)
        if page and out:
            page.screenshot(path=str(out / f"fail-{len(fails)}.png"), full_page=True)


def shot(page: Page, out: Path, name: str) -> None:
    page.screenshot(path=str(out / f"{name}.png"), full_page=True)


def add_person(p: Page, name: str, allergens: list[str], diets: list[str], cautious: bool) -> None:
    p.get_by_role("button", name="Add a child").click()
    p.get_by_label("Name", exact=True).fill(name)
    for a in allergens:
        p.get_by_role("button", name=a, exact=True).click()
    for d in diets:
        p.get_by_label(d, exact=True).check()
    if cautious:
        p.get_by_role("button", name="Cautious: turn amber").click()
    p.get_by_role("button", name="Save").click()


def setup_family(p: Page, out: Path) -> None:
    p.get_by_role("button", name="Create our family").click()
    p.get_by_label("What should the family call you?").fill("Mum")
    p.get_by_label("Family name (optional)").fill("Al-Khatib")
    add_person(p, "Sara", ["Peanuts", "Tree nuts"], [], False)
    add_person(p, "Omar", ["Gluten"], ["Halal"], True)
    shot(p, out, "02-setup")
    p.get_by_role("button", name="Create the circle").click()
    expect(p.get_by_role("heading", name="Good food. Safer little moments.")).to_be_visible(timeout=10000)


def type_barcode(p: Page, code: str) -> None:
    p.get_by_role("button", name="Scan", exact=True).click()
    p.get_by_role("button", name="Type the barcode").click()
    p.get_by_label("Barcode number").fill(code)
    p.get_by_role("button", name="Look up").click()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--label", help="a label photo for the photo path (Gemma must be running)")
    ap.add_argument("--menu", help="a restaurant menu photo or PDF for the eating-out path (Gemma must be running)")
    ap.add_argument("--out", default="bench/out/ui")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])
        parent_ctx = b.new_context(**PHONE, permissions=["camera"])
        p = parent_ctx.new_page()
        errors: list[str] = []
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.goto(a.url)
        expect(p.get_by_role("heading", name="A safer start, together.")).to_be_visible()
        create = p.get_by_role("button", name="Create our family")
        check("consent comes first: nothing starts without it", lambda: expect(create).to_be_disabled())
        p.get_by_label("I'm a parent or guardian", exact=False).check()
        shot(p, out, "01-welcome")

        check("set up a family with two people", lambda: setup_family(p, out))
        shot(p, out, "03-home")

        def barcode_scan():
            type_barcode(p, NUTELLA)
            expect(p.get_by_role("heading", name="Not for Sara", exact=True)).to_be_visible(timeout=30000)
            expect(p.locator(".verdict-card.red", has_text="Sara")).to_contain_text("Tree nuts")
            expect(p.locator(".verdict-card.green", has_text="Omar")).to_be_visible()
            expect(p.get_by_text("“hazelnuts”").first).to_be_visible()
            expect(p.get_by_text("A red result can't be overridden.")).to_be_visible()
        check("barcode: Nutella is red for Sara, green for Omar; red can't be overridden", barcode_scan)
        shot(p, out, "04-result-barcode")

        if a.label:
            def photo_scan():
                p.get_by_role("button", name="Scan another").click()
                with p.expect_file_chooser() as fc:
                    p.get_by_role("button", name="Upload a photo").click()
                fc.value.set_files(a.label)
                expect(p.get_by_role("button", name="Add the Arabic sticker")).to_be_visible()
                shot(p, out, "05-photo-taken")
                p.get_by_role("button", name="Check now").click()
                shot(p, out, "06-checking")
                expect(p.locator(".verdicts")).to_be_visible(timeout=900000)
                expect(p.get_by_role("heading", name="Allergens on this label")).to_be_visible()
            check("label photo: Gemma reads it and the phone checks it", photo_scan)
            shot(p, out, "07-result-photo")

        if a.menu:
            def menu():
                p.get_by_role("button", name="Eating out", exact=True).click()
                expect(p.get_by_role("heading", name="What can we order?")).to_be_visible()
                with p.expect_file_chooser() as fc:
                    p.get_by_role("button", name="Add a photo or PDF of the menu").click()
                fc.value.set_files(a.menu)
                p.get_by_role("button", name="Check the menu").click()
                expect(p.locator(".menu-summary")).to_be_visible(timeout=900000)
                expect(p.locator(".dish-group.avoid")).to_be_visible()
                shot(p, out, "07b-menu")
                p.get_by_role("button", name="Show the cook card").click()
                expect(p.get_by_text("Please help keep our meal safe.")).to_be_visible()
            check("eating out: a menu photo, dishes grouped per person, then the cook card", menu, p, out)

        def invite():
            p.goto(a.url)
            p.get_by_role("button", name="Family", exact=True).click()
            expect(p.get_by_text("Parent · owner")).to_be_visible()
            p.get_by_role("button", name="Invite a grandparent").click()
            expect(p.locator(".qr canvas")).to_be_visible()
        check("family screen and invite", invite)
        shot(p, out, "08-invite")
        link = p.get_by_label("Invite link").input_value()
        p.keyboard.press("Escape")

        g_ctx = b.new_context(**PHONE, permissions=["camera"])
        g = g_ctx.new_page()
        g.on("pageerror", lambda e: errors.append("grandma: " + str(e)))

        def join():
            assert urlparse(link).fragment.startswith("join="), link
            g.goto(link)
            g.get_by_label("What should the family call you?").fill("Teta")
            expect(g.get_by_role("button", name="Join")).to_be_disabled()
            g.get_by_label("I'm a parent or guardian", exact=False).check()
            g.get_by_role("button", name="Join").click()
            expect(g.get_by_role("heading", name="Sara")).to_be_visible(timeout=20000)
        check("grandma joins as a grandparent (with consent) and gets the profiles", join)
        shot(g, out, "09-grandma-home")

        def ask_and_approve():
            type_barcode(g, PHILADELPHIA)
            expect(g.get_by_role("heading", name="Check first for Omar")).to_be_visible(timeout=30000)
            expect(g.locator(".verdict-card.amber", has_text="Omar")).to_be_visible()
            shot(g, out, "10-grandma-amber")
            g.get_by_role("button", name="Ask Mum").click()
            expect(g.get_by_text("Sent. You'll see the answer here.")).to_be_visible(timeout=10000)
            p.goto(a.url)
            p.get_by_text("Teta asks about Philadelphia").click(timeout=20000)
            shot(p, out, "11-parent-request")
            p.get_by_label("Add a note (optional)").fill("Fine for Omar, it's locust bean gum")
            expect(p.get_by_label("Save this exact recipe to the family safe list")).to_be_checked()
            p.get_by_role("button", name="Approve for Omar").click()
            expect(p.get_by_role("heading", name="Answer sent")).to_be_visible()
            p.get_by_role("button", name="Done").click()
            g.goto(a.url)
            expect(g.get_by_text("Mum answered: approved").first).to_be_visible(timeout=20000)
            g.get_by_text("Mum answered: approved").first.click()
            expect(g.get_by_text("Mum approved this recipe")).to_be_visible()
            expect(g.locator(".verdict-card.green", has_text="Omar")).to_be_visible()
        check("grandma asks about an amber product; the parent approves; grandma sees it", ask_and_approve)
        shot(g, out, "12-grandma-answer")

        def safe_list():
            p.goto(a.url)
            p.get_by_role("button", name="Safe list", exact=True).click()
            expect(p.get_by_text("Philadelphia Original")).to_be_visible(timeout=10000)
            expect(p.get_by_text("Approved", exact=False).first).to_be_visible()
            p.get_by_role("button", name="Sara", exact=True).click()
            expect(p.get_by_text("No products match your search.")).to_be_visible()
        check("safe list: the approved recipe, filtered by person", safe_list)
        shot(p, out, "13-safe-list")

        def emergency():
            p.goto(a.url)
            p.get_by_role("button", name="Emergency", exact=True).click()
            p.get_by_role("button", name="Sara", exact=True).click()
            expect(p.get_by_role("link", name="Call 911 now", exact=False)).to_have_attribute("href", "tel:911")
            expect(p.locator(".em-facts")).to_contain_text("Philadelphia Original")  # grandma's, the latest
        check("emergency: call 911, Sara's card, last scanned product", emergency)
        shot(p, out, "14-emergency")

        def profile():
            p.goto(a.url)
            p.get_by_role("button", name="Family", exact=True).click()
            p.locator("button.person-main", has_text="Sara").click()
            p.get_by_text("Doctor's emergency plan and pen expiry").click()
            p.get_by_label("Action plan from the doctor").fill("If wheezing or lip swelling: epinephrine pen in the outer thigh, then call 911.")
            p.get_by_label("Medicines").fill("Epinephrine pen 0.15 mg")
            p.get_by_label("Epinephrine pen expiry").fill("2026-11-10")
            p.get_by_role("button", name="Add a contact").click()
            p.get_by_placeholder("Name").last.fill("Mum")
            p.get_by_placeholder("Phone").last.fill("+962 79 000 0000")
            shot(p, out, "15-profile-edit")
            p.get_by_role("button", name="Save profile").click()
            p.get_by_role("button", name="Overview").click()
            expect(p.get_by_text("Sara's epinephrine pen expires in")).to_be_visible()
        check("profile: doctor's plan and pen expiry saved; the reminder shows", profile)
        shot(p, out, "16-home-reminder")

        def cook_and_child():
            p.locator("button.quick", has_text="Tell the cook").click()  # on a phone, from the overview
            expect(p.get_by_text("Please help keep our meal safe.")).to_be_visible()
            expect(p.get_by_text("يُرجى المساعدة في تحضير وجبة آمنة")).to_be_visible()
            shot(p, out, "17-cook-card")
            p.get_by_role("tab", name="Child mode").click()
            p.get_by_role("button", name="Sara", exact=True).click()
            # Sara's latest scan is grandma's Philadelphia (no problem for her)
            expect(p.get_by_role("heading", name="A grown-up checked this label.")).to_be_visible()
        check("cook card in both languages; child mode for Sara", cook_and_child)
        shot(p, out, "18-child")

        def arabic():
            p.goto(a.url)
            p.get_by_role("button", name="العربية").click()
            expect(p.locator("html")).to_have_attribute("dir", "rtl")
        check("Arabic: the app switches to right-to-left", arabic)
        shot(p, out, "19-home-ar")

        def arabic_result():
            p.locator("button.item:not([disabled])", has_text="Nutella").first.click()
            expect(p.get_by_role("heading", name="غير مناسب لـ Sara")).to_be_visible()
        check("Arabic: a result reads right to left", arabic_result)
        shot(p, out, "20-result-ar")
        p.get_by_role("button", name="English").click()
        expect(p.locator("html")).to_have_attribute("dir", "ltr")

        def child_joins():
            # Mum shows Omar's own code; Omar's phone joins and adds sesame; Mum's phone takes it in (no reload here:
            # the language change above is still being saved)
            p.get_by_role("button", name="Family", exact=True).click()
            p.get_by_role("button", name="Invite Omar's phone").click()
            child_link = p.get_by_label("Invite link").input_value()
            p.keyboard.press("Escape")
            c = b.new_context(**PHONE, permissions=["camera"]).new_page()
            c.on("pageerror", lambda e: errors.append("omar: " + str(e)))
            c.goto(child_link)
            expect(c.get_by_role("heading", name="Hi Omar")).to_be_visible()
            c.get_by_role("button", name="Sesame", exact=True).click()
            shot(c, out, "21-child-join")
            c.get_by_role("button", name="Save my allergies").click()
            expect(c.get_by_role("button", name="My allergies")).to_be_visible(timeout=10000)
            expect(c.locator("button.member")).to_have_count(1)  # only his own card
            p.goto(a.url)
            p.get_by_role("button", name="Family", exact=True).click()
            omar = p.locator(".person-row", has_text="Omar")
            expect(omar).to_contain_text("Sesame", timeout=20000)
            expect(omar).to_contain_text("On Omar's own phone")
            shot(p, out, "22-family-after-child")
        check("a child joins on their own phone, chooses an allergy, and the parent's phone takes it in", child_joins, p, out)

        def desktop():
            # the same family on a laptop: sidebar, dashboard
            d = b.new_context(**DESKTOP).new_page()
            d.on("pageerror", lambda e: errors.append("desktop: " + str(e)))
            d.goto(link)
            d.get_by_label("What should the family call you?").fill("Omar's teacher")
            d.get_by_label("I'm a parent or guardian", exact=False).check()
            d.get_by_role("button", name="Join").click()
            expect(d.get_by_role("heading", name="Sara")).to_be_visible(timeout=20000)
            expect(d.locator(".sidebar")).to_be_visible()
            shot(d, out, "23-desktop-home")
        check("desktop: sidebar and dashboard", desktop)

        print("page errors:", errors)
        b.close()
    print(f"{len(fails)} failed" if fails else "all passed")
    sys.exit(1 if fails or errors else 0)


if __name__ == "__main__":
    main()
