# Benchmark results

30 synthetic labels made by `bench/make_labels.py` (Italian, Turkish, French, German, English, Arabic). Some have an
Arabic sticker that drops a line, and some are blurred or cut off on purpose. Gemma 4 (`gemma4:e4b-it-qat`, through
Ollama on a CPU-only machine) reads each photo, and the phone's engine (`web/src/engine`) checks it. Each label is
checked for 15 test members, each avoiding one allergen, with "may contain" counted as avoid.

Run it yourself: `uv run python bench/make_labels.py`, `uv run python bench/run.py bench/out/labels`,
`node --experimental-strip-types bench/score.ts bench/out/labels`.

| Measure | Result |
|---|---|
| Allergens on the label that were flagged (red or amber) | 77/78 (99%) |
| **False greens** (an allergen on the label shown as no problem) | **1** |
| Lines the Arabic sticker dropped that were reported | 10/13 (77%) |
| Blurred or cut-off photos never shown green | 6/8 (75%) |
| False alarms (flagged for an allergen that isn't there) | 4/372 (1%) |
| Green when it should be (sharp, whole labels, allergen absent) | 168/229 (73%) |
| Mean seconds per label (Gemma reading + pairing, CPU only) | 113.4 |

## What went wrong, and why

- **label-003 (the one false green).** The German list runs off the right edge of the photo, mid-word
  ("Gerstenm…"). Gemma copied "Gersten", left out what followed (malt, sesame, salt), and said the list was
  complete. The engine trusts that flag, so sesame came out green. Gemma's "complete" flag is the weak point.
- **label-013.** Also cut off at the edge and also reported complete. Nothing on the visible part was an
  allergen for anyone it missed, but it should have stayed amber.
- **label-006, label-009, label-016.** The Arabic sticker left out a line (gluten, a tree-nut warning,
  peanuts) and the pairing step matched it to something else. Where the original label names the allergen,
  the member is still red from the original; only the "sticker leaves it out" note is missing.
- **German small print.** Gemma sometimes misreads words ("fettamer"). These come out as unknown
  ingredients, so amber, which is the safe direction.

## Limits

- Synthetic labels only, so real photos (glare, curved packs, hands) will do worse.
- Small, quantised model on a CPU: about 2 minutes per label. A GPU or a larger Gemma 4 will be faster and
  likely more accurate.
- The benchmark scores the reading and the engine together. The engine alone is covered by unit tests
  (`npm test`).

## Per label

| Label | Language | Sticker | Photo | Allergens on the label → verdict | Seconds |
|---|---|---|---|---|---|
| label-000 | tr | – | ok | eggs:red gluten:red milk:red peanuts:red | 60.7 |
| label-001 | it | – | ok | gluten:red sesame:red | 70.7 |
| label-002 | de | – | cut off | milk:red peanuts:red | 65.6 |
| label-003 | de | – | cut off | gluten:red sesame:green peanuts:red | 52.4 |
| label-004 | fr | – | ok | eggs:red gluten:red milk:red sesame:red | 62.7 |
| label-005 | de | faithful | ok | gluten:red sesame:red milk:red | 165.2 |
| label-006 | it | drops_item | ok | gluten:red sesame:red | 161.1 |
| label-007 | fr | faithful | ok | tree_nuts:red | 212.9 |
| label-008 | tr | drops_may | ok | gluten:red sesame:red peanuts:red | 251.2 |
| label-009 | de | drops_may | ok | milk:red peanuts:red tree_nuts:amber | 230.9 |
| label-010 | it | drops_may | ok | sesame:red | 289.1 |
| label-011 | ar | – | blurred | milk:amber peanuts:red | 45.5 |
| label-012 | it | drops_may | ok | gluten:red milk:red soy:red tree_nuts:red peanuts:red | 125.7 |
| label-013 | fr | – | cut off | tree_nuts:red | 36 |
| label-014 | fr | drops_may | ok | gluten:red milk:red soy:red tree_nuts:red peanuts:red | 142.5 |
| label-015 | it | drops_item | ok | eggs:red gluten:red milk:red peanuts:red | 120.1 |
| label-016 | en | drops_item | cut off | milk:red peanuts:red tree_nuts:red | 108.8 |
| label-017 | it | – | ok | tree_nuts:red | 49.8 |
| label-018 | it | drops_may | ok | eggs:red gluten:red milk:red peanuts:red | 112.5 |
| label-019 | de | – | ok | tree_nuts:red milk:red | 51.6 |
| label-020 | fr | drops_item | ok | milk:red peanuts:red | 118.5 |
| label-021 | fr | drops_may | ok | eggs:red gluten:red milk:red tree_nuts:red | 121.5 |
| label-022 | de | – | ok | gluten:red milk:red soy:red tree_nuts:red | 61.9 |
| label-023 | en | drops_may | ok | tree_nuts:red | 126 |
| label-024 | fr | faithful | ok | – | 117 |
| label-025 | ar | – | ok | tree_nuts:amber | 43.9 |
| label-026 | en | drops_may | cut off | gluten:red sesame:red tree_nuts:red | 104.3 |
| label-027 | tr | faithful | ok | eggs:red gluten:red milk:red tree_nuts:red | 145.6 |
| label-028 | de | faithful | blurred | eggs:amber | 103.2 |
| label-029 | de | – | cut off | milk:red peanuts:red tree_nuts:amber | 46 |
