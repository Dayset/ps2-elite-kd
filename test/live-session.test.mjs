// Live session values (owner 2026-11-08): raw, no rounding, session-scoped —
// ☠️ K/D, 🪖 Infantry, 🤝 Assists, 🪳 Zerg, 🌈 G — same treatment as 🎲 luck.
import test from "node:test";
import assert from "node:assert/strict";
import { traitPools } from "../trait-scores.mjs";
import {
  SESS_MIN_KILLS, SESS_ANCHOR_W, sessionReady, sessionKd, isFootWeapon, sessionInf,
  sessionApk, sessionInflation, quantile, sessionBrave, sessionZerg,
  sessionG, sessText, anchorValue,
} from "../live-session.mjs";

// Catalog stub: items[id] = [name, category, ?, image].
const cat = {
  items: {
    1: ["Orion VS54", "LMG", "", "img1"],
    2: ["M20 Basilisk", "Vehicle Weapons", "", "img2"],
    3: ["Mercenary", "Carbine", "", "img3"],
    4: ["Quasar VM1", "AI MAX (Left)", "", "img4"],
    5: ["MANA Anti-Infantry Turret", "Infantry Abilities", "", "img5"],
    6: ["Glaive IPC", "Infantry Abilities", "", "img6"],
    7: ["Unlisted", "", "", "img7"],
  },
};

test("sessionReady: floor is 10 kills", () => {
  assert.equal(sessionReady(9), false);
  assert.equal(sessionReady(10), true);
  assert.equal(sessionReady(SESS_MIN_KILLS), true);
});

test("sessionKd: kills ÷ deaths, ∞ with no deaths, null with no kills", () => {
  assert.equal(sessionKd(20, 10), 2);
  assert.equal(sessionKd(5, 0), Infinity);
  assert.equal(sessionKd(0, 0), null);
  assert.equal(sessionKd(0, 5), null);
});

test("isFootWeapon: vehicle category, MAX, MANA, Glaive, unknown", () => {
  assert.equal(isFootWeapon(cat, "1"), true); // LMG
  assert.equal(isFootWeapon(cat, "2"), false); // Vehicle Weapons
  assert.equal(isFootWeapon(cat, "3"), true); // Carbine
  assert.equal(isFootWeapon(cat, "4"), true); // MAX counts as foot
  assert.equal(isFootWeapon(cat, "5"), false); // MANA turret
  assert.equal(isFootWeapon(cat, "6"), false); // Glaive
  assert.equal(isFootWeapon(cat, "7"), null); // empty category
  assert.equal(isFootWeapon(cat, "999"), null); // unlisted
  assert.equal(isFootWeapon(cat, null), null);
  assert.equal(isFootWeapon(null, "1"), null);
});

test("sessionInf: foot share over classified kills only", () => {
  const r = sessionInf(["1", "2", "3", "4", "999", null], cat);
  assert.equal(r.foot, 3);
  assert.equal(r.total, 4);
  assert.ok(Math.abs(r.share - 0.75) < 1e-12, `share ${r.share}`);
  assert.equal(sessionInf(["999", null], cat), null);
  assert.equal(sessionInf([], cat), null);
  assert.equal(sessionInf(["1"], null), null);
});

test("sessionApk: assists ÷ kills", () => {
  assert.equal(sessionApk(6, 10), 0.6);
  assert.equal(sessionApk(0, 10), 0);
  assert.equal(sessionApk(3, 0), null);
});

test("sessionInflation: my iVi ÷ mean opponent iVi", () => {
  const fights = [{ iv: 200 }, { iv: 200 }, { iv: null }, { iv: -5 }];
  assert.equal(sessionInflation(400, fights), 2);
  assert.equal(sessionInflation(400, [{ iv: null }]), null);
  assert.equal(sessionInflation(null, fights), null);
  assert.equal(sessionInflation(400, []), null);
});

test("quantile: linear interpolation, single value", () => {
  assert.ok(Math.abs(quantile([1, 2, 3, 4], 0.9) - 3.7) < 1e-12);
  assert.equal(quantile([5], 0.9), 5);
  assert.equal(quantile([], 0.9), null);
});

test("sessionBrave: KPM ÷ p90 opponent Activity", () => {
  // 30 kills in 10 min = 3 KPM; p90 of [1, 2, 3] = 2.8 → 3 / 2.8.
  const b = sessionBrave(30, 10, [1, 2, 3]);
  assert.ok(Math.abs(b - 3 / 2.8) < 1e-12, `brave ${b}`);
  assert.equal(sessionBrave(30, 10, []), null);
  assert.equal(sessionBrave(30, 0, [1, 2]), null);
  assert.equal(sessionBrave(0, 10, [1, 2]), null);
});

test("sessionZerg: lower of the two percentiles, null on missing inputs", () => {
  // 100-player pools: inflation 1..2 (percentile of 1.5 ≈ 50), apk 0..1 (0.6 ≈ 60) → min ≈ 50.
  const tp = traitPools({
    inflation: Array.from({ length: 100 }, (_, i) => 1 + i / 99),
    apk: Array.from({ length: 100 }, (_, i) => i / 99),
  });
  const z = sessionZerg(tp, 1.5, 0.6);
  assert.ok(Number.isFinite(z) && z >= 0 && z <= 99, `zerg ${z}`);
  assert.ok(Math.abs(z - 50) < 3, `zerg ${z}`);
  assert.equal(sessionZerg(tp, null, 0.6), null);
  assert.equal(sessionZerg(tp, 1.5, null), null);
});

test("sessionG: (share beaten on K/D) × (share beaten on Brave) × 100", () => {
  assert.ok(Math.abs(sessionG(0.9, 0.8) - 72) < 1e-12);
  assert.ok(Math.abs(sessionG(1, 1) - 100) < 1e-12);
  assert.ok(Math.abs(sessionG(0, 0.5) - 0) < 1e-12);
  assert.equal(sessionG(null, 0.8), null);
  assert.equal(sessionG(0.9, 1.2), null);
});

test("sessText: raw shortest-round-trip string, ∞ stays ∞", () => {
  assert.equal(sessText(2.4000000000000004), "2.4000000000000004");
  assert.equal(sessText(0.6000000000000001), "0.6000000000000001");
  assert.equal(sessText(Infinity), "∞");
  assert.equal(sessText(null), "–");
});

test("anchorValue: lifetime counts as W observations, first session observation moves it ~1/(W+1)", () => {
  assert.equal(SESS_ANCHOR_W, 100);
  // K/D: lifetime 2.0, session 10 kills / 0 deaths → (100×2 + 10)/100 = 2.1 (finite — no ∞).
  assert.ok(Math.abs(anchorValue(2, 10, 0) - 2.1) < 1e-12);
  // K/D: lifetime 2.0, session 10 kills / 10 deaths → (200 + 10)/110 ≈ 1.909.
  assert.ok(Math.abs(anchorValue(2, 10, 10) - 210 / 110) < 1e-12);
  // Infantry share: lifetime 0.9, session 3 foot of 4 → (90 + 3)/104 ≈ 0.894.
  assert.ok(Math.abs(anchorValue(0.9, 3, 4) - 93 / 104) < 1e-12);
  // As the session grows the anchor washes out: 100 session deaths at K/D 1 → (200 + 100)/200 = 1.5.
  assert.ok(Math.abs(anchorValue(2, 100, 100) - 1.5) < 1e-12);
  assert.equal(anchorValue(null, 10, 10), null);
  assert.equal(anchorValue(2, 10, -1), null);
});
