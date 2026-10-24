// Text normalisation shared by the terms and the label text, so both sides compare the same way.

const ARABIC_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const LATIN_MARKS = /[̀-ͯ]/g;

/** Lower case; Arabic letter variants unified and vowel marks removed; Latin accents removed; E-numbers written
 * one way ("E 471", "E-471", "INS 471" → "e471"); punctuation to spaces. */
export function norm(input: string): string {
  let s = input.normalize("NFKC").toLowerCase();
  // Arabic and Persian digits to ASCII
  s = s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  s = s.replace(ARABIC_MARKS, "");
  s = s.replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي");
  s = s.replace(/ı/g, "i").replace(/ß/g, "ss").replace(/œ/g, "oe").replace(/æ/g, "ae");
  s = s.normalize("NFD").replace(LATIN_MARKS, "").normalize("NFC");
  s = s.replace(/(^|[^\p{L}\p{N}])(?:e|ins)\s*[-‐‑–]?\s*(\d{3,4})\s*([a-f])?(?![\p{L}\p{N}])/gu, (_m, pre, n, l) => `${pre}e${n}${l ?? ""}`);
  s = s.replace(/['’`´]/g, "");
  s = s.replace(/[^\p{L}\p{N}]+/gu, " ");
  return s.trim().replace(/\s+/g, " ");
}

/** Strip amounts and percentages ("sugar 30%", "12.5 % cocoa"). */
export function stripAmounts(s: string): string {
  return s.replace(/\d+(?:[.,]\d+)?\s*%/g, " ").replace(/\b\d+(?:[.,]\d+)?\s*(?:g|mg|kg|ml|l)\b/gi, " ");
}

/** An ingredient's parts: the name and anything in brackets ("emulsifier (soy lecithin)" → two parts). */
export function parts(text: string): string[] {
  return stripAmounts(text)
    .split(/[()[\]{}:;,،؛]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && /[\p{L}\p{N}]/u.test(p));
}

/** Split a raw ingredient text into ingredients (Open Food Facts text, or a typed list). Top-level commas only. */
export function splitIngredients(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === "," || ch === "،" || ch === ";" || ch === "؛")) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim().replace(/\.$/, ""));
  return out;
}

/** A short, stable fingerprint of a recipe: the ingredient list plus the "contains" and "may contain" lines. */
export function fingerprint(items: string[]): string {
  const text = items.map(norm).join("|");
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}
