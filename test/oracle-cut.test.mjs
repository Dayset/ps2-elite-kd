// Cut-aware territory (oracle-worker/src/cut.js) and the rescan scorer
// (oracle-worker/rescan.mjs). Fixture: last map snapshot before the end of three
// real alerts with Census' final scores (D1, 2026-10-18).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cutBases, cutAwareSnap } from "../oracle-worker/src/cut.js";
import { territory } from "../oracle-worker/src/engine.js";
import { snapsFromFrames, rescanAlert, summarize, grid } from "../oracle-worker/rescan.mjs";
import { regionMap } from "../oracle-worker/src/models.js";

const S = JSON.parse(readFileSync(new URL("./fixtures/cut-end-snapshots.json", import.meta.url), "utf8"));

test("cut bases: 10-4-46315 ended with four VS bases cut off from the VS warpgate", () => {
  const a = S["10-4-46315"];
  const cut = cutBases(a.z, a.zone);
  assert.deepEqual(cut.map((c) => c.name).sort(), ["Acan", "Cairn Station", "Hurakan", "Hurakan Southern Depot"]);
  assert.ok(cut.every((c) => c.fac === "VS"));
  // Census scored VS 21.2 %: the raw map says 26.1 %, cut-aware 21.6 %.
  const raw = territory(a.z), adj = territory(cutAwareSnap(a.z, a.zone).snap);
  assert.ok(Math.abs(adj.VS - a.final.VS) < Math.abs(raw.VS - a.final.VS));
  assert.equal(adj.NC, raw.NC);
});

test("cut-aware snapshot leaves an uncut map alone and never mutates the input", () => {
  const a = S["10-2-46310"];
  const r = cutAwareSnap(a.z, a.zone);
  assert.equal(r.cut.length, 0);
  assert.equal(r.snap, a.z);
  const b = S["1-4-49349"], before = JSON.stringify(b.z);
  const rb = cutAwareSnap(b.z, b.zone);
  assert.deepEqual(rb.cut.map((c) => `${c.name}/${c.fac}`), ["Johari Cove/TR"]);
  assert.equal(JSON.stringify(b.z), before);
  assert.equal(rb.snap["4117"], "0");
  assert.equal(cutBases({}, 999), null, "no lattice -> null");
});

test("rescan: frames rebuild the map, both variants scored on the same minutes", () => {
  const a = S["10-4-46315"];
  const r2f = regionMap(4);
  const fullSet = Object.fromEntries(Object.entries(a.z).map(([r, v]) => [r2f[r], { 1: "VS", 2: "NC", 3: "TR" }[v] || null]));
  // One frame per minute; the final map from minute 70 on (cut in place for the last 20 min).
  const frames = [{ t: 0, set: fullSet }];
  for (let t = 1; t <= 90; t++) frames.push({ t, set: {} });
  const snaps = snapsFromFrames(frames, 4);
  assert.equal(Object.keys(snaps[0].snap).length, 88);
  assert.equal(snaps[0].snap["4150"], "1");
  const res = rescanAlert({ key: "10-4-46315", zone: 4, event_id: 154, dur: 90, winner: "NC", final: a.final }, frames);
  assert.ok(res.rows.length >= grid(90).length - 1, JSON.stringify(res).slice(0, 200));
  assert.ok(res.rows.every((x) => x.cutN === 4));
  assert.ok(res.end.cutErr < res.end.rawErr, JSON.stringify(res.end));
  const s = summarize([res, { key: "x", skip: "meltdown" }]);
  assert.equal(s.alerts, 1);
  assert.equal(s.final_check.cut_closer, 1);
  assert.equal(s.skipped.meltdown, 1);
  assert.ok(s.minutes.with_cut.n === s.minutes.all.n);
  assert.deepEqual(rescanAlert({ key: "m", zone: 4, event_id: 177, dur: 90, winner: "VS" }, frames).skip, "meltdown");
});
