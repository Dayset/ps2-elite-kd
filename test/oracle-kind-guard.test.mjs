// #117: the neutral-map guard applies to territory and facility alerts, not to
// aerial / pressure points races (territory cannot change those results).
import { test } from "node:test";
import assert from "node:assert/strict";

test("neutral-map guard: territory yes, aerial and pressure no (#117)", async () => {
  const { dataSuspect, neutralMatters } = await import("../oracle-worker/src/index.js");
  // 88 regions, 33 neutral: 62.5 % owned, the broken map from alert 1-4-49583.
  const z = {};
  for (let i = 1; i <= 88; i++) z[i] = i <= 55 ? (i % 2 ? "1" : "2") : "0";
  const now = 1_792_540_000;
  const fresh = { ts: now - 600, zones: { 4: { ...z } } };
  const has = (kind) => dataSuspect(z, now, fresh, 4, 0, now, kind).some((f) => f.startsWith("neutral_heavy"));
  assert.equal(has("territory"), true, "territory still flags a neutral-heavy map");
  assert.equal(has("facility"), true, "facility still flags it (its odds read the targets' owners)");
  assert.equal(has("aerial"), false, "aerial is exempt");
  assert.equal(has("pressure"), false, "pressure is exempt");
  assert.equal(has("meltdown"), false, "meltdown was already exempt");
  assert.equal(neutralMatters("aerial"), false);
  assert.equal(neutralMatters("territory"), true);
});
