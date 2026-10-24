// The verdict: red, amber or green for each family member. Code only; Gemma's output can add caution here but
// never removes it. Green needs a complete, legible ingredient list where every item is understood.
import offTags from "./data/allergens.json" with { type: "json" };
import { findTerms, understood } from "./match.ts";
import { fingerprint, splitIngredients } from "./normalize.ts";
import type { Ingredient, LabelFacts, Level, Member, MemberVerdict, ProductFacts, Reason, SafeEntry, Source, TriggerId } from "./types.ts";

const OFF_TAGS = offTags.off_tags as Record<string, TriggerId>;

/** The recipe fingerprint used by the safe list: a changed ingredient list means a changed fingerprint. */
export function recipeOf(facts: ProductFacts): string {
  const l = facts.label;
  if (!l) return "";
  return fingerprint([...l.ingredients.map((i) => i.text), `contains:${l.contains ?? ""}`, `may:${l.may_contain ?? ""}`]);
}

function triggersOf(text: string | null | undefined, en: string | null | undefined, language: string | null): Set<TriggerId> {
  return new Set([...findTerms(text, language), ...findTerms(en, "en")].map((m) => m.trigger));
}

export interface StickerGaps {
  ingredients: (Ingredient & { missing: TriggerId[] })[];
  statements: { kind: "contains" | "may_contain"; missing: TriggerId[] }[];
}

/** What the Arabic sticker leaves out: original-label ingredients with no partner on the sticker, or whose partner
 *  doesn't name the same allergens (Gemma can pair the wrong items, or two whole lists read as one item), and
 *  "contains" / "may contain" statements the sticker drops or shortens. Each gap lists the allergens missing. */
export function stickerGaps(facts: ProductFacts): StickerGaps {
  const { label, sticker, pairs } = facts;
  if (!label || !sticker || !pairs) return { ingredients: [], statements: [] };
  const partner = new Map<number, number>();
  for (const [o, s] of pairs) if (s !== null && s >= 0 && s < sticker.ingredients.length) partner.set(o, s);
  const ingredients: StickerGaps["ingredients"] = [];
  label.ingredients.forEach((ing, i) => {
    const s = partner.get(i);
    const there = s === undefined ? null : triggersOf(sticker.ingredients[s].text, sticker.ingredients[s].en, sticker.language);
    if (there === null) {
      ingredients.push({ ...ing, missing: [...triggersOf(ing.text, ing.en, label.language)] });
      return;
    }
    const missing = [...triggersOf(ing.text, ing.en, label.language)].filter((t) => !there.has(t));
    if (missing.length) ingredients.push({ ...ing, missing });
  });
  const statements: StickerGaps["statements"] = [];
  for (const kind of ["may_contain", "contains"] as const) {
    if (!label[kind]) continue;
    const there = triggersOf(sticker[kind], null, sticker.language);
    const missing = [...triggersOf(label[kind], null, label.language)].filter((t) => !there.has(t));
    if (!sticker[kind] || missing.length) statements.push({ kind, missing });
  }
  return { ingredients, statements };
}

interface Hit {
  trigger: TriggerId;
  certainty: "certain" | "likely";
  quote: string;
  source: Source;
  why?: string;
  pack: boolean;
}

function scanList(l: LabelFacts, source: Source): { contains: Hit[]; may: Hit[]; unknown: string[] } {
  const contains: Hit[] = [];
  const may: Hit[] = [];
  const unknown: string[] = [];
  for (const ing of l.ingredients) {
    const found = [...findTerms(ing.text, l.language), ...findTerms(ing.en, "en")];
    for (const m of found) contains.push({ trigger: m.trigger, certainty: m.certainty, quote: ing.text, source: m.pack ? "jordan_pack" : source, why: m.why, pack: m.pack });
    if (!understood(ing.text, ing.en, l.language, ing.known_by_off)) unknown.push(ing.text);
  }
  for (const m of findTerms(l.contains, l.language))
    contains.push({ trigger: m.trigger, certainty: m.certainty, quote: l.contains!, source: m.pack ? "jordan_pack" : source, why: m.why, pack: m.pack });
  for (const m of findTerms(l.may_contain, l.language))
    may.push({ trigger: m.trigger, certainty: m.certainty, quote: l.may_contain!, source, why: m.why, pack: m.pack });
  return { contains, may, unknown };
}

