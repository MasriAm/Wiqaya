// Benchmark, step 2: score Gemma's readings with the phone's engine (web/src/engine), against ground truth.
//
//   node --experimental-strip-types bench/score.ts bench/out/labels
//
// For every label, one test member per allergen avoids just that allergen ("may contain" counts as avoid). We
// count, per allergen on the label: caught (red or amber), missed (green: a false green). Allergens not on the
// label that still come up are false alarms. Sticker gaps planted in the label must be reported as such.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { verdicts } from "../web/src/engine/verdict.ts";
import type { AllergenId, Member, ProductFacts } from "../web/src/engine/types.ts";

const ALLERGENS: AllergenId[] = ["gluten", "milk", "eggs", "peanuts", "tree_nuts", "pine_nuts", "sesame", "soy", "fish", "crustaceans", "molluscs", "celery", "mustard", "sulphites", "lupin"];

interface Truth {
  id: string;
  language: string;
  contains: AllergenId[];
  may_contain: AllergenId[];
  sticker: string | null;
  sticker_drops: { what: string; trigger: AllergenId }[];
  complete: boolean;
  legible: boolean;
  unknown: string[];
}

const dir = process.argv[2];
const truth = JSON.parse(readFileSync(join(dir, "truth.json"), "utf8")) as Truth[];
const members: Member[] = ALLERGENS.map((a) => ({ id: a, name: a, avoid: [a], diets: [], traces: "avoid" }));

let present = 0;
let caught = 0;
let falseGreen = 0;
let falseAlarm = 0;
let absentChecks = 0;
let gapsPlanted = 0;
let gapsFound = 0;
let defects = 0;
let defectsNotGreen = 0;
let cleanGreenPossible = 0;
let cleanGreen = 0;
let seconds = 0;
const rows: string[] = [];
const misses: string[] = [];

let scored = 0;
for (const c of truth) {
  if (!existsSync(join(dir, "facts", `${c.id}.json`))) continue; // not read yet
  scored++;
  const facts = JSON.parse(readFileSync(join(dir, "facts", `${c.id}.json`), "utf8")) as ProductFacts & { seconds: number };
  seconds += facts.seconds ?? 0;
  const v = new Map(verdicts(facts, members).map((x) => [x.member_id, x]));
  const onLabel = new Set<AllergenId>([...c.contains, ...c.may_contain]);
  for (const a of ALLERGENS) {
    const level = v.get(a)!.level;
    if (onLabel.has(a)) {
      present++;
      if (level === "green") {
        falseGreen++;
        misses.push(`${c.id}: ${a} on the label, shown green`);
      } else caught++;
    } else {
      absentChecks++;
      // a false alarm: red or amber for an allergen that isn't there, *because of a finding about that allergen*
      if (v.get(a)!.reasons.some((r) => r.trigger === a && r.level !== "green")) falseAlarm++;
    }
  }
  for (const d of c.sticker_drops) {
    gapsPlanted++;
    if (v.get(d.trigger)!.reasons.some((r) => r.kind === "sticker_gap" && r.trigger === d.trigger)) gapsFound++;
    else misses.push(`${c.id}: sticker drop of ${d.trigger} (${d.what}) not reported`);
  }
  if (!c.complete || !c.legible) {
    defects++;
    if ([...v.values()].every((x) => x.level !== "green")) defectsNotGreen++;
    else misses.push(`${c.id}: ${c.complete ? "blurred" : "cut off"} photo shown green for someone`);
  } else if (!c.unknown.length) {
    // a sharp, whole label: members whose allergen isn't on it should get green
    for (const a of ALLERGENS) {
      if (onLabel.has(a)) continue;
      cleanGreenPossible++;
      if (v.get(a)!.level === "green") cleanGreen++;
    }
  }
  const levels = c.contains.concat(c.may_contain).map((a) => `${a}:${v.get(a)!.level}`).join(" ");
  rows.push(`| ${c.id} | ${c.language} | ${c.sticker ?? "–"} | ${c.complete && c.legible ? "ok" : c.complete ? "blurred" : "cut off"} | ${levels || "–"} | ${facts.seconds ?? ""} |`);
}

const pct = (a: number, b: number) => (b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : "–");
const report = `# Wiqaya benchmark

${scored} synthetic labels (Italian, Turkish, French, German, English, Arabic), some with an Arabic sticker
that drops a line, some blurred or cut off on purpose. Gemma reads each photo; the phone's engine checks it.

| Measure | Result |
|---|---|
| Allergens on the label that were flagged (red or amber) | ${pct(caught, present)} |
| **False greens** (an allergen on the label shown as no problem) | **${falseGreen}** |
| Lines the Arabic sticker dropped that were reported | ${pct(gapsFound, gapsPlanted)} |
| Blurred or cut-off photos never shown green | ${pct(defectsNotGreen, defects)} |
| False alarms (flagged for an allergen that isn't there) | ${pct(falseAlarm, absentChecks)} |
| Green when it should be (sharp, whole labels, allergen absent) | ${pct(cleanGreen, cleanGreenPossible)} |
| Mean seconds per label (Gemma reading + pairing) | ${(seconds / Math.max(1, scored)).toFixed(1)} |

${misses.length ? "Misses:\n\n" + misses.map((m) => `- ${m}`).join("\n") : "No misses."}

| Label | Language | Sticker | Photo | Allergens on the label → verdict | Seconds |
|---|---|---|---|---|---|
${rows.join("\n")}
`;
writeFileSync(join(dir, "report.md"), report);
console.log(report.split("\n").slice(0, 16).join("\n"));
