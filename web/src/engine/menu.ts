// Restaurant menus: which dishes each person can ask for. A menu rarely lists every ingredient, so nothing here is
// ever "safe": a dish is to avoid (the menu names the allergen), to ask about first (it usually contains it, or a
// name that usually means it), or one where nothing points to an allergen (still to confirm with the staff).
import { findTerms } from "./match.ts";
import type { Member, TriggerId } from "./types.ts";

export interface Dish {
  name: string;
  en: string | null;
  section: string;
  description: string;
  /** What Gemma says the dish is usually made and served with. It can only add caution. */
  usual: string[];
}

export interface MenuFacts {
  restaurant: string | null;
  language: string | null;
  dishes: Dish[];
}

export type DishLevel = "avoid" | "ask" | "options";

export interface DishReason {
  trigger: TriggerId;
  /** named: the menu says it; likely: a name that usually means it; usually: the dish is usually made with it. */
  how: "named" | "likely" | "usually";
  quote: string;
  why?: string;
}

export interface DishVerdict {
  member_id: string;
  level: DishLevel;
  reasons: DishReason[];
  /** The person has no allergies set yet: nothing can be cleared. */
  unset?: boolean;
}

const RANK: Record<DishLevel, number> = { avoid: 0, ask: 1, options: 2 };

export function dishVerdicts(dish: Dish, language: string | null, members: Member[]): DishVerdict[] {
  const printed: [string, string | null][] = [
    [dish.name, language],
    [dish.description, language],
    [dish.en ?? "", "en"],
  ];
  const found: DishReason[] = [];
  for (const [text, lang] of printed) {
    for (const m of findTerms(text, lang)) found.push({ trigger: m.trigger, how: m.certainty === "certain" ? "named" : "likely", quote: text, why: m.why });
  }
  for (const u of dish.usual) {
    for (const m of findTerms(u, "en")) found.push({ trigger: m.trigger, how: "usually", quote: u, why: m.why });
  }
  return members.map((member) => {
    const watch = new Set<TriggerId>([...member.avoid, ...member.diets]);
    if (!watch.size) return { member_id: member.id, level: "ask", reasons: [], unset: true };
    // one reason per allergen: the strongest
    const best = new Map<TriggerId, DishReason>();
    const order = { named: 0, likely: 1, usually: 2 };
    for (const r of found) {
      if (!watch.has(r.trigger)) continue;
      const prev = best.get(r.trigger);
      if (!prev || order[r.how] < order[prev.how]) best.set(r.trigger, r);
    }
    const reasons = [...best.values()].sort((a, b) => order[a.how] - order[b.how]);
    const level: DishLevel = reasons.some((r) => r.how === "named") ? "avoid" : reasons.length ? "ask" : "options";
    return { member_id: member.id, level, reasons };
  });
}

/** The dish's level for a group of people: the most careful one. */
export function worstDish(levels: DishLevel[]): DishLevel {
  return levels.reduce<DishLevel>((w, l) => (RANK[l] < RANK[w] ? l : w), "options");
}
