# Demo (3 minutes)

**Set up before.** The laptop runs `uv run wiqaya serve --host 0.0.0.0 --https` (and `uv run wiqaya prefetch` once,
so Jordan's products are cached if the Wi-Fi is slow). Two phones on the same Wi-Fi, or a phone and a laptop
browser:

- **Parent's phone ("Mum").** Consent ticked, family circle created: **Sara** avoids peanuts and tree nuts, strict
  about traces; **Omar** avoids gluten, halal, cautious about traces. Sara's doctor's plan, medicines, pen expiry
  and a family contact saved (Family circle → Sara → Doctor's emergency plan and pen expiry).
- **Grandma's phone ("Teta").** Joined as a caregiver with the invite QR (Family circle → Invite a caregiver).
- **On the table.** A Nutella jar (barcode 3017624010701), a Philadelphia Original (7622300441937), and an
  imported biscuit with an Arabic sticker (or print `bench/out/labels/label-006.png`).

1. **The problem (20 s).** "11.5% of Jordanian schoolchildren have a food allergy their parents know about, and
   only half of those are diagnosed. The person buying the snack is often their grandmother, and the label is in
   Italian."
2. **Consent and privacy (15 s).** Open Wiqaya on a fresh browser: the welcome screen explains that profiles stay on
   the phone and Gemma sees the label, never the child. Nothing starts until the consent box is ticked. Then switch
   to Mum's phone.
3. **Nutella: red (25 s).** Mum scans the barcode. **Not for Sara**: "The label lists hazelnuts: tree nuts", quoting
   the label. Omar: no problem found. Point at the line under the result: a red result can't be overridden, and
   there is no approve button for it.
4. **Philadelphia: ask and approve (45 s).** Teta scans the Philadelphia barcode. Omar is **amber**: Wiqaya doesn't
   know the carob seed flour, so it can't rule it out. Teta taps **Ask Mum**. Mum's phone shows "Teta asks about
   Philadelphia", the quoted words and the reason; Mum adds a note ("Fine for Omar, it's locust bean gum"), leaves
   *Save this exact recipe to the family safe list* ticked, and taps **Approve for Omar**. Teta's screen shows "Mum
   answered: approved". Only amber can be approved, and approval records a parent's decision; it doesn't change
   what the label says.
5. **The sticker (30 s).** Teta photographs the imported biscuit's original label and its Arabic sticker. Gemma reads
   both languages and pairs the lists; the phone finds the **sticker discrepancy**: the original lists an
   ingredient (or a "may contain" line) that the Arabic sticker leaves out. Gemma read; the phone decided.
6. **Safe list (10 s).** Safe list: Philadelphia, approved by Mum for Omar, tied to the exact recipe. If the
   ingredients change, it shows a recipe change alert and stops counting as approved.
7. **Cook card and child mode (15 s).** Cook card: Sara's allergies with every hidden name, in Arabic and English,
   with *Read to the cook*. Child mode: a face and a voice that tell Sara, in Arabic and English, what a grown-up found on
   her last snack's label.
8. **Emergency (20 s).** Tap **Emergency** → Sara: *Call 911 now* (use a teammate's number on stage), the doctor's
   plan word for word, *Show to paramedics* in Arabic or English, and the text to the family: "Sara may be having
   an allergic reaction. Last scanned: Nutella (not suitable) at 4:12 pm. Location: …". Wiqaya doesn't decide
   whether this is a reaction.
9. **Trust (20 s).** "Gemma sees the label, never the child": `docs/PRIVACY.md`'s table and a captured Gemma request
   (`bench/out/labels/gemma_requests.json`). The benchmark ([docs/RESULTS.md](RESULTS.md)): allergens caught, no
   false greens, cut-off photos never green. Open source, Gemma 4 on our own machine, Open Food Facts.

If the phones or the network fail on stage: with `uv run wiqaya serve --port 8010` running,
`uv run python scripts/ui_flow.py http://127.0.0.1:8010` replays the whole story in two browsers and saves
screenshots to `bench/out/ui`.
