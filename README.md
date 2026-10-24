# Wiqaya · وقاية

**Scan a food label. Check it against your family's allergies. The allergy goes wherever the child goes.**

Wiqaya is an open-source food label checker for families in Jordan. Anyone who feeds a child (a parent, a
grandmother, a driver, the school) scans a product. **Gemma 4** reads the label in any language; the **phone**
checks it against each person's profile and shows red, amber or green, quoting the label's own words. Nobody, not
the server and not the AI, learns who is allergic to what.

Built for Hack Day Amman (JOSA × MLH), theme *Digital Health & Wellness*: "stop problems before they start".

## Why

- **11.5%** of 1,629 Jordanian schoolchildren had a parent-reported food allergy, and only **5.7%** a formal
  diagnosis (eggs, cow's milk and peanuts most common).[^1] About **1 in 124** schoolchildren in Irbid screened
  positive for celiac disease.[^2]
- Much packaged food in Jordan is imported: the original label is in Italian, Turkish or German, with an Arabic
  sticker on top. "May contain" warnings are usually voluntary, so a sticker can leave one out.
- Allergens hide behind names: malt extract (gluten), casein and whey (milk), tahini (sesame), jameed (milk).
- The person buying the snack is often not the parent.

## What it does

| | |
|---|---|
| **Scan** | One viewfinder: a barcode is read by itself (Open Food Facts); otherwise the shutter photographs the ingredients, and the Arabic sticker if there is one. The photo is exactly what was framed. |
| **Check, per person** | A big card per person, with the allergens that caused it, and a tile for every allergen on the label. Red: an avoided ingredient is on the label. Amber: something can't be ruled out (a "may contain" line, an unknown ingredient, a cut-off photo). Green: the whole list was read and nothing on it is avoided. |
| **Original vs Arabic sticker** | Gemma pairs the two ingredient lists across languages; the phone flags anything the sticker leaves out, such as "Può contenere frutta a guscio" (may contain nuts). |
| **Hidden names** | The EU's 14 major allergens plus halal and vegetarian, in seven languages, and a **Jordanian pack** of local names (jameed, kishk, freekeh, fustuq abeed, turmus, labneh). |
| **Gemma researches unknowns** | For an ingredient no list knows (E476, an unfamiliar additive), Gemma uses tools (web search and Open Food Facts) and cites its sources. This can only add caution (amber), never clear a product. |
| **Family: parent, children, grandparents** | A parent creates the family and owns it. Each child joins on their own phone with their own QR code and chooses their allergies; the parent's phone takes the choice in (it can only add) and the parent can change anything. A child's phone checks for that child only. Grandparents join with a QR code, scan, and tap "Ask a parent" when a result isn't green; the parent approves or refuses on their own phone. Only amber can be approved: red can never be overridden. |
| **Safe list** | Products a parent approved, tied to the exact recipe. If the ingredient list changes, the approval stops counting and a recipe change alert shows. |
| **Emergency** | One tap calls 911. A card for paramedics (Arabic and English) shows the doctor's plan the parent saved; a text to the family says what was last eaten and where. Wiqaya never decides whether a reaction is happening. |
| **Eating out** | Take a photo of a restaurant's menu (up to four pages). Gemma reads the dishes and what each is usually made with; the phone sorts them for each person: *avoid* (the menu names the allergen), *ask the staff first* (usually made with it, or the menu doesn't say), and *good to ask for*. Never "safe": a menu rarely lists every ingredient, so it ends with the cook card. |
| **Card for the cook** | The child's allergies with every hidden name, in Arabic and English, for restaurants, the school canteen or a relative's kitchen, with a read-aloud button. |
| **Child mode** | A face and a voice that tell a young child, in Arabic and English, what a grown-up found on their last snack's label. |
| **Pen expiry** | Gemma reads the expiry date off the epinephrine pen's box; the parent confirms it and gets a reminder before it runs out. |
| **Consent and control** | Nothing is set up until a parent or guardian agrees. "Delete everything" removes all Wiqaya keeps on the phone. |
| **Arabic and English, offline shell** | The whole app in both languages (right to left in Arabic). It installs on the home screen and opens without a connection; scans need the server. |

## How it works

```
 Phone (web app)                               Wiqaya server (open source)
 ┌───────────────────────────────┐   photos,   ┌───────────────────────────────────────┐
 │ camera, barcode (zxing-wasm)  │   barcodes  │ Gemma 4 via Ollama:                   │
 │ ALLERGEN ENGINE — the verdict │ ──────────▶ │   read label · pair lists ·           │
 │ profiles, scans (encrypted)   │             │   research unknowns (tools) · explain │
 │ family circle (AES-GCM, ECDSA)│ ◀────────── │ Open Food Facts lookup + cache        │
 │ emergency: tel:, sms:         │   product   │ relay for encrypted family messages   │
 └───────────────────────────────┘   facts     └───────────────────────────────────────┘
```

