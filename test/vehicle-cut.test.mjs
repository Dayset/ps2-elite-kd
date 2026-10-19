import test from "node:test";
import assert from "node:assert/strict";
import { vehicleCutFrac, vehicleCutFor, applyVehicleCut, vehicleCutTip, setVehicleCutReviewed, isVehicleCutCleared } from "../vehicle-cut.mjs";
import { playerMetrics, normalizePlayer } from "../player-metrics.mjs";

const near = (a, b) => Math.abs(a - b) < 1e-9;

test("curve: max(0, share − 10%), no cap", () => {
  assert.equal(vehicleCutFrac(0), 0);
  assert.equal(vehicleCutFrac(0.1), 0);
  assert.ok(near(vehicleCutFrac(0.45), 0.35));
  assert.ok(near(vehicleCutFrac(0.96), 0.86));
  assert.ok(near(vehicleCutFrac(1), 0.9));
  assert.equal(vehicleCutFrac(NaN), 0);
});

test("two parts (vehicle, MAX) added up; no data = no cut", () => {
  const inf = (foot, max, veh) => ({ v: 2, kills: foot + veh, footKills: foot, maxKills: max, vehKills: veh, otherKills: 0 });
  const a = vehicleCutFor(inf(600, 50, 400)); // 40% vehicle, 5% MAX
  assert.ok(near(a.cutVeh, 0.3) && a.cutMax === 0 && near(a.cut, 0.3));
  const b = vehicleCutFor(inf(550, 400, 450)); // 45% vehicle + 40% MAX → −35% − 30%
  assert.ok(near(b.cutVeh, 0.35) && near(b.cutMax, 0.3) && near(b.cut, 0.65));
  assert.ok(near(vehicleCutFor(inf(40, 0, 960)).cut, 0.86)); // vehicle 96% → −86%
  assert.ok(vehicleCutFor(inf(0, 0, 1000)).cut < 1); // 100% vehicle → −90%, never −100%
  assert.ok(vehicleCutFor(inf(500, 500, 500)).cut <= 0.8 + 1e-9); // shares ≤ 100% → at most −80%
  assert.equal(vehicleCutFor(null), null);
  assert.equal(vehicleCutFor(inf(50, 0, 10)), null); // < 100 kills
  assert.ok(near(applyVehicleCut(1000, 0.65), 350));
  assert.ok(applyVehicleCut(1000, 0.86) > 0); // positive stays positive
  assert.ok(applyVehicleCut(-10, 0.5) < -10); // ≤ 0 only falls, no sign flip
  assert.equal(applyVehicleCut(0, 0.5) <= 0, true);
});

test("hover text lists each part and the total", () => {
  assert.equal(vehicleCutTip(45, 40, 65), "vehicle kills 45%: −35% · MAX kills 40%: −30% → −65% iVi, infantry skill only");
  assert.equal(vehicleCutTip(96, 2, 86), "vehicle kills 96%: −86% iVi, infantry skill only");
  assert.equal(vehicleCutTip(5, 23, 13), "MAX kills 23%: −13% iVi, infantry skill only");
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
  assert.ok(Math.abs(m1.adjs - m0.adjs * 0.7) < 1e-6); // 40% vehicle → −30%, 5% MAX → 0
  assert.equal(m1.adjsPreVeh, m0.adjs);
  assert.equal(m1.rkd, m0.rkd);
  assert.ok(near(m1.vehCut, 0.3));
});
