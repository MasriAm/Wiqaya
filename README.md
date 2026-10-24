# Wiqaya · وقاية

**Scan a food label. Check it against your family's allergies. The allergy goes wherever the child goes.**

Wiqaya is an open-source food label checker for families in Jordan. Anyone who feeds a child (a parent, a
grandmother, a driver, the school) scans a product. **Gemma 4** reads the label in any language; the **phone**
checks it against each person's profile and shows red, amber or green, quoting the label's own words. Nobody, not
the server and not the AI, learns who is allergic to what.

Built for Hack Day Amman (JOSA × MLH), theme *Digital Health & Wellness*: "stop problems before they start".

**Quick links:** [How it works (architecture)](docs/ARCHITECTURE.md) · [Run it](#run-it) ·
[Demo script](docs/DEMO.md) · [Results](docs/RESULTS.md) · [Privacy](docs/PRIVACY.md)

## Why

- More than **1 in 10** Jordanian schoolchildren has a food allergy: **11.5%** of 1,629 children in a 2025 study
  (eggs, cow's milk and peanuts most common).[^1] About **1 in 124** schoolchildren in Irbid screened
  positive for celiac disease.[^2]
- Much packaged food in Jordan is imported: the original label is in Italian, Turkish or German, with an Arabic
  sticker on top. "May contain" warnings are usually voluntary, so a sticker can leave one out.
- Allergens hide behind names: malt extract (gluten), casein and whey (milk), tahini (sesame), jameed (milk).
- The person buying the snack is often not the parent.

## What it does

| | |
|---|---|
| **Scan** | One viewfinder: a barcode is read by itself (Open Food Facts); otherwise the shutter photographs the ingredients, and the Arabic sticker if there is one. A photo can also be uploaded; if it shows a barcode too, the photo's ingredients still count and the barcode only fills in the rest. |
| **Check, per person** | A big card per person, with the allergens that caused it, and a tile for every allergen on the label. Red: an avoided ingredient is on the label. Amber: something can't be ruled out (a "may contain" line, a cut-off or unreadable photo, an ingredient Gemma's research suspects). Green: the whole list was read and nothing on it is avoided. Every result reminds you to double-check the label and ask the shop or the chef. |
| **Original vs Arabic sticker** | Gemma pairs the two ingredient lists across languages; the phone flags anything the sticker leaves out, such as "Può contenere frutta a guscio" (may contain nuts). |
| **Hidden names** | The EU's 14 major allergens plus halal and vegetarian, in seven languages, and a **Jordanian pack** of local names (jameed, kishk, freekeh, fustuq abeed, turmus, labneh). |
| **Gemma researches unknowns** | For an ingredient no list knows (E476, an unfamiliar additive), Gemma uses tools (web search and Open Food Facts) and cites its sources. This can only add caution (amber), never clear a product. |
| **Family: parent, children, grandparents** | A parent creates the family and owns it. Each child joins on their own phone with their own QR code and chooses their allergies; the parent's phone takes the choice in (it can only add) and the parent can change anything. A child's phone checks for that child only. Grandparents join with a QR code, scan, and tap "Ask a parent" when a result isn't green; the parent approves or refuses on their own phone. Only amber can be approved: red can never be overridden. |
| **Safe list** | Products a parent approved, tied to the exact recipe. If the ingredient list changes, the approval stops counting and a recipe change alert shows. |
| **Emergency** | One tap calls 911. A card for paramedics (Arabic and English) shows the doctor's plan the parent saved; a text to the family says what was last eaten and where. Wiqaya never decides whether a reaction is happening. |
| **Eating out** | Take a photo of a restaurant's menu (up to four pages). Gemma reads the dishes and what each is usually made with; the phone sorts them for each person: *avoid* (the menu names the allergen), *ask the staff first* (usually made with it, or the menu doesn't say), and *good to ask for*. Never "safe": a menu rarely lists every ingredient, so it ends with the cook card. |
| **Card for the cook** | The child's allergies with every hidden name, in Arabic and English, for restaurants, the school canteen or a relative's kitchen. |
| **Pen expiry** | Gemma reads the expiry date off the epinephrine pen's box; the parent confirms it and gets a reminder before it runs out. |
| **Consent and control** | Nothing is set up until a parent or guardian agrees. "Delete everything" removes all Wiqaya keeps on the phone. |
| **Arabic and English, offline shell** | The whole app in both languages (right to left in Arabic). It installs on the home screen and opens without a connection; scans need the server. |

## How it works

![Wiqaya architecture](docs/architecture.png)

The full explanation (the three parts, one scan step by step, how a result is decided, the stack, the decisions and
answers to common technical questions) is in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

**Code owns every verdict; Gemma reads.** Gemma turns photos into ingredient lists, matches the original list with
the Arabic sticker, researches unknown ingredients and writes plain explanations. Whether a product is red, amber
or green is decided by the engine in [`web/src/engine`](web/src/engine) on the phone, and Gemma's output can only add
caution. Green requires a complete, legible list with nothing the child avoids; **doubt is never shown as safe**.

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

You need Python 3.10+, [uv](https://docs.astral.sh/uv/) and [Ollama](https://ollama.com) 0.20 or newer. Node 20+ is
only needed to change the app's screens.

1. Get the code and the model:
   ```bash
   git clone https://github.com/MasriAm/Wiqaya.git && cd Wiqaya
   ollama pull gemma4:e4b-it-qat
   ```
2. Start Ollama so it can answer two requests at once (a photo's second reading and its edge check run together):
   ```bash
   OLLAMA_NUM_PARALLEL=2 ollama serve          # Windows PowerShell: $env:OLLAMA_NUM_PARALLEL=2; ollama serve
   ```
3. In a second terminal, install and start Wiqaya:
   ```bash
   uv sync --extra dev
   uv run wiqaya doctor                        # checks Gemma, Open Food Facts and web search
   uv run wiqaya serve                         # open http://127.0.0.1:8000
   ```
4. To use a phone's camera, put the phone on the same Wi-Fi and run
   `uv run wiqaya serve --host 0.0.0.0 --https`, then open `https://<laptop-ip>:8000` on the phone and accept the
   certificate warning (browsers only allow the camera over HTTPS).
5. Optional: `uv run wiqaya prefetch` caches the ~1,250 products Open Food Facts lists for Jordan.

The built app is committed in `wiqaya/web_dist`. To change the screens: `npm --prefix web ci && npm --prefix web run build`.

Settings (environment variables): `WIQAYA_MODEL`, `WIQAYA_OLLAMA_URL`, `WIQAYA_DATA` (default `./.wiqaya`),
`WIQAYA_WEB_SEARCH=0` to turn web search off. If the configured model isn't pulled, Wiqaya uses another
installed Gemma 4 (the E4B size first) and shows which one in the app's footer.

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
- The term lists are curated, not exhaustive. An ingredient they don't know is noted on the result and looked up by
  Gemma, but a rare name could still be missed: always read the label too.
- The benchmark is synthetic. Real photos (glare, curved packs, tiny print) are harder.
- Jordan's own allergen-labelling rule could not be confirmed; Wiqaya doesn't claim labels break any rule.

[^1]: Prevalence and Impact of Food Allergies Among Jordanian Schoolchildren (2025), PMC12017951.
[^2]: Serological screening of schoolchildren in Irbid, Italian Journal of Pediatrics 36:16.
