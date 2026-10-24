import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildLive } from "../scripts/build-live.mjs";
import { infMedian, infDial, isTractor, tractorHint } from "../tractor.mjs";
import { autoMarksHtml, tractorMark } from "../auto-marks.mjs";
import { infUnit, classifyDeath, feedPush, censusStats, cellText, fmtGap, LIVE_COLS, tipText, ME_REFRESH_MS, mergeFresh, FEED_MAX, emojiFill, fillDriver, glowTier, unknownFill, FULL_AT, EMPTY_AT, goodPct, FILL_DIM, HOLLOW_PX, overlayPush, overlayRows, VICTIM_LINES, eventAt, EVENT_SKEW_MS, unitGlow, ZERG_GOLD_OVER, OUTLINE_PX } from "../live.mjs";

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

test("feedPush (owner t587u): every kill is its own line (repeats too), 7th drops the oldest, stopwatch freezes the old top", () => {
  let rows = [];
  rows = feedPush(rows, { kind: "kill", opp: "a" }, 1000).rows;
  assert.equal(rows[0].gap, null);
  rows = feedPush(rows, { kind: "death", opp: "b" }, 4000).rows;
  assert.equal(rows[1].gap, 3000);
  assert.equal(rows[0].gap, null);
  rows = feedPush(rows, { kind: "kill", opp: "a" }, 5000).rows;
  assert.deepEqual(rows.map((r) => r.opp), ["a", "b", "a"]); // a again = a new line on top, the old a line stays
  assert.equal(rows[1].gap, 1000); // b froze when a came back
  assert.equal(rows[2].gap, 3000); // the first a line keeps its own time
  rows = feedPush(rows, { kind: "kill", opp: "a" }, 7000).rows;
  assert.deepEqual(rows.map((r) => [r.opp, r.gap]), [["a", null], ["a", 2000], ["b", 1000], ["a", 3000]]);
  let dropped = null;
  for (const [i, o] of ["c", "d", "e", "f"].entries()) ({ rows, dropped } = feedPush(rows, { kind: "kill", opp: o }, 8000 + i));
  assert.equal(rows.length, FEED_MAX);
  assert.equal(FEED_MAX, 6); // owner t575u: back to 6 lines (victims)
  assert.equal(dropped.opp, "b"); // the oldest lines go first
  assert.deepEqual(rows.map((r) => r.opp), ["f", "e", "d", "c", "a", "a"]);
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
  assert.equal(FILL_DIM, 0.18); // t589u: dark greyscale interior
  const css = readFileSync(new URL("styles.css", root), "utf8");
  assert.match(css, /\.lv-e0 \{ filter: url\(#lvHollow\); \}/); // t589u: hollow silhouette, not a 25% copy
  assert.doesNotMatch(css, /\.lv-e0 \{ opacity/);
  assert.match(css, /\.lv-e1 \{ clip-path: inset\(calc\(var\(--it, 0%\) \+ var\(--ih, 100%\) \* \(100 - var\(--f, 0\)\) \/ 100\) -25% -25% -25%\); \}/); // fills from the bottom of the ink
  assert.match(css, /\.lv-ivc > \.lv-iv \{ display: inline-block; width: 4ch; font-variant-numeric: tabular-nums;/); // t564u: 4-digit room
  assert.doesNotMatch(css, /scale\(var\(--s/); // no rank-based sizes any more
  const js = readFileSync(new URL("live.mjs", root), "utf8");
  assert.doesNotMatch(js, /emojiScale|class="lv-v"/); // no size scaling, no number under the emoji
});

test("LIVE columns (owner t550u/t581u/t590u): iVi · 🏃 · 🦁 · 🛡️ · 🪖/🚜 · ☠️ K/D · 🪳 last — no 🤝 🔀 ⚡", () => {
  assert.deepEqual(LIVE_COLS.map((c) => c.id), ["adjs", "act", "pvs", "rf", "inf", "rkd", "zerg"]);
  assert.deepEqual(LIVE_COLS.map((c) => c.label.split(" ")[0]), ["⚔️", "🏃", "🦁", "🛡️", "🪖", "☠️", "🪳"]);
  // ⚔️ iVi = the number next to the name, the rest = emoji fill meters
  assert.deepEqual(LIVE_COLS.map((c) => c.mode), ["ivi", ...Array(6).fill("stack")]);
  // K/D: percentile fill (same p50 → p91 mapping as the others), not the value itself
  for (const id of ["rkd"]) {
    const c = LIVE_COLS.find((x) => x.id === id);
    assert.equal(c.fill, undefined, id);
    assert.equal(fillDriver(c, 5, 73), goodPct(c, 73), id); // driver = the player's percentile
  }
  const js = readFileSync(new URL("live.mjs", root), "utf8");
  // t590u: 🔀 Diff no longer computed on LIVE; not cached → Zerg unknown (full roach)
  assert.doesNotMatch(js, /aimGap|diffCol/);
  assert.match(js, /const v = c\.id === "zerg" \? null :/);
  assert.match(js, /listEl\.style\.setProperty\("--lv-n", String\(LIVE_COLS\.length - 1\)\)/);
});

test("hover values (owner t584u): short label + the real value, 'unknown' when missing, Diff too; no layout change", () => {
  const col = (id) => LIVE_COLS.find((c) => c.id === id);
  assert.equal(tipText(col("rkd"), 2.4), "K/D 2.40");
  assert.equal(tipText(col("zerg"), 41.2), "Zerg 41");
  assert.equal(tipText(col("inf"), 95.43), "Infantry 95.4%");
  assert.equal(tipText(col("adjs"), 1357.4), "iVi 1357");
  assert.equal(tipText(col("zerg"), null), "Zerg unknown");
  assert.equal(tipText(col("rkd"), NaN), "K/D unknown");
  for (const c of LIVE_COLS) assert.ok(c.tip && !/\p{Extended_Pictographic}/u.test(c.tip), c.id);
  const js = readFileSync(new URL("live.mjs", root), "utf8");
  const css = readFileSync(new URL("styles.css", root), "utf8");
  assert.equal((js.match(/data-tip="\$\{esc\(tipText\(c, (v|null)\)\)\}"/g) || []).length, 5); // every emoji + the iVi number + (t590u) the 🪖/🚜 unit — real infantry % on hover
  assert.doesNotMatch(js, /class="lv-(u|iv)[^"]*"[^>]*title=/);
  assert.match(css, /\.lv-tip \{ position: fixed; z-index: 50; pointer-events: none;/); // floats above, never takes space
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
  assert.deepEqual(st.victims.map((r) => r.opp), ["g", "f", "e", "d", "a", "c"]); // newest on top, max 6 (t587u: the first a is pushed out)
  assert.equal(st.lastEv.opp, "g");
  assert.equal(st.killer, null); // owner t576u: a kill clears the killer line
  assert.deepEqual(overlayRows(st).map((r) => r.opp), ["g", "f", "e", "d", "a", "c"]);
  st = overlayPush(st, { kind: "kill", opp: "g" }, 5000); // owner t587u: same victim again = a new line on top
  assert.deepEqual(st.victims.map((r) => r.opp), ["g", "g", "f", "e", "d", "a"]);
  assert.notEqual(st.victims[0], st.victims[1]);
  assert.equal(st.victims[0].gap, null); // only the new line runs
  assert.equal(st.victims[1].gap, 5000 - 4006); // the earlier g line keeps its own frozen time
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
  // one shared order: [time][name][iVi][🏃🦁🛡️🪖🪳] — the same cells() for killer, player and victims
  assert.match(js, /return `<td class="lv-nm">\$\{nameHtml\(p, tip\)\}<\/td>\$\{IVI\.map[^\n]*<td class="lv-ems"><span class="lv-row">\$\{REST\.map/);
  assert.match(js, /<tr><td class="lv-time">\$\{ageHtml\(r\)\}<\/td>\$\{cells\(p, false\)\}<\/tr>/);
  assert.match(js, /<tbody class="lv-ev lv-me\$\{fm\.cls\}"\$\{fm\.sty\}><tr><td class="lv-time"><\/td>\$\{cells\(me, true\)\}<\/tr><\/tbody>/);
  assert.match(js, /Array\.from\(\{ length: VICTIM_LINES \}, \(_, i\) => \(st\.victims\[i\] \? oppLine\(st\.victims\[i\], "vic"\) : emptyLine\("vic"\)\)\)/);
  assert.match(js, /listEl\.innerHTML = cols \+ atk \+ mid \+ low;/);
  assert.match(js, /const blank = `<td class="lv-nm"><\/td><td class="lv-ivc"><\/td><td class="lv-ems"><span class="lv-row"><\/span><\/td>`;/); // empty = same box
  assert.deepEqual([...js.matchAll(/<col class="(lv-c-[a-z]+)">/g)].map((m) => m[1]), ["lv-c-time", "lv-c-nm", "lv-c-iv", "lv-c-em"]);
  // fixed size: fixed layout, fixed line height, fixed column widths
  assert.match(css, /\.live-table \{[^}]*table-layout: fixed;/);
  assert.match(css, /\.live-table td \{[^}]*height: var\(--lv-ez\);[^}]*overflow: hidden;/);
  assert.match(css, /\.lv-row \{ display: flex; height: var\(--lv-ez\); \}/);
  assert.match(css, /col\.lv-c-em \{ width: calc\(var\(--lv-n\) \* var\(--lv-u\)\); \}/);
  assert.match(css, /--lv-n: 6;/); // t590u: 6 emoji units
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
  assert.match(js, /const g = unitGlow\(c, v, driverOf\(c, v\)\);/); // tiers use the fill's own driver (t577u: 🪳 > 35 gold)
  assert.doesNotMatch(js, /TOP_PCT|lv-top\b/);
  assert.match(js, /const UPSET_GAP = 50;/);
  assert.match(js, /fresh = newest && newest !== shown \? newest : null;/); // a re-render never replays the entrance
  assert.match(css, /\.lv-ev\.lv-new\.lv-death > tr > td \{ animation-name: lvPop, lvFlashD; \}/); // new killer: red flash
  assert.match(css, /\.lv-ev\.lv-new > tr > td \{ animation: lvPop [^;]*lvFlashK/); // new victim: pop + green flash
});

test("no value = empty 0% emoji, never a dash (owner t567u): stats, iVi, uncached players, skeleton row", () => {
  const js = readFileSync(new URL("live.mjs", root), "utf8");
  const css = readFileSync(new URL("styles.css", root), "utf8");
  assert.match(js, /const u = unknownFill\(c\);\n\s*const ug = unitGlow\(c, null\);\n\s*return `<span class="lv-u lv-fl lv-nil[^\n]*style="--f:\$\{u\}"[^\n]*\$\{meter\(shortLab\(c\), u\)\}/); // empty emoji (no "—"); t577u: unknown 🪳 = full + gold
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

test("killer line clears on a kill (owner t576u): kill after death empties the top, the next death fills it again", () => {
  let st = overlayPush(null, { kind: "death", opp: "k1" }, 1000);
  assert.equal(st.killer.opp, "k1");
  assert.equal(st.gone, null);
  st = overlayPush(st, { kind: "kill", opp: "v1" }, 5000);
  assert.equal(st.killer, null);
  assert.equal(st.gone.opp, "k1"); // the cleared killer, for its one fade-out
  assert.equal(st.gone.gap, 4000); // frozen at the time until the kill
  st = overlayPush(st, { kind: "kill", opp: "v2" }, 6000);
  assert.equal(st.killer, null);
  assert.equal(st.gone, null); // nothing left to fade
  st = overlayPush(st, { kind: "death", opp: "k2" }, 7000);
  assert.equal(st.killer.opp, "k2");
  assert.deepEqual(st.victims.map((r) => r.opp), ["v2", "v1"]);
  const js = readFileSync(new URL("live.mjs", root), "utf8");
  const css = readFileSync(new URL("styles.css", root), "utf8");
  assert.match(js, /const atk = st\.killer \? oppLine\(st\.killer, "atk"\) : fade \? oppLine\(st\.gone, "atk", " lv-out"\) : emptyLine\("atk"\);/);
  assert.match(css, /\.lv-ev\.lv-out > tr > td \{ animation: lvOut 0\.35s ease-in forwards; \}/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.lv-ev\.lv-out > tr > td \{ animation: none; opacity: 0; \} \}/);
});

test("⏱️ timer (owner t576u): the event's own time, one stopwatch — only the newest line runs, older lines freeze", () => {
  // Census stamps whole seconds; real events arrive ~0.1–1.1 s later (measured on the live stream)
  assert.equal(eventAt({ timestamp: "1000" }, 1000600), 1000000);
  assert.equal(eventAt({ timestamp: "1000" }, 1000000 + EVENT_SKEW_MS + 1), 1000000 + EVENT_SKEW_MS + 1); // PC clock far off → arrival time
  assert.equal(eventAt({ timestamp: "1002" }, 1000000), 1000000); // stamp in the future → arrival time
  assert.equal(eventAt({ timestamp: "1000" }, 999500), 999500); // within the 1 s rounding: never later than arrival
  assert.equal(eventAt({}, 42), 42);
  assert.equal(eventAt({ timestamp: "x" }, 42), 42);
  // the time comes from the event, not from when the name lookup finished
  let st = overlayPush(null, { kind: "kill", opp: "a", at: 1000 }, 9000);
  assert.equal(st.victims[0].at, 1000);
  assert.equal(st.victims[0].gap, null); // running
  st = overlayPush(st, { kind: "death", opp: "k", at: 4000 }, 9000);
  assert.equal(st.victims[0].gap, 3000); // a froze when the death came
  assert.equal(st.killer.gap, null); // the killer line runs
  st = overlayPush(st, { kind: "kill", opp: "b", at: 6500 }, 9000);
  assert.equal(st.gone.gap, 2500); // killer froze at the kill
  assert.deepEqual(st.victims.map((r) => [r.opp, r.gap]), [["b", null], ["a", 3000]]);
  assert.equal(overlayRows(st).filter((r) => r.gap == null).length, 1); // exactly one stopwatch runs
  const js = readFileSync(new URL("live.mjs", root), "utf8");
  assert.match(js, /if \(ev\) ev\.at = eventAt\(j\.payload\);/);
  assert.match(js, /const ageHtml = \(r\) => \(r\.gap == null \? `<span class="lv-timer" data-at="\$\{r\.at\}">\$\{fmtGap\(Date\.now\(\) - r\.at\)\}<\/span>` : fmtGap\(r\.gap\)\);/);
  assert.match(js, /evChain = evChain\.then\(\(\) => onEventNow\(ev\), \(\) => onEventNow\(ev\)\)/); // events keep their order
  assert.match(js, /el\.textContent = `\$\{fmtGap\(Date\.now\(\) - \+el\.dataset\.at\)\}`/); // ticks every second
});

test("🪳 Zerg gold (owner t577u): raw Zerg above 35 = top gold glow whatever its tier; unknown 🪳 (full roach) = full top glow", () => {
  const z = LIVE_COLS.find((c) => c.id === "zerg"), act = LIVE_COLS.find((c) => c.id === "act");
  assert.equal(ZERG_GOLD_OVER, 35);
  assert.equal(unitGlow(z, 36, 10), 3);
  assert.equal(unitGlow(z, 35, 10), 0); // not above 35 → its own tier
  assert.equal(unitGlow(z, 30, 75), 2);
  assert.equal(unitGlow(z, null), 3); // unknown → full top glow
  assert.equal(unitGlow(act, null), 0); // other unknowns: empty, no glow
  assert.equal(unitGlow(act, 80, 95), 3);
  assert.equal(unitGlow(act, 80, 60), 1);
  const js = readFileSync(new URL("live.mjs", root), "utf8");
  assert.match(js, /const g = unitGlow\(c, v, driverOf\(c, v\)\);/);
  assert.match(js, /const ug = unitGlow\(c, null\);\n\s*return `<span class="lv-u lv-fl lv-nil\$\{ug \? ` lv-g\$\{ug\}` : ""\}"/);
});

test("emoji fill grows 0 → level over 5 s when a line appears (owner t578u); glow fades in late; reduced motion = final fill", () => {
  const js = readFileSync(new URL("live.mjs", root), "utf8");
  const css = readFileSync(new URL("styles.css", root), "utf8");
  assert.match(css, /@property --f \{ syntax: "<number>"; inherits: true; initial-value: 0; \}/);
  assert.match(css, /@property --gw \{ syntax: "<number>"; inherits: true; initial-value: 1; \}/);
  assert.match(css, /\.lv-fillin \.lv-u \{ animation: lvFill 10s cubic-bezier\([^)]*\) var\(--fd, 0ms\) both; \}/);
  assert.match(css, /@keyframes lvFill \{ 0% \{ --f: 0; --gw: 0; \} 80% \{ --gw: 0;/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.lv-fillin \.lv-u \{ animation: none; \} \}/);
  assert.match(css, /rgba\(255, 214, 90, calc\(0\.95 \* var\(--gw, 1\)\)\)/); // glow scaled by --gw
  assert.match(js, /const FILL_MS = 10000;/);
  assert.match(js, /return played >= FILL_MS \? NO_FILL : \{ cls: " lv-fillin", sty: ` style="--fd:-\$\{played\}ms"` \};/); // re-renders continue, never restart
  assert.match(js, /fillIn\(`\$\{r\.opp\}@\$\{r\.at\}:\$\{\(people\.get\(r\.opp\) \|\| \{\}\)\.cached \? "c" : "u"\}`\)/); // stats arriving later = a new fill
  assert.match(js, /fillIn\(`me:\$\{me\.cached \? "c" : "u"\}`\)/);
});

test("emoji outline (owner t579u): a dark ring that hugs the whole silhouette, the faint part too; no layout change", () => {
  const js = readFileSync(new URL("live.mjs", root), "utf8");
  const css = readFileSync(new URL("styles.css", root), "utf8");
  assert.ok(OUTLINE_PX >= 2 && OUTLINE_PX <= 2.5); // t581u: bolder
  assert.match(js, /<feGaussianBlur in="grown" stdDeviation="0\.7" result="soft"\/><feComponentTransfer in="soft" result="even"><feFuncA type="linear" slope="4" intercept="-1"\/>/); // even, round edge
  assert.match(js, /<b class="lv-e lv-eo">\$\{e\}<\/b><b class="lv-e lv-e0">/); // outline copy under the faint + filled copies
  assert.match(js, /<feMorphology in="SourceAlpha" operator="dilate" radius="\$\{OUTLINE_PX\}"/);
  assert.match(js, /<feComposite in="ring" in2="SourceAlpha" operator="out"\/>/); // ring only, the emoji itself stays untouched
  assert.match(css, /\.lv-eo \{ filter: url\(#lvOutline\); \}/);
});

test("🪖 / 🚜 infantry dial (owner t590u): median from the data, 🪖 fills M → 100, 🚜 fills M → M/2, glow follows the fill", () => {
  const j = JSON.parse(readFileSync(new URL("data/ranks.json", root), "utf8"));
  const ii = j.cols.indexOf("inf");
  const M = infMedian(j.rows.map((r) => r[ii]).filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b));
  assert.ok(M > 70 && M < 95, String(M)); // real data: 85.1 on 2026-10-24
  assert.equal(infMedian([3, 1, 2].sort()), 2);
  assert.equal(infMedian([1, 2, 3, 4]), 2.5);
  assert.equal(infMedian([]), null);
  const m = 85;
  assert.deepEqual(infDial(100, m), { emoji: "🪖", tractor: false, fill: 100 });
  assert.deepEqual(infDial(85, m), { emoji: "🪖", tractor: false, fill: 0 }); // at the median: 🪖, empty
  assert.equal(infDial(92.5, m).fill, 50);
  assert.deepEqual(infDial(84.9, m), { emoji: "🚜", tractor: true, fill: 0.2 }); // just under: least-filled tractor
  assert.equal(infDial(63.75, m).fill, 50);
  assert.deepEqual(infDial(42.5, m), { emoji: "🚜", tractor: true, fill: 100 }); // half the median: full
  assert.equal(infDial(5, m).fill, 100); // clamped
  assert.equal(infDial(null, m), null);
  assert.equal(infDial(90, null), null);
  // glow tiers follow the fill on the same thresholds (fill 0 = EMPTY_AT … 100 = FULL_AT)
  assert.equal(infUnit(100, m).glow, 3);
  assert.equal(infUnit(42.5, m).glow, 3); // full 🚜 = shiny
  assert.equal(infUnit(84.9, m).glow, 0);
  assert.equal(infUnit(85, m).glow, 0);
  assert.equal(infUnit(63.75, m).glow, glowTier(EMPTY_AT + 0.5 * (FULL_AT - EMPTY_AT)));
  assert.equal(infUnit(null, m), null);
  const js = readFileSync(new URL("live.mjs", root), "utf8");
  assert.match(js, /infM = infMedian\(pools\.inf\);/);
  assert.match(js, /meter\(iu\.emoji, iu\.fill\)/);
  // main site (t591u–t593u): a static 🚜 NAME mark next to 🪦 (auto-marks.mjs), Infantry cell unchanged, 2-line hint
  assert.equal(isTractor(84.9, m), true);
  assert.equal(isTractor(85, m), false);
  assert.equal(tractorMark({ inf: 90, med: m }), null);
  assert.equal(tractorMark(null), null);
  assert.deepEqual(tractorMark({ inf: 60, med: m }), { id: "tractor", mark: "🚜", tip: tractorHint(m) });
  assert.match(tractorHint(m), /^🚜 Tractor mark[^\n]+\n[^\n]+\(85\.0%\)\.(\n[^\n]+)?$/); // t597u: 2-3 lines, not the iVi cut / Diff damp 🚜
  const now = Date.UTC(2026, 9, 24), s = now / 1000, day = 86400;
  const h = autoMarksHtml(null, { score: 90, rvp: 99, confirmed: true }, { created: s - 3000 * day, last: s - 400 * day }, now, null, { inf: 50, med: m });
  assert.match(h, /auto-mark-zerg.*🪳.*<span class="poop-mark auto-mark auto-mark-tractor" title="🚜 [^"]+" aria-label="🚜 [^"]+">🚜<\/span><span class="poop-mark auto-mark auto-mark-inactive"[^>]*>🪦/s); // order 🪳 🐣 🚜 🪦
  assert.doesNotMatch(autoMarksHtml(null, null, null, now, null, { inf: 90, med: m }), /🚜/);
  const app = readFileSync(new URL("app.js", root), "utf8");
  const rk = readFileSync(new URL("rankings.mjs", root), "utf8");
  assert.match(app, /nbhOf\(d, row\.p\), ie \? \{ inf: ie\.inf, med: infMed \} : null\)/);
  assert.match(rk, /r\.nbh, fin\(r\.inf\) \? \{ inf: r\.inf, med: infMed\(\) \} : null\)/);
  assert.doesNotMatch(app + rk, /inf-trac/); // nothing in the Infantry cell
  for (const l of ["en", "ja", "ru", "de", "fr", "zh", "es", "uk", "it"]) {
    const d = JSON.parse(readFileSync(new URL(`i18n/${l}.json`, root), "utf8"));
    const lines = d["inf.tractor"].split("\n");
    assert.ok(lines.length >= 2 && lines.length <= 3 && lines.every((x) => x.length <= 60), l);
    assert.ok(d["inf.tractor"].startsWith("🚜") && d["inf.tractor"].includes("{m}"), l);
    assert.ok(d["cp.infTractor"].includes("🚜"), l);
  }
  assert.match(readFileSync(new URL("columns.html", root), "utf8"), /data-i18n="cp\.infTractor"/);
});

test("hollow empty part (owner t589u): light inner ring inside the black outline, dark greyscale interior, filled part untouched", () => {
  const js = readFileSync(new URL("live.mjs", root), "utf8");
  assert.ok(HOLLOW_PX >= 1.5 && HOLLOW_PX <= 2);
  assert.ok(FILL_DIM >= 0.15 && FILL_DIM <= 0.2);
  assert.match(js, /<filter id="lvHollow"[^`]*type="matrix" values="0\.13 0\.43 0\.04 0 0 0\.13 0\.43 0\.04 0 0 0\.13 0\.43 0\.04 0 0 0 0 0 \$\{FILL_DIM\} 0"/); // greyscale, darkened
  assert.match(js, /<feMorphology in="SourceAlpha" operator="erode" radius="\$\{HOLLOW_PX\}" result="inner"\/><feComposite in="SourceAlpha" in2="inner" operator="out" result="edge"\/>/); // ring just inside
  assert.match(js, /<feMergeNode in="dim"\/><feMergeNode in="rim"\/>/);
  assert.match(js, /\$\{HOLLOW_FILTER\}<\/svg>/); // in the same hidden svg as #lvOutline
  assert.match(js, /<b class="lv-e lv-e1">\$\{e\}<\/b>/); // the filled copy has no filter: full colour, solid
});

test("centre refresh (owner t586u): fresh Census numbers every 5 min, paused while hidden, never shared or saved", () => {
  assert.equal(ME_REFRESH_MS, 5 * 60000); // measured: 9 Census calls + 0 Honu per refresh → 5 min, not 1
  assert.deepEqual(mergeFresh({ adjs: 400, zerg: 41, apk: 0.3 }, { adjs: 455, zerg: null, apk: null, rf: NaN }), { adjs: 455, zerg: 41, apk: 0.3 });
  assert.deepEqual(mergeFresh(null, { adjs: 455 }), { adjs: 455 });
  const js = readFileSync(new URL("live.mjs", root), "utf8");
  const app = readFileSync(new URL("app.js", root), "utf8");
  const fn = js.slice(js.indexOf("async function refreshMe()"), js.indexOf("function meRefreshLoop()"));
  assert.match(fn, /document\.hidden\) return;/);
  assert.match(fn, /a\.fetchPlayerFresh\(me\.name\)/);
  assert.doesNotMatch(fn, /onBgFetched|queueSharedCache|cachePut|sharePending/);
  assert.match(js, /if \(!document\.hidden && Date\.now\(\) >= meNext\) refreshMe\(\);/);
  const api = app.slice(app.indexOf("fetchPlayerFresh: async"), app.indexOf("getLastAnalyzedNames:"));
  assert.match(api, /return loadLive\(name\);/);
  assert.doesNotMatch(api, /cachePut|suggestSharedCache/);
  const css = readFileSync(new URL("styles.css", root), "utf8");
  assert.match(css, /\.lv-u\.lv-ease \{ transition: --f 1\.2s/);
});
