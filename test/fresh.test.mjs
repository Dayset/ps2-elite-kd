/**
 * 🌱 Fresh accounts page (fresh.mjs): 30-day age rule, top-1% Pure
 * cutoff, dedupe, and the live snapshot shape.
 *
 * The fixture pins the rules exactly (constant inflation/apk pools make
 * 🪳 Zerg 0 for everyone, so 🧘 Pure = adjs and the cutoff is hand-
 * computable). The live tests are relational only — the bot refreshes
 * ranks.json, so exact counts rot (the archetypes pins already do);
 * they assert the shape that must hold on any snapshot.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  FRESH_DAYS, buildFresh, normName, serverLabel,
  ageDaysAt, isFreshAge, playerSheetUrl,
} from "../fresh.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readRanks = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));

const SNAP = "2026-11-03T18:59:53.795Z";
const SNAP_SEC = Date.parse(SNAP) / 1000;
const D = (days) => SNAP_SEC - days * 86400;

const COLS = ["name", "slug", "adjs", "adj", "ivi", "kd", "kpm", "ownKpm", "pvs", "cons", "inf",
  "inflation", "apk", "acc", "hsr", "rkd", "hut", "vdf", "nbd", "rvp", "crp", "created", "srv"];
// Constant inflation/apk pools → every 🪳 Zerg is 0 → 🧘 Pure = adjs.
const row = (name, adjs, created, extra = {}) => [
  name, name.toLowerCase(), adjs, adjs, 1000, 2.0, 1.0, 2.0, 5.0, 0.5, 99,
  2.0, 0.2, 30, 30, 1.5, null, null, null, null, null, created, "wainwright",
].map((v, i) => (extra[COLS[i]] !== undefined ? extra[COLS[i]] : v));

const FIXTURE = {
  updatedAt: SNAP,
  cols: COLS,
  rows: [
    row("FreshTop", 1000, D(5)),
    row("FreshMid", 500, D(30)), // exactly 30 days: fresh (boundary inclusive)
    row("FreshLow", 100, D(1)),
    row("OldHigh", 900, D(31)), // 31 days: not fresh
    row("OldLow", 200, D(1000)),
    row("FutureKid", 800, D(-1)), // created after the snapshot: not fresh
    row("NoCreated", 700, null),
    row("NoAdjs", null, D(2)), // fresh, but no Pure
    row("FreshNoZerg", 600, D(3), { apk: null }), // fresh, no 🪳 → no Pure
    row("FreshTop", 50, D(5)), // duplicate name: first row wins
  ],
};

test("age rule: 0 and 30 days are fresh, 31 and negative are not", () => {
  assert.equal(FRESH_DAYS, 30);
  assert.equal(ageDaysAt(D(0), SNAP_SEC), 0);
  assert.equal(ageDaysAt(D(30), SNAP_SEC), 30);
  assert.equal(isFreshAge(0), true);
  assert.equal(isFreshAge(30), true);
  assert.equal(isFreshAge(30.0001), false);
  assert.equal(isFreshAge(31), false);
  assert.equal(isFreshAge(-1), false);
  assert.equal(isFreshAge(null), false);
  assert.equal(ageDaysAt(null, SNAP_SEC), null);
});

test("server labels: PC worlds and PS us/eu", () => {
  assert.equal(serverLabel("wainwright"), "Wainwright");
  assert.equal(serverLabel("osprey"), "Osprey");
  assert.equal(serverLabel("us"), "Genudine");
  assert.equal(serverLabel("eu"), "Ceres");
  assert.equal(serverLabel(null), "—");
  assert.equal(serverLabel(""), "—");
});

test("fixture: fresh set, Pure ranking, top-1% cutoff and dedupe", () => {
  const d = buildFresh(FIXTURE);
  assert.equal(d.updatedAt, SNAP);
  assert.equal(d.total, 9); // duplicate FreshTop dropped, first row wins
  assert.equal(d.withPure, 7);
  assert.equal(d.topN, 1); // ceil(1% of 7)
  assert.equal(d.cutoff, 1000);
  assert.equal(d.bottomN, 1); // ceil(1% of 7)
  assert.equal(d.bottomCutoff, 100); // worst Pure in the fixture
  assert.deepEqual(d.worstFresh.map((p) => p.name), ["FreshLow"]);
  assert.equal(d.byName.get(normName("FreshLow")).worst1, true);
  assert.equal(d.byName.get(normName("FreshTop")).worst1, false);
  assert.equal(d.fresh.length, 5);
  assert.equal(d.freshNoPure, 2); // NoAdjs + FreshNoZerg
  assert.deepEqual(d.freshPure.map((p) => p.name), ["FreshTop", "FreshMid", "FreshLow"]);
  assert.deepEqual(d.topFresh.map((p) => p.name), ["FreshTop"]);
  assert.equal(d.byName.get(normName("FreshTop")).adjs, 1000); // dup's 50 ignored
  assert.equal(d.byName.get(normName("FreshTop")).overallRank, 1);
  assert.equal(d.byName.get(normName("FreshTop")).top1, true);
  assert.equal(d.byName.get(normName("OldHigh")).overallRank, 2);
  assert.equal(d.byName.get(normName("OldHigh")).fresh, false);
  assert.equal(d.byName.get(normName("FreshMid")).fresh, true);
  assert.equal(d.byName.get(normName("OldHigh")).fresh, false);
  assert.equal(d.byName.get(normName("FutureKid")).fresh, false);
  assert.equal(d.byName.get(normName("NoCreated")).fresh, false);
  assert.equal(d.byName.get(normName("NoAdjs")).pure, null);
  assert.equal(d.byName.get(normName("FreshNoZerg")).pure, null);
  assert.equal(d.byName.get(normName("FreshMid")).srv, "wainwright");
  assert.equal(playerSheetUrl("FreshTop"), "index.html?names=FreshTop");
});

test("empty or malformed input builds an empty result, never throws", () => {
  assert.deepEqual(buildFresh(null), {
    updatedAt: null, total: 0, withPure: 0, topN: 0, cutoff: null, bottomN: 0, bottomCutoff: null,
    players: [], fresh: [], freshPure: [], freshNoPure: 0, topFresh: [], worstFresh: [], byName: new Map(),
  });
  assert.equal(buildFresh({ cols: [], rows: [] }).total, 0);
});

function checkLiveShape(d, label, minTotal, minWithPure, minFresh) {
  assert.ok(d.total > minTotal, `${label}: total ${d.total}`);
  assert.ok(d.withPure > minWithPure, `${label}: withPure ${d.withPure}`);
  assert.equal(d.topN, Math.ceil(d.withPure * 0.01), `${label}: topN`);
  assert.ok(d.cutoff > 1000, `${label}: cutoff ${d.cutoff}`);
  assert.equal(d.bottomN, Math.ceil(d.withPure * 0.01), `${label}: bottomN`);
  assert.ok(d.bottomCutoff < 0, `${label}: bottomCutoff ${d.bottomCutoff}`);
  assert.ok(d.bottomCutoff < d.cutoff, `${label}: bottom below top`);
  assert.deepEqual(
    d.worstFresh.map((p) => p.name),
    d.freshPure.filter((p) => p.pure <= d.bottomCutoff).sort((a, b) => a.pure - b.pure).map((p) => p.name),
    `${label}: worstFresh is exactly the fresh players at/below the bottom cutoff, worst first`,
  );
  for (let i = 1; i < d.worstFresh.length; i++) {
    assert.ok(d.worstFresh[i - 1].pure <= d.worstFresh[i].pure, `${label}: worstFresh sorted worst-first`);
  }
  for (const p of d.worstFresh) assert.equal(p.worst1, true, `${label}: ${p.name} flagged worst1`);
  assert.ok(d.fresh.length > minFresh, `${label}: fresh ${d.fresh.length}`);
  assert.ok(d.freshPure.length > 0, `${label}: freshPure`);
  assert.equal(d.fresh.length, d.freshPure.length + d.freshNoPure, `${label}: fresh split`);
  for (const p of d.fresh) assert.ok(p.ageDays >= 0 && p.ageDays <= 30, `${label}: ${p.name} age ${p.ageDays}`);
  for (let i = 1; i < d.freshPure.length; i++) {
    assert.ok(d.freshPure[i - 1].pure >= d.freshPure[i].pure, `${label}: freshPure sorted`);
  }
  assert.deepEqual(
    d.topFresh.map((p) => p.name),
    d.freshPure.filter((p) => p.pure >= d.cutoff).map((p) => p.name),
    `${label}: topFresh is exactly the fresh players at/above the cutoff`,
  );
  for (const p of d.topFresh) assert.equal(p.top1, true, `${label}: ${p.name} flagged top1`);
  const top = d.freshPure[0];
  assert.equal(d.byName.get(normName(top.name)), top, `${label}: byName finds the top fresh player`);
}

test("live PC snapshot: shape holds (relational, no pinned counts)", () => {
  checkLiveShape(buildFresh(readRanks("data/ranks.json")), "PC", 15000, 5000, 500);
});

test("live PS snapshot: shape holds (relational, no pinned counts)", () => {
  checkLiveShape(buildFresh(readRanks("data-ps/ranks.json")), "PS", 2000, 500, 50);
});
