/** t302u–t305u: shared name comparator on Analyze + Rankings, 🏆 button, letter blocks. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const ranks = rankingsSource();
const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("Analyze stats table name sort uses compareByCharName", () => {
  assert.match(app, /compareByCharName\(a\.p\.display, b\.p\.display\)/);
  assert.doesNotMatch(app, /String\(a\.p\.display \|\| ""\)\.toLowerCase\(\)/);
});
test("Rankings Player sort uses the shared comparator", () => {
  assert.match(ranks, /import \{ compareByCharName \} from "\.\/analyze-run\.mjs/);
  assert.match(ranks, /byName = \(a, b\) => compareByCharName\(a\.name, b\.name\)/);
});
test("one page (t356u): no 🏆 / › buttons; order controls → stats → graph → Rankings → footer (vehicles note + 📊 Public in the footer)", () => {
  assert.doesNotMatch(index, /id="ranksLink"|id="ranksGoBtn"|ranks-row|href="ranks\.html"/);
  // t375u: 📦 cache line is the first row (chips only); 🗑️ / theme are small icon buttons at the right of "Fetch fresh data".
  assert.match(index, /<div class="controls">\s*<div class="cache-row">\s*<div id="cacheChips"[^>]*><\/div>\s*<\/div>\s*<div id="namesBox"/);
  assert.match(index, /<div class="fresh-row">[\s\S]*?id="fetchFresh"[\s\S]*?<span class="fresh-row-end">[\s\S]*?id="wipeLocalBtn"[\s\S]*?id="themeToggle"[\s\S]*?<\/span>\s*<\/div>/);
  const at = (re) => { const m = index.search(re); assert.ok(m >= 0, String(re)); return m; };
  // 2026-10-19: ✨ Stats and 🏅 Positions share one spot under the names box (stats-carousel.mjs).
  const order = [/id="namesBox"/, /id="analyzeBtn"/, /id="statsCarousel"/, /id="statsPanel"/, /id="rkPositions"/, /<svg id="chart"/, /<section id="rankings"/, /id="distSection"/, /id="ranksTableSection"/, /id="ranksSearch"/, /id="ranksTable"/, /<footer>/, /id="statsPublic"/, /What about vehicles\?/, /id="ranksMeta"/].map(at);
  assert.deepEqual(order, order.slice().sort((a, b) => a - b));
  assert.match(app, /import\("\.\/rankings\.mjs\?v=/, "Rankings load lazily");
  // t358u: no "🏆 Rankings" title; big table folded by default.
  assert.doesNotMatch(index, /🏆 Rankings|class="rk-title"/);
  assert.doesNotMatch(index, /id="rkPosSection"/, "positions are a carousel mode now, not a fold");
  // Tabs in order; the swipe dots sit with them (between the two tabs since 2026-10-20).
  const sc = index.slice(index.indexOf('<section id="statsCarousel" class="stats-carousel"'), index.indexOf("</section>", index.indexOf('id="statsCarousel"')));
  assert.match(sc, /data-sc="0"[\s\S]*?data-sc="1"/);
  assert.match(sc, /class="sc-dots"/);
  assert.match(app, /mountStatsCarousel\(\{ root: document\.getElementById\("statsCarousel"\)/);
  assert.match(index, /<details id="ranksTableSection" class="dist-section rk-table-section">/);
});
test("shared-cache letters are collapsible blocks with counts", () => {
  assert.match(app, /block\.className = "chip-group"/);
  assert.match(app, /cacheLetterOpen/);
});
test("shared-cache section is visually hidden, code kept (plenty of players)", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css, /details\.cache-shared\s*\{\s*display:\s*none/);
  // Rendering still exists — only the display is hidden.
  assert.match(app, /details\.className = "cache-shared"/);
});

import { freshEtaText } from "../analyze-run.mjs";
import { rankingsSource } from "./rankings-src.mjs";
test("freshEtaText: n × learned live time, default 7 s", () => {
  assert.equal(freshEtaText(0), "");
  assert.equal(freshEtaText(1), "(it will take approximately 7 s)");
  assert.equal(freshEtaText(3), "(it will take approximately 21 s)");
  assert.equal(freshEtaText(3, 4000), "(it will take approximately 12 s)");
  assert.equal(freshEtaText(10, 7000), "(it will take approximately 1 min 10 s)");
  assert.equal(freshEtaText(20, 6000), "(it will take approximately 2 min)");
  assert.match(index, /id="freshEta"/);
  assert.match(app, /fetchFresh\.addEventListener\("change", updateFreshEta\)/);
});

test("Rankings chart menu: only our own current metrics; 🎈 Inflation is an older stat (t345u/t346u)", () => {
  assert.match(ranks, /const groups = \[\["✨ Adjusted", VISIBLE\]\];/);
  assert.match(ranks, /const DIST_IDS = new Set\(VISIBLE\.map/);
  const vis = ranks.slice(ranks.indexOf("const VISIBLE = ["), ranks.indexOf("const DEBUG = ["));
  assert.doesNotMatch(vis, /id: "inflation"/);
  const dbg = ranks.slice(ranks.indexOf("const DEBUG = ["), ranks.indexOf("const PUBLIC = ["));
  assert.match(dbg, /id: "inflation"/);
  const adjDebug = app.slice(app.indexOf("const adjDebugCols = ["), app.indexOf("];", app.indexOf("const adjDebugCols = [")));
  assert.match(adjDebug, /id: "inflation"/);
});
