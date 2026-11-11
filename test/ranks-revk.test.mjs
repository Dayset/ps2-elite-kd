// 👿 Sore (owner 2026-11-11): revenge kills per kill as a percentage, from the
// Revenge Kill XP tick (exp id 11) via session-stats s_revk. Stored in ranks.json
// as "revk" right after "apk" (same onPlayer push, same measured rule), and carried
// in ranks-lite.json next to "apk" for the debug columns.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

const ranks = JSON.parse(readFileSync(new URL("../data/ranks.json", import.meta.url), "utf8"));
const lite = JSON.parse(readFileSync(new URL("../data/ranks-lite.json", import.meta.url), "utf8"));

test("ranks.json keeps the 👿 revk column, right after 🤝 apk", () => {
  const i = ranks.cols.indexOf("revk");
  const a = ranks.cols.indexOf("apk");
  assert.ok(i >= 0, "revk column missing");
  assert.equal(i, a + 1, "revk sits right after apk");
  const vals = ranks.rows.map((row) => row[i]).filter((v) => Number.isFinite(v));
  assert.ok(vals.length > 1000, `only ${vals.length} revk values`);
  assert.ok(vals.every((v) => v >= 0 && v <= 100), "revk is a percentage 0–100, not a fraction");
});

test("the two checked players carry their measured revenge %", () => {
  const i = ranks.cols.indexOf("revk");
  const si = ranks.cols.indexOf("slug");
  const bySlug = Object.fromEntries(ranks.rows.map((row) => [row[si], row[i]]));
  // Loose bands around the measured values (Nov 11: NanoVS 7.1%, Werkitten 3.0%):
  // wide enough to survive a data refresh, tight enough to catch a fraction
  // stored as a percent (0.07) or a double-scaled one (710).
  assert.ok(bySlug.nanovs >= 6 && bySlug.nanovs <= 8, `NanoVS revk ${bySlug.nanovs}`);
  assert.ok(bySlug.werkitten >= 2 && bySlug.werkitten <= 4, `Werkitten revk ${bySlug.werkitten}`);
  assert.ok(bySlug.nanovs > bySlug.werkitten, "NanoVS revenges more often than Werkitten");
});

test("ranks-lite.json carries revk next to apk, same values", () => {
  const i = lite.cols.indexOf("revk");
  const a = lite.cols.indexOf("apk");
  assert.ok(i >= 0, "revk column missing from lite");
  assert.equal(i, a + 1, "revk sits right after apk in lite");
  const si = lite.cols.indexOf("slug");
  const bySlug = Object.fromEntries(lite.rows.map((row) => [row[si], row[i]]));
  assert.equal(bySlug.nanovs, ranks.rows.find((row) => row[ranks.cols.indexOf("slug")] === "nanovs")[ranks.cols.indexOf("revk")]);
  assert.equal(bySlug.werkitten, ranks.rows.find((row) => row[ranks.cols.indexOf("slug")] === "werkitten")[ranks.cols.indexOf("revk")]);
});
