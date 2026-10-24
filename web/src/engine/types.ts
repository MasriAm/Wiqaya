// The allergen engine's types. The engine runs on the phone: the server and Gemma return facts about the
// product; only the phone knows the people.

export type AllergenId =
  | "gluten"
  | "milk"
  | "eggs"
  | "peanuts"
  | "tree_nuts"
  | "pine_nuts"
  | "sesame"
  | "soy"
  | "fish"
  | "crustaceans"
  | "molluscs"
  | "celery"
  | "mustard"
  | "sulphites"
  | "lupin";
export type DietId = "halal" | "vegetarian";
export type TriggerId = AllergenId | DietId;
export type Level = "red" | "amber" | "green";

/** One ingredient as read from a label or from Open Food Facts. */
export interface Ingredient {
  text: string;
  /** Gemma's English rendering, checked too (a match in either language counts). */
  en?: string | null;
  /** Open Food Facts recognised it in its ingredient taxonomy. */
  known_by_off?: boolean;
}

/** One ingredient list: the original label, or the Arabic sticker. */
export interface LabelFacts {
  /** ISO 639-1 code, when known. */
  language: string | null;
  ingredients: Ingredient[];
  contains: string | null;
  may_contain: string | null;
  /** The whole list was visible (not cut off). */
  complete: boolean;
  /** The text was sharp enough to read. */
  legible: boolean;
}

/** Gemma's research on an ingredient the lists don't know: amber only, never green. */
export interface Suspicion {
  ingredient: string;
  triggers: TriggerId[];
  reason: string;
  sources: string[];
}

/** Everything the server returns about a product. Nothing in here is about a person. */
export interface ProductFacts {
  barcode: string | null;
  name: string | null;
  brand: string | null;
  /** The main ingredient list (original language). */
  label: LabelFacts | null;
  /** The Arabic sticker's list, when photographed. */
  sticker: LabelFacts | null;
  /** Gemma's pairing: [original index, sticker index or null]. */
  pairs: Array<[number, number | null]> | null;
  off: { allergens: string[]; traces: string[] } | null;
  suspicions: Suspicion[];
}

export interface Member {
  id: string;
  name: string;
  avoid: AllergenId[];
  diets: DietId[];
  /** "avoid": a "may contain" line is red; "allow": amber. */
  traces: "avoid" | "allow";
}

export interface SafeEntry {
  barcode: string;
  recipe: string;
  member_id: string;
  approved_by: string;
  at: number;
}

export type ReasonKind =
  | "contains" // an avoided ingredient is on the label
  | "likely" // a name that usually means an avoided ingredient
  | "may_contain" // a "may contain" line names it
  | "sticker_gap" // in the original label, missing from the Arabic sticker
  | "gemma_suspects" // an unknown ingredient Gemma thinks may contain it
  | "unknown_ingredient" // an ingredient no list knows
  | "incomplete" // the list was cut off
  | "unreadable" // the photo was too blurry
  | "unknown_product" // no ingredient list at all
  | "not_compared" // two labels, but they could not be compared
  | "recipe_changed" // approved before, but the ingredients changed
  | "approved" // a parent approved this product for this member
  | "all_clear"; // nothing found, everything understood

export type Source = "label" | "sticker" | "open_food_facts" | "jordan_pack" | "gemma" | "safe_list" | "wiqaya";

export interface Reason {
  level: Level;
  kind: ReasonKind;
  trigger?: TriggerId;
  /** The words on the label that caused it. */
  quote?: string;
  source: Source;
  /** Why a Jordanian-pack name or a Gemma suspicion means this. */
  why?: string;
  urls?: string[];
  approved_by?: string;
}

export interface MemberVerdict {
  member_id: string;
  level: Level;
  reasons: Reason[];
}

export interface Match {
  trigger: TriggerId;
  term: string;
  certainty: "certain" | "likely";
  pack: boolean;
  why?: string;
}
