// Real photos (TESTING_IMAGES, taken in a shop in Amman): what the app shows for each, per allergen. Like the app: the
// barcode is read on the "phone" (zxing-wasm), looked up, and the photo is read by Gemma. Then bench/score_real.py.
//
//   uv run wiqaya serve --port 8010
//   cd web && node --experimental-strip-types scripts/real_photos.ts ../bench/out/real.json
//   uv run python bench/score_real.py bench/out/real.json
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { readBarcodes } from "zxing-wasm/reader";
import { verdicts } from "../src/engine/verdict.ts";
import type { AllergenId, Member, ProductFacts } from "../src/engine/types.ts";

const SERVER = process.env.SERVER ?? "http://127.0.0.1:8010";
const dir = "../TESTING_IMAGES";  // from web/
const out = process.argv[2];
const ALLERGENS: AllergenId[] = ["gluten", "milk", "eggs", "peanuts", "tree_nuts", "sesame", "soy", "celery", "mustard", "fish", "crustaceans", "molluscs", "pine_nuts", "lupin", "sulphites"];
const members: Member[] = ALLERGENS.map((a) => ({ id: a, name: a, avoid: [a], diets: [], traces: "avoid" }));

function summary(facts: ProductFacts) {
  const v = verdicts(facts, members);
  const lv = Object.fromEntries(v.map((x) => [x.member_id, x.level]));
  const red = ALLERGENS.filter((a) => lv[a] === "red");
  const amberFor = ALLERGENS.filter((a) => lv[a] === "amber" && v.find((x) => x.member_id === a)!.reasons.some((r) => r.trigger === a));
  const general = v[0].reasons.filter((r) => !r.trigger && r.level === "amber").map((r) => r.kind + (r.quote ? `(${r.quote.slice(0, 30)})` : ""));
  const greens = ALLERGENS.filter((a) => lv[a] === "green");
  return { red, amberFor, general: [...new Set(general)], greens };
}

const rows: unknown[] = [];
for (const f of readdirSync(dir).sort()) {
  const name = f.replace("WhatsApp Image 2026-10-24 at ", "").replace(".jpeg", "");
  const buf = readFileSync(`${dir}/${f}`);
  const codes = await readBarcodes(new Uint8Array(buf), { formats: ["EAN13", "EAN8", "UPCA", "UPCE"], tryHarder: true, maxNumberOfSymbols: 1 });
  const code = codes.find((r) => r.isValid)?.text ?? null;
  const row: Record<string, unknown> = { name, code };
  if (code) {
    const r = await fetch(`${SERVER}/api/product/${code}`);
    row.off = r.ok ? summary((await r.json()) as ProductFacts) : `off ${r.status}`;
    if (r.ok) row.offName = ((await (await fetch(`${SERVER}/api/product/${code}`)).json()) as ProductFacts).name;
  }
  const fd = new FormData();
  fd.append("photos", new Blob([buf], { type: "image/jpeg" }), "label.jpg");
  fd.append("hints", "");
  if (code) fd.append("barcode", code);
  const t = Date.now();
  const r = await fetch(`${SERVER}/api/scan`, { method: "POST", body: fd });
  const facts = (await r.json()) as ProductFacts & { error?: string };
  row.seconds = Math.round((Date.now() - t) / 100) / 10;
  if (facts.error) row.photo = facts.error;
  else {
    // the photo as read, without Open Food Facts' tags, so the reading itself is tested
    row.photo = summary({ ...facts, off: null });
    row.read = { name: facts.name, lang: facts.label?.language, n: facts.label?.ingredients.length ?? 0, complete: facts.label?.complete, legible: facts.label?.legible,
      contains: facts.label?.contains, may: facts.label?.may_contain, sticker: facts.sticker?.language ?? null,
      first: facts.label?.ingredients.slice(0, 6).map((i) => `${i.text}${i.en && i.en !== i.text ? ` [${i.en}]` : ""}`) };
  }
  rows.push(row);
  console.log(JSON.stringify(row));
}
writeFileSync(out, JSON.stringify(rows, null, 1));
