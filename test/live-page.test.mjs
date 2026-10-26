import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { buildLive } from "../scripts/build-live.mjs";
import { infMedian, infDial, isTractor, tractorHint, tractorCuts, tractorRule, tractorMarked, tractorCleared, tracXpIds, tracSample } from "../tractor.mjs";
import { autoMarksHtml, tractorMark } from "../auto-marks.mjs";
import { infUnit, classifyDeath, feedPush, censusStats, cellText, fmtGap, LIVE_COLS, tipText, ME_REFRESH_MS, mergeFresh, FEED_MAX, emojiFill, fillDriver, glowTier, unknownFill, FULL_AT, EMPTY_AT, goodPct, FILL_DIM, HOLLOW_PX, overlayPush, overlayRows, VICTIM_LINES, eventAt, EVENT_SKEW_MS, unitGlow, ZERG_GOLD_OVER, OUTLINE_PX, LIVE_GLOWS, weaponIcon, CARD_CATEGORIES, LIVE_FPS, liveFps, HALO_KEY, haloOn, bezier, easeFill, glowIn, BEAT, TIER_MOTION, beatAt, haloAt, SHINE, shineFrame, beatSleep } from "../live.mjs";
import { disk, dilate, erode, blurAlpha, inkBox, outlineMasks, hollowRim, spriteCss, shineAt } from "../live-sprites.mjs";
import { appSource } from "./app-source.mjs";

const root = new URL("../", import.meta.url);
// #66: live.mjs = the browser part + live-model.mjs (the pure part, moved out unchanged); source checks read both
// live CSS = styles.css + live.css (the live page's own rules, moved out unchanged, #66)
const cssSrc = () => readFileSync(new URL("styles.css", root), "utf8") + "\n" + readFileSync(new URL("live.css", root), "utf8");
const liveSrc = () => readFileSync(new URL("live.mjs", root), "utf8") + "\n" + readFileSync(new URL("live-model.mjs", root), "utf8");

test("live.html is built from index.html (run node scripts/build-live.mjs)", () => {
  const want = buildLive(readFileSync(new URL("index.html", root), "utf8"));
  assert.equal(readFileSync(new URL("live.html", root), "utf8"), want);
});

