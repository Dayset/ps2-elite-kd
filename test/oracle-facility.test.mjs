// #114 follow-up: Capture Facility Alerts odds model (oracle-worker/src/facility.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FACILITY_TARGETS, facilityWin, facilityState, endDist, FAC_LAMBDA } from "../oracle-worker/src/facility.js";
import { OTHER_ALERTS } from "../oracle-worker/src/engine.js";

const SLUG = { 2: "indar", 4: "hossin", 6: "amerish", 8: "esamir" };
const TYPE = { amp: ["2", "16"], biolab: ["3"], tech: ["4"] };

test("target table matches the regions files (3 per type where the game has 3)", () => {
  for (const [z, slug] of Object.entries(SLUG)) {
    const reg = JSON.parse(readFileSync(new URL(`../oracle/backend/${slug}_regions.json`, import.meta.url), "utf8"));
    for (const [sub, types] of Object.entries(TYPE)) {
      const want = reg.filter((r) => types.includes(String(r.facility_type_id))).map((r) => [+r.facility_id, r.facility_name]);
      if (want.length === 3) assert.deepEqual(FACILITY_TARGETS[z][sub], want, `${slug} ${sub}`);
      else assert.equal((FACILITY_TARGETS[z] || {})[sub], undefined, `${slug} ${sub}: not 3 targets`);
    }
  }
  for (const id of [7, 10, 13, 16, 8, 11, 17, 164, 9, 12, 14, 18]) assert.equal(OTHER_ALERTS[id].type, "facility");
});

test("odds: sum to 1, all three held = won, more time = closer to even", () => {
  const sum = (w) => w.VS + w.NC + w.TR;
  const a = facilityWin(["NC", "NC", "TR"], 44);
  assert.ok(Math.abs(sum(a) - 1) < 1e-9);
  assert.ok(a.NC > 0.5 && a.TR > a.VS);
  assert.deepEqual(facilityWin(["TR", "TR", "TR"], 30), { VS: 0, NC: 0, TR: 1 });
  const late = facilityWin(["NC", "NC", "TR"], 2), early = facilityWin(["NC", "NC", "TR"], 44);
  assert.ok(late.NC > early.NC);
  const even = facilityWin(["VS", "NC", "TR"], 20);
  assert.ok(Math.abs(even.VS - 1 / 3) < 1e-9);
  assert.deepEqual(endDist(null, 10), [1 / 3, 1 / 3, 1 / 3]);
  assert.equal(FAC_LAMBDA, 0.012);
});

test("orders: take where the faction can reach, hold what it has", () => {
  // Hossin biolabs; adjacency: VS reaches Bitol only.
  const owners = { 302000: "NC", 303000: "NC", 304000: "TR", 9: "VS" };
  const adj = new Map([[302000, [304000]], [303000, [9, 302000]], [304000, [302000]]]);
  const s = facilityState({ zone: 4, sub: "biolab", owners, t: 10, dur: 45, adj });
  assert.deepEqual(s.count, { VS: 0, NC: 2, TR: 1 });
  assert.equal(s.orders.VS.move, "take"); assert.equal(s.orders.VS.name, "Bitol");
  assert.deepEqual([s.orders.NC.move, s.orders.NC.name], ["take", "Zotz"], "NC can reach Zotz: taking it wins outright");
  assert.equal(s.orders.TR.move, "take"); // TR reaches Acan (next to Zotz)
  assert.equal(facilityState({ zone: 8, sub: "biolab", owners, t: 0, dur: 45 }), null, "Esamir has no 3 Biolabs");
});
