// Find allergen and diet terms in label text. Whole words only, except terms written "word*" (German and Turkish
// compounds and suffixes). Arabic words may carry a prefix (و، ب، ل، ف، ك، ال). "Safe" phrases are removed first,
// so "cocoa butter" never reads as milk. The longest term at a position wins, so "wine vinegar" (likely) beats
// "wine" (certain) for halal.
import allergensData from "./data/allergens.json" with { type: "json" };
import jordanData from "./data/jordan.json" with { type: "json" };
import knownData from "./data/known.json" with { type: "json" };
import { norm, parts } from "./normalize.ts";
import type { Match, TriggerId } from "./types.ts";

export const LANGS = ["en", "ar", "it", "fr", "es", "de", "tr"] as const;
type Lang = (typeof LANGS)[number];

interface Compiled {
  trigger: TriggerId;
  term: string;
  re: RegExp;
  length: number;
  certainty: "certain" | "likely";
  pack: boolean;
  why?: string;
  lang: Lang;
}

const L = "\\p{L}\\p{N}";
const ARABIC_PREFIX = "(?:[وفبلك]?(?:ال)?)";

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compile(raw: string, lang: Lang, trigger: TriggerId, pack: boolean, why?: string): Compiled | null {
  const certainty = raw.startsWith("~") ? "likely" : "certain";
  let t = raw.replace(/^~/, "");
  const prefix = t.endsWith("*");
  t = norm(t.replace(/\*$/, ""));
  if (!t) return null;
  const arabic = /[؀-ۿ]/.test(t);
  if (arabic) t = t.replace(/^ال/, "");
  const body = t.split(" ").map(escape).join("\\s+");
  const left = arabic ? `(?<![${L}])${ARABIC_PREFIX}` : `(?<![${L}])`;
  const right = prefix ? "" : `(?![${L}])`;
  return { trigger, term: raw.replace(/^~/, ""), re: new RegExp(left + body + right, "gu"), length: t.length, certainty, pack, why, lang };
}

function compileSafe(raw: string): RegExp | null {
  const t = norm(raw);
  if (!t) return null;
  const arabic = /[؀-ۿ]/.test(t);
  const body = (arabic ? t.replace(/^ال/, "") : t).split(" ").map(escape).join("\\s+");
  return new RegExp(`(?<![${L}])${arabic ? ARABIC_PREFIX : ""}${body}(?![${L}])`, "gu");
}

type Entry = { id: string; terms: Record<string, string[]>; safe: Record<string, string[]> };
const ENTRIES: Entry[] = [...(allergensData.allergens as Entry[]), ...(allergensData.diets as Entry[])];

const TERMS: Compiled[] = [];
const SAFE = new Map<TriggerId, RegExp[]>();
for (const e of ENTRIES) {
  const id = e.id as TriggerId;
  for (const lang of LANGS) {
    for (const raw of e.terms[lang] ?? []) {
      const c = compile(raw, lang, id, false);
      if (c) TERMS.push(c);
    }
  }
  SAFE.set(
    id,
    LANGS.flatMap((lang) => e.safe[lang] ?? [])
      .map(compileSafe)
      .filter((r): r is RegExp => r !== null),
  );
}
for (const e of jordanData.entries) {
  const c = compile(e.term, e.lang as Lang, e.allergen as TriggerId, true, e.why);
  if (c) TERMS.push(c);
}

const KNOWN = new Set<string>(LANGS.flatMap((l) => ((knownData.terms as Record<string, string[]>)[l] ?? []).map(norm)));
const KNOWN_E = new Set<string>(knownData.e_numbers);

/** Which languages' terms to try: the label's language plus English and Arabic, or every language if unknown. */
function langsFor(language: string | null | undefined): Set<Lang> {
  const l = (language ?? "").toLowerCase().slice(0, 2) as Lang;
  return LANGS.includes(l) ? new Set<Lang>([l, "en", "ar"]) : new Set<Lang>(LANGS);
}

/** Every term found in the text. One match per trigger: a certain match beats a likely one. */
export function findTerms(text: string | null | undefined, language?: string | null): Match[] {
  if (!text) return [];
  const base = norm(text);
  if (!base) return [];
  const langs = langsFor(language);
  const best = new Map<TriggerId, Match>();
  const byTrigger = new Map<TriggerId, Compiled[]>();
  for (const c of TERMS) {
    if (!langs.has(c.lang) && !c.pack) continue;
    const list = byTrigger.get(c.trigger) ?? [];
    list.push(c);
    byTrigger.set(c.trigger, list);
  }
  for (const [trigger, terms] of byTrigger) {
    let t = base;
    for (const re of SAFE.get(trigger) ?? []) t = t.replace(re, (m) => " ".repeat(m.length));
    // longest term at each position: collect all hits, then keep hits not covered by a longer one
    const hits: { start: number; end: number; c: Compiled }[] = [];
    for (const c of terms) {
      c.re.lastIndex = 0;
      for (const m of t.matchAll(c.re)) hits.push({ start: m.index!, end: m.index! + m[0].length, c });
    }
    hits.sort((a, b) => b.end - b.start - (a.end - a.start));
    const taken: { start: number; end: number }[] = [];
    for (const h of hits) {
      if (taken.some((t2) => h.start < t2.end && t2.start < h.end)) continue;
      taken.push(h);
      const prev = best.get(trigger);
      const m: Match = { trigger, term: h.c.term, certainty: h.c.certainty, pack: h.c.pack, why: h.c.why };
      if (!prev || (prev.certainty === "likely" && m.certainty === "certain")) best.set(trigger, m);
    }
  }
  return [...best.values()];
}

/** Is this ingredient understood: on the known list, a known E-number, or matched by a term? */
export function understood(text: string, en: string | null | undefined, language: string | null, knownByOff = false): boolean {
  if (knownByOff) return true;
  const ok = (s: string, lang: string | null) =>
    parts(s).every((p) => {
      const n = norm(p);
      if (!n) return true;
      if (KNOWN.has(n) || KNOWN_E.has(n)) return true;
      if (/^e\d{3,4}[a-f]?$/.test(n)) return KNOWN_E.has(n);
      // "emulsifier e322": a known class name followed by codes or names checked separately
      const words = n.split(" ");
      if (words.every((w) => KNOWN.has(w) || KNOWN_E.has(w))) return true;
      return findTerms(p, lang).length > 0;
    });
  return ok(text, language) || (!!en && ok(en, "en"));
}

export function isKnownENumber(code: string): boolean {
  return KNOWN_E.has(norm(code));
}
