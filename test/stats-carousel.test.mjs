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
