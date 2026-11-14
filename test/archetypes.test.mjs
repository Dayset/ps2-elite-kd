/**
 * Archetypes page (archetypes.mjs): the v2 decision tree, live medians,
 * and the 2026-11-14 PC snapshot counts.
 *
 * The tree is order-sensitive by design — vehicle beats zerg, peaky and
 * selective beat elite — so the tests pin the order, not just the rules.
 * Snapshot numbers below are the live values from data/ranks.json at
 * 2026-11-14 (19,962 rows) computed with the site's own zergScore
 * (revive/crowd softening included).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ARCHETYPES, ARCHETYPE_BY_ID, classifyArchetype, buildArchetypes, median, normName,
} from "../archetypes.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readRanks = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));

// Named players, values straight from the 2026-11-03 PC snapshot.
const NAMED = {
  xCloneKano: { adjs: 2337.83, kd: 4.13, ownKpm: 4.51, pvs: 15.65, cons: 0.57, inf: 98.3, inflation: 2.31, zerg: 14 },
  Zyr0s: { adjs: 2255.8, kd: 3.78, ownKpm: 3.56, pvs: 12.11, cons: 0.48, inf: 98.2, inflation: 1.78, zerg: 6 },
  Fantom220TR: { adjs: 1724.2, kd: 4.67, ownKpm: 1.85, pvs: 8.12, cons: 0.65, inf: 80.6, inflation: 2.35, zerg: 28 },
  Simplenubb: { adjs: 2476, kd: 5.89, ownKpm: 3.29, pvs: 10.05, cons: 0.57, inf: 99.9, inflation: 2.01, zerg: 9 },
  botWaz: { adjs: 1357.32, kd: 2.77, ownKpm: 1.72, pvs: 4.86, cons: 0.48, inf: 93, inflation: 1.98, zerg: 8 },
  Bhorn: { adjs: 1155.8, kd: 4.01, ownKpm: 1.34, pvs: 3.51, cons: 0.4, inf: 80.1, inflation: 3.58, zerg: 94 },
  Artofdying: { adjs: 2311, kd: 9.77, ownKpm: 0.98, pvs: 3.83, cons: 0.84, inf: 99.8, inflation: 2.06, zerg: 44 },
  Aekris: { adjs: 2772, kd: 9.7, ownKpm: 1.03, pvs: 0.09, cons: 0.38, inf: 98.9, inflation: 1.62, zerg: 8 },
  DizzyKnight: { adjs: 1976, kd: 5.74, ownKpm: 1.45, pvs: 0.1, cons: 0.5, inf: 98, inflation: 1.9, zerg: 10 },
  ShloDog: { adjs: 473.2, kd: 0.87, ownKpm: 0.4, pvs: 0.63, cons: 0.64, inf: 95.4, inflation: 1.57, zerg: 6 },
  ALandWhale: { adjs: 1973.3, kd: 4.3, ownKpm: 1.35, pvs: 1.71, cons: 0.45, inf: 80.5, inflation: 1.23, zerg: 1 },
};

test("tree has eleven archetypes in the documented order", () => {
  assert.deepEqual(ARCHETYPES.map((a) => a.id), [
    "vehicle", "zerg", "peaky", "selective", "elite", "grinder", "soft", "steady", "solid", "mid", "below",
  ]);
  for (const a of ARCHETYPES) assert.equal(ARCHETYPE_BY_ID[a.id], a);
});

test("named players land where the prototype put them", () => {
  const want = {
    xCloneKano: "elite", Zyr0s: "elite", Fantom220TR: "elite", Simplenubb: "elite",
    botWaz: "grinder", Bhorn: "zerg", Artofdying: "selective",
    Aekris: "peaky", DizzyKnight: "peaky", ShloDog: "mid",
    // Known gap, pinned: low-assist forensics is not a zerg signal.
    ALandWhale: "solid",
  };
  for (const [name, id] of Object.entries(want)) {
    assert.equal(classifyArchetype(NAMED[name]), id, name);
  }
});

test("order beats single rules: vehicle before zerg, peaky/selective before elite", () => {
  // Vehicle-heavy AND zerg-riding → vehicle (first rule wins).
  assert.equal(classifyArchetype({ inf: 35, inflation: 4.0, zerg: 90, adjs: 500, kd: 2, ownKpm: 0.5, pvs: 0.5, cons: 0.5 }), "vehicle");
  // Peaky numbers that would also clear elite → peaky.
  assert.equal(classifyArchetype({ inf: 98, inflation: 1.6, zerg: 8, adjs: 2772, kd: 9.7, ownKpm: 1.03, pvs: 0.09, cons: 0.38 }), "peaky");
  // Selective pace that would also clear elite on adjs+Brave → selective.
  assert.equal(classifyArchetype({ inf: 99, inflation: 2.0, zerg: 44, adjs: 2311, kd: 9.77, ownKpm: 0.98, pvs: 3.83, cons: 0.84 }), "selective");
  // Zerg by inflation alone when assists are missing (zerg null).
  assert.equal(classifyArchetype({ inf: 85, inflation: 3.6, zerg: null, adjs: 100, kd: 1, ownKpm: 0.3, pvs: 0.3, cons: 0.5 }), "zerg");
  // No adjs at all → unassigned, never a skill tier.
  assert.equal(classifyArchetype({ inf: 85, inflation: 2.0, zerg: 10, adjs: null, kd: 1, ownKpm: 0.3, pvs: 0.3, cons: 0.5 }), null);
  assert.equal(classifyArchetype({}), null);
});

test("median ignores missing values, handles even counts", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([1, null, 3]), 2);
  assert.equal(median([null, undefined]), null);
  assert.equal(median([]), null);
});

const FIXTURE = {
  updatedAt: "2026-11-03T18:59:53.795Z",
  cols: ["name", "slug", "adjs", "adj", "ivi", "kd", "kpm", "ownKpm", "pvs", "cons", "inf", "inflation", "apk", "acc", "hsr", "rkd", "hut", "vdf", "nbd", "rvp", "crp"],
  rows: [
    ["EliteOne", "eliteone", 2000, 1900, 1200, 3.5, 1.2, 2.0, 6.0, 0.55, 99, 1.9, 0.2, 32, 35, 2.0, null, null, null, 10, 10],
    ["VehicleOne", "vehicleone", 500, 450, 400, 1.5, 0.4, 0.4, 0.6, 0.5, 35, 2.0, 0.3, 20, 6, 0.9, null, null, null, 10, 10],
    ["MidOne", "midone", 400, 380, 300, 1.0, 0.3, 0.4, 0.6, 0.55, 85, 2.0, 0.4, 20, 18, 0.6, null, null, null, 10, 10],
    ["BelowOne", "belowone", -300, -300, 100, 0.4, 0.1, 0.2, 0.15, 0.5, 80, 2.0, 0.4, 15, 14, 0.25, null, null, null, 10, 10],
    ["NoAdjs", "noadjs", null, null, 100, 0.5, 0.2, 0.2, 0.2, 0.5, 80, 2.0, 0.4, 15, 14, 0.3, null, null, null, 10, 10],
    // Same name twice: first row wins, like the Rankings join.
    ["EliteOne", "eliteone", 100, 90, 100, 1.0, 0.3, 0.4, 0.6, 0.5, 99, 1.9, 0.2, 32, 35, 2.0, null, null, null, 10, 10],
  ],
};

test("buildArchetypes groups a fixture, dedupes names, counts the unassigned", () => {
  const d = buildArchetypes(FIXTURE);
  assert.equal(d.total, 5);
  assert.equal(d.unassigned, 1);
  assert.equal(d.groups.elite.n, 1);
  assert.equal(d.groups.vehicle.n, 1);
  assert.equal(d.groups.mid.n, 1);
  assert.equal(d.groups.below.n, 1);
  assert.equal(d.groups.elite.med.adjs, 2000);
  assert.equal(d.groups.elite.top[0].name, "EliteOne");
  assert.equal(d.byName.get(normName("EliteOne")).archetype, "elite");
  assert.equal(d.byName.get(normName("NoAdjs")).archetype, null);
});

test("live PC snapshot: counts match the 2026-11-14 snapshot (zergScore, not raw-min zerg)", () => {
  const d = buildArchetypes(readRanks("data/ranks.json"));
  assert.equal(d.total, 19962);
  assert.equal(d.unassigned, 64);
  assert.deepEqual(
    Object.fromEntries(ARCHETYPES.map((a) => [a.id, d.groups[a.id].n])),
    { vehicle: 1479, zerg: 1585, peaky: 41, selective: 79, elite: 729, grinder: 635, soft: 495, steady: 1724, solid: 1541, mid: 8358, below: 3232 },
  );
  // Prototype medians (spot-checks, not the whole table; medians are
  // unrounded here, the page rounds them for display).
  assert.equal(Math.round(d.groups.elite.med.adjs), 1742);
  assert.equal(Math.round(d.groups.vehicle.med.inf), 34);
  assert.equal(d.groups.zerg.med.zerg, 82);
  assert.ok(Math.abs(d.groups.peaky.med.pvs - 0.10) < 0.005);
  // Named players land in the live build too, by name lookup.
  assert.equal(d.byName.get(normName("xCloneKano")).archetype, "elite");
  assert.equal(d.byName.get(normName("Bhorn")).archetype, "zerg");
  assert.equal(d.byName.get(normName("Artofdying")).archetype, "selective");
  assert.equal(d.byName.get(normName("Aekris")).archetype, "peaky");
  assert.equal(d.byName.get(normName("ShloDog")).archetype, "mid");
});

test("live PS snapshot: same tree runs, zerg known only where assists exist", () => {
  // 2,355 unique names, not the file's 2,370 rows: 15 PS names collide
  // after tag-strip/lowercase normalising (PC has 0 such collisions),
  // and the first row wins, like the Rankings join.
  const d = buildArchetypes(readRanks("data-ps/ranks.json"));
  assert.equal(d.total, 2355);
  const zergKnown = d.players.filter((p) => p.zerg != null).length;
  assert.ok(zergKnown > 0 && zergKnown < d.total, `zerg known for ${zergKnown} of ${d.total}`);
  const assigned = d.total - d.unassigned;
  assert.ok(assigned / d.total > 0.95, `${assigned} assigned`);
});
