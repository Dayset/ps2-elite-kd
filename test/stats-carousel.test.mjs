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

test("both tables share one look (right-aligned numbers, same weights) inside the carousel", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const block = css.slice(css.indexOf("✨ Stats ⇄ 🏅 Positions (2026-10-19)"));
  assert.match(block, /\.stats-carousel \.stats-table td,\s*\n\.stats-carousel \.rk-pos-table th,/);
  assert.match(block, /text-align: right/);
  assert.match(block, /\.stats-carousel:has\(#statsPanel:empty\) \{ display: none; \}/);
  const ranks = readFileSync(new URL("../rankings.mjs", import.meta.url), "utf8");
  assert.match(ranks, /class="player-num"[^`]*\$\{i \+ 1\}\./, "positions rows carry the same series number as the stats rows");
});

// t470u: 4 quick flips on a phone poof the tab / dots line away.
import { flipBurst, FLIPS_TO_POOF, FLIP_WINDOW_MS } from "../stats-carousel.mjs";
test("flipBurst (t470u): fires on exactly the 3rd switch inside the window", () => {
    assert.equal(FLIPS_TO_POOF, 3);
    assert.equal(flipBurst([0, 1000]), false);
    assert.equal(flipBurst([0, 1000, 2000]), true);
});
test("flipBurst (t470u): not when the 3 switches are spread over more than the window", () => {
    assert.equal(flipBurst([0, 4000, FLIP_WINDOW_MS + 1]), false);
    assert.equal(flipBurst([0, 4000, FLIP_WINDOW_MS]), true);
});

// t471u: the fold is per page session; a second mount never doubles listeners.
import { collapseScBar } from "../stats-carousel.mjs";
test("collapseScBar (t471u): folds without animation, once, and blurs a focused tab", () => {
  const cls = new Set(), attrs = {};
  let blurred = 0;
  const tab = { blur: () => { blurred++; } };
  const bar = { setAttribute: (k, v) => { attrs[k] = v; }, contains: (n) => n === tab };
  const root = { classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) }, querySelector: () => bar, isConnected: true };
  globalThis.document = { activeElement: tab };
  try {
    collapseScBar(root, { animate: false });
    assert.ok(cls.has("sc-bar-gone"));
    assert.equal(attrs.inert, "");
    assert.equal(blurred, 1);
    collapseScBar(root, { animate: false });
    assert.equal(blurred, 1, "second call is a no-op");
  } finally { delete globalThis.document; }
});
test("mountStatsCarousel (t471u): one mount per element; a folded session stays folded", () => {
  const src = readFileSync(new URL("../stats-carousel.mjs", import.meta.url), "utf8");
  assert.match(src, /if \(root\.__sc\) return root\.__sc;/);
  assert.match(src, /if \(sessionPoofed\) collapseScBar\(root, \{ animate: false \}\);/);
  assert.match(src, /const poof = !sessionPoofed && phoneUi\(\) && flipBurst\(flips\);/);
});
