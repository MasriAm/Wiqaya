import { test } from "node:test";
import assert from "node:assert/strict";
import { findTerms, understood } from "./match.ts";
import { norm, splitIngredients } from "./normalize.ts";
import { recipeOf, stickerGaps, verdicts } from "./verdict.ts";
import type { LabelFacts, Member, ProductFacts } from "./types.ts";

const ids = (text: string, lang: string | null = null) => findTerms(text, lang).map((m) => `${m.trigger}:${m.certainty}`).sort();

const label = (ingredients: string[], extra: Partial<LabelFacts> = {}): LabelFacts => ({
  language: "en",
  ingredients: ingredients.map((text) => ({ text })),
  contains: null,
  may_contain: null,
  complete: true,
  legible: true,
  ...extra,
});
const product = (l: LabelFacts | null, extra: Partial<ProductFacts> = {}): ProductFacts => ({
  barcode: "6250000000001",
  name: "Test",
  brand: null,
  label: l,
  sticker: null,
  pairs: null,
  off: null,
  suspicions: [],
  ...extra,
});
const sara: Member = { id: "s", name: "Sara", avoid: ["peanuts", "tree_nuts"], diets: [], traces: "avoid" };
const omar: Member = { id: "o", name: "Omar", avoid: ["gluten"], diets: ["halal"], traces: "allow" };

test("normalisation: Arabic variants, accents, E-numbers", () => {
  assert.equal(norm("طحينةُ"), "طحينه");
  assert.equal(norm("Crème fraîche"), "creme fraiche");
  assert.equal(norm("E 471, E-322, INS 330"), "e471 e322 e330");
  assert.equal(norm("Za'atar"), "zaatar");
  assert.equal(norm("بُرغُل"), "برغل");
});

test("terms in several languages", () => {
  assert.deepEqual(ids("hazelnuts 13%"), ["tree_nuts:certain"]);
  assert.deepEqual(ids("può contenere frutta a guscio", "it"), ["tree_nuts:certain"]);
  assert.deepEqual(ids("Weizenmehl", "de"), ["gluten:certain"]);
  assert.deepEqual(ids("buğday unu", "tr"), ["gluten:certain"]);
  assert.deepEqual(ids("حليب مجفف", "ar"), ["milk:certain"]);
  assert.deepEqual(ids("والحليب", "ar"), ["milk:certain"]);
  assert.deepEqual(ids("malt extract"), ["gluten:certain"]);
});

test("German trace lines use the dative plural", () => {
  assert.deepEqual(ids("Kann Spuren von Schalenfrüchten enthalten.", "de"), ["tree_nuts:certain"]);
  assert.deepEqual(ids("Kann Spuren von Erdnüssen enthalten.", "de"), ["peanuts:certain"]);
  assert.deepEqual(ids("Kann Spuren von Haselnüssen und Eiern enthalten.", "de").sort(), ["eggs:certain", "tree_nuts:certain"]);
});

test("safe phrases are not allergens", () => {
  assert.deepEqual(ids("cocoa butter"), []);
  assert.deepEqual(ids("coconut milk"), []);
  assert.deepEqual(ids("maltodextrin"), []);
  assert.deepEqual(ids("sunflower lecithin"), []);
  assert.deepEqual(ids("rice flour"), []);
  assert.deepEqual(ids("سمن نباتي", "ar"), []);
  assert.deepEqual(ids("eggplant"), []);
  assert.deepEqual(ids("nutmeg"), []);
  assert.deepEqual(ids("جوز الهند", "ar"), []);
});

test("peanut butter is peanuts, not milk", () => {
  assert.deepEqual(ids("peanut butter"), ["peanuts:certain"]);
});

test("likely names: unstated grain or source", () => {
  assert.deepEqual(ids("flour"), ["gluten:likely"]);
  assert.deepEqual(ids("emulsifier (lecithin)"), ["soy:likely"]);
  assert.deepEqual(ids("emulsifier (E322)"), ["soy:likely"]);
  assert.deepEqual(ids("wine vinegar"), ["halal:likely"]);
  assert.deepEqual(ids("wine"), ["halal:certain"]);
  assert.deepEqual(ids("gelatine"), ["halal:likely", "vegetarian:certain"]);
  assert.deepEqual(ids("beef gelatine"), ["vegetarian:certain"]);
});

