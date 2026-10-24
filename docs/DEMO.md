# Demo (3 minutes)

**Set up before:** two phones (or one phone and a laptop) on the same Wi-Fi as the laptop running
`uv run wiqaya serve --host 0.0.0.0 --https`. Parent phone: family "Sara: peanuts, tree nuts", "Omar: gluten,
halal", Sara's doctor's plan saved. Grandma's phone joined as a caregiver. Products on the table: an imported
biscuit with an Arabic sticker, something with tahini, a Nutella jar.

1. **The problem (20 s).** "11.5% of Jordanian schoolchildren have a food allergy their parents know about, and
   only half of those are diagnosed. The person buying the snack is often their grandmother, and the label is in
   Italian."
2. **Grandma scans the biscuit (40 s).** Barcode isn't known, so she photographs the label and the Arabic sticker.
   Result: **Sara: not suitable**. "The original label says *Può contenere frutta a guscio* (tree nuts), but the
   Arabic sticker leaves it out." Gemma read both languages; the phone did the check.
3. **She asks the parent (30 s).** "Ask a parent" → the parent's phone shows the question, the photo and the quoted
   words → *Not this one* with a note → Grandma's screen shows the answer.
4. **A hidden name (20 s).** A product with tahini or jameed: flagged as sesame or milk, with the reason from the
   Jordanian pack.
5. **Emergency (25 s).** Tap *Emergency* → Sara → call 911 (use a teammate's number on stage), the card for
   paramedics in Arabic, and the text to the family: "Sara: last scanned Nutella (not suitable) at 4:12 pm,
   location …".
6. **Trust (25 s).** "Gemma sees the label, never the child": show `docs/PRIVACY.md`'s table and a captured Gemma
   request (`bench/out/labels/gemma_requests.json`). Benchmark: allergens caught, **zero false greens**. Open
   source, Gemma 4 on our own machine, Open Food Facts.
