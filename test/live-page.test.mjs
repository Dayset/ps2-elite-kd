import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildLive } from "../scripts/build-live.mjs";
import { classifyDeath, feedPush, graphNames, censusKd, FEED_MAX } from "../live.mjs";

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

test("feedPush: repeats bump one row, 7th opponent drops the oldest", () => {
  let rows = [];
  rows = feedPush(rows, { kind: "kill", opp: "a" }).rows;
  rows = feedPush(rows, { kind: "kill", opp: "a" }).rows;
  rows = feedPush(rows, { kind: "death", opp: "a" }).rows;
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].kills, rows[0].deaths, rows[0].last], [2, 1, "death"]);
  let dropped = null;
  for (const o of ["b", "c", "d", "e", "f", "g"]) ({ rows, dropped } = feedPush(rows, { kind: "kill", opp: o }));
  assert.equal(rows.length, FEED_MAX);
  assert.equal(dropped.opp, "a");
  assert.equal(rows[0].opp, "g");
});

test("graphNames: target first, 5 newest cached, no repeats", () => {
  assert.deepEqual(graphNames("Me", ["a", "b", "a", "me", "c", "d", "e", "f"]), ["Me", "a", "b", "c", "d", "e"]);
});

test("censusKd from stat_history", () => {
  assert.equal(censusKd({ stats: { stat_history: [{ stat_name: "kills", all_time: "30" }, { stat_name: "deaths", all_time: "10" }] } }), 3);
  assert.equal(censusKd({}), null);
});
