# Benchmark results

30 synthetic labels from `bench/make_labels.py --n 30 --seed 7`: imported products in Italian, Turkish, French,
German, English and Arabic, 18 with an Arabic sticker (13 stickers drop a line on purpose), 6 photos cut off at the
edge and 2 blurred. Gemma 4 (`gemma4:e4b` in Ollama, on a laptop RTX 4050) reads each photo; the phone's engine
(`web/src/engine`) gives each test member, one per allergen, a verdict. Run it yourself:

```bash
uv run python bench/make_labels.py --n 30 --seed 7 --out bench/out/labels
uv run python bench/run.py bench/out/labels
node --experimental-strip-types bench/score.ts bench/out/labels
```

## Latest

### Real photos (24, taken in a shop in Amman)

`TESTING_IMAGES/`: phone photos of snacks on the shelf, in English, Arabic, Turkish, German, French, Italian,
Romanian, Polish, Serbian, Czech and Croatian. 15 show an ingredient list (some cut off, shiny or tiny); 9 show only
the barcode, the front or the nutrition table. What each pack says was read by eye. Run with
`web/scripts/real_photos.ts` and `bench/score_real.py`.

| Measure | First run | After the fixes |
|---|---|---|
| Allergens printed on the pack that were flagged (red or amber) | 42/42, 4 photos failed | **56/56** (29 red) |
| **False greens** for an allergen on the pack | 0 | **0** |
| Photos without an ingredient list never shown green | **6/9** | **9/9** |
| Requests that failed ("Gemma isn't available") | 4 | **0** |
| Seconds per photo | 2–30 | 2–58 (most 10–35) |

What the first run found, and what changed:

- **Gemma invented ingredient lists.** On two photos of a biscuit's barcode side (no list visible) it wrote a
  plausible Turkish list and called it complete, so the product was green for eggs, peanuts, nuts, soy and more. On
  a chocolate bar's barcode side it read the product's name as its ingredients. Asking Gemma whether a list is
  visible, or having it copy the printed lines, didn't catch this reliably. Now **a list only counts as whole and
  legible when a second reading, of a slightly cropped and scaled copy of the photo, agrees with it** (at least 60%
  of ingredient words in common), and a "list" of one or two items with no "contains" line counts as cut off. Both
  checks can only lower "complete" and "legible".
- **Big multi-language panels failed.** The edge check copies the printed lines; on a six-language pack the answer
  ran past its length limit and the whole scan failed. It now has more room, and uses the lines that came through.
- "Made in a facility that processes dairy, soy, sesame, celery" is read as a "may contain" line; "dairy" is a milk
  term. A whole list returned as one item is split (when its English splits the same way), and a heading glued to
  the first ingredient ("Ingredients: cocoa mass") or read as an item ("Contains:") is removed.

### Synthetic labels (30)

After the changes above (`bench/out/labels2`):

| Measure | Before | After |
|---|---|---|
| Allergens on the label that were flagged | 78/78 | 78/78 |
| **False greens** | **0** | **0** |
| Lines the Arabic sticker dropped that were reported | 13/13 | 12/13 |
| Blurred or cut-off photos never shown green | 8/8 | 7/8 |
| False alarms | 0/372 | 1/372 |
| Green when it should be | 229/229 | 215/229 |
| Mean seconds per label | 7.6 | 21.0 |

Honest notes on the drops:

- label-016 (cut off): a whole phrase ("emulsifier: sunflower lecithin") is outside the photo, with no broken word to
  see. Before, Gemma returned the list as one lumped item the engine didn't understand, so it was amber by accident;
  split into ingredients, it is understood and green for people who avoid none of them. No check on the text can see
  a phrase that isn't in the photo.
- label-008: Gemma copied the original's "may contain peanuts" onto the Arabic sticker, which doesn't have it, so the
  gap wasn't reported (peanuts are still red from the original label).