/** The verdict for each member. */
export function verdicts(facts: ProductFacts, members: Member[], safe: SafeEntry[] = []): MemberVerdict[] {
  const lists: { l: LabelFacts; source: Source }[] = [];
  if (facts.label) lists.push({ l: facts.label, source: "label" });
  if (facts.sticker) lists.push({ l: facts.sticker, source: "sticker" });
  const scanned = lists.map(({ l, source }) => ({ l, ...scanList(l, source) }));
  const gaps = stickerGaps(facts);
  const recipe = recipeOf(facts);

  return members.map((member) => {
    // nothing to check against yet: never green, and nothing a parent can approve
    if (!member.avoid.length && !member.diets.length) {
      return { member_id: member.id, level: "amber", reasons: [{ level: "amber", kind: "no_allergies", source: "wiqaya" }] };
    }
    const watch = new Set<TriggerId>([...member.avoid, ...member.diets]);
    const reasons: Reason[] = [];
    const add = (r: Reason) => {
      const dup = reasons.some((x) => x.kind === r.kind && x.trigger === r.trigger && x.quote === r.quote && x.source === r.source);
      if (!dup) reasons.push(r);
    };

    for (const s of scanned) {
      for (const h of s.contains) {
        if (!watch.has(h.trigger)) continue;
        add({ level: h.certainty === "certain" ? "red" : "amber", kind: h.certainty === "certain" ? "contains" : "likely", trigger: h.trigger, quote: h.quote, source: h.source, why: h.why });
      }
      for (const h of s.may) {
        if (!watch.has(h.trigger)) continue;
        add({ level: member.traces === "avoid" ? "red" : "amber", kind: "may_contain", trigger: h.trigger, quote: h.quote, source: h.source });
      }
      for (const u of s.unknown) add({ level: "amber", kind: "unknown_ingredient", quote: u, source: "wiqaya" });
    }

    // Open Food Facts' own allergen and trace tags (barcode lookups)
    for (const tag of facts.off?.allergens ?? []) {
      const t = OFF_TAGS[tag];
      if (t && watch.has(t)) add({ level: "red", kind: "contains", trigger: t, quote: tag.replace(/^en:/, ""), source: "open_food_facts" });
    }
    for (const tag of facts.off?.traces ?? []) {
      const t = OFF_TAGS[tag];
      if (t && watch.has(t)) add({ level: member.traces === "avoid" ? "red" : "amber", kind: "may_contain", trigger: t, quote: tag.replace(/^en:/, ""), source: "open_food_facts" });
    }

    // the Arabic sticker leaves out something the original says
    if (facts.label && facts.sticker) {
      if (!facts.pairs) add({ level: "amber", kind: "not_compared", source: "wiqaya" });
      for (const ing of gaps.ingredients) {
        for (const t of ing.missing) {
          if (watch.has(t)) add({ level: "red", kind: "sticker_gap", trigger: t, quote: ing.text, source: "label" });
        }
      }
      for (const st of gaps.statements) {
        const text = facts.label[st.kind]!;
        for (const t of st.missing) {
          if (!watch.has(t)) continue;
          const level: Level = st.kind === "contains" || member.traces === "avoid" ? "red" : "amber";
          add({ level, kind: "sticker_gap", trigger: t, quote: text, source: "label" });
        }
      }
    }

    // Gemma's suspicions about unknown ingredients: amber only
    for (const s of facts.suspicions) {
      for (const t of s.triggers) {
        if (watch.has(t)) add({ level: "amber", kind: "gemma_suspects", trigger: t, quote: s.ingredient, source: "gemma", why: s.reason, urls: s.sources });
      }
    }

    // is the list there, whole and readable?
    const anyList = facts.label && facts.label.ingredients.length > 0;
    if (!anyList) add({ level: "amber", kind: "unknown_product", source: "wiqaya" });
    for (const { l } of lists) {
      if (!l.complete) add({ level: "amber", kind: "incomplete", source: l === facts.sticker ? "sticker" : "label" });
      if (!l.legible) add({ level: "amber", kind: "unreadable", source: l === facts.sticker ? "sticker" : "label" });
    }

    let level: Level = reasons.some((r) => r.level === "red") ? "red" : reasons.some((r) => r.level === "amber") ? "amber" : "green";

    // a parent's approval, for this recipe. It never overrides red: an avoided ingredient on the label stays red.
    if (facts.barcode) {
      const entry = safe.find((e) => e.barcode === facts.barcode && e.member_id === member.id);
      if (entry && entry.recipe === recipe && recipe && level !== "red") {
        reasons.unshift({ level: "green", kind: "approved", source: "safe_list", approved_by: entry.approved_by });
        level = "green";
      } else if (entry) {
        add({ level: "amber", kind: "recipe_changed", source: "safe_list", approved_by: entry.approved_by });
        if (level === "green") level = "amber";
      }
    }
    if (level === "green" && !reasons.some((r) => r.kind === "approved")) reasons.push({ level: "green", kind: "all_clear", source: "wiqaya" });
    // the approval first, then what the label says, most serious first
    reasons.sort((a, b) => Number(b.kind === "approved") - Number(a.kind === "approved") || rank(b.level) - rank(a.level));
    return { member_id: member.id, level, reasons };
  });
}

function rank(l: Level): number {
  return l === "red" ? 2 : l === "amber" ? 1 : 0;
}

/** Open Food Facts gives the list as one text when its parsed list is missing: split it. */
export function listFromText(text: string, language: string | null): LabelFacts {
  return { language, ingredients: splitIngredients(text).map((t) => ({ text: t })), contains: null, may_contain: null, complete: true, legible: true };
}