test("classifyDeath: kill, death, suicide, unrelated", () => {
  const d = (att, vic, hs = "0") => ({ event_name: "Death", attacker_character_id: att, character_id: vic, is_headshot: hs });
  assert.deepEqual(classifyDeath(d("1", "2", "1"), "1"), { kind: "kill", opp: "2", headshot: true, weapon: null });
  assert.deepEqual(classifyDeath(d("2", "1"), "1"), { kind: "death", opp: "2", headshot: false, weapon: null });
  // 2026-10-24: the killer's weapon (Census item id) rides along; "0" / missing / junk = no weapon
  assert.equal(classifyDeath({ ...d("1", "2"), attacker_weapon_id: "80" }, "1").weapon, "80");
  assert.equal(classifyDeath({ ...d("2", "1"), attacker_weapon_id: "0" }, "1").weapon, null);
  assert.equal(classifyDeath({ ...d("2", "1"), attacker_weapon_id: "x7" }, "1").weapon, null);
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
  const css = cssSrc();
  assert.match(css, /\.live-mode #chartSection \{ display: none !important; \}/);
  const js = liveSrc();
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
  const css = cssSrc();
  // the solid picture shows the bottom --f % of the ink: its window sits on the ink (--it/--ih) and moves down by (100 − f)%
  assert.match(css, /\.lv-sw \{ left: 0; right: 0; top: var\(--it, 0px\); height: var\(--ih, 100%\); overflow: hidden; transform: translateY\(calc\(var\(--ih, 0px\) \* \(100 - var\(--f, 0\)\) \/ 100\)\); \}/);
  assert.match(css, /\.lv-s \{[^}]*transform: translateY\(calc\(var\(--ih, 0px\) \* \(var\(--f, 0\) - 100\) \/ 100\)\); \}/); // the picture itself stays put
  assert.doesNotMatch(css, /filter: url\(#lv/); // 2026-10-24: no SVG filters re-run per frame
  assert.match(css, /\.lv-ivc > \.lv-iv \{ display: inline-block; width: 4ch; font-variant-numeric: tabular-nums;/); // t564u: 4-digit room
  assert.doesNotMatch(css, /scale\(var\(--s/); // no rank-based sizes any more
  const js = liveSrc();
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
  const js = liveSrc();
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
  const js = liveSrc();
  const css = cssSrc();
  assert.equal((js.match(/data-tip="\$\{esc\(tipText\(c, (v|null)\)\)\}"/g) || []).length, 5); // every emoji + the iVi number + (t590u) the 🪖/🚜 unit — real infantry % on hover
  assert.doesNotMatch(js, /class="lv-(u|iv)[^"]*"[^>]*title=/);
  assert.match(css, /\.lv-tip \{ position: fixed; z-index: 50; pointer-events: none;/); // floats above, never takes space
});

test("LIVE: no distribution chart, no title once kills arrive, a themed background", () => {
  const css = cssSrc();
  assert.match(css, /\.live-mode #distSection,\n\.live-mode #weaponsSection \{ display: none !important; \}/);
  assert.match(css, /\.live-state:empty \{ display: none; \}/);
  assert.match(css, /background: var\(--panel\)/);
  const js = liveSrc();
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
  const js = liveSrc();
  const css = cssSrc();
  // no flip / phase / mirroring code left
  assert.doesNotMatch(js, /phaseAt|PHASE_A_MS|PHASE_B_MS|lv-phB|setPhase|lv-pa|lv-pb|lv-bL|lv-bR|reverse\(\)|letter\(/);
  assert.doesNotMatch(css, /lv-phB|lv-pa\b|lv-pb\b|lv-bL|lv-bR|lv-li\b|lv-blk|rotateX/);
  assert.doesNotMatch(js, /❯|lv-arrow|<thead/);
  // one shared order: [time][name][iVi][🏃🦁🛡️🪖🪳] — the same cells() for killer, player and victims
  assert.match(js, /<td class="lv-nm"><span class="lv-nm2">\$\{nameHtml\(p, tip, hsHtml\(r\)\)\}\$\{wn\}/);
  assert.match(js, /<tr><td class="lv-time">\$\{ageHtml\(r\)\}<\/td>\$\{cells\(p, false, r\)\}<\/tr>/);
  assert.match(js, /<tbody class="lv-ev lv-me\$\{fm\.cls\}"\$\{fm\.sty\}><tr><td class="lv-time"><\/td>\$\{cells\(me, true\)\}<\/tr><\/tbody>/);
  assert.match(js, /Array\.from\(\{ length: VICTIM_LINES \}, \(_, i\) => \(st\.victims\[i\] \? oppLine\(st\.victims\[i\], "vic"\) : emptyLine\("vic"\)\)\)/);
  assert.match(js, /listEl\.innerHTML = cols \+ atk \+ mid \+ low;/);
  assert.match(js, /const blank = `<td class="lv-nm"><\/td><td class="lv-ivc"><\/td><td class="lv-iz"><\/td>`;/); // empty = same box
  assert.deepEqual([...js.matchAll(/<col class="(lv-c-[a-z]+)">/g)].map((m) => m[1]), ["lv-c-time", "lv-c-nm", "lv-c-iv", "lv-c-iz"]);
  // fixed size: fixed layout, fixed line height, fixed column widths
  assert.match(css, /\.live-table \{[^}]*table-layout: fixed;/);
  assert.match(css, /\.live-table td \{[^}]*height: var\(--lv-ez\);[^}]*overflow: hidden;/);
  assert.match(css, /\.lv-row \{ display: flex; height: var\(--lv-ez\); \}/);
  assert.match(css, /col\.lv-c-iz \{ width: var\(--lv-iz\); \}/);
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
  const css = cssSrc();
  for (const k of ["lvPop", "lvFlash", "lvShake"]) assert.match(css, new RegExp(`@keyframes ${k} `));
  // owner 2026-10-24: no endless CSS pulses (they were most of the CPU); the tiers move on live.mjs's 30 fps beat instead
  for (const k of ["lvGlow", "lvGlow1", "lvGlow2", "lvSpark", "lvFlashK", "lvFlashD", "lvFlashU"]) assert.doesNotMatch(css, new RegExp(`@keyframes ${k} `));
  const liveCss = readFileSync(new URL("live.css", root), "utf8"); // the live page's own rules (#66)
  assert.deepEqual([...liveCss.matchAll(/animation:[^;]*infinite/g)].map((m) => m[0]), ["animation: liveBlink 1.2s ease-in-out infinite"]); // only the "waiting…" dot
  assert.doesNotMatch(liveCss, /animation[^;]*box-shadow|@keyframes [^{]*\{[^}]*box-shadow/); // flashes fade by opacity, no repaint per frame
  assert.doesNotMatch(css, /rotateX/); // owner t575u: no flip any more
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.lv-ev\.lv-new > tr > td, \.lv-ev\.lv-new > tr > td::after/);
  assert.doesNotMatch(css, /\.lv-g3::after|✦";/); // owner 2026-10-24: the ✦ star is replaced by the gold shine
  // the t568u tier colours: green / blue / gold (+ an orange outer halo on gold); each tier's halo reaches further
  assert.equal(LIVE_GLOWS.length, 3);
  assert.deepEqual(LIVE_GLOWS.map((t) => t[0].color), [[120, 230, 140], [80, 170, 255], [255, 226, 120]]);
  assert.deepEqual(LIVE_GLOWS[2][1].color, [255, 170, 30]);
  for (const t of LIVE_GLOWS) { assert.ok(t[0].alpha > 0.5 && t[0].alpha <= 1); for (const l of t) assert.ok(l.blur > 0 && l.blur < 1 && l.alpha > 0 && l.alpha <= 1); }
  const reach = LIVE_GLOWS.map((t) => Math.max(...t.map((l) => l.blur)));
  assert.ok(reach[0] < reach[1] && reach[1] < reach[2], `green < blue < gold: ${reach}`);
  assert.doesNotMatch(css, /lv-top\b/);
  const js = liveSrc();
  assert.match(js, /const g = unitGlow\(c, v, driverOf\(c, v\)\);/); // tiers use the fill's own driver (t577u: 🪳 > 35 gold)
  assert.doesNotMatch(js, /TOP_PCT|lv-top\b/);
  assert.match(js, /const UPSET_GAP = 50;/);
  assert.match(js, /fresh = newest && newest !== shown \? newest : null;/); // a re-render never replays the entrance
  assert.match(css, /\.lv-ev\.lv-new\.lv-death > tr > td::after \{ background: rgba\(229, 57, 53, 0\.28\); \}/); // new killer: red flash
  assert.match(css, /\.lv-ev\.lv-new > tr > td \{ animation: lvPop /); // new line: pop …
  assert.match(css, /\.lv-ev\.lv-new > tr > td::after \{[^}]*background: rgba\(67, 160, 71, 0\.32\); animation: lvFlash 0\.8s ease-out; \}/); // … + green flash
  assert.match(css, /\.lv-ev\.lv-new\.lv-upset > tr > td::after \{ background: rgba\(255, 193, 7, 0\.4\); animation-duration: 1\.1s; \}/); // upset: gold
});

test("no value = empty 0% emoji, never a dash (owner t567u): stats, iVi, uncached players, skeleton row", () => {
  const js = liveSrc();
  const css = cssSrc();
  assert.match(js, /const u = unknownFill\(c\);\n\s*const ug = unitGlow\(c, null\);\n\s*return `<span class="lv-u lv-fl lv-nil[^\n]*style="--f:\$\{u\}"[^\n]*\$\{meter\(shortLab\(c\)\)\}/); // empty emoji (no "—"); t577u: unknown 🪳 = full + gold
  // owner t569u: unknown 🪳 Zerg = full roach (display only); every other missing stat stays empty
  for (const c of LIVE_COLS) assert.equal(unknownFill(c), c.id === "zerg" ? 100 : 0, c.id);
  assert.equal(emojiFill(LIVE_COLS.find((c) => c.id === "zerg"), null, 50), null); // the value itself stays unknown
  assert.match(js, /if \(fillOf\(c, v\) == null\) return `<span class="lv-iv lv-nil" style="--f:0"[^`]*\$\{meter\(shortLab\(c\)\)\}/); // empty ⚔️ in the iVi box
  // one meter = halo, hollow+outline picture, solid picture in its window (0% fill = the window sits below the ink)
  assert.match(js, /const meter = \(e\) => `<span class="lv-em lv-x\$\{emojiIdx\.get\(e\)\}" aria-hidden="true" data-e="\$\{e\}"><i class="lv-gl"><\/i><i class="lv-b"><\/i><i class="lv-sw"><i class="lv-s"><i class="lv-shn"><\/i><\/i><\/i><\/span>`;/);
  assert.match(js, /const vals = p\.cached \|\| \{\};/); // uncached too
  assert.match(js, /IVI\.map\(\(c\) => `<td class="lv-ivc">\$\{iviText\(c, vals\[c\.id\]\)\}<\/td>`\)/);
  assert.match(js, /return `<td class="lv-iz" data-tip="Infantry \$\{infS\}% · Zerg \$\{zgS\}">\[\$\{infS\}\/\$\{zgS\}\]<\/td>`;/); // owner 2026-10-25: the pair in square brackets, no % sign
  assert.match(js, /if \(!Number\.isFinite\(inf\) && !Number\.isFinite\(zg\)\) return `<td class="lv-iz"><\/td>`;/); // both unknown = empty cell
  assert.match(js, /const zgS = Number\.isFinite\(zg\) \? \(est != null \? `~\$\{Math\.round\(zg\)\}` : String\(Math\.round\(zg\)\)\) : "–";/); // t614: "~N" estimate survives as text
  assert.doesNotMatch(js, /<td class="lv-ems">/); // no emoji cells on the lines any more
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
  const js = liveSrc();
  const css = cssSrc();
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
  const js = liveSrc();
  assert.match(js, /if \(ev\) ev\.at = eventAt\(j\.payload\);/);
  assert.match(js, /const ageHtml = \(r\) => \(r\.gap == null \? `<span class="lv-timer" data-at="\$\{r\.at\}">\$\{fmtGap\(Date\.now\(\) - r\.at\)\}<\/span>` : fmtGap\(r\.gap\)\);/);
  assert.match(js, /evChain = evChain\.then\(\(\) => commitEvent\(ev, fetchP, row\.seq\), \(\) => commitEvent\(ev, fetchP, row\.seq\)\)/); // accounting keeps the order
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
  const js = liveSrc();
  assert.match(js, /const g = unitGlow\(c, v, driverOf\(c, v\)\);/);
  assert.match(js, /const ug = unitGlow\(c, null\);\n\s*return `<span class="lv-u lv-fl lv-nil\$\{ug \? ` lv-g\$\{ug\}` : ""\}"/);
});

test("emoji fill grows 0 → level over 10 s when a line appears (owner t578u/t588u); glow fades in late; reduced motion = final fill", () => {
  const js = liveSrc();
  const css = cssSrc();
  assert.match(css, /@property --f \{ syntax: "<number>"; inherits: true; initial-value: 0; \}/);
  assert.doesNotMatch(css, /--gw|lv-fillin \.lv-u \{ animation/); // 2026-10-24: no per-frame custom-property animation
  assert.match(js, /const FILL_MS = 10000;/);
  assert.match(js, /return played >= FILL_MS \? NO_FILL : \{ cls: " lv-fillin", sty: ` data-fk="\$\{esc\(key\)\}"` \};/); // re-renders continue, never restart
  assert.match(js, /const played = now - \(fillStart\.get\(tb\.dataset\.fk\) \|\| now\);/);
  assert.match(js, /fillIn\(`\$\{r\.opp\}@\$\{r\.at\}:\$\{\(people\.get\(r\.opp\) \|\| \{\}\)\.cached \? "c" : "u"\}`\)/); // stats arriving later = a new fill
  assert.match(js, /fillIn\(`me:\$\{me\.cached \? "c" : "u"\}`\)/);
  // the 30 fps ticker moves the window and the picture (transforms), continuing with the time already played
  assert.match(js, /const a = \{ u, sw, s: so, ih: s\.ih, from, to, t0: performance\.now\(\) - played, ms, glowLate \};/);
  assert.match(js, /if \(y !== a\.y\) \{ a\.y = y; a\.sw\.style\.transform = `translateY\(\$\{y\}px\)`; a\.s\.style\.transform = `translateY\(\$\{-y\}px\)`; \}/);
  assert.match(js, /if \(h\) h\.gw = glowIn\(k\);/); // halo off for 80%, then in
  assert.match(js, /function startFills\(\) \{\n\s*if \(!listEl \|\| reduced\(\)\) return;/); // reduced motion = the final fill at once
  assert.match(js, /startFills\(\); \/\/ lines drawn before the pictures were ready start filling now/);
  assert.match(js, /listEl\.innerHTML = cols \+ atk \+ mid \+ low;\n\s*listEl\.classList\.toggle\("lv-dim-names", namesDim\);\n\s*collectMotion\(\);\n\s*startFills\(\);\n\s*wake\(\);/);
  assert.doesNotMatch(js, /\.animate\(\[/); // nothing runs at the screen's own rate
  // same curve as the old CSS fill: cubic-bezier(0.22, 1, 0.36, 1)
  assert.equal(easeFill(0), 0);
  assert.equal(easeFill(1), 1);
  assert.ok(Math.abs(easeFill(0.5) - 0.9614) < 0.005, String(easeFill(0.5))); // ≈ 96 % of the way at half time
  assert.ok(Math.abs(bezier(0.25, 0.1, 0.25, 1)(0.25) - 0.4085) < 0.005); // CSS "ease" at 25 %
  assert.equal(glowIn(0.5), 0);
  assert.equal(glowIn(0.8), 0);
  assert.equal(glowIn(1), 1);
  assert.ok(glowIn(0.9) > 0.3 && glowIn(0.9) < 1);
});

test("30 fps (owner 2026-10-24: bare minimum 30, 60 next step) and the rank tiers: green still, blue flares, gold flares + shine", () => {
  assert.equal(LIVE_FPS, 30);
  assert.deepEqual(["", null, "30", "60", "120", "x", "59"].map(liveFps), [30, 30, 30, 60, 30, 30, 30]);
  // tier 1 never moves; between beats the halos rest (and the ticker sleeps)
  assert.equal(TIER_MOTION[1], null);
  assert.deepEqual(haloAt(1, 123456), { opacity: 1, scale: 1 });
  assert.deepEqual(haloAt(1, 0, 0.4), { opacity: 0.4, scale: 1 });
  const rest2 = haloAt(2, BEAT.ms + 10), rest3 = haloAt(3, BEAT.ms + 10);
  assert.equal(rest2.opacity, TIER_MOTION[2].rest);
  assert.equal(rest3.opacity, TIER_MOTION[3].rest);
  assert.equal(beatAt(BEAT.ms + 10), null);
  // the top of a flare: full halo, gold swells, blue doesn't
  const top2 = haloAt(2, BEAT.ms / 2), top3 = haloAt(3, BEAT.ms / 2);
  assert.ok(Math.abs(top2.opacity - 1) < 1e-9 && top2.scale === 1);
  assert.ok(Math.abs(top3.opacity - 1) < 1e-9 && top3.scale > 1.05);
  assert.ok(TIER_MOTION[3].rest < TIER_MOTION[2].rest); // gold flares harder
  // the wave: a later column flares later
  assert.equal(beatAt(30, 60), null);
  assert.ok(beatAt(90, 60) > 0);
  // gold shine: a band crosses the emoji at the start of each beat (frames 1..15), nothing in between
  assert.equal(shineFrame(0), 1);
  assert.equal(shineFrame(SHINE.ms - 1), SHINE.frames - 1);
  assert.equal(shineFrame(SHINE.ms + 1), 0);
  assert.equal(shineFrame(BEAT.every + 5), 1);
  assert.equal(shineFrame(100, 200), 0); // not its turn yet
  assert.ok(SHINE.ms <= BEAT.ms);
  assert.equal(shineAt(0, 16), null); // frame 0 = no band
  assert.equal(shineAt(1, 16), 0);
  assert.equal(shineAt(15, 16), 1);
  // the ticker sleeps between beats: how long until the next one
  assert.equal(beatSleep(10, 300), 0);
  assert.equal(beatSleep(BEAT.ms + 300 + 41, 300), BEAT.every - (BEAT.ms + 341));
  const css = cssSrc();
  const js = liveSrc();
  assert.match(js, /const FPS = liveFps\(new URLSearchParams\(location\.search\)\.get\("fps"\)\);/);
  assert.match(js, /let wait = Math\.max\(0, lastTick \+ FRAME_MS - now - 2\);/); // never more often than FPS
  assert.match(js, /wait = Math\.max\(wait, beatSleep\(now, maxOff\)\); \/\/ between beats the overlay stands still/);
  assert.match(js, /if \(!halos\.some\(\(h\) => h\.tier >= 2\)\) return; \/\/ nothing moves: no frames at all/);
  assert.match(js, /<i class="lv-sw"><i class="lv-s"><i class="lv-shn"><\/i><\/i><\/i>/); // the shine rides with the solid picture (cut to the fill)
  assert.match(css, /\.lv-g2 > \.lv-em > \.lv-gl, \.lv-g3 > \.lv-em > \.lv-gl \{ will-change: opacity, transform; \}/);
  const sheet = spriteCss([{ w: 30, h: 28, it: 4, ih: 20, gp: 6, base: "blob:b", solid: "blob:s", glow: ["", "", ""], shine: "blob:sh", frames: 16 }]);
  assert.match(sheet, /\.lv-g3>\.lv-x0>\.lv-sw>\.lv-s>\.lv-shn\{background-image:url\("blob:sh"\);background-size:1600% 100%;background-position:calc\(var\(--sf, 0\) \* 6\.6667%\) 0\}/);
});

test("✨ halo switch (owner 2026-10-24: with and without halos, for lower PCs): URL first, then this browser, else on", () => {
  assert.equal(HALO_KEY, "ps2-elite-kd-live-halo");
  assert.equal(haloOn(null, null), true);
  assert.equal(haloOn(null, "0"), false);
  assert.equal(haloOn("1", "0"), true); // ?halo=1 wins (OBS links)
  assert.equal(haloOn("0", "1"), false);
  assert.equal(haloOn("x", "1"), true);
  const js = liveSrc();
  const css = cssSrc();
  assert.match(js, /if \(!halo\) \{ halos = halos\.filter\(\(h\) => h\.tier < 2\); shines = \[\]; \}/); // off: no beat, no shine = no frames
  assert.match(js, /tr\("live\.haloOn", /);
  assert.match(js, /tr\("live\.haloOff", /);
  assert.match(css, /\.lv-nohalo \.lv-gl, \.lv-nohalo \.lv-shn \{ display: none; \}/);
});

test("emoji outline (owner t579u/t581u): a dark ring that hugs the whole silhouette, round and even; the emoji itself untouched", () => {
  assert.ok(OUTLINE_PX >= 2 && OUTLINE_PX <= 2.5); // t581u: bolder
  // a 10 × 10 square in a 30 × 30 image
  const w = 30, h = 30, a = new Uint8ClampedArray(w * h);
  for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) a[y * w + x] = 255;
  assert.deepEqual(disk(1).length / 2, 5); // centre + 4 neighbours
  const g = dilate(a, w, h, 2);
  assert.equal(g[8 * w + 15], 255); // 2 px above the top edge
  assert.equal(g[7 * w + 15], 0); // 3 px: outside
  assert.equal(g[8 * w + 8], 0); // the corner is round, not square
  const { ring, shape } = outlineMasks(a, w, h, OUTLINE_PX, 0.7);
  assert.equal(ring[15 * w + 15], 0); // the emoji itself is cut out of the ring
  assert.ok(ring[8 * w + 15] > 200); // the ring sits just outside the edge
  assert.equal(ring[2 * w + 15], 0); // and hugs it
  assert.ok(shape[15 * w + 15] === 255 && shape[8 * w + 15] > 200); // silhouette (for the halo) = emoji + ring
  assert.deepEqual(inkBox(a, w, h), { x: 10, y: 10, w: 10, h: 10 });
  assert.equal(inkBox(new Uint8ClampedArray(9), 3, 3), null);
  const b = blurAlpha(a, w, h, 1);
  assert.ok(b[15 * w + 15] > 250 && b[9 * w + 15] > 0 && b[9 * w + 15] < 128); // soft edge, solid middle
  const js = liveSrc();
  assert.match(js, /outlinePx: OUTLINE_PX, hollowPx: HOLLOW_PX, dim: FILL_DIM, hollowInk: HOLLOW_INK/);
  const sp = readFileSync(new URL("live-sprites.mjs", root), "utf8");
  assert.match(sp, /outlineMasks\(a, w, h, outlinePx \* dpr, 0\.7 \* dpr\)/); // t581u: softened by 0.7 px, then a hard edge
  assert.match(sp, /grown\[i\] \* 4 - 255/); // feFuncA slope 4, intercept −1
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
  // t622u: with the 🚜 cut C: 🚜 below C (fill C → C/2), an empty 🪖 between C and M, 🪖 fill above M as before
  assert.deepEqual(infDial(60, m, 72), { emoji: "🚜", tractor: true, fill: 33.3 });
  assert.deepEqual(infDial(36, m, 72), { emoji: "🚜", tractor: true, fill: 100 });
  assert.deepEqual(infDial(80, m, 72), { emoji: "🪖", tractor: false, fill: 0 });
  assert.deepEqual(infDial(92.5, m, 72), { emoji: "🪖", tractor: false, fill: 50 });
  assert.equal(infUnit(36, m, 72).glow, 3);
  assert.equal(infUnit(80, m, 72).glow, 0);
  const js = liveSrc();
  assert.match(js, /infM = infMedian\(pools\.inf\);/);
  assert.match(js, /infC = j\.tracCuts && Number\.isFinite\(j\.tracCuts\.cut\) \? j\.tracCuts\.cut : tractorCuts\(pools\.inf, \[\]\)\.cut;/); // t622u: 🚜 below the build cut
  assert.match(js, /infUnit\(v, infM, infC\)/);
  assert.match(js, /style="--f:\$\{iu\.fill\}"[^\n]*\$\{meter\(iu\.emoji\)\}/); // own emoji, own fill
  assert.match(js, /const EMOJIS = \[\.\.\.new Set\(\[\.\.\.LIVE_COLS\.map\(shortLab\), TRACTOR_EMOJI\]\)\];/); // 🚜 gets its pictures too
  // main site (t591u–t593u, rule t622u): a static 🚜 NAME mark next to 🪦 (auto-marks.mjs), Infantry cell unchanged, 2-3 line hint
  assert.equal(isTractor(84.9, m), true); // the old median helper stays (not used for the mark any more)
  const cuts = { cut: 72, fb: 22, med: m, rep: 0.9, vk: 0.2 };
  assert.equal(tractorMark({ inf: 90, trc: 0, cuts }), null);
  assert.equal(tractorMark(null), null);
  assert.equal(tractorMark({ inf: 60, trc: 0, cuts }), null); // under the cut but no XP confirmation: no 🚜
  assert.deepEqual(tractorMark({ inf: 60, trc: 1, cuts }), { id: "tractor", mark: "🚜", tip: tractorHint(cuts) });
  assert.ok(tractorMark({ inf: 20, trc: null, cuts })); // not in the build: fallback only
  assert.equal(tractorMark({ inf: 40, trc: null, cuts }), null);
  assert.match(tractorHint(cuts), /^🚜 Vehicle mark[^\n]+\n[^\n]+< 72\.0%[^\n]+\n[^\n]+< 22\.0%[^\n]+$/); // t597u: 2-3 lines, not the iVi cut / Diff damp 🚜
  const now = Date.UTC(2026, 9, 24), s = now / 1000, day = 86400;
  const h = autoMarksHtml(null, { score: 90, rvp: 99, confirmed: true }, { created: s - 3000 * day, last: s - 400 * day }, now, null, { inf: 50, trc: 1, cuts });
  assert.match(h, /auto-mark-zerg.*🪳.*<span class="poop-mark auto-mark auto-mark-tractor" title="🚜 [^"]+" aria-label="🚜 [^"]+">🚜<\/span><span class="poop-mark auto-mark auto-mark-inactive"[^>]*>🪦/s); // order 🪳 🐣 🚜 🪦
  assert.doesNotMatch(autoMarksHtml(null, null, null, now, null, { inf: 90, trc: 0, cuts }), /🚜/);
  const app = appSource();
  const rk = readFileSync(new URL("rankings.mjs", root), "utf8");
  assert.match(app, /nbhOf\(d, row\.p\), ie \? \{ inf: ie\.inf, trc: ie\.trc, cuts: tracCuts \} : null\)/);
  assert.match(rk, /r\.nbh, fin\(r\.inf\) \? \{ inf: r\.inf, trc: r\.trc, cuts: tracCuts\(\) \} : null\)/);
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

test("🚜 name mark rule (owner t622u): infantry < p25 + vehicle XP ≥ p75, or infantry < p2; cuts from the data, ~400 on PC", () => {
  const ids = tracXpIds({ 1: ["Kill Player", 100], 90: ["Repair Sunderer", 10], 91: ["Repair MAX", 10], 92: ["Vehicle Destruction - Flash", 50], 93: ["Kill Assist - Lightning", 30] });
  assert.deepEqual(ids, { repair: ["90"], vkill: ["92", "93"] });
  assert.equal(tracSample({ seconds_counted: 3600, totals: { g: { 90: [60, 600] } } }, ids), null); // under 2 h
  assert.deepEqual(tracSample({ seconds_counted: 7200, totals: { g: { 90: [240, 2400], 92: [12, 600], 93: [12, 360] } } }, ids), { rep: 2, vk: 0.2 });
  const inf = Array.from({ length: 100 }, (_, i) => i + 0.5); // 0.5 … 99.5
  const xs = Array.from({ length: 100 }, (_, i) => ({ rep: i / 100, vk: i / 1000 }));
  const c = tractorCuts(inf, xs);
  assert.deepEqual(c, { cut: 25.5, fb: 2.5, med: 50, rep: 0.75, vk: 0.075 });
  assert.equal(tractorRule(2, null, c), 1); // fallback, no XP
  assert.equal(tractorRule(20, null, c), 0); // under the cut, no XP
  assert.equal(tractorRule(20, { rep: 0.8, vk: 0 }, c), 1); // repair confirms
  assert.equal(tractorRule(20, { rep: 0, vk: 0.08 }, c), 1); // vehicle kills confirm
  assert.equal(tractorRule(30, { rep: 5, vk: 5 }, c), 0); // above the cut
  assert.equal(tractorRule(null, null, c), null);
  assert.equal(tractorMarked(1, 90, c), true);
  assert.equal(tractorMarked(0, 1, c), false); // the build (incl. reviewed "cleared") wins
  assert.equal(tractorCleared({ players: { a: { tractor: "cleared" } } }, "a"), true);
  assert.equal(tractorCleared({ players: { a: { zerg: "cleared" } } }, "a"), false);
  for (const [dir, lo, hi] of [["data", 300, 600], ["data-ps", 5, 120]]) {
    const j = JSON.parse(readFileSync(new URL(`${dir}/ranks.json`, root), "utf8"));
    const ti = j.cols.indexOf("trc"), ii = j.cols.indexOf("inf");
    assert.ok(ti >= 0 && j.tracCuts && j.tracCuts.cut > j.tracCuts.fb && j.tracCuts.med > j.tracCuts.cut, dir);
    const n = j.rows.filter((r) => r[ti] === 1).length;
    assert.ok(n >= lo && n <= hi, `${dir}: ${n}`);
    assert.ok(j.rows.every((r) => r[ti] !== 1 || r[ii] < j.tracCuts.cut), dir); // every 🚜 is under the infantry cut
    const lite = JSON.parse(readFileSync(new URL(`${dir}/ranks-lite.json`, root), "utf8"));
    assert.ok(lite.cols.includes("trc") && lite.tracCuts && lite.tracCuts.cut === j.tracCuts.cut, dir);
  }
});

test("hollow empty part (owner t589u): light inner ring inside the black outline, dark greyscale interior, filled part untouched", () => {
  assert.ok(HOLLOW_PX >= 1.5 && HOLLOW_PX <= 2);
  assert.ok(FILL_DIM >= 0.15 && FILL_DIM <= 0.2);
  const w = 30, h = 30, a = new Uint8ClampedArray(w * h);
  for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) a[y * w + x] = 255;
  assert.equal(erode(a, w, h, 2)[11 * w + 15], 0); // 1 px in: eroded away
  assert.equal(erode(a, w, h, 2)[12 * w + 15], 255); // 2 px in: kept
  const rim = hollowRim(a, w, h, HOLLOW_PX);
  assert.equal(rim[10 * w + 15], 255); // a 1.75 px ring just inside the edge: the first pixel fully …
  assert.equal(rim[11 * w + 15], 191); // … the second at 75 % …
  assert.equal(rim[15 * w + 15], 0); // … not the middle
  assert.equal(rim[9 * w + 15], 0); // … and nothing outside
  const sp = readFileSync(new URL("live-sprites.mjs", root), "utf8");
  assert.match(sp, /const g = 0\.13 \* rgba\[i\] \+ 0\.43 \* rgba\[i \+ 1\] \+ 0\.04 \* rgba\[i \+ 2\]; \/\/ #lvHollow colour matrix/); // greyscale, darkened
  assert.match(sp, /over\(base, i, g, g, g, \(dim \* a\[p\]\) \/ 255\)/); // FILL_DIM visible
  assert.match(sp, /const solidCv = put\(rgba, w, h\);/); // the filled part: the emoji as it is, full colour
  // one stylesheet: sizes + pictures per emoji, halos per tier
  const css = spriteCss([{ w: 30, h: 28, it: 4, ih: 20, gp: 6, base: "blob:b", solid: "blob:s", glow: ["blob:g1", "blob:g2", "blob:g3"] }, null]);
  assert.match(css, /\.lv-x0\{--sw:30px;--sh:28px;--it:4px;--ih:20px;--gp:6px\}/);
  assert.match(css, /\.lv-x0>\.lv-b\{background-image:url\("blob:b"\)\}/);
  assert.match(css, /\.lv-x0>\.lv-sw>\.lv-s\{background-image:url\("blob:s"\)\}/);
  assert.match(css, /\.lv-g3>\.lv-x0>\.lv-gl\{background-image:url\("blob:g3"\)\}/);
  assert.doesNotMatch(css, /lv-x1/);
});

test("weapon name + headshot mark (owner 2026-10-25): no weapon icon — the weapon's name under the player name, small and dim; headshot is a custom head-with-bullet mark", () => {
  const cat = { items: { 80: ["Orion VS54", "LMG", 1, 6030], 44505: ["Frag Grenade", "Grenade", 0, 87006], 432: ["C-4", "Explosive", 0, 89142], 7: ["No picture", "LMG", 1, 0] } };
  assert.deepEqual(weaponIcon(cat, "80"), { name: "Orion VS54", image: "6030", card: false }); // the catalog lookup still resolves the name
  assert.equal(weaponIcon(cat, "44505").card, true);
  assert.equal(weaponIcon(cat, "432").card, true);
  assert.equal(weaponIcon(cat, "7"), null); // no picture
  assert.equal(weaponIcon(cat, "999"), null);
  assert.equal(weaponIcon(null, "80"), null);
  assert.equal(weaponIcon(cat, null), null);
  assert.ok(CARD_CATEGORIES.test("Infantry Abilities") && !CARD_CATEGORIES.test("Assault Rifle"));
  const js = liveSrc();
  const css = cssSrc();
  assert.match(js, /const HS_TIP = tr\("live\.hs", "Headshot"\);/); // the headshot flag + tooltip stay
  assert.match(js, /<span class="lv-wn">\$\{w \? esc\(w\.name\) : ""\}<\/span>/); // the weapon's name under the player name
  assert.match(js, /<span class="lv-hs2" role="img" aria-label="\$\{esc\(HS_TIP\)\}" data-tip="\$\{esc\(HS_TIP\)\}">\$\{HS_SVG\}<\/span>/); // headshot only when it IS one
  assert.match(js, /viewBox="0 0 16 16"/); // the custom head-with-bullet mark (inline SVG, no asset)
  assert.doesNotMatch(js, /wpHtml|lv-wp|lv-wi/); // no weapon column, no gun icon
  assert.doesNotMatch(css, /\.lv-wp|\.lv-wi|\.lv-hs \{|headshot\.svg/); // no icon rules, no free-icon asset
  assert.match(css, /\.lv-wn \{[^}]*color: var\(--dim\)/); // small, dim weapon name
  assert.match(css, /\.lv-hs2 \{[^}]*color: var\(--err\)/);
  assert.match(css, /\.live-table \{[^}]*--lv-nm: 14\.15rem/); // the name column absorbed the weapon column
  assert.throws(() => readFileSync(new URL("assets/icons/headshot.svg", root), "utf8")); // the free icon is gone
  assert.doesNotMatch(readFileSync(new URL("NOTICE", root), "utf8"), /headshot\.svg/);
  // the event keeps its weapon on the line it lands on
  let st = overlayPush(null, { kind: "kill", opp: "a", weapon: "80", headshot: true }, 1000);
  assert.equal(st.victims[0].weapon, "80");
  st = overlayPush(st, { kind: "death", opp: "k", weapon: "432" }, 2000);
  assert.equal(st.killer.weapon, "432");
  assert.equal(st.victims[0].weapon, "80");
});

test("centre refresh (owner t586u): fresh Census numbers every 5 min, paused while hidden, never shared or saved", () => {
  assert.equal(ME_REFRESH_MS, 5 * 60000); // measured: 9 Census calls + 0 Honu per refresh → 5 min, not 1
  assert.deepEqual(mergeFresh({ adjs: 400, zerg: 41, apk: 0.3 }, { adjs: 455, zerg: null, apk: null, rf: NaN }), { adjs: 455, zerg: 41, apk: 0.3 });
  assert.deepEqual(mergeFresh(null, { adjs: 455 }), { adjs: 455 });
  const js = liveSrc();
  const app = appSource();
  const fn = js.slice(js.indexOf("async function refreshMe()"), js.indexOf("function meRefreshLoop()"));
  assert.match(fn, /document\.hidden\) return;/);
  assert.match(fn, /a\.fetchPlayerFresh\(me\.name\)/);
  assert.doesNotMatch(fn, /onBgFetched|queueSharedCache|cachePut|sharePending/);
  assert.match(js, /if \(!document\.hidden && Date\.now\(\) >= meNext\) refreshMe\(\);/);
  const api = app.slice(app.indexOf("fetchPlayerFresh: async"), app.indexOf("getLastAnalyzedNames:"));
  assert.match(api, /return loadLive\(name\);/);
  assert.doesNotMatch(api, /cachePut|suggestSharedCache/);
  assert.match(js, /animateFill\(u, \+before\.f\[i\], 1200\)/); // the new fill eases in from the old one
});

test("trends removed (owner 2026-10-25): no chart, no module, pill kept in the DPM row", () => {
  const js = liveSrc();
  const css = cssSrc();
  const live = readFileSync(new URL("live.html", root), "utf8");
  const swap = readFileSync(new URL("scripts/build-live.mjs", root), "utf8");
  assert.doesNotMatch(js, /live-trends|drawTrends|trendSeries|trendStart|trendKills|trendDeaths|liveTrend/);
  assert.doesNotMatch(live, /liveTrends|liveTrendCanvas|liveTrendLegend|liveTrendTitle/);
  assert.doesNotMatch(swap, /liveTrends|liveTrendCanvas|liveTrendLegend|liveTrendTitle/);
  assert.doesNotMatch(css, /live-trend|\.lv-tl/);
  assert.ok(!existsSync(new URL("live-trends.mjs", root)), "live-trends.mjs deleted");
  assert.ok(!existsSync(new URL("test/live-trends.test.mjs", root)), "live-trends test deleted");
  assert.match(swap, /<span id="liveOnline" class="live-online" data-state="unknown">/); // the pill survives
});

test("iz cell (owner 2026-10-25): infantry/zerg aligned left", () => {
  const css = cssSrc();
  assert.match(css, /\.lv-iz \{[^}]*text-align: left;/);
});

test("teamkill (owner 2026-10-25): own-faction kills farm nothing, own-faction deaths still count", () => {
  const js = liveSrc();
  assert.match(js, /if \(ev\.kind === "kill" && p\.faction && me && me\.faction && p\.faction === me\.faction\) \{\s*st = \{ \.\.\.st, victims: st\.victims\.filter\(\(r\) => r\.seq !== seq\) \};/); // #76: retract only the arrival row
});

test("dim names on death (owner 2026-10-25): death dims the killed list and your name to 50%, a kill re-lights them", () => {
  const js = liveSrc();
  const css = readFileSync(new URL("live.css", root), "utf8");
  assert.match(js, /let namesDim = false;/);
  assert.match(js, /if \(ev\.kind === "death"\) namesDim = true;/);
  assert.match(js, /namesDim = false;/);
  assert.match(js, /listEl\.classList\.toggle\("lv-dim-names", namesDim\);/);
  assert.match(css, /\.live-table\.lv-dim-names tbody\.lv-vic \.lv-nm, \.live-table\.lv-dim-names tbody\.lv-me \.lv-nm \{ opacity: 0\.5; \}/);
});

test("cash boost (owner 2026-10-25): payouts x1.34 at the cash choke point, formula carries +34%", () => {
  const js = liveSrc();
  assert.match(js, /const CASH_BOOST_PCT = 34;/);
  assert.match(js, /Math\.round\(Math\.max\(0, p\.cached\.adjs\) \* \(1 \+ CASH_BOOST_PCT \/ 100\)\)/);
  assert.match(js, /cashFormula\(cashKills\.map\(\(e\) => e\.iv\), CASH_BOOST_PCT\)/);
});

test("cash formula (owner 2026-10-25): pot and banked runs show total plus parts", () => {
  const js = liveSrc();
  assert.match(js, /const f = cashFormula\(cashKills\.map\(\(e\) => e\.iv\), CASH_BOOST_PCT\);/);
  assert.match(js, /cashSumEl\.textContent = f;/);
  assert.match(js, /cashHist\.unshift\(\{ sum: t\.sum, avg: t\.avg, formula: cashFormula\(cashKills\.map\(\(e\) => e\.iv\), CASH_BOOST_PCT\) \}\);/);
  assert.match(js, /<div>Σ \$\{h\.formula\} · /);
});

test("adjustable tau (owner 2026-10-25): DPM decay tau is a persisted page control", () => {
  const js = liveSrc();
  const swap = readFileSync(new URL("scripts/build-live.mjs", root), "utf8");
  assert.match(js, /dpsNow\(dpsEvents, effNow, dpmTauMs, holdMs\)/);
  assert.match(js, /ps2-live-dpm-tau/);
  assert.match(swap, /<input id="liveDpmTauVal" type="number" min="1" max="3600" step="1" value="10">/);
});

test("bounty (owner 2026-10-25): hearts on the centre line's second row, 💰💰💰 at 7, one removed per death", () => {
  const js = liveSrc();
  const css = cssSrc();
  assert.match(js, /bountyNext[^}]*\} from "\.\/live-model\.mjs\?v=20261025-ttc1"/);
  assert.match(js, /const b = bountyNext\(\{ streak: bountyStreak, lives: bountyLives \}, ev\.kind === "kill"\);/);
  assert.match(js, /if \(bountyLives > 0\) return `<span class="lv-wn">\$\{"💰"\.repeat\(bountyLives\)\}<\/span>`;/); // one mark per life left, not one mark for all three
  assert.match(js, /Array\.from\(\{ length: 7 \}, \(_, i\) => `<span class="lv-bh\$\{i < bountyStreak \? "" : " lv-bh-empty"\}">❤️‍🔥<\/span>`\)\.join\(""\)/); // 7 slots, filled + dim
  assert.match(css, /\.live-table tbody\.lv-me \.lv-wn \.lv-bh-empty \{ opacity: 0\.25; \}/);
  assert.match(js, /const wn = isMe \? bountyHtml\(\) : `<span class="lv-wn">/);
  assert.match(css, /\.live-table tbody\.lv-me \.lv-wn \{ font-size: 1rem; line-height: 1\.1; \}/);
});

test("mobile names + legend + DPS (owner 2026-10-25): table 100% with a flexible name column, legend above the graph small, DPS under the feed", () => {
  const js = liveSrc();
  const css = cssSrc();
  const live = readFileSync(new URL("live.html", root), "utf8");
  const swap = readFileSync(new URL("scripts/build-live.mjs", root), "utf8");
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?\.live-table \{[^}]*width: 100%;/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*?col\.lv-c-nm \{ width: auto; \}/);
  assert.match(swap, /<div id="liveDps" class="live-dps"><span id="liveDpsLabel"><\/span> <span id="liveDpsVal">0\.0<\/span> <span aria-hidden="true">·<\/span> <span id="liveDpsHold"><\/span> <span id="liveDpsCombatSep" aria-hidden="true">·<\/span> <span id="liveDpsCombat"><\/span> <span aria-hidden="true">·<\/span> <span id="liveCashSumLabel"><\/span> <span id="liveCashSumVal">0<\/span> <span aria-hidden="true">·<\/span> <span id="liveCashAvgLabel"><\/span> <span id="liveCashAvgVal">–<\/span> <span aria-hidden="true">·<\/span> <span id="liveOnline" class="live-online" data-state="unknown"><i><\/i><span id="liveOnlineText">…<\/span><\/span><\/div>/);
  assert.match(js, /eventNames: \["Death", "GainExperience_experience_id_2", "GainExperience_experience_id_3", "GainExperience_experience_id_371", "GainExperience_experience_id_372", "PlayerLogin", "PlayerLogout"\]/);
  assert.match(js, /DPS_ASSIST_XP\.has\(Number\(p\.experience_id\)\)/);
  assert.match(js, /setInterval\(dpsTick, 100\)/);
  assert.match(js, /const trueDpm = dpsNow\(dpsEvents, effNow, dpmTauMs, holdMs\) \* 60;/);
  assert.match(js, /cashKills\.push\(\{ cid: ev\.opp, iv: cashIv\(p\) \}\)/); // one ledger entry per kill
  assert.match(js, /for \(const e of cashKills\) if \(e\.cid === cid && !Number\.isFinite\(e\.iv\)\) e\.iv = cashIv\(p\);/); // late iVi finalizes in the list
  assert.match(js, /tr\("live\.cashSum", "Σ iVi"\)/);
  assert.match(swap, /<span id="liveOnline" class="live-online" data-state="unknown"><i><\/i><span id="liveOnlineText">…<\/span><\/span>/); // pill survives in the DPM row
  assert.match(js, /characters_online_status\/\?character_id=\$\{me\.cid\}/); // Census is the source of truth for "right now"
  assert.match(js, /setInterval\(pollOnline, 60000\)/);
  assert.match(js, /event_name === "PlayerLogin" \? "online" : "offline"/);
  assert.match(js, /setOnline\("online"\); \/\/ any Death involving them means they are playing right now/);
  assert.match(css, /\.live-online\[data-state="online"\] i \{ background: #4caf50; \}/);
  assert.match(css, /\.live-online\[data-state="offline"\] i \{ background: var\(--err\); \}/);
  assert.match(js, /const wasStreak = bountyStreak;/); // a kill starting a new streak clears the old run's victim lines
  assert.match(js, /if \(wasStreak === 0\) st = \{ \.\.\.st, victims: st\.victims\.filter\(\(r\) => r\.seq === seq \|\| pendingSeq\.has\(r\.seq\)\) \};/); // #76: keeps the new run's early rows
  assert.match(swap, /<div id="liveCashHist" class="live-cash-hist"><\/div>/); // banked runs live on the page only
  assert.match(js, /if \(ev\.kind === "death" && wasStreak > 0 && bountyStreak === 0\)/);
  assert.match(js, /if \(cashHist\.length > 5\) cashHist\.length = 5;/);
  assert.match(js, /cashKills\.length = 0;/);
  assert.match(js, /tr\("live\.cashHist", "Past runs"\)/);
  assert.match(css, /\.live-cash-hist \{ margin-top: 0.25rem; font-size: 0.72rem; color: var\(--dim\); background: var\(--panel\); padding: 0.25rem 0.5rem; \}/);
  assert.match(js, /Math\.round\(Math\.max\(0, p\.cached\.adjs\) \* \(1 \+ CASH_BOOST_PCT \/ 100\)\)/); // floor first, then the boost (a sub-0 victim still pays 0) // sub-0 victims pay 0, never subtract
  assert.match(js, /tr\("live\.cashAvg", "avg"\)/);
});

test("#76 snappy feed: the row lands on arrival, lookups run in parallel, accounting stays in order", async () => {
  const js = liveSrc();
  const on = js.slice(js.indexOf("const onEvent = (ev) =>"), js.indexOf("async function commitEvent"));
  // arrival: lookup started (not awaited), row pushed and rendered before the commit is chained
  assert.match(on, /const fetchP = person\(ev\.opp\);/);
  assert.doesNotMatch(on, /\bawait\b/);
  assert.ok(on.indexOf("st = overlayPush(st, ev)") < on.indexOf("evChain = evChain.then"), "row pushed before the commit");
  assert.ok(on.indexOf("render()") < on.indexOf("evChain = evChain.then"), "rendered before the commit");
  // pending rows are keyed by seq, not identity: overlayPush copies rows when it stops the top timer
  assert.match(on, /row\.seq = \+\+evSeq;/);
  const { overlayPush } = await import("../live-model.mjs");
  let st = overlayPush(null, { kind: "kill", opp: "a", at: 1000 });
  const first = st.lastEv; first.seq = 1;
  st = overlayPush(st, { kind: "kill", opp: "b", at: 1100 });
  assert.notEqual(st.victims[1], first, "the first row was copied (identity lost) …");
  assert.equal(st.victims[1].seq, 1, "… but its seq survived");
  // one lookup per cid in flight; pending shows "…"
  assert.match(js, /if \(peopleP\.has\(cid\)\) return peopleP\.get\(cid\);/);
  assert.match(js, /pr\.catch\(\(\) => peopleP\.delete\(cid\)\)/);
  assert.match(js, /if \(p\.pending\) return `<span class="lv-pn"><span class="lv-name lv-pend"><bdi>…<\/bdi>/);
  // commit: a failed lookup never strands "…"; no second push; DPM at the event's time
  const commit = js.slice(js.indexOf("async function commitEvent"), js.indexOf("let ws = null"));
  assert.match(commit, /try \{ p = await fetchP; \} catch \{ p = people\.get\(ev\.opp\); if \(p\) p\.pending = false; \}/);
  assert.doesNotMatch(commit, /overlayPush\(/);
  assert.match(commit, /dpsEvents\.push\(\{ t: Number\.isFinite\(ev\.at\) \? ev\.at : Date\.now\(\), dmg: DPS_HP \}\)/);
  assert.match(commit, /pendingSeq\.delete\(seq\);/);
});

test("hold meter (owner 2026-10-25): decay freezes on death, lifts on a spike or the average spawn run", () => {
  const js = liveSrc();
  assert.match(js, /let deathTimes = \[\], timeDebtMs = 0, freezeStart = 0, freezeFor = 0;/);
  assert.match(js, /const spikeTimes = \(\) => dpsEvents\.map\(\(e\) => e\.t\);/);
  assert.match(js, /const liftFreeze = \(at\) => \{ if \(freezeStart\) \{ timeDebtMs \+= Math\.min\(Math\.max\(0, at - freezeStart\), freezeFor\); freezeStart = 0; freezeFor = 0; \} \};/);
  assert.match(js, /if \(freezeStart && Date\.now\(\) >= freezeStart \+ freezeFor\) \{ timeDebtMs \+= freezeFor; freezeStart = 0; freezeFor = 0; \}/);
  assert.match(js, /const effNow = freezeStart \? freezeStart - timeDebtMs : Date\.now\(\) - timeDebtMs;/);
  assert.match(js, /if \(ev\.kind === "death"\) \{ liftFreeze\(ev\.at\); deathTimes\.push\(ev\.at\); freezeStart = ev\.at; freezeFor = spawnRunHoldMs\(deathTimes, spikeTimes\(\)\); \}/);
  assert.match(js, /dpsEvents\.push\(\{ t: Number\.isFinite\(ev\.at\) \? ev\.at : Date\.now\(\), dmg: DPS_HP \}\); if \(shownDps !== null\) scrollQ\.push\(dpsNow\(\[\{ t: 0, dmg: DPS_HP \}\], 0, dpmTauMs\) \* 60\); liftFreeze\(Number\.isFinite\(ev\.at\) \? ev\.at : Date\.now\(\)\);/);
  assert.match(js, /dpsEvents\.push\(\{ t: Date\.now\(\), dmg: DPS_ASSIST \}\); if \(shownDps !== null\) scrollQ\.push\(dpsNow\(\[\{ t: 0, dmg: DPS_ASSIST \}\], 0, dpmTauMs\) \* 60\); liftFreeze\(Date\.now\(\)\);/);
  assert.match(js, /combatHoldMs, spawnRunHoldMs, timeToCombatMs, easeInQuad \} from "\.\/live-model\.mjs\?v=20261025-ttc1"/);
});

test("warm-up (owner 2026-10-25): the meter waits for its 3rd chunk — first two spikes only bump the count", () => {
  const js = liveSrc();
  assert.match(js, /const dpsLabelEl = \$\("liveDpsLabel"\);/);
  assert.match(js, /let lastDps = "", lastDpsLabel = "", lastHold = "", lastCombat = "", lastCash = "";/);
  assert.match(js, /if \(dpsEvents\.length < 3\) \{/);
  assert.match(js, /v = `\$\{dpsEvents\.length\}\/3`;/);
  assert.match(js, /label = tr\("live\.dpmWarm", "DPM starts at 3"\);/);
  assert.match(js, /if \(dpsLabelEl && label !== lastDpsLabel\) \{ dpsLabelEl\.textContent = label; lastDpsLabel = label; \}/);
});

test("hold indicator (owner 2026-10-25): the current hold in whole seconds, next to the meter", () => {
  const js = liveSrc();
  const swap = readFileSync(new URL("scripts/build-live.mjs", root), "utf8");
  assert.match(swap, /<span id="liveDpsVal">0\.0<\/span> <span aria-hidden="true">·<\/span> <span id="liveDpsHold"><\/span>/);
  assert.match(js, /const dpsHoldEl = \$\("liveDpsHold"\);/);
  assert.match(js, /let lastDps = "", lastDpsLabel = "", lastHold = "", lastCombat = "", lastCash = "";/);
  assert.match(js, /const holdMs = combatHoldMs\(spikeTimes\(\), deathTimes\);/);
  assert.match(js, /const holdText = tr\("live\.dpmHold", "hold \{s\}s", \{ s: Math\.round\(holdMs \/ 1000\) \}\);/);
  assert.match(js, /if \(dpsHoldEl && holdText !== lastHold\) \{ dpsHoldEl\.textContent = holdText; lastHold = holdText; \}/);
});

test("combat average (owner 2026-10-25): median of ALL death→first-combat runs, next to hold", () => {
  const js = liveSrc();
  const swap = readFileSync(new URL("scripts/build-live.mjs", root), "utf8");
  assert.match(swap, /<span id="liveDpsHold"><\/span> <span id="liveDpsCombatSep" aria-hidden="true">·<\/span> <span id="liveDpsCombat"><\/span>/);
  assert.match(js, /const dpsCombatEl = \$\("liveDpsCombat"\), dpsCombatSepEl = \$\("liveDpsCombatSep"\);/);
  assert.match(js, /const combat = timeToCombatMs\(deathTimes, spikeTimes\(\)\);/);
  assert.match(js, /const combatText = combat\.n \? tr\("live\.dpmCombat", "combat \{s\}s \(n=\{n\}\)", \{ s: Math\.round\(combat\.ms \/ 1000\), n: combat\.n \}\) : "";/);
  assert.match(js, /if \(dpsCombatEl && combatText !== lastCombat\) \{ dpsCombatEl\.textContent = combatText; lastCombat = combatText; \}/);
  assert.match(js, /if \(dpsCombatSepEl\) dpsCombatSepEl\.style\.display = combat\.n \? "" : "none";/);
});

test("scroll (owner 2026-10-25): gas-counter queue — one 700 ms ease-in scroll per spike, deaths never enqueue", () => {
  const js = liveSrc();
  assert.match(js, /const SCROLL_MS = 700;/);
  assert.match(js, /let scrollQ = \[\], scrollJob = null, shownDps = null;/);
  assert.match(js, /if \(scrollJob \|\| !scrollQ\.length \|\| shownDps === null\) return;/);
  assert.match(js, /const p = Math\.min\(1, \(now - scrollJob\.start\) \/ SCROLL_MS\);/);
  assert.match(js, /const v = scrollJob\.from \+ \(scrollJob\.to - scrollJob\.from\) \* easeInQuad\(p\);/);
  assert.match(js, /if \(p < 1\) requestAnimationFrame\(step\);/);
  assert.match(js, /if \(shownDps !== null\) scrollQ\.push\(dpsNow\(\[\{ t: 0, dmg: DPS_HP \}\], 0, dpmTauMs\) \* 60\);/);
  assert.match(js, /if \(shownDps !== null\) scrollQ\.push\(dpsNow\(\[\{ t: 0, dmg: DPS_ASSIST \}\], 0, dpmTauMs\) \* 60\);/);
  assert.match(js, /if \(shownDps === null\) \{ shownDps = trueDpm; dpsEl\.textContent = shownDps\.toFixed\(1\); \}/);
  assert.match(js, /if \(scrollQ\.length\) startScroll\(\);/);
  assert.match(js, /if \(Math\.abs\(trueDpm - shownDps\) < 0\.05\) shownDps = trueDpm;/);
  assert.match(js, /shownDps \+= \(trueDpm - shownDps\) \* 0\.35;/);
  assert.match(js, /easeInQuad \} from "\.\/live-model\.mjs\?v=20261025-ttc1"/);
});

test("past cashouts background (owner 2026-10-25): the history sits on the theme panel, not transparent", () => {
  const css = cssSrc();
  assert.match(css, /\.live-cash-hist \{[^}]*background: var\(--panel\);/);
  assert.match(css, /\.live-cash-hist:empty \{ padding: 0; \}/);
});

test("reconnect (owner 2026-10-25): one immediate retry per healthy drop, backoff otherwise, no second socket", () => {
  const js = liveSrc();
  assert.match(js, /if \(ws && \(ws\.readyState === WebSocket\.OPEN \|\| ws\.readyState === WebSocket\.CONNECTING\)\) return;/);
  assert.match(js, /if \(connectTimer\) \{ clearTimeout\(connectTimer\); connectTimer = null; \}/);
  assert.match(js, /const lived = openedAt && Date\.now\(\) - openedAt > 5000;/);
  assert.match(js, /if \(lived\) connect\(\); else retry\(\);/);
  assert.match(js, /connectTimer = setTimeout\(connect, backoff\);/);
  assert.match(js, /if \(!document\.hidden && \(!ws \|\| ws\.readyState === WebSocket\.CLOSED\)\) connect\(\);/);
});
