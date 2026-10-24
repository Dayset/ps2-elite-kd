import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildLive } from "../scripts/build-live.mjs";
import { classifyDeath, feedPush, censusStats, cellText, fmtGap, LIVE_COLS, FEED_MAX, emojiFill, fillDriver, glowTier, FULL_AT, goodPct, FILL_DIM, PHASE_A_MS, PHASE_B_MS, phaseAt } from "../live.mjs";

const root = new URL("../", import.meta.url);

test("live.html is built from index.html (run node scripts/build-live.mjs)", () => {
  const want = buildLive(readFileSync(new URL("index.html", root), "utf8"));
  assert.equal(readFileSync(new URL("live.html", root), "utf8"), want);
});

test("classifyDeath: kill, death, suicide, unrelated", () => {
  const d = (att, vic, hs = "0") => ({ event_name: "Death", attacker_character_id: att, character_id: vic, is_headshot: hs });
  assert.deepEqual(classifyDeath(d("1", "2", "1"), "1"), { kind: "kill", opp: "2", headshot: true });
  assert.deepEqual(classifyDeath(d("2", "1"), "1"), { kind: "death", opp: "2", headshot: false });
  assert.equal(classifyDeath(d("1", "1"), "1"), null);
  assert.equal(classifyDeath(d("0", "1"), "1"), null);
  assert.equal(classifyDeath(d("3", "4"), "1"), null);
});

test("feedPush: no repeats, 7th opponent drops the oldest, stopwatch freezes the old top", () => {
  let rows = [];
  rows = feedPush(rows, { kind: "kill", opp: "a" }, 1000).rows;
  assert.equal(rows[0].gap, null);
  rows = feedPush(rows, { kind: "death", opp: "b" }, 4000).rows;
  assert.equal(rows[1].gap, 3000);
  assert.equal(rows[0].gap, null);
  rows = feedPush(rows, { kind: "kill", opp: "a" }, 5000).rows;
  assert.deepEqual(rows.map((r) => r.opp), ["a", "b"]);
  assert.equal(rows[1].gap, 1000); // b froze when a came back
  let dropped = null;
  for (const [i, o] of ["c", "d", "e", "f", "g"].entries()) ({ rows, dropped } = feedPush(rows, { kind: "kill", opp: o }, 6000 + i));
  assert.equal(rows.length, FEED_MAX);
  assert.equal(FEED_MAX, 3); // owner t563u: 3 rows
  assert.equal(dropped.opp, "d");
  assert.equal(rows[0].opp, "g");
});

test("fmtGap", () => {
  assert.equal(fmtGap(3400), "3s");
  assert.equal(fmtGap(65000), "1m 05s");
  assert.equal(fmtGap(3720000), "1h 02m");
});