- label-023: Gemma listed the word "Contains:" as an ingredient, an unknown item that made the label amber for the 14
  test members (the 14 lost greens). Such heading-only items are now dropped; not yet re-measured.
- The extra reading costs about 6–13 s per label. Reading time varies a little between runs on the GPU.

Not tried yet: preprocessing photos before Gemma (upscaling to 2048 px, auto-contrast and sharpening). An experiment
is set up (one server per variant on the same 24 photos) but wasn't run to the end.

## What changed

### German trace lines (the false green)

| | Before | After |
|---|---|---|
| Allergens flagged | 77/78 | 78/78 |
| False greens | 1 | 0 |
| Sticker drops reported | 11/13 | 12/13 |

label-009 says *Kann Spuren von Schalenfrüchten enthalten* ("may contain traces of tree nuts"). Gemma read it
correctly, but the German term list had *Schalenfrüchte* and *Erdnüsse*, not the dative plural that "Spuren von"
takes (*Schalenfrüchten*, *Erdnüssen*), so tree nuts came out green, and the sticker leaving the line out went
unreported. The German nut and egg terms now match their inflected forms (`schalenfrüchte*`, `nüsse*`,
`erdnüsse*`, `eier*`, ...), with a test. The same gap would have turned *Kann Spuren von Erdnüssen enthalten*
green for a peanut allergy on any whole German label.

### Cut-off photos

| | Before | After |
|---|---|---|
| Cut-off lists marked incomplete by the reading | 1/6 | 3/6 |
| Cut-off photos never shown green | 6/6 | 6/6 |
| Green when it should be | 229/229 | 229/229 |

Reading a whole label, Gemma said the list was complete on 5 of the 6 cut-off photos, and on label-003 and
label-026 it quietly finished the word the edge had cut (*Gerstenmalzextra* became *Gerstenmalzextrakt*, *barley
malt extra* became *barley malt extract*). Those photos stayed amber only because of other stray text. Asking
Gemma directly ("is any line cut off by the edge?") didn't help: one wording answered no for all 30 photos,
another said yes for all 6 cut photos but also for 15 of the 24 whole ones, which would have cost most greens.

So the second look asks Gemma only to copy the list's printed lines as they are, and code decides: a line that
ends in the beginning of a word Gemma read whole ran into the edge, and the list is marked incomplete (this check
can only lower "complete", never raise it). It caught both completed words and none of the 24 whole labels. The
other cut photos: on label-013 the reading already said incomplete; on label-002 and label-029 the cut word ("Em")
is read as an ingredient Wiqaya doesn't know, which keeps them amber; on label-016 a whole phrase is outside the
photo with no broken word to see. The extra call takes about 1.5 s.

### Sticker gaps

| | Before | After |
|---|---|---|
| Sticker drops reported | 12/13 | 13/13 |
| Stickers with an extra discrepancy | 3 | 4 |

On label-016 Gemma read each list as a single item (the whole original list, the whole sticker list) and paired
the two, so the peanuts the sticker leaves out were "paired". The engine no longer trusts a pair blindly: an
original item counts as missing from the sticker for every allergen it names that its sticker partner doesn't.
"Contains" and "may contain" statements are compared the same way, so a sticker that shortens "may contain
peanuts and nuts" to "may contain peanuts" is caught too. Each gap now lists the allergens missing, and the result
screen shows those. The new extra discrepancy is label-008, where Gemma's reading of the sticker dropped the
sesame the sticker prints.

## Limits

- The labels are synthetic: flat, sharp, evenly lit. Real photos (curved packs, glare, tiny print) are harder.
- 30 labels is a small sample; one label moves a percentage by several points.
- Results are for `gemma4:e4b`. Earlier runs reported with `gemma4:e4b-it-qat` on CPU gave different readings (77/78 flagged,
  1 false green, 10/13 sticker gaps, 4/372 false alarms, 168/229 clean greens).