**Code owns every verdict; Gemma reads.** Gemma turns photos into ingredient lists, matches the original list with
the Arabic sticker, researches unknown ingredients and writes plain explanations. Whether a product is red, amber
or green is decided by the engine in [`web/src/engine`](web/src/engine) on the phone, and Gemma's output can only add
caution. Green requires a complete, legible list where every ingredient is understood: **unknown is never shown as
safe**.

### Gemma 4's jobs

| Call | Input (product data only) | Output |
|---|---|---|
| Read | a label photo | ingredient lists per language, "contains" and "may contain" lines, complete? legible? |
| Second look | the same photo, when the reading says the list is complete | the list's printed lines, copied as they are; code checks whether one ends in a word the photo's edge cut |
| Pair | original list + Arabic sticker list | which item is which; the engine finds what's missing |
| Research (tool use) | unknown ingredient names | possible allergen groups, with the sources Gemma looked at (web search, Open Food Facts) |
| Explain | the product's findings (all of them, not the family's) | one plain sentence each, facts only |
| Expiry | a photo of a medicine box | the printed expiry date, for the parent to confirm |
| Menu | photos of a restaurant menu | each dish as printed, and what it is usually made and served with |

All calls use JSON schemas, temperature 0 and no "thinking" mode. Sources Gemma cites are kept only if they
appeared in its tool results.

## Privacy

- Profiles, scans and the doctor's plan are stored **encrypted on the phone**.
- The family's messages are **end-to-end encrypted**; the relay stores text it cannot read. Profiles and approvals
  are signed by a parent, so only parents can change them.
- **Gemma never sees a person**: it receives label photos and ingredient names. Explanations cover every finding
  in the product, so the request doesn't reveal which allergy a family has.
- Photos are rebuilt from their pixels before they leave the phone's request (no GPS, no device data) and are not
  stored on the server. The server keeps no logs of requests.
- No accounts, no phone numbers. A family is a random id plus a key inside an invite QR code (in the URL fragment,
  which browsers never send to a server).
- The emergency text is written on the phone and sent by its own messaging app.

More in [docs/PRIVACY.md](docs/PRIVACY.md).

## Run it

You need Python 3.10+, [uv](https://docs.astral.sh/uv/), Node 20+ (only to rebuild the app) and
[Ollama](https://ollama.com) 0.20 or newer.

```bash
ollama pull gemma4:e4b-it-qat
uv sync --extra dev
uv run wiqaya doctor                 # Gemma, Open Food Facts, web search
uv run wiqaya prefetch               # optional: cache the ~1,250 products Open Food Facts lists for Jordan
uv run wiqaya serve                  # http://127.0.0.1:8000
uv run wiqaya serve --host 0.0.0.0 --https   # phones on the same Wi-Fi (the camera needs HTTPS)
```

The built app is committed in `wiqaya/web_dist`, so Node is only needed to change it:

```bash
npm --prefix web ci && npm --prefix web run build
```

Settings (environment variables): `WIQAYA_MODEL`, `WIQAYA_OLLAMA_URL`, `WIQAYA_DATA` (default `./.wiqaya`),
`WIQAYA_WEB_SEARCH=0` to turn web search off. If the configured model isn't pulled, Wiqaya uses another
installed Gemma 4 (the E4B size first) and shows which one in the app's footer.

A photo's second reading and its edge check are sent to Gemma together. Start Ollama with
`OLLAMA_NUM_PARALLEL=2 ollama serve` so it answers both at once; with one slot they wait in turn.

## Tests and benchmark

```bash
uv run pytest                                   # server: label pipeline, relay, images, privacy of Gemma requests
npm --prefix web test                           # engine: matching, verdicts, sticker gaps, safe list; encryption
uv run python scripts/ui_flow.py http://127.0.0.1:8000   # two phones: set up, scan, join, ask, answer, emergency

uv run python bench/make_labels.py --n 30 --seed 7 --out bench/out/labels
uv run python bench/run.py bench/out/labels
node --experimental-strip-types bench/score.ts bench/out/labels
```

The benchmark renders synthetic imported-product labels (six languages, Arabic stickers that drop a line, blurred
and cut-off photos) with exact ground truth. See [docs/RESULTS.md](docs/RESULTS.md).

## Data and licences

| | Licence |
|---|---|
| Wiqaya's code | Apache-2.0 |
| Jordanian pack ([`web/src/engine/data/jordan.json`](web/src/engine/data/jordan.json)), allergen terms | CC BY 4.0 |
| Product data from [Open Food Facts](https://world.openfoodfacts.org) | ODbL |
| Gemma 4 | [Gemma terms of use](https://ai.google.dev/gemma/terms) |

## Limits

- Wiqaya checks labels. It does not give medical advice and cannot promise a food is safe: labels can be wrong or
  change. When in doubt, don't.
- The term lists are curated, not exhaustive; anything they don't know is amber, never green.
- The benchmark is synthetic. Real photos (glare, curved packs, tiny print) are harder.
- Jordan's own allergen-labelling rule could not be confirmed; Wiqaya doesn't claim labels break any rule.

[^1]: Prevalence and Impact of Food Allergies Among Jordanian Schoolchildren (2025), PMC12017951.
[^2]: Serological screening of schoolchildren in Irbid, Italian Journal of Pediatrics 36:16.
