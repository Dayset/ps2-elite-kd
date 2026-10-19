// PS2Alerts history -> archive bundles (oracle-worker/history/bundle.mjs, ingest.mjs).
// Bundles must pass the Worker's own validBundle and read back through the rescan's
// snapsFromFrames into the same map PS2Alerts started from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compact } from "../oracle-worker/history/fetch.mjs";
import { bundleFrom, keyOf } from "../oracle-worker/history/bundle.mjs";
import { plan, sizes } from "../oracle-worker/history/ingest.mjs";
import { validBundle } from "../oracle-worker/src/archive.js";
import { snapsFromFrames, rescanAlert } from "../oracle-worker/rescan.mjs";
import { regionMap } from "../oracle-worker/src/models.js";

const F = JSON.parse(readFileSync(new URL("./fixtures/ps2alerts-10-46315.json", import.meta.url), "utf8"));
const rec = () => compact(F.instance, F.entries);

test("keyOf: PS2Alerts instanceId 'world-censusInstance' -> archive key world-zone-instance", () => {
  assert.deepEqual(keyOf({ id: "10-46315", world: 10, zone: 4 }), { key: "10-4-46315", instance: 46315 });
  assert.equal(keyOf({ id: "abc", world: 10, zone: 4 }), null);
  assert.equal(keyOf({ id: "10-46315", world: "10", zone: 4 }), null);
});

test("bundleFrom: a real PS2Alerts response becomes a valid v1 bundle", () => {
  const { bundle: b, skip } = bundleFrom(rec());
  assert.equal(skip, undefined);
  assert.ok(validBundle(b), "the Worker's /archive/ingest accepts it");
  assert.equal(b.key, "10-4-46315");
  assert.equal(b.source, "ps2alerts");
  assert.equal(b.instance_id, 46315);
  assert.equal(b.winner, "NC");
  assert.equal(b.dur, 90);
  assert.equal(b.status, "settled");
  assert.deepEqual(b.final, { VS: 21, NC: 44, TR: 29, cutoff: 4, outOfPlay: 0 });
  assert.deepEqual(b.flips, [], "captures live in the frames");
  assert.equal(b.frames[0].t, 0);
  assert.equal(Object.keys(b.frames[0].set).length, 88, "every lattice facility in the first frame");
  assert.deepEqual(b.frames.slice(1), [
    { t: 10, set: { 291000: "NC", 300000: "NC" } },   // 600 s and 602 s round to the same 0.1 min
    { t: 20.1, set: { 300030: "NC" } },                // the defence at 900 s is not a frame
  ]);
  assert.deepEqual(b.score.map((x) => x[0]), [10, 10, 20.1]);
  assert.deepEqual(b.score[0], [10, 26, 40, 27, 5]);
  assert.equal(bundleFrom(rec(), { score: false }).bundle.score, undefined);
});

test("bundleFrom: frames read back through the rescan into the same map", () => {
  const { bundle: b } = bundleFrom(rec());
  const snaps = snapsFromFrames(b.frames, 4);
  const r2f = regionMap(4);
  const first = snaps[0].snap;
  const init = rec().init;
  for (const [region, fid] of Object.entries(r2f)) {
    if (!(fid in init)) continue;
    assert.equal(first[region], String(init[fid]), `region ${region}`);
  }
  const fidToRegion = Object.fromEntries(Object.entries(r2f).map(([r, f]) => [String(f), r]));
  assert.equal(snaps.at(-1).snap[fidToRegion["300030"]], "2");
});

test("bundleFrom: skips Meltdowns, out-of-scope and unscorable alerts; keeps draws", () => {
  const r = rec();
  assert.equal(bundleFrom({ ...r, event: 177 }).skip, "meltdown");
  assert.equal(bundleFrom(r, { since: r.start + 1 }).skip, "before scope");
  assert.equal(bundleFrom({ ...r, zone: 14 }).skip, "zone");
  assert.equal(bundleFrom({ ...r, result: { victor: null, draw: false } }).skip, "no winner");
  assert.equal(bundleFrom({ ...r, result: { ...r.result, victor: null, draw: true } }).bundle.winner, "draw");
  assert.equal(bundleFrom({ ...r, init: { ...r.init, 999999: 1 } }).skip, "lattice mismatch");
  assert.equal(bundleFrom({ ...r, end: null }).skip, "no end");
});

test("plan: skips archived keys (any source), keeps the newest on a recycled id, newest first", () => {
  const r = rec();
  const older = { ...r, start: r.start - 86400 * 400, end: r.end - 86400 * 400 };            // same key, recycled id
  const other = { ...r, id: "10-46316", start: r.start + 3600, end: r.end + 3600 };
  const lines = [JSON.stringify(older), JSON.stringify(r), JSON.stringify(other), "not json", JSON.stringify({ ...r, id: "10-1", event: 177 })];
  const p = plan(lines, new Map());
  assert.deepEqual(p.todo.map((b) => b.key), ["10-4-46316", "10-4-46315"]);
  assert.equal(p.todo[1].start_ts, r.start, "newest of the recycled pair");
  assert.equal(p.stats.collisions, 1);
  assert.deepEqual(p.stats.skipped, { "bad json": 1, meltdown: 1 });
  const have = new Map([["10-4-46315", { source: "worker", start_ts: r.start }]]);
  const p2 = plan(lines, have);
  assert.deepEqual(p2.todo.map((b) => b.key), ["10-4-46316"]);
  assert.equal(p2.stats.archived, 1);
  assert.equal(p2.stats.archiveCollisions, 0);
});

test("sizes: byte summary as stored (JSON text)", () => {
  const { bundle: b } = bundleFrom(rec());
  const s = sizes([b, b]);
  assert.equal(s.n, 2);
  assert.equal(s.total, 2 * JSON.stringify(b).length);
  assert.ok(s.mean < 8000, `one 90-min Indar alert stays small (${s.mean} B)`);
});

test("rescanAlert scores a backfilled bundle like a Worker bundle", () => {
  const { bundle: b } = bundleFrom(rec());
  // Pad to the rescan's minimum frame count with no-op frames at later minutes.
  const frames = [...b.frames];
  for (let m = 25; frames.length < 12; m += 5) frames.push({ t: m, set: {} });
  const res = rescanAlert({ ...b, frames }, frames);
  assert.ok(res.rows && res.rows.length > 10, JSON.stringify(res).slice(0, 200));
  assert.ok(res.end, "final-score check runs on PS2Alerts finals");
});
