import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildLive } from "../scripts/build-live.mjs";
import { classifyDeath, feedPush, censusStats, cellText, fmtGap, LIVE_COLS, FEED_MAX, emojiFill, fillDriver, glowTier, unknownFill, FULL_AT, EMPTY_AT, goodPct, FILL_DIM, overlayPush, overlayRows, VICTIM_LINES } from "../live.mjs";

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

test("feedPush: no repeats, 7th victim drops the oldest, stopwatch freezes the old top", () => {
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
  for (const [i, o] of ["c", "d", "e", "f", "g", "h"].entries()) ({ rows, dropped } = feedPush(rows, { kind: "kill", opp: o }, 6000 + i));
  assert.equal(rows.length, FEED_MAX);
  assert.equal(FEED_MAX, 6); // owner t575u: back to 6 lines (victims)
  assert.equal(dropped.opp, "a"); // b went first, then a
  assert.equal(rows[0].opp, "h");
  assert.deepEqual(rows.map((r) => r.opp), ["h", "g", "f", "e", "d", "c"]);
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

test("emoji fill meter (owner t564u): one size, p50 and below empty / p70.5 half / p91+ full (t573u); 🪖 by infantry %, 🪳 by raw-Zerg percentile", () => {
  const act = LIVE_COLS.find((c) => c.id === "act");
  const zerg = LIVE_COLS.find((c) => c.id === "zerg");
  const inf = LIVE_COLS.find((c) => c.id === "inf");
  for (const c of LIVE_COLS) assert.ok(!c.lowerBetter, c.id);
  // owner t573u: fill = clamp((driver - 50) / (91 - 50), 0, 1) — p50 and below empty, p91+ (and 91%+ infantry) solid
  assert.equal(FULL_AT, 91);
  assert.equal(EMPTY_AT, 50);
  assert.equal(emojiFill(act, 1.2, 0), 0);
  assert.equal(emojiFill(act, 1.2, 50), 0); // p50 = empty (the no-glow tier)
  assert.equal(emojiFill(act, 1.2, 51), 2.4);
  assert.equal(emojiFill(act, 1.2, 70.5), 50); // halfway
  assert.equal(emojiFill(act, 1.2, 90), 97.6);
  assert.equal(emojiFill(act, 1.2, 91), 100);
  assert.equal(emojiFill(act, 1.2, 99), 100);
  assert.equal(emojiFill(zerg, 40, 80), 73.2); // higher raw Zerg → higher percentile → more fill
  assert.equal(fillDriver(zerg, 40, 80), 80);
  assert.equal(emojiFill(inf, 50, 99), 0); // 🪖 by the infantry % itself, same 50..91 rule
  assert.equal(emojiFill(inf, 70.5, 3), 50);
  assert.equal(emojiFill(inf, 91, 3), 100);
  assert.equal(emojiFill(inf, 120, 99), 100);
  assert.equal(fillDriver(inf, 120, 99), 100);
  const apk = { id: "x", lowerBetter: true }; // the generic reversed mapping still works
  assert.equal(fillDriver(apk, 1, 10), 89);
  assert.equal(emojiFill(apk, 1, 10), 95.1);
  // owner t568u glow tiers: TOP 91+, HIGH 71–90, AVERAGE 51–70, none ≤ 50 / missing
  assert.deepEqual([null, NaN, 0, 50, 51, 70, 70.9, 71, 90, 90.9, 91, 99, 100].map(glowTier), [0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]);
  assert.equal(goodPct(apk, 10), 89);
  assert.equal(emojiFill(act, null, 50), null);
  assert.equal(emojiFill(act, NaN, 50), null);
  assert.equal(FILL_DIM, 0.25);
  const css = readFileSync(new URL("styles.css", root), "utf8");
  assert.match(css, /\.lv-e0 \{ opacity: 0\.25; \}/);
  assert.match(css, /\.lv-e1 \{ clip-path: inset\(calc\(var\(--it, 0%\) \+ var\(--ih, 100%\) \* \(100 - var\(--f, 0\)\) \/ 100\) -25% -25% -25%\); \}/); // fills from the bottom of the ink
  assert.match(css, /\.lv-ivc > \.lv-iv \{ display: inline-block; width: 4ch; font-variant-numeric: tabular-nums;/); // t564u: 4-digit room
  assert.doesNotMatch(css, /scale\(var\(--s/); // no rank-based sizes any more
  const js = readFileSync(new URL("live.mjs", root), "utf8");
  assert.doesNotMatch(js, /emojiScale|class="lv-v"/); // no size scaling, no number under the emoji
});

test("LIVE columns (owner t550u): iVi, Activity, Brave, Resist, Zerg, Infantry in that order", () => {
  assert.deepEqual(LIVE_COLS.map((c) => c.id), ["adjs", "act", "pvs", "rf", "zerg", "inf"]);
  assert.deepEqual(LIVE_COLS.map((c) => c.label.split(" ")[0]), ["⚔️", "🏃", "🦁", "🛡️", "🪳", "🪖"]);
  // ⚔️ iVi = the number next to the name, the rest = emoji fill meters
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

test("overlay (owner t575u): one killer line above (each new killer replaces it), the player in the centre, 6 victims below", () => {
  assert.equal(VICTIM_LINES, 6);
  let st = overlayPush(null, { kind: "kill", opp: "a" }, 1000);
  assert.equal(st.killer, null);
  assert.deepEqual(st.victims.map((r) => r.opp), ["a"]);
  assert.equal(st.lastEv, st.victims[0]);
  st = overlayPush(st, { kind: "death", opp: "k1", headshot: true }, 2000);
  assert.equal(st.killer.opp, "k1");
  assert.equal(st.killer.headshot, true);
  assert.equal(st.lastEv, st.killer);
  assert.deepEqual(st.victims.map((r) => r.opp), ["a"]); // a death never touches the victims
  st = overlayPush(st, { kind: "death", opp: "k2" }, 3000);
  assert.equal(st.killer.opp, "k2"); // only one line above
  for (const [i, o] of ["b", "c", "a", "d", "e", "f", "g"].entries()) st = overlayPush(st, { kind: "kill", opp: o }, 4000 + i);
  assert.deepEqual(st.victims.map((r) => r.opp), ["g", "f", "e", "d", "a", "c"]); // newest on top, no repeats, max 6
  assert.equal(st.lastEv.opp, "g");
  assert.equal(st.killer.opp, "k2");
  assert.deepEqual(overlayRows(st).map((r) => r.opp), ["k2", "g", "f", "e", "d", "a", "c"]);
  assert.deepEqual(overlayRows(null), []);
  assert.deepEqual(overlayRows(overlayPush(null, { kind: "kill", opp: "x" }, 0)).map((r) => r.opp), ["x"]);
});

test("overlay layout (owner t575u): no flip, ONE column order on every line, fixed 1 + 1 + 6 lines, a marked centre line", () => {
  const js = readFileSync(new URL("live.mjs", root), "utf8");
  const css = readFileSync(new URL("styles.css", root), "utf8");
  // no flip / phase / mirroring code left
  assert.doesNotMatch(js, /phaseAt|PHASE_A_MS|PHASE_B_MS|lv-phB|setPhase|lv-pa|lv-pb|lv-bL|lv-bR|reverse\(\)|letter\(/);
  assert.doesNotMatch(css, /lv-phB|lv-pa\b|lv-pb\b|lv-bL|lv-bR|lv-li\b|lv-blk|rotateX/);
  assert.doesNotMatch(js, /❯|lv-arrow|<thead/);
  // one shared order: [time][name][iVi][🏃🦁🛡️🪳🪖] — the same cells() for killer, player and victims
  assert.match(js, /return `<td class="lv-nm">\$\{nameHtml\(p, tip\)\}<\/td>\$\{IVI\.map[^\n]*<td class="lv-ems"><span class="lv-row">\$\{REST\.map/);
  assert.match(js, /<tr><td class="lv-time">\$\{ageHtml\(r\)\}<\/td>\$\{cells\(p, false\)\}<\/tr>/);
  assert.match(js, /<tbody class="lv-ev lv-me"><tr><td class="lv-time"><\/td>\$\{cells\(me, true\)\}<\/tr><\/tbody>/);
  assert.match(js, /oppLine\(st\.killer, "atk"\) : emptyLine\("atk"\)/);
  assert.match(js, /Array\.from\(\{ length: VICTIM_LINES \}, \(_, i\) => \(st\.victims\[i\] \? oppLine\(st\.victims\[i\], "vic"\) : emptyLine\("vic"\)\)\)/);
  assert.match(js, /listEl\.innerHTML = cols \+ atk \+ mid \+ low;/);
  assert.match(js, /const blank = `<td class="lv-nm"><\/td><td class="lv-ivc"><\/td><td class="lv-ems"><span class="lv-row"><\/span><\/td>`;/); // empty = same box
  assert.deepEqual([...js.matchAll(/<col class="(lv-c-[a-z]+)">/g)].map((m) => m[1]), ["lv-c-time", "lv-c-nm", "lv-c-iv", "lv-c-em"]);
  // fixed size: fixed layout, fixed line height, fixed column widths
  assert.match(css, /\.live-table \{[^}]*table-layout: fixed;/);
  assert.match(css, /\.live-table td \{[^}]*height: var\(--lv-ez\);[^}]*overflow: hidden;/);
  assert.match(css, /\.lv-row \{ display: flex; height: var\(--lv-ez\); \}/);
  assert.match(css, /col\.lv-c-em \{ width: calc\(5 \* var\(--lv-u\)\); \}/);
  // the centre line is set apart (accent rules above and below, a tint)
  assert.match(css, /tbody\.lv-me > tr > td \{ background-color: color-mix\(in srgb, var\(--accent\) 13%, var\(--panel\)\); border-top: 2px solid var\(--accent\); border-bottom: 2px solid var\(--accent\); \}/);
  assert.match(css, /\.live-table \.lv-name \{[^}]*text-overflow: ellipsis;/);
  // a 1 s ticking age on the opponent lines
  assert.match(js, /\.lv-timer\[data-at\]/);
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
  assert.doesNotMatch(css, /rotateX/); // owner t575u: no flip any more
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.lv-ev\.lv-new > tr > td/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.lv-g1 > \.lv-em, \.lv-g2 > \.lv-em, \.lv-g3 > \.lv-em \{ animation: none; \} \.lv-g3::after \{ animation: none; opacity: 0\.85; \} \}/); // static glow, no pulse
  assert.match(css, /\.lv-g3::after \{ content: "✦"; position: absolute;/); // sparkle never takes layout room
  assert.doesNotMatch(css, /lv-top\b/);
  const js = readFileSync(new URL("live.mjs", root), "utf8");
  assert.match(js, /const g = glowTier\(driverOf\(c, v\)\);/); // tiers use the fill's own driver
  assert.doesNotMatch(js, /TOP_PCT|lv-top\b/);
  assert.match(js, /const UPSET_GAP = 50;/);
  assert.match(js, /fresh = newest && newest !== shown \? newest : null;/); // a re-render never replays the entrance
  assert.match(css, /\.lv-ev\.lv-new\.lv-death > tr > td \{ animation-name: lvPop, lvFlashD; \}/); // new killer: red flash
  assert.match(css, /\.lv-ev\.lv-new > tr > td \{ animation: lvPop [^;]*lvFlashK/); // new victim: pop + green flash
});

test("no value = empty 0% emoji, never a dash (owner t567u): stats, iVi, uncached players, skeleton row", () => {
  const js = readFileSync(new URL("live.mjs", root), "utf8");
  const css = readFileSync(new URL("styles.css", root), "utf8");
  assert.match(js, /const u = unknownFill\(c\);\n\s*return `<span class="lv-u lv-fl lv-nil" style="--f:\$\{u\}"[^`]*\$\{meter\(shortLab\(c\), u\)\}/); // empty emoji (no "—"), no glow class
  // owner t569u: unknown 🪳 Zerg = full roach (display only); every other missing stat stays empty
  for (const c of LIVE_COLS) assert.equal(unknownFill(c), c.id === "zerg" ? 100 : 0, c.id);
  assert.equal(emojiFill(LIVE_COLS.find((c) => c.id === "zerg"), null, 50), null); // the value itself stays unknown
  assert.match(js, /if \(fillOf\(c, v\) == null\) return `<span class="lv-iv lv-nil" style="--f:0"[^`]*\$\{meter\(shortLab\(c\), 0\)\}/); // empty ⚔️ in the iVi box
  assert.match(js, /\$\{f > 0 \? `<b class="lv-e lv-e1">/); // 0% = only the 25% copy
  assert.match(js, /const vals = p\.cached \|\| \{\};/); // uncached too
  assert.match(js, /IVI\.map\(\(c\) => `<td class="lv-ivc">\$\{iviText\(c, vals\[c\.id\]\)\}<\/td>`\)/);
  assert.match(js, /REST\.map\(\(c\) => unit\(c, vals\[c\.id\]\)\)/);
  assert.doesNotMatch(js, /lv-none|lv-unc|>—<\/span>/); // no K/D-over-KPM text, no dash cells
  assert.doesNotMatch(css, /lv-none|lv-unc|\.lv-ini\b/);
  assert.match(css, /\.lv-iv\.lv-nil \{ display: inline-flex;/);
});