test("Jordanian pack names", () => {
  const m = findTerms("جميد", "ar");
  assert.deepEqual(m.map((x) => [x.trigger, x.pack]), [["milk", true]]);
  assert.deepEqual(ids("فستق عبيد", "ar"), ["peanuts:certain"]);
  assert.deepEqual(ids("كشك", "ar"), ["gluten:certain", "milk:certain"]);
  assert.deepEqual(ids("طحينة", "ar"), ["sesame:certain"]);
});

test("short words in one language don't fire in another", () => {
  // Turkish "et" (meat) is French "and"
  assert.deepEqual(ids("sucre et sel", "fr"), []);
});

test("understood: known list, E-numbers, matched terms", () => {
  assert.equal(understood("sugar", null, "en"), true);
  assert.equal(understood("palm oil 20%", null, "en"), true);
  assert.equal(understood("emulsifier (E476)", null, "en"), false);
  assert.equal(understood("acidity regulator (citric acid)", null, "en"), true);
  assert.equal(understood("hazelnuts", null, "en"), true);
  assert.equal(understood("xyzzy extract", null, "en"), false);
  assert.equal(understood("zucchero", "sugar", "it"), true);
});

test("splitting a raw list keeps brackets together", () => {
  assert.deepEqual(splitIngredients("sugar, emulsifier (soy lecithin, E476), salt."), ["sugar", "emulsifier (soy lecithin, E476)", "salt"]);
  assert.deepEqual(splitIngredients("سكر، دقيق القمح، ملح"), ["سكر", "دقيق القمح", "ملح"]);
});

test("verdict: red for an avoided allergen, green when everything is understood", () => {
  const facts = product(label(["sugar", "palm oil", "hazelnuts", "cocoa"]));
  const [s, o] = verdicts(facts, [sara, omar]);
  assert.equal(s.level, "red");
  assert.equal(s.reasons[0].kind, "contains");
  assert.equal(s.reasons[0].quote, "hazelnuts");
  assert.equal(o.level, "green");
  assert.equal(o.reasons[0].kind, "all_clear");
});

test("verdict: may-contain follows the member's policy", () => {
  const facts = product(label(["sugar", "cocoa"], { may_contain: "May contain nuts" }));
  assert.equal(verdicts(facts, [sara])[0].level, "red");
  const relaxed = { ...sara, traces: "allow" as const };
  assert.equal(verdicts(facts, [relaxed])[0].level, "amber");
});

test("verdict: never green when the list is cut off, unreadable, unknown or missing", () => {
  assert.equal(verdicts(product(label(["sugar"], { complete: false })), [omar])[0].level, "amber");
  assert.equal(verdicts(product(label(["sugar"], { legible: false })), [omar])[0].level, "amber");
  assert.equal(verdicts(product(label(["sugar", "xyzzy extract"])), [omar])[0].level, "amber");
  assert.equal(verdicts(product(null), [omar])[0].level, "amber");
  assert.equal(verdicts(product(null), [omar])[0].reasons[0].kind, "unknown_product");
});

test("verdict: Gemma's suspicion adds amber, never green", () => {
  const facts = product(label(["sugar", "cocoa"]), { suspicions: [{ ingredient: "cocoa", triggers: ["milk"], reason: "x", sources: [] }] });
  const m: Member = { id: "m", name: "M", avoid: ["milk"], diets: [], traces: "avoid" };
  assert.equal(verdicts(facts, [m])[0].level, "amber");
});

test("verdict: Open Food Facts tags count", () => {
  const facts = product(label(["sugar"]), { off: { allergens: ["en:peanuts"], traces: [] } });
  const v = verdicts(facts, [sara])[0];
  assert.equal(v.level, "red");
  assert.equal(v.reasons[0].source, "open_food_facts");
});

