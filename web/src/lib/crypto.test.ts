import { test } from "node:test";
import assert from "node:assert/strict";
import { newFamilyKey, newParentKeys, open, seal, sign, verify } from "./crypto.ts";

test("seal and open with the family key; a different key can't read it", async () => {
  const k = await newFamilyKey();
  const body = await seal(k, { t: "scan", product: "Choco Wafer" });
  assert.match(body, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(await open(k, body), { t: "scan", product: "Choco Wafer" });
  assert.equal(await open(await newFamilyKey(), body), null);
});

test("a parent's signature checks out; a changed profile doesn't", async () => {
  const { pub, priv } = await newParentKeys();
  const profile = { members: [{ name: "Sara", avoid: ["peanuts"] }], v: 2 };
  const sig = await sign(priv, profile);
  assert.equal(await verify(pub, { v: 2, members: [{ avoid: ["peanuts"], name: "Sara" }] }, sig), true);
  assert.equal(await verify(pub, { ...profile, v: 3 }, sig), false);
  const other = await newParentKeys();
  assert.equal(await verify(other.pub, profile, sig), false);
});
