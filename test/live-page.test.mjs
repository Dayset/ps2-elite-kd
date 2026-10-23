import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildLive } from "../scripts/build-live.mjs";
import { classifyDeath, feedPush, censusStats, cellText, fmtGap, LIVE_COLS, FEED_MAX, emojiScale, goodPct, EMOJI_MIN, EMOJI_MAX, CYCLE, CYCLE_MS, cyclePhase, colUnits } from "../live.mjs";

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

test("emoji size: median 1x, best 1.8x, worst 0.55x, smooth, lower-is-better reversed", () => {
  const kd = LIVE_COLS.find((c) => c.id === "rkd");
  const apk = LIVE_COLS.find((c) => c.id === "apk");
  assert.equal(apk.lowerBetter, true);
  assert.equal(emojiScale(kd, 50), 1);
  assert.equal(emojiScale(kd, 99), EMOJI_MAX);
  assert.equal(emojiScale(kd, 0), EMOJI_MIN);
  assert.equal(EMOJI_MAX, 1.8);
  assert.equal(EMOJI_MIN, 0.55);
  assert.equal(emojiScale(apk, 0), EMOJI_MAX);
  assert.equal(emojiScale(apk, 99), EMOJI_MIN);
  assert.equal(goodPct(apk, 10), 89);
  for (let p = 1; p <= 99; p++) assert.ok(emojiScale(kd, p) >= emojiScale(kd, p - 1), "monotonic at " + p);
  for (let p = 1; p <= 99; p++) assert.ok(Math.abs(emojiScale(kd, p) - emojiScale(kd, p - 1)) < 0.03, "no jumps at " + p);
  assert.equal(emojiScale(kd, null), null);
  assert.equal(emojiScale(kd, NaN), null);
});

test("LIVE columns: one config list, iVi is the only double-width cell", () => {
  assert.deepEqual(LIVE_COLS.map((c) => c.mode), ["ivi-wide", "flip", "emoji", "emoji", "emoji"]);
  assert.equal(LIVE_COLS[0].id, "adjs");
  for (const c of LIVE_COLS) assert.ok(["ivi-wide", "flip", "emoji"].includes(c.mode), c.id);
  assert.deepEqual(LIVE_COLS.map(colUnits), [2, 1, 1, 1, 1]);
});

test("flip loop: number 2s, fade 0.4s, emoji 3s, one shared clock", () => {
  assert.deepEqual(CYCLE, { num: 2000, fade: 400, emoji: 3000 });
  assert.equal(CYCLE_MS, 5800);
  assert.equal(cyclePhase(5800 * 3 + 1234), "-1234ms");
  const css = readFileSync(new URL("styles.css", root), "utf8");
  assert.match(css, /animation: lvNum 5\.8s/);
  assert.match(css, /prefers-reduced-motion/);
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
  assert.equal(cellText(LIVE_COLS.find((c) => c.id === "rkd"), null), "—");
});