test("sticker: a 'may contain' line missing from the Arabic sticker is caught", () => {
  const original = label(["zucchero", "farina di frumento", "cacao"], { language: "it", may_contain: "Può contenere frutta a guscio" });
  const sticker: LabelFacts = { ...label(["سكر", "دقيق القمح", "كاكاو"]), language: "ar", may_contain: null };
  const facts = product(original, { sticker, pairs: [[0, 0], [1, 1], [2, 2]] });
  assert.deepEqual(stickerGaps(facts).statements, [{ kind: "may_contain", missing: ["tree_nuts"] }]);
  const v = verdicts(facts, [sara])[0];
  assert.equal(v.level, "red");
  assert.ok(v.reasons.some((r) => r.kind === "sticker_gap" && r.trigger === "tree_nuts"));
});

test("sticker: an ingredient missing from the Arabic sticker is caught", () => {
  const original = label(["sugar", "wheat flour", "skimmed milk powder"]);
  const sticker: LabelFacts = { ...label(["سكر", "دقيق القمح"]), language: "ar" };
  const facts = product(original, { sticker, pairs: [[0, 0], [1, 1], [2, null]] });
  const m: Member = { id: "m", name: "M", avoid: ["milk"], diets: [], traces: "avoid" };
  const v = verdicts(facts, [m])[0];
  assert.ok(v.reasons.some((r) => r.kind === "sticker_gap" && r.quote === "skimmed milk powder"));
});

test("safe list: green for the approved recipe, amber when the recipe changes", () => {
  // amber: an ingredient no list knows
  const facts = product(label(["sugar", "cocoa", "zorbel extract"]));
  assert.equal(verdicts(facts, [sara])[0].level, "amber");
  const recipe = recipeOf(facts);
  const safe = [{ barcode: facts.barcode!, recipe, member_id: "s", approved_by: "Mum", at: 1 }];
  assert.equal(verdicts(facts, [sara], safe)[0].level, "green");
  assert.equal(verdicts(facts, [sara], safe)[0].reasons[0].kind, "approved");
  const changed = product(label(["sugar", "cocoa", "zorbel extract", "milk"]));
  const v = verdicts(changed, [sara], safe)[0];
  assert.notEqual(v.level, "green");
  assert.ok(v.reasons.some((r) => r.kind === "recipe_changed"));
});

test("safe list: an approval never turns red into green", () => {
  const facts = product(label(["sugar", "cocoa"], { may_contain: "may contain nuts" }));
  const safe = [{ barcode: facts.barcode!, recipe: recipeOf(facts), member_id: "s", approved_by: "Mum", at: 1 }];
  const v = verdicts(facts, [sara], safe)[0];
  assert.equal(v.level, "red");
  assert.ok(!v.reasons.some((r) => r.kind === "approved"));
});

test("sticker: a pair whose Arabic side lacks the allergen still counts as a gap", () => {
  // Gemma read each list as one item and paired them; the sticker's has no peanuts
  const original = label(["sugar, palm oil, peanuts, whey powder, cocoa"]);
  const sticker: LabelFacts = { ...label(["سكر، زيت النخيل، مصل اللبن المجفف، كاكاو"]), language: "ar" };
  const facts = product(original, { sticker, pairs: [[0, 0]] });
  assert.deepEqual(stickerGaps(facts).ingredients.map((i) => i.missing), [["peanuts"]]);
  const milk: Member = { id: "m", name: "M", avoid: ["milk"], diets: [], traces: "avoid" };
  const [p, m] = verdicts(facts, [sara, milk]);
  assert.ok(p.reasons.some((r) => r.kind === "sticker_gap" && r.trigger === "peanuts"));
  assert.ok(!m.reasons.some((r) => r.kind === "sticker_gap"));
});

test("sticker: a shortened 'may contain' line is a gap for what it drops", () => {
  const original = label(["zucchero"], { language: "it", may_contain: "Può contenere arachidi e frutta a guscio" });
  const sticker: LabelFacts = { ...label(["سكر"]), language: "ar", may_contain: "قد يحتوي على الفول السوداني" };
  const facts = product(original, { sticker, pairs: [[0, 0]] });
  assert.deepEqual(stickerGaps(facts).statements, [{ kind: "may_contain", missing: ["tree_nuts"] }]);
});
