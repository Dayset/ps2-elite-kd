// Negative ⚔️ iVi shows as-is in every player table (owner 2026-11-08: same as
// All players — stats table, live page, latest-100-kills feed, Duels crowd).
// The distribution graph no longer floors everything at 0: pureivi (linear,
// debug-only) still floors at 0, but adjs / combinedivi use symlog, which
// shows the negatives and ignores the floor by design (2026-11-15);
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

test("distribution graph: pureivi still floors at 0, adjs / combinedivi use symlog (no floor), tier grouping unchanged", () => {
  const rk = read("rankings.mjs");
  // The floor argument (adjs / pureivi → 0, everything else → null) still holds;
  // the scale is now a variable: log1p for the skewed metrics, symlog for
  // adjs / combinedivi — symlog ignores the floor by design (2026-11-15).
  assert.match(rk, /histogram\(vals, \{ floor: id === "adjs" \|\| id === "pureivi" \? 0 : null, scale \}\)/);
  assert.match(rk, /const SYMLOG_DIST = new Set\(\["adjs", "combinedivi"\]\)/);
  const tiers = read("tiers.mjs");
  assert.match(tiers, /if \(adjs <= 0\) return BELOW_TIER\.id;/);
});
