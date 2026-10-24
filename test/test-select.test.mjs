// #66 test tiers: scripts/test-select.mjs picks the tests a change needs.
// test-select: imports only
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { select, allTests, GUARDS, DATA, HEAVY, LIVE_ROOTS } from "../scripts/test-select.mjs";

test("every listed test exists (a renamed test must not drop out of its tier)", () => {
  const all = new Set(allTests());
  for (const t of [...GUARDS, ...DATA, ...HEAVY]) assert.ok(all.has(t), t);
  for (const f of LIVE_ROOTS) assert.ok(fs.existsSync(new URL(`../${f}`, import.meta.url)), f);
});

test("tiers: full = all, quick = no real-store / browser tests, live = the live tests + guards", () => {
  const all = allTests();
  assert.deepEqual(select("full").files, all);
  const quick = select("quick").files;
  for (const t of DATA) assert.ok(!quick.includes(t), t);
  assert.ok(!quick.includes("test/live-browser.test.mjs"));
  assert.ok(quick.length > 80 && quick.length < all.length);
  const live = select("live").files;
  for (const t of ["test/live-page.test.mjs", "test/live-browser.test.mjs", ...GUARDS]) assert.ok(live.includes(t), t);
  assert.ok(live.length < 10);
});

test("changed: the tests that reach the change + guards; heavy browser tests wait for the full run", () => {
  const live = select("changed", ["live.mjs"]).files;
  assert.ok(live.includes("test/live-page.test.mjs") && live.includes("test/i18n.test.mjs"));
  assert.ok(live.length < 10, live.join(" "));
  const app = select("changed", ["app.js"]).files;
  for (const t of HEAVY) assert.ok(!app.includes(t), t);
  assert.deepEqual(select("changed", ["i18n/ja.json"]).files.sort(), ["test/i18n.test.mjs", "test/legal.test.mjs"]);
  assert.ok(select("changed", ["test/hut.test.mjs"]).files.includes("test/hut.test.mjs")); // a changed test runs itself
});

test("really big = full, by rule: shared core, build / test setup, 8+ source files", () => {
  assert.match(select("changed", ["padding.mjs"]).why, /^full: shared core padding\.mjs/);
  assert.match(select("changed", ["package.json"]).why, /^full: build \/ test setup/);
  assert.match(select("changed", ["data/reviewed.json"]).why, /^full/);
  assert.match(select("changed", ["a.mjs", "b.mjs", "c.mjs", "d.mjs", "e.mjs", "f.mjs", "g.mjs", "h.css"]).why, /^full: 8 source files/);
  assert.match(select("changed", ["brand-new.json"]).why, /^quick: no test reaches/); // never zero tests
  assert.equal(select("changed", ["README.md"]).files.length, 0);
});
