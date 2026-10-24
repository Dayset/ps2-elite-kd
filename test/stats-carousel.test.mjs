// ✨ Stats ⇄ 🏅 Positions carousel (stats-carousel.mjs): pure helpers + wiring.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canScrollToward, clampMode } from "../stats-carousel.mjs";

test("a swipe changes mode only once the table can't scroll that way", () => {
  const el = (scrollLeft, scrollWidth = 900, clientWidth = 360) => ({ scrollLeft, scrollWidth, clientWidth });
  assert.equal(canScrollToward(el(0), -50), true, "finger left at the start: the table scrolls");
  assert.equal(canScrollToward(el(540), -50), false, "at the right end: next mode");
  assert.equal(canScrollToward(el(0), 50), false, "at the left edge, finger right: previous mode");
  assert.equal(canScrollToward(el(200), 50), true);
  assert.equal(canScrollToward(el(0, 300, 360), -50), false, "a table that fits never scrolls");
  assert.equal(canScrollToward(null, -50), false);
});

test("mode index stays within the slides", () => {
  assert.equal(clampMode(-1, 2), 0);
  assert.equal(clampMode(5, 2), 1);
  assert.equal(clampMode(1, 2), 1);
});

test("carousel block still sets right-aligned numbers (positions keep them; stats table overrides to left in the 2026-10-24 alignment test)", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const block = css.slice(css.indexOf("✨ Stats ⇄ 🏅 Positions (2026-10-19)"));
  assert.match(block, /\.stats-carousel \.stats-table td,\s*\n\.stats-carousel \.rk-pos-table th,/);
  assert.match(block, /text-align: right/);
  assert.match(block, /\.stats-carousel:has\(#statsPanel:empty\) \{ display: none; \}/);
  const ranks = readFileSync(new URL("../rankings.mjs", import.meta.url), "utf8");
  assert.match(ranks, /class="player-num"[^`]*\$\{i \+ 1\}\./, "positions rows carry the same series number as the stats rows");
});

test("mountStatsCarousel (t471u): one mount per element", () => {
  const src = readFileSync(new URL("../stats-carousel.mjs", import.meta.url), "utf8");
  assert.match(src, /if \(root\.__sc\) return root\.__sc;/);
});

// Owner 2026-10-22: no Stats/Positions tab bar, no dots, no poof — the two
// modes switch by left / right swipe only, and users find it on their own.
test("no tab bar, no dots, no poof anywhere (owner 2026-10-22)", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(!/sc-bar|sc-tab|sc-dot/.test(html), "index.html carries no bar markup");
  assert.match(html, /class="sc-viewport"/, "the swipe viewport stays");
  const sc = readFileSync(new URL("../stats-carousel.mjs", import.meta.url), "utf8");
  assert.ok(!/poof|collapseScBar|flipBurst/.test(sc), "carousel has no poof machinery");
  assert.match(sc, /addEventListener\("scroll"/, "mode still follows the swipe scroll");
  const sfx = readFileSync(new URL("../sfx.mjs", import.meta.url), "utf8");
  assert.ok(!/poof/.test(sfx), "the 💨 poof sound is gone from sfx");
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.ok(!/poof|onThumb/.test(app), "app.js wires no poof callback");
});

// t540u (owner 2026-10-23): swiping with a hint open left an empty gap on the other side.
test("closeSlideHints closes open fold notes in the slides once a switch starts", async () => {
  const { closeSlideHints } = await import("../stats-carousel.mjs");
  const folds = [{ open: true }, { open: true }];
  const root = { querySelectorAll: (sel) => (sel === ".sc-slide details.fold-note[open]" ? folds.filter((d) => d.open) : []) };
  assert.equal(closeSlideHints(root), 2);
  assert.ok(folds.every((d) => !d.open));
  assert.equal(closeSlideHints(root), 0);
  assert.equal(closeSlideHints(null), 0);
  const src = readFileSync(new URL("../stats-carousel.mjs", import.meta.url), "utf8");
  assert.match(src, /!hintsClosed && Math\.abs\(viewport\.scrollLeft - i \* width\(\)\) > 2/);
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  for (const m of ["head-tip", "name-peek"]) {
    const a = app.match(new RegExp(m + "\\.mjs\\?v=[^\"']+"))[0];
    assert.ok(src.includes(a), `${m} imported with the same ?v= as app.js (one shared module instance)`);
  }
});
