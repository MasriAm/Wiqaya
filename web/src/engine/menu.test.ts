import { test } from "node:test";
import assert from "node:assert/strict";
import { dishVerdicts, worstDish, type Dish } from "./menu.ts";
import type { Member } from "./types.ts";

const dish = (name: string, description = "", usual: string[] = [], en: string | null = null): Dish => ({ name, en, section: "", description, usual });
const sara: Member = { id: "s", name: "Sara", avoid: ["sesame"], diets: [], traces: "avoid" };
const omar: Member = { id: "o", name: "Omar", avoid: ["gluten", "milk"], diets: [], traces: "allow" };

test("menu: the menu naming an allergen means avoid", () => {
  const [v] = dishVerdicts(dish("Hummus Beiruti", "chickpeas, tahini, garlic"), "en", [sara]);
  assert.equal(v.level, "avoid");
  assert.equal(v.reasons[0].how, "named");
});

test("menu: what a dish is usually made with means ask first, never avoid or clear", () => {
  const [v] = dishVerdicts(dish("Grilled halloumi plate", "", ["halloumi", "pita bread", "cheese"]), "en", [omar]);
  assert.equal(v.level, "ask");
  assert.deepEqual(v.reasons.map((r) => r.trigger).sort(), ["gluten", "milk"]);
});

test("menu: a Jordanian dish name is caught even when Gemma lists nothing", () => {
  const [s] = dishVerdicts(dish("Moutabal"), "en", [sara]);
  assert.equal(s.level, "ask");
  // knafeh is always cheese and wheat pastry: the pack says so for certain
  const [o] = dishVerdicts(dish("كنافة نابلسية"), "ar", [omar]);
  assert.equal(o.level, "avoid");
});

test("menu: nothing pointing to an allergen is an option to ask for, and a person with no allergies is never cleared", () => {
  const [v] = dishVerdicts(dish("Grilled fish", "with lemon and rice", ["fish", "lemon", "rice", "olive oil"]), "en", [omar]);
  assert.equal(v.level, "options");
  const [u] = dishVerdicts(dish("Grilled fish"), "en", [{ id: "n", name: "New", avoid: [], diets: [], traces: "avoid" }]);
  assert.equal(u.level, "ask");
  assert.ok(u.unset);
  assert.equal(worstDish(["options", "ask", "options"]), "ask");
});
