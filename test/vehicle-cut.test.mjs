import test from "node:test";
import assert from "node:assert/strict";
import { vehicleCutFrac, vehicleCutFor, applyVehicleCut, vehicleCutTip, setVehicleCutReviewed, isVehicleCutCleared, VEH_CUT } from "../vehicle-cut.mjs";
import { playerMetrics, normalizePlayer } from "../player-metrics.mjs";

test("curve: none to 10%, linear, −20% cap at 60%+", () => {
  assert.equal(vehicleCutFrac(0), 0);
  assert.equal(vehicleCutFrac(0.1), 0);
  assert.ok(Math.abs(vehicleCutFrac(0.35) - 0.1) < 1e-12);
  assert.ok(Math.abs(vehicleCutFrac(0.45) - 0.14) < 1e-12);
  assert.equal(vehicleCutFrac(0.6), VEH_CUT.CAP);
  assert.equal(vehicleCutFrac(1), 0.2);
  assert.equal(vehicleCutFrac(NaN), 0);
});

test("vehicle + MAX share on one curve, one cap; no data = no cut", () => {
  const inf = (foot, max, veh) => ({ v: 2, kills: foot + veh, footKills: foot, maxKills: max, vehKills: veh, otherKills: 0 });
  const a = vehicleCutFor(inf(600, 50, 400)); // 40% vehicle + 5% MAX
  assert.ok(Math.abs(a.share - 0.45) < 1e-9 && Math.abs(a.cut - 0.14) < 1e-9);
  assert.equal(vehicleCutFor(inf(400, 300, 600)).cut, 0.2); // 60% + 30% → still −20%
  assert.equal(vehicleCutFor(null), null);
  assert.equal(vehicleCutFor(inf(50, 0, 10)), null); // < 100 kills
  assert.equal(applyVehicleCut(1000, 0.14), 860);
  assert.ok(applyVehicleCut(-10, 0.1) < -10); // never rises
  assert.match(vehicleCutTip(40, 5, 14), /vehicle kills 40% \+ MAX kills 5%: −14% iVi/);
});

test("owner override (reviewed.json vehicleCutCleared)", () => {
  setVehicleCutReviewed({ vehicleCutCleared: { someone: { note: "x" } } });
  assert.ok(isVehicleCutCleared("[TAG] Someone"));
  assert.ok(!isVehicleCutCleared("other"));
  setVehicleCutReviewed(null);
});

test("playerMetrics applies the cut to adjs only and keeps the pre-cut value", () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ name: "o" + i, kills: 20 + (i % 7), deaths: 10 + (i % 5), kpm: 0.3 + (i % 20) * 0.08 }));
  const base = { player: { display: "Tester", cid: "1", global_kd: 2, global_kpm: 1.2, own_kpm: 1.4, acc: 30, hsr: 30, ivi: 900, rows } };
  const m0 = playerMetrics(normalizePlayer(base));
  const withInf = { player: { ...base.player, infantry: { v: 2, kills: 1000, footKills: 600, maxKills: 50, vehKills: 400, otherKills: 0 } } };
  const m1 = playerMetrics(normalizePlayer(withInf));
  assert.ok(Number.isFinite(m0.adjs) && m0.adjs > 0);
  assert.ok(Math.abs(m1.adjs - m0.adjs * 0.86) < 1e-6);
  assert.equal(m1.adjsPreVeh, m0.adjs);
  assert.equal(m1.rkd, m0.rkd);
  assert.ok(Math.abs(m1.vehCut - 0.14) < 1e-9);
});
