// Negative ⚔️ iVi shows as-is in every player table (owner 2026-11-08: same as
// All players — stats table, live page, latest-100-kills feed, Duels crowd).
// The distribution graph keeps its floor: 0 + underflow bin (rankings.mjs:1046);
// 🎲 Luck stays null for iVi ≤ 0 (duelExpected) and Glicko keeps its flat seed;
// the live feed's tier glyphs ("0" for opp ≤ 0) are bands, not values, and stay.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("negative iVi is shown as-is in stats table, live page, kill feed and duels", () => {
  const st = read("stats-table.mjs");
  assert.doesNotMatch(st, /floorZero/, "no floor flag left in stats-table.mjs");
  assert.doesNotMatch(st, /below-scale/, "no below-scale cell left in stats-table.mjs");
  const lm = read("live-model.mjs");
  assert.doesNotMatch(lm, /floorZero/, "no floor flag left in live-model.mjs");
  const kf = read("kill-feed.mjs");
  assert.doesNotMatch(kf, /Math\.max\(0, info\.adjs\)/, "kill feed no longer floors iVi at 0");
  const dp = read("duels-panel.mjs");
  assert.doesNotMatch(dp, /v <= 0\) continue/, "duels crowd map no longer skips non-positive iVi");
  assert.doesNotMatch(dp, /&& v > 0/, "duels crowd no longer hides non-positive iVi");
  const tiers = read("tiers.mjs");
  assert.match(tiers, /label: "Below the rating scale"/);
  assert.doesNotMatch(tiers, /\(iVi 0\)/, "no (iVi 0) left in the tier label");
  const en = JSON.parse(read("i18n/en.json"));
  assert.equal(en["tier.below"], "Below the rating scale");
  const cx = read("columns-example.mjs");
  assert.doesNotMatch(cx, /Math\.max\(0, .*adjs\)/, "example page no longer floors iVi at 0");
  assert.match(read("columns.html"), /columns-example\.mjs\?v=20261110-swp1/);
});

test("distribution graph still floors at 0 (underflow bin), tier grouping unchanged", () => {
  const rk = read("rankings.mjs");
  assert.match(rk, /histogram\(vals, \{ floor: id === "adjs" \|\| id === "pureivi" \? 0 : null \}\)/);
  const tiers = read("tiers.mjs");
  assert.match(tiers, /if \(adjs <= 0\) return BELOW_TIER\.id;/);
});