test("LIVE has no skill graph: the chart section is hidden and live.mjs no longer drives it", () => {
  const css = readFileSync(new URL("styles.css", root), "utf8");
  assert.match(css, /\.live-mode #chartSection \{ display: none !important; \}/);
  const js = readFileSync(new URL("live.mjs", root), "utf8");
  assert.doesNotMatch(js, /analyzeNames|setNameTokens/);
});

test("emoji fill meter (owner t564u): one size, p0 empty / p50 half / top full; 🪖 by infantry %, 🪳 by raw-Zerg percentile", () => {
  const act = LIVE_COLS.find((c) => c.id === "act");
  const zerg = LIVE_COLS.find((c) => c.id === "zerg");
  const inf = LIVE_COLS.find((c) => c.id === "inf");
  for (const c of LIVE_COLS) assert.ok(!c.lowerBetter, c.id);
  // owner t568u: fill = min(1, driver / 91) — p91+ (and 91%+ infantry) completely solid
  assert.equal(FULL_AT, 91);
  assert.equal(emojiFill(act, 1.2, 0), 0);
  assert.equal(emojiFill(act, 1.2, 50), 54.9); // p50 ≈ 55% full
  assert.equal(emojiFill(act, 1.2, 90), 98.9);
  assert.equal(emojiFill(act, 1.2, 91), 100);
  assert.equal(emojiFill(act, 1.2, 99), 100);
  assert.equal(emojiFill(zerg, 40, 80), 87.9); // higher raw Zerg → higher percentile → more fill
  assert.equal(fillDriver(zerg, 40, 80), 80);
  assert.equal(emojiFill(inf, 50, 3), 54.9); // 🪖 by the infantry % itself, same /91 rule
  assert.equal(emojiFill(inf, 91, 3), 100);
  assert.equal(emojiFill(inf, 120, 99), 100);
  assert.equal(fillDriver(inf, 120, 99), 100);
  const apk = { id: "x", lowerBetter: true }; // the generic reversed mapping still works
  assert.equal(fillDriver(apk, 1, 10), 89);
  assert.equal(emojiFill(apk, 1, 10), 97.8);
  // owner t568u glow tiers: TOP 91+, HIGH 71–90, AVERAGE 51–70, none ≤ 50 / missing
  assert.deepEqual([null, NaN, 0, 50, 51, 70, 70.9, 71, 90, 90.9, 91, 99, 100].map(glowTier), [0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]);
  assert.equal(goodPct(apk, 10), 89);
  assert.equal(emojiFill(act, null, 50), null);
  assert.equal(emojiFill(act, NaN, 50), null);
  assert.equal(FILL_DIM, 0.25);
  const css = readFileSync(new URL("styles.css", root), "utf8");
  assert.match(css, /\.lv-e0 \{ opacity: 0\.25; \}/);
  assert.match(css, /\.lv-e1 \{ clip-path: inset\(calc\(var\(--it, 0%\) \+ var\(--ih, 100%\) \* \(100 - var\(--f, 0\)\) \/ 100\) -25% -25% -25%\); \}/); // fills from the bottom of the ink
  assert.match(css, /\.lv-pa > \.lv-iv \{ width: 4ch; font-variant-numeric: tabular-nums; \}/); // t564u: 4-digit room
  assert.doesNotMatch(css, /scale\(var\(--s/); // no rank-based sizes any more
  const js = readFileSync(new URL("live.mjs", root), "utf8");
  assert.doesNotMatch(js, /emojiScale|class="lv-v"/); // no size scaling, no number under the emoji
});

test("LIVE columns (owner t550u): iVi, Activity, Brave, Resist, Zerg, Infantry in that order", () => {
  assert.deepEqual(LIVE_COLS.map((c) => c.id), ["adjs", "act", "pvs", "rf", "zerg", "inf"]);
  assert.deepEqual(LIVE_COLS.map((c) => c.label.split(" ")[0]), ["⚔️", "🏃", "🦁", "🛡️", "🪳", "🪖"]);
  // owner t557u: ⚔️ iVi = phase A (number + emoji inline), the rest = phase B (emoji with the number under it)
  assert.deepEqual(LIVE_COLS.map((c) => c.mode), ["ivi", "stack", "stack", "stack", "stack", "stack"]);
});

test("LIVE: no distribution chart, no title once kills arrive, a themed background", () => {
  const css = readFileSync(new URL("styles.css", root), "utf8");
  assert.match(css, /\.live-mode #distSection,\n\.live-mode #weaponsSection \{ display: none !important; \}/);
  assert.match(css, /\.live-state:empty \{ display: none; \}/);
  assert.match(css, /background: var\(--panel\)/);
  const js = readFileSync(new URL("live.mjs", root), "utf8");
  assert.doesNotMatch(js, /Live: <strong/);
});

test("A 10 s / B 5 s switch (owner t557u, t559u, t560u, t563u, t566u): one fixed block a side, phase A name + iVi (no ⚔️), phase B mirrored emojis, quick flip", () => {
  assert.equal(PHASE_A_MS, 10000);
  assert.equal(PHASE_B_MS, 5000);
  assert.deepEqual([0, 9999, 10000, 14999, 15000, 24999, 25000, 29999, 30000, -5].map(phaseAt), ["A", "A", "B", "B", "A", "A", "B", "B", "A", "A"]);
  const css = readFileSync(new URL("styles.css", root), "utf8");
  assert.doesNotMatch(css, /lvNum|lvEm|lv-arrow|lv-cyc/);
  assert.match(css, /transition: opacity 0\.133s/);
  assert.match(css, /\.lv-phB \.lv-blk > \.lv-pb \{ opacity: 1;/);
  assert.match(css, /\.lv-bL > \.lv-pa, \.lv-bL > \.lv-pb \{ justify-content: flex-end; \}/); // left block hugs the centre
  assert.match(css, /\.lv-bR > \.lv-pa, \.lv-bR > \.lv-pb \{ justify-content: flex-start; \}/);
  const js = readFileSync(new URL("live.mjs", root), "utf8");
  assert.doesNotMatch(js, /❯|lv-arrow/);
  // t567u: the first letter moved inside the block next to 🏃 (phase B only); no separate letter cells.
  assert.match(js, /<td class="lv-time">\$\{t\}<\/td>\$\{left\}\$\{right\}<\/tr>/);
  assert.doesNotMatch(js, /lv-c-ini|class="lv-ini/);
  assert.match(js, /const pb = sd === "L" \? letter\(p, sd, tip\) \+ em : em \+ letter\(p, sd, tip\)/); // letter · 🏃🦁🛡️🪳🪖 | 🪖🪳🛡️🦁🏃 · letter
  assert.doesNotMatch(js, /lv-pa">[^<]*letter\(/); // never in phase A (the name is there)
  assert.match(css, /col\.lv-c-blk \{ width: calc\(var\(--lv-b\) \+ var\(--lv-ini\)\); \}/);
  assert.match(css, /\.lv-li \{ flex: none; width: var\(--lv-ini\);/);
  assert.match(js, /const pa = sd === "L" \? nameHtml\(p, sd\) \+ iv : iv \+ nameHtml\(p, sd\)/);
  assert.doesNotMatch(js, /lv-ie|lv-slot|lv-name-cell/); // no ⚔️ in phase A, no separate name columns
  assert.match(js, /sd === "R" \? \[\.\.\.REST\]\.reverse\(\) : REST/); // right player: 🪖 🪳 🛡️ 🦁 🏃
  assert.match(js, /lv-e lv-e0/);
});

test("censusStats: K/D and KPM from stat_history", () => {
  const s = censusStats({ stats: { stat_history: [{ stat_name: "kills", all_time: "30" }, { stat_name: "deaths", all_time: "10" }, { stat_name: "time", all_time: "1800" }] } });
  assert.equal(s.kd, 3);
  assert.equal(s.kpm, 1);
  assert.deepEqual(censusStats({}), { kd: null, kpm: null });
});

test("cellText: digits, floor at zero, missing", () => {
  const adjs = LIVE_COLS.find((c) => c.id === "adjs");
  assert.equal(cellText(adjs, 1357.3), "1357"); // t564u: no comma
  assert.equal(cellText(adjs, -20), "0");
  assert.equal(cellText(LIVE_COLS.find((c) => c.id === "inf"), null), "—"); // 🪖 missing → "—" in the hover title only; the cell is an empty 0% 🪖 (t567u)
  const pvs = LIVE_COLS.find((c) => c.id === "pvs");
  assert.equal(cellText(pvs, 0.634), "0.63");
  assert.equal(cellText(pvs, 329.633), "330"); // t557u: small numbers fit 4 characters
  assert.equal(cellText(pvs, 12.345), "12.3");
  assert.equal(cellText(LIVE_COLS.find((c) => c.id === "inf"), 95.43), "95.4");
  assert.equal(cellText(LIVE_COLS.find((c) => c.id === "inf"), 100), "100");
  assert.equal(cellText(adjs, 1883.2), "1883"); // owner t564u: "1600, not 1,600"
});

test("LIVE juice (owner t562u): pop-in row, flip switch, top-rank glow, upset shake — never resizes, honours reduced motion", () => {
  const css = readFileSync(new URL("styles.css", root), "utf8");
  for (const k of ["lvPop", "lvFlashK", "lvFlashD", "lvFlashU", "lvShake", "lvGlow", "lvGlow1", "lvGlow2", "lvSpark"]) assert.match(css, new RegExp(`@keyframes ${k} `));
  assert.match(css, /rotateX\(-85deg\)/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.lv-ev\.lv-new > tr > td/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.lv-g1 > \.lv-em, \.lv-g2 > \.lv-em, \.lv-g3 > \.lv-em \{ animation: none; \} \.lv-g3::after \{ animation: none; opacity: 0\.85; \} \}/); // static glow, no pulse
  assert.match(css, /\.lv-g3::after \{ content: "✦"; position: absolute;/); // sparkle never takes layout room
  assert.doesNotMatch(css, /lv-top/);
  const js = readFileSync(new URL("live.mjs", root), "utf8");
  assert.match(js, /const g = glowTier\(driverOf\(c, v\)\);/); // tiers use the fill's own driver
  assert.doesNotMatch(js, /TOP_PCT|lv-top/);
  assert.match(js, /const UPSET_GAP = 50;/);
  assert.match(js, /freshTop = !!rows\[0\] && rows\[0\] !== shownTop;/); // a re-render never replays the entrance
});

test("no value = empty 0% emoji, never a dash (owner t567u): stats, iVi, uncached players, skeleton row", () => {
  const js = readFileSync(new URL("live.mjs", root), "utf8");
  const css = readFileSync(new URL("styles.css", root), "utf8");
  assert.match(js, /if \(f == null\) return `<span class="lv-u lv-fl lv-nil" style="--f:0"[^`]*\$\{meter\(shortLab\(c\), 0\)\}/); // empty emoji, no "—"
  assert.match(js, /if \(fillOf\(c, v\) == null\) return `<span class="lv-iv lv-nil" style="--f:0"[^`]*\$\{meter\(shortLab\(c\), 0\)\}/); // empty ⚔️ in the iVi box
  assert.match(js, /\$\{f > 0 \? `<b class="lv-e lv-e1">/); // 0% = only the 25% copy
  assert.match(js, /const iv = IVI\.map\(\(c\) => iviText\(c, vals\[c\.id\]\)\)/); // uncached too
  assert.match(js, /const em = restFor\(sd\)\.map\(\(c\) => unit\(c, vals\[c\.id\]\)\)/);
  assert.doesNotMatch(js, /lv-none|lv-unc|>—<\/span>/); // no K/D-over-KPM text, no dash cells
  assert.doesNotMatch(css, /lv-none|lv-unc|\.lv-ini\b/);
  assert.match(css, /\.lv-iv\.lv-nil \{ display: inline-flex;/);
});
