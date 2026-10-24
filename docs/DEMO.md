# Demo (about 4 minutes)

**Set up before.** The laptop runs `uv run wiqaya serve --host 0.0.0.0 --https` (and `uv run wiqaya prefetch` once,
so Jordan's products are cached if the Wi-Fi is slow). Three phones on the same Wi-Fi (or phones and a laptop
browser):

- **Parent's phone ("Mum").** "I'm a parent", consent ticked, family created: **Sara** avoids peanuts and tree nuts,
  strict about traces; **Omar** avoids gluten, halal, cautious about traces. Sara's doctor's plan, medicines, pen
  expiry and a family contact saved (Family → Sara → Doctor's emergency plan and pen expiry).
- **Grandma's phone ("Teta").** Joined as a grandparent with the QR code (Family → Invite a grandparent).
- **A third phone, for Sara.** Not joined yet: it joins on stage.
- **On the table.** A Nutella jar (barcode 3017624010701), a Philadelphia Original (7622300441937), and an
  imported biscuit with an Arabic sticker (or print `bench/out/labels/label-006.png`).

1. **The problem (20 s).** "11.5% of Jordanian schoolchildren have a food allergy their parents know about, and
   only half of those are diagnosed. The person buying the snack is often their grandmother, and the label is in
   Italian."
2. **Sara joins on a phone of their own (30 s).** Mum opens Family: Sara is listed as a child, "No phone joined yet". Mum
   taps *Invite Sara's phone*; Sara scans the QR code: "Hi Sara", a grid of allergy pictures. Sara taps sesame too and
   saves. On Mum's phone a moment later, Sara's row says "On Sara's own phone" with sesame added. Mum opens Sara's
   profile ("Sara chose some of these on their own phone") and can change anything. A child's choice can only add
   caution; the parent's signed profile is what every phone uses. Mum taps sesame off again for the rest of the
   demo.
3. **Nutella: red (25 s).** Sara points the camera at the jar; the barcode is read by itself, no button. A big red
   card: **Not for Sara**, with a *Tree nuts · Contains* chip. Sara's phone shows only Sara's result. On Mum's phone the
   same scan shows both children (Omar green) and the allergen tiles on the label. A red result can't be overridden,
   and there is no approve button for it.
4. **Philadelphia: ask and approve (45 s).** Teta scans the Philadelphia barcode. Omar is **amber**: Wiqaya doesn't
   know the carob seed flour, so it can't rule it out. Teta taps **Ask Mum**. Mum's phone shows "Teta asks about
   Philadelphia", the quoted words and the reason; Mum adds a note ("Fine for Omar, it's locust bean gum"), leaves
   *Save this exact recipe to the family safe list* ticked, and taps **Approve for Omar**. Teta's screen shows "Mum
   answered: approved". Only amber can be approved, and approval records a parent's decision; it doesn't change
   what the label says.
5. **The sticker (30 s).** Teta takes a photo of the imported biscuit's ingredients with the round shutter, then
   *Add the Arabic sticker* and a second photo, then *Check now*. Gemma reads
   both languages and pairs the lists; the phone finds the **sticker discrepancy**: the original lists an
   ingredient (or a "may contain" line) that the Arabic sticker leaves out. Gemma read; the phone decided.
6. **Safe list (10 s).** Safe list: Philadelphia, approved by Mum for Omar, tied to the exact recipe. If the
   ingredients change, it shows a recipe change alert and stops counting as approved.
7. **Eating out (25 s).** "Where can we take the kids tonight?" Eating out → take a photo of the
   restaurant's menu. In about ten seconds: *12 good to ask for · 6 ask the staff first · 9 avoid*. Tabbouleh is
   under Avoid for Omar (the menu says bulgur), knafeh too (wheat pastry); hummus is fine for both. Tap Sara to see
   only Sara's view. Nothing is ever "safe" on a menu, so it ends with *Show the cook card*. Gemma saw the menu only.
8. **Cook card and child mode (10 s).** Cook card: Sara's allergies with every hidden name, in Arabic and English.
   Child mode: a face that tells Sara, in Arabic and English, what a grown-up found on the last snack's label.
9. **Emergency (20 s).** Tap **Emergency** → Sara: *Call 911 now* (use a teammate's number on stage), the doctor's
   plan word for word, *Show to paramedics* in Arabic or English, and the text to the family: "Sara may be having
   an allergic reaction. Last scanned: Nutella (not suitable) at 4:12 pm. Location: …". Wiqaya doesn't decide
   whether this is a reaction.
10. **Trust (20 s).** "Gemma sees the label, never the child": `docs/PRIVACY.md`'s table and a captured Gemma request
   (`bench/out/labels/gemma_requests.json`). The benchmark ([docs/RESULTS.md](RESULTS.md)): allergens caught, no
   false greens, cut-off photos never green. Open source, Gemma 4 on our own machine, Open Food Facts.

If the phones or the network fail on stage: with `uv run wiqaya serve --port 8010` running,
`uv run python scripts/ui_flow.py http://127.0.0.1:8010` replays the whole story in two browsers and saves
screenshots to `bench/out/ui`.
