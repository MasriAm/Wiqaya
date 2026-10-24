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

| Measure | Result |
|---|---|
| Allergens on the label that were flagged (red or amber) | 78/78 (100%) |
| **False greens** (an allergen on the label shown as no problem) | **0** |
| Lines the Arabic sticker dropped that were reported | 12/13 (92%) |
| Blurred or cut-off photos never shown green | 8/8 (100%) |
| False alarms (flagged for an allergen that isn't there) | 0/372 (0%) |
| Green when it should be (sharp, whole labels, allergen absent) | 229/229 (100%) |
| Mean seconds per label (Gemma reading + pairing) | 7.6 |

Misses:

- label-016: the sticker drops "peanuts" and the photo is also cut off; the gap isn't reported as a sticker gap
  (the verdict is still red for peanuts, from the original label).

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

## Limits

- The labels are synthetic: flat, sharp, evenly lit. Real photos (curved packs, glare, tiny print) are harder.
- 30 labels is a small sample; one label moves a percentage by several points.
- Results are for `gemma4:e4b`. Earlier runs reported with `gemma4:e4b-it-qat` on CPU gave different readings (77/78 flagged,
  1 false green, 10/13 sticker gaps, 4/372 false alarms, 168/229 clean greens).
