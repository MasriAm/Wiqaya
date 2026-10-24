"""Walk through Wiqaya in two phone-sized browsers, the way a family would, and save screenshots.

    uv run wiqaya serve --port 8010 &
    uv run python scripts/ui_flow.py http://127.0.0.1:8010 --label bench/out/labels/label-006.png

Parent: sets up the family (Sara: peanuts and tree nuts; Omar: gluten, halal), scans a barcode, photographs a label.
Grandma: joins with the invite link, scans, asks the parent; the parent approves; grandma sees the answer.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import Page, expect, sync_playwright

PHONE = {"viewport": {"width": 390, "height": 844}, "device_scale_factor": 2, "is_mobile": True, "has_touch": True}
fails: list[str] = []


def check(name: str, fn) -> None:
    try:
        fn()
        print(f"PASS  {name}")
    except Exception as e:  # noqa: BLE001  keep going: report every failure at the end
        print(f"FAIL  {name}  <- {str(e).splitlines()[0][:200]}")
        fails.append(name)


def shot(page: Page, out: Path, name: str) -> None:
    page.screenshot(path=str(out / f"{name}.png"), full_page=True)


def setup_family(p: Page) -> None:
    p.get_by_role("button", name="Set up my family").click()
    p.get_by_placeholder("For example: Mum, Teta, Omar").fill("Mum")
    p.get_by_role("button", name="Next").click()
    for name, allergies, diets, allow in [("Sara", ["Peanuts", "Tree nuts"], [], False), ("Omar", ["Gluten"], ["Halal"], True)]:
        p.get_by_role("button", name="Add a person").click()
        p.get_by_placeholder("For example: Sara").fill(name)
        for a in allergies + diets:
            p.get_by_role("button", name=a, exact=True).click()
        if allow:
            p.get_by_role("button", name="Show them as a warning (amber)").click()
        p.get_by_role("button", name="Save").click()
    p.get_by_role("button", name="Next").click()
    p.get_by_role("button", name="Start").click()
    expect(p.get_by_role("button", name="Scan a product")).to_be_visible(timeout=10000)


def type_barcode(p: Page, code: str) -> None:
    p.get_by_role("button", name="Scan a product").click()
    p.get_by_role("button", name="Type the barcode").click()
    p.get_by_label("Barcode number").fill(code)
    p.get_by_role("button", name="Look up").click()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--label", help="a label photo for the photo path (Gemma must be running)")
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
        expect(p.get_by_text("Check food labels against your family's allergies.")).to_be_visible()
        shot(p, out, "01-welcome")

        check("set up a family with two people", lambda: setup_family(p))
        shot(p, out, "02-home")

        def barcode_scan():
            type_barcode(p, "3017624010701")  # Nutella: hazelnuts
            expect(p.get_by_role("heading", name="Not for Sara")).to_be_visible(timeout=30000)
            expect(p.get_by_text("“hazelnuts”").first).to_be_visible()
            expect(p.get_by_role("heading", name="No problem found for Omar")).to_be_visible()
        check("barcode: Nutella is red for Sara, green for Omar", barcode_scan)
        shot(p, out, "03-result-barcode")

        if a.label:
            def photo_scan():
                p.get_by_role("button", name="Scan another").click()
                p.get_by_role("button", name="Photograph the ingredients").click()
                with p.expect_file_chooser() as fc:
                    p.get_by_role("button", name="Choose a photo").click()
                fc.value.set_files(a.label)
                p.get_by_role("button", name="Use this photo").click()
                shot(p, out, "04-sticker-question")
                p.get_by_role("button", name="No, check now").click()
                shot(p, out, "05-checking")
                expect(p.locator(".summary-banner")).to_be_visible(timeout=900000)
            check("label photo: Gemma reads it and the phone checks it", photo_scan)
            shot(p, out, "06-result-photo")

        check("family screen and invite", lambda: (
            p.goto(a.url), p.get_by_role("button", name="Family").click(),
            p.get_by_role("button", name="Invite a caregiver").click(),
            expect(p.locator(".qr canvas")).to_be_visible()))
        shot(p, out, "07-invite")
        link = p.get_by_label("Invite link").input_value()
        g_ctx = b.new_context(**PHONE, permissions=["camera"])
        g = g_ctx.new_page()
        g.on("pageerror", lambda e: errors.append("grandma: " + str(e)))

        def join():
            assert urlparse(link).fragment.startswith("join="), link
            g.goto(link)
            g.get_by_placeholder("For example: Mum, Teta, Omar").fill("Teta")
            g.get_by_role("button", name="Join").click()
            expect(g.get_by_text("Sara").first).to_be_visible(timeout=20000)
        check("grandma joins with the invite link and gets the profiles", join)
        shot(g, out, "08-grandma-home")

        def ask_and_approve():
            type_barcode(g, "3017624010701")
            expect(g.get_by_role("heading", name="Not for Sara")).to_be_visible(timeout=30000)
            g.get_by_role("button", name="Ask a parent").click()
            expect(g.get_by_text("Waiting for a parent's answer")).to_be_visible(timeout=10000)
            p.goto(a.url)
            p.get_by_text("Teta asks about Nutella").click(timeout=20000)
            shot(p, out, "09-parent-request")
            p.get_by_label("Add a note (optional)").fill("A small spoon is fine for Omar, not Sara")
            p.get_by_role("button", name="Not this one").click()
            g.goto(a.url)
            expect(g.get_by_text("Mum answered: not this one").first).to_be_visible(timeout=20000)
        check("grandma asks; the parent answers; grandma sees it", ask_and_approve)
        shot(g, out, "10-grandma-answer")

        def emergency():
            p.goto(a.url)
            p.get_by_role("button", name="Emergency").click()
            p.get_by_role("button", name="Sara").click()
            expect(p.get_by_role("link", name="Call 911")).to_have_attribute("href", "tel:911")
            expect(p.get_by_text("Nutella").first).to_be_visible()
        check("emergency: call 911, Sara's card, last scanned product", emergency)
        shot(p, out, "11-emergency")

        def arabic():
            p.goto(a.url)
            p.get_by_role("button", name="Settings").click()
            p.get_by_role("button", name="العربية").click()
            expect(p.locator("html")).to_have_attribute("dir", "rtl")
            p.go_back()
        check("Arabic: the app switches to right-to-left", arabic)
        shot(p, out, "12-home-ar")

        print("page errors:", errors)
        b.close()
    print(f"{len(fails)} failed" if fails else "all passed")
    sys.exit(1 if fails or errors else 0)


if __name__ == "__main__":
    main()
