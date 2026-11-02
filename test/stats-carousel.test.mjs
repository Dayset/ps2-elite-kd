// ✨ Stats ⇄ 🏅 Positions carousel (stats-carousel.mjs): pure helpers + wiring.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canScrollToward, clampMode } from "../stats-carousel.mjs";
import { appSource } from "./app-source.mjs";

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
  assert.match(ranks, /class="rk-pos-num"[^`]*\$\{i \+ 1\}\./, "positions rows carry the series number in their own pinned # column");
  const stats = readFileSync(new URL("../stats-table.mjs", import.meta.url), "utf8");
  assert.match(stats, /class="stats-num"[^`]*\$\{num\}\./, "stats rows carry the same series number in their own pinned # column");
});

test("mountStatsCarousel (t471u): one mount per element", () => {
  const src = readFileSync(new URL("../stats-carousel.mjs", import.meta.url), "utf8");
  assert.match(src, /if \(root\.__sc\) return root\.__sc;/);
});

// Owner 2026-11-02: the tab bar is still gone, but the dots are back — on a PC
// there is no swipe, so the dots are the way to switch views. They are built by
// mount (one button per slide), not markup in index.html; the poof stays gone.
test("dots back, tab bar still gone, no poof (owner 2026-11-02)", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(!/sc-bar|sc-tab/.test(html), "index.html carries no bar/tab markup");
  assert.match(html, /class="sc-viewport"/, "the swipe viewport stays");
  const sc = readFileSync(new URL("../stats-carousel.mjs", import.meta.url), "utf8");
  assert.match(sc, /className = "sc-dots"/, "mount builds the dots row");
  assert.match(sc, /b\.addEventListener\("click", \(\) => go\(k\)\)/, "a dot click is go(), the swipe path");
  assert.match(sc, /d\.classList\.toggle\("on", on\)/, "paint syncs the active dot");
  assert.ok(!/poof|collapseScBar|flipBurst/.test(sc), "carousel has no poof machinery");
  assert.match(sc, /addEventListener\("scroll"/, "mode still follows the swipe scroll");
  const sfx = readFileSync(new URL("../sfx.mjs", import.meta.url), "utf8");
  assert.ok(!/poof/.test(sfx), "the 💨 poof sound is gone from sfx");
  const app = appSource();
  assert.ok(!/poof|onThumb/.test(app), "app.js wires no poof callback");
});

// Owner 2026-11-02: the table wraps' scrollbar hiding is touch-only — on a PC
// the bar stays, so a windowed table's cut columns stay reachable (the Rankings
// wrap already worked this way since 2026-10-20). The slide viewport keeps its
// hiding on all pointers: the dots switch slides now, not its scrollbar.
test("table-wrap scrollbars hidden on touch only, PC keeps its bar", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const coarse = [];
  const stripCoarse = (src) => {
    let out = "", k = 0;
    while (k < src.length) {
      const at = src.indexOf("@media (pointer: coarse)", k);
      if (at < 0) { out += src.slice(k); break; }
      out += src.slice(k, at);
      const open = src.indexOf("{", at);
      let d = 0, m = open;
      for (; m < src.length; m++) {
        if (src[m] === "{") d++;
        else if (src[m] === "}") { d--; if (d === 0) break; }
      }
      coarse.push(src.slice(at, m + 1));
      k = m + 1;
    }
    return out;
  };
  const rest = stripCoarse(css);
  const joined = coarse.join("\n");
  for (const sel of [".stats-table-wrap", ".rk-pos-wrap"]) {
    const esc = sel.replace(".", "\\.");
    assert.ok(!new RegExp(esc + "[^{]*\\{[^}]*scrollbar-width").test(rest), `${sel} rule carries no hiding outside touch`);
    assert.ok(!new RegExp(esc + "::-webkit-scrollbar").test(rest), `${sel} webkit hiding lives in touch only`);
    assert.ok(new RegExp(esc + " \\{ scrollbar-width: none; \\}").test(joined), `${sel} hiding is inside a touch block`);
  }
  assert.match(css, /\.sc-viewport \{[^}]*scrollbar-width: none;/, "the slide viewport stays hidden on all pointers");
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
  assert.match(src, /!hintsClosed && Math\.abs\(viewport\.scrollLeft - slotOf\(i\) \* width\(\)\) > 2/);
  const app = appSource();
  for (const m of ["head-tip", "name-peek"]) {
    const a = app.match(new RegExp(m + "\\.mjs\\?v=[^\"']+"))[0];
    assert.ok(src.includes(a), `${m} imported with the same ?v= as app.js (one shared module instance)`);
  }
});

// #88 (2026-11-01): the loop wraps by rotating the slides' places (CSS order) so the
// shown slide always has a neighbour on both sides; every wrap is the browser's own
// snap glide. No instant jump on touchend (a phone's fling carried it one slide on).
test("loop by rotation: no touchend wrap jump, re-deal only at rest (#88)", () => {
  const src = readFileSync(new URL("../stats-carousel.mjs", import.meta.url), "utf8");
  assert.ok(!/addEventListener\("touchend", \(e\) => \{\s*if \(!loopStart\)/.test(src), "the touchend wrap is gone");
  assert.ok(!/loopStart/.test(src), "no loop snapshot state left");
  assert.match(src, /s\.style\.order = String\(slots\[k\]\)/, "places are dealt with CSS order");
  assert.match(src, /if \(touching \|\| !viewport\.clientWidth\) return;/, "never re-deal under a finger");
  assert.match(src, /progTimer = setTimeout\(/, "the programmatic flag always clears by timer, not only by scrollend");
});
