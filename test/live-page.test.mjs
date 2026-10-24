import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildLive } from "../scripts/build-live.mjs";
import { classifyDeath, feedPush, censusStats, cellText, fmtGap, LIVE_COLS, FEED_MAX, emojiScale, goodPct, EMOJI_MIN, EMOJI_MAX, PHASE_MS, phaseAt } from "../live.mjs";

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
  assert.equal(dropped.opp, "b");
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

test("emoji size (owner t558u): median 1x, best 2.2x, worst 0.35x, big steps, smooth, lower-is-better reversed", () => {
  const kd = LIVE_COLS.find((c) => c.id === "act");
  const zerg = LIVE_COLS.find((c) => c.id === "zerg"); // owner t555u: bigger Zerg = bigger 🪳
  for (const c of LIVE_COLS) assert.ok(!c.lowerBetter, c.id);
  assert.equal(emojiScale(zerg, 99), EMOJI_MAX);
  assert.equal(emojiScale(zerg, 0), EMOJI_MIN);
  assert.equal(emojiScale(zerg, 50), 1);
  const apk = { id: "x", lowerBetter: true }; // the generic reversed mapping still works
  assert.equal(emojiScale(kd, 50), 1);
  assert.equal(emojiScale(kd, 99), EMOJI_MAX);
  assert.equal(emojiScale(kd, 0), EMOJI_MIN);
  assert.equal(EMOJI_MAX, 2.2);
  assert.equal(EMOJI_MIN, 0.35);
  assert.ok(emojiScale(kd, 95) - emojiScale(kd, 75) >= 0.5, "p75 vs p95 clearly apart");
  assert.ok(emojiScale(kd, 25) <= 0.6, "poor ranks much smaller");
  assert.equal(emojiScale(apk, 0), EMOJI_MAX);
  assert.equal(emojiScale(apk, 99), EMOJI_MIN);
  assert.equal(goodPct(apk, 10), 89);
  for (let p = 1; p <= 99; p++) assert.ok(emojiScale(kd, p) >= emojiScale(kd, p - 1), "monotonic at " + p);
  for (let p = 1; p <= 99; p++) assert.ok(Math.abs(emojiScale(kd, p) - emojiScale(kd, p - 1)) < 0.05, "no jumps at " + p);
  assert.equal(emojiScale(kd, null), null);
  assert.equal(emojiScale(kd, NaN), null);
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

test("20 s switch (owner t557u, t559u): one fixed slot a side, phase A iVi, phase B mirrored emojis, quick fade", () => {
  assert.equal(PHASE_MS, 20000);
  assert.deepEqual([0, 19999, 20000, 39999, 40000, -5].map(phaseAt), ["A", "A", "B", "B", "A", "A"]);
  const css = readFileSync(new URL("styles.css", root), "utf8");
  assert.doesNotMatch(css, /lvNum|lvEm|lv-arrow|lv-cyc/);
  assert.match(css, /transition: opacity 0\.133s/);
  assert.match(css, /\.lv-phB \.lv-slot > \.lv-pb \{ opacity: 1;/);
  assert.match(css, /col\.lv-c-slot \{ width: calc\(5 \* var\(--lv-u\)\); \}/);
  const js = readFileSync(new URL("live.mjs", root), "utf8");
  assert.doesNotMatch(js, /❯|lv-arrow/);
  assert.match(js, /\$\{left\.name\}\$\{left\.stats\}\$\{right\.stats\}\$\{right\.name\}/);
  assert.match(js, /sd === "R" \? \[\.\.\.REST\]\.reverse\(\) : REST/); // right player: 🪖 🪳 🛡️ 🦁 🏃
  assert.match(js, /class="lv-v"/);
});

test("censusStats: K/D and KPM from stat_history", () => {
  const s = censusStats({ stats: { stat_history: [{ stat_name: "kills", all_time: "30" }, { stat_name: "deaths", all_time: "10" }, { stat_name: "time", all_time: "1800" }] } });
  assert.equal(s.kd, 3);
  assert.equal(s.kpm, 1);
  assert.deepEqual(censusStats({}), { kd: null, kpm: null });
});

test("cellText: digits, floor at zero, missing", () => {
  const adjs = LIVE_COLS.find((c) => c.id === "adjs");
  assert.equal(cellText(adjs, 1357.3), "1,357");
  assert.equal(cellText(adjs, -20), "0");
  assert.equal(cellText(LIVE_COLS.find((c) => c.id === "inf"), null), "—"); // 🪖 missing → "—" (and no emoji)
  const pvs = LIVE_COLS.find((c) => c.id === "pvs");
  assert.equal(cellText(pvs, 0.634), "0.63");
  assert.equal(cellText(pvs, 329.633), "330"); // t557u: small numbers fit 4 characters
  assert.equal(cellText(pvs, 12.345), "12.3");
  assert.equal(cellText(LIVE_COLS.find((c) => c.id === "inf"), 95.43), "95.4");
  assert.equal(cellText(LIVE_COLS.find((c) => c.id === "inf"), 100), "100");
  assert.equal(cellText(adjs, 1883.2), "1,883"); // phase A keeps the thousands separator
});
