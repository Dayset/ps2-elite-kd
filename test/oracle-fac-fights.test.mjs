// ⚔️ Live fights follow the Commander faction (2026-11-02): when a faction is
// being followed, the card shows that faction's fights (top 3), not all hot
// fights. Structural (source-shape) checks — dashboard fights.js is not
// node-importable (its `?v=` imports break node resolution); the filter logic
// itself is verified through the real module in check-fac-fights.mjs (CDP).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fights = readFileSync(new URL("../oracle/js/fights.js", import.meta.url), "utf8");
const main = readFileSync(new URL("../oracle/js/main.js", import.meta.url), "utf8");
const en = JSON.parse(readFileSync(new URL("../i18n/en.json", import.meta.url), "utf8"));

test("fightsCard takes the followed faction and filters to its fights", () => {
  assert.ok(fights.includes("export function fightsCard(s, fac = null, nowS"), "fightsCard(s, fac, nowS)");
  assert.ok(fights.includes(".filter((f) => !fac || (f.n && f.n[fac] > 0))"), "scoped filter on f.n[fac], unscoped when fac is null");
  assert.ok(fights.includes("· ${fac}"), "heading names the followed faction when scoped");
  assert.ok(fights.includes('or.f.noneFac'), "scoped empty note key used");
});

test("main.js: commander runs before fightsCard, which gets S.cmdOn", () => {
  assert.ok(main.includes('const cmdHtml = a.status === "live" ? commander('), "commander hoisted before the template");
  assert.ok(main.includes("fightsCard(s, S.cmdOn)"), "fights card gets the Commander faction");
  assert.ok(main.includes("${cmdHtml}"), "template uses the hoisted commander HTML");
  assert.equal(main.split("commander(cmdView").length - 1, 1, "commander() called exactly once (the hoist, not again in the template)");
});

test("scoped empty note key exists in English", () => {
  assert.equal(en["or.f.noneFac"], "No big fights for {f} right now.");
});
