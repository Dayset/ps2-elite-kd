// weapons-model.mjs: damage falloff, ideal TTK, exact accuracy distribution, reloads, DPS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  damageAt, hitDamage, timeOfShot, ttkDistribution, quantileMs, chanceByMs, minShots, idealTtk,
  medianTtk, dps, rangeAxis, ttkCurve, winnerStrip, slowerPct, withCadence, fpsFireRateDrop, withFpsLimit,
  ttkHistogram, stkHistogram, deepBands,
} from "../weapons-model.mjs";
import { toProfile } from "../replay/weapons.mjs";

const AR = toProfile([600, 30, 1950, 167, 125, 10, 90, 2, 1, "auto"]);
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);

test("damage falloff is flat inside the near range, linear between, flat beyond the far range", () => {
  assert.equal(damageAt(AR, 0), 167);
  assert.equal(damageAt(AR, 10), 167);
  near(damageAt(AR, 50), 146);
  assert.equal(damageAt(AR, 90), 125);
  assert.equal(damageAt(AR, 300), 125);
});

test("no recorded falloff (far range 0) means flat damage", () => {
  const flat = toProfile([500, 20, 2000, 143, 100, 0, 0, 2, 1, "auto"]);
  assert.equal(damageAt(flat, 80), 143);
});

test("hit damage is unrounded, and a headshot is never below a body hit", () => {
  const d0 = hitDamage(AR, 0);
  assert.equal(d0.body, 167);
  assert.equal(d0.head, 334);
  near(d0.leg, 150.3, 1e-9);                            // legs: 167 x 0.9
  assert.equal(hitDamage(AR, 50).body, 146);
});

test("no rounding: the Gauss at 56 m is 8 shots, not 7", () => {
  near(damageAt(AR, 56), 142.85, 1e-9);
  near(hitDamage(AR, 56).body, 142.85, 1e-9);           // 7 x 142.85 = 999.95 < 1000
  near(hitDamage(AR, 56).head, 285.7, 1e-9);            // 142.85 x 2
  assert.equal(minShots(AR, { hp: 1000, range: 56 }), 8);
  const kcap = { ...AR, legMult: 1.2 };                 // KCAP flips legs to 1.2x
  near(hitDamage(kcap, 0).leg, 200.4, 1e-9);            // 167 x 1.2
  assert.equal(hitDamage(kcap, 0).body, 167, "KCAP does not change body damage");
});

test("ideal TTK: first shot at t = 0, so shots-1 gaps", () => {
  assert.equal(minShots(AR, { hp: 500 }), 3);               // 3 x 167 = 501
  assert.equal(idealTtk(AR, { hp: 500 }), 200);             // 2 gaps x 100 ms
  assert.equal(minShots(AR, { hp: 500, head: true }), 2);
  assert.equal(idealTtk(AR, { hp: 500, head: true }), 100);
  assert.equal(minShots(AR, { hp: 1000 }), 6);
});

test("falloff changes the shots needed", () => {
  assert.equal(minShots(AR, { hp: 500, range: 90 }), 4);    // 4 x 125 = 500
});

test("reload time is added after a full magazine", () => {
  const small = toProfile([600, 2, 1000, 100, 100, 0, 0, 2, 1, "auto"]);
  assert.equal(timeOfShot(small, 2), 100);
  assert.equal(timeOfShot(small, 3), 200 + 1000);
  assert.equal(timeOfShot(small, 5), 400 + 2000);
});

test("perfect accuracy gives a single step distribution", () => {
  const d = ttkDistribution(AR, { acc: 1, hsr: 0, hp: 500 });
  assert.equal(d.cdf.length, 3);
  near(d.cdf[1], 0);
  near(d.cdf[2], 1);
  assert.equal(quantileMs(d, 0.5), 200);
});

test("exact binomial check: 2 hits needed, 50 % accuracy", () => {
  const p = toProfile([600, 30, 1000, 167, 167, 0, 0, 2, 1, "auto"]);
  const d = ttkDistribution(p, { acc: 0.5, hsr: 0, hp: 334 });
  near(d.cdf[0], 0);
  near(d.cdf[1], 0.25);                 // both of 2 hit
  near(d.cdf[2], 0.5);                  // at least 2 of 3
  near(d.cdf[3], 11 / 16);              // at least 2 of 4
  assert.ok(d.cdf.every((v, i) => i === 0 || v >= d.cdf[i - 1]), "monotone");
});

test("headshot rate shortens the kill", () => {
  const body = medianTtk(AR, { acc: 1, hsr: 0, hp: 500 });
  const head = medianTtk(AR, { acc: 1, hsr: 1, hp: 500 });
  assert.ok(head < body);
  const mid = medianTtk(AR, { acc: 0.5, hsr: 0.3, hp: 500 });
  assert.ok(mid > body, "missing half the shots is slower than perfect aim");
});

test("lower accuracy is never faster", () => {
  let last = 0;
  for (const acc of [1, 0.8, 0.6, 0.4, 0.2]) {
    const m = medianTtk(AR, { acc, hsr: 0.15, hp: 500 });
    assert.ok(m >= last, `acc ${acc}`);
    last = m;
  }
});

test("shotgun pellets: damage per shot is the sum of the pellets that hit", () => {
  const sg = toProfile([240, 6, 2800, 100, 50, 5, 30, 1.5, 6, "semi"]);
  assert.equal(minShots(sg, { hp: 500 }), 1);                // 6 x 100 = 600
  const d = ttkDistribution(sg, { acc: 0.5, hsr: 0, hp: 500 });
  assert.ok(d.cdf[0] > 0 && d.cdf[0] < 0.2, "one shot kill needs 5+ of 6 pellets: " + d.cdf[0]);
  near(d.cdf[0], (6 * 0.5 ** 6) + 0.5 ** 6, 1e-9);           // 5 or 6 hits = 7/64
});

test("a weapon that can never kill gives null", () => {
  const tiny = toProfile([600, 30, 1000, 1, 1, 0, 0, 1, 1, "auto"]);
  const d = ttkDistribution(tiny, { acc: 0.1, hsr: 0, hp: 1500 });
  assert.equal(quantileMs(d, 0.5), null);
});

test("chance by time", () => {
  const d = ttkDistribution(AR, { acc: 1, hsr: 0, hp: 500 });
  assert.equal(chanceByMs(d, 199), 0);
  assert.equal(chanceByMs(d, 200), 1);
});

test("DPS: burst vs sustained", () => {
  const { burst, sustained } = dps(AR, { range: 0 });
  near(burst, 1670);
  assert.ok(sustained < burst);
  // 30 shots take 2900 ms, + 1950 reload -> 30 x 167 / 4.95 s
  near(sustained, 30 * 167 * 1000 / (2900 + 100 + 1950), 1e-6);
});

test("ttkCurve and winnerStrip", () => {
  const fast = toProfile([900, 30, 2000, 125, 125, 0, 0, 2, 1, "auto"]);
  const xs = rangeAxis(100, 10);
  assert.equal(xs.length, 11);
  const a = ttkCurve(AR, xs, { hp: 500 });
  const b = ttkCurve(fast, xs, { hp: 500 });
  assert.equal(a.length, xs.length);
  const w = winnerStrip([a, b]);
  assert.equal(w.length, xs.length);
  assert.ok(w.every((v) => v >= -1 && v <= 1));
  assert.deepEqual(winnerStrip([[100, null], [100, null]]), [-1, -1], "tie and no kill are -1");
});

test("slowerPct is relative, never percentage points", () => {
  assert.equal(slowerPct(220, 200), 10);
  assert.equal(slowerPct(200, 200), 0);
  assert.equal(slowerPct(null, 200), null);
});

test("FPS limit: the 1/fps law at 600 rpm", () => {
  near(fpsFireRateDrop(30, 600), 0.264, 0.002);   // 0.0132 * 600 / 30
  near(fpsFireRateDrop(60, 600), 0.132, 0.002);
  near(fpsFireRateDrop(120, 600), 0.066, 0.002);
  near(fpsFireRateDrop(210, 600), 0.0377, 0.002);
  // the law stays within ~2 points of the chart's mean curve (24.5 / 13.5 / 6.7 / 5.2 %);
  // the chart's flattening past ~150 FPS is measurement error, not a floor
  for (const [fps, chart] of [[30, 0.245], [60, 0.135], [120, 0.067], [210, 0.052]]) {
    assert.ok(Math.abs(fpsFireRateDrop(fps, 600) - chart) <= 0.02, `law within 2 pts of the chart at ${fps} FPS`);
  }
});

test("FPS limit: faster weapons lose more, and the loss vanishes at high FPS", () => {
  assert.ok(fpsFireRateDrop(60, 1000) > fpsFireRateDrop(60, 600));
  assert.ok(fpsFireRateDrop(60, 600) > fpsFireRateDrop(60, 200));
  near(fpsFireRateDrop(500, 600), 0.0158, 0.002, "at 500 FPS only 1.6 % is left, not the old 5.1 % floor");
  near(fpsFireRateDrop(500, 1000), 0.0264, 0.002);
  assert.ok(fpsFireRateDrop(500, 600) < fpsFireRateDrop(210, 600), "the loss still falls past the chart's end");
});

test("FPS limit: DPS and TTK slow by the drop, reload does not", () => {
  const drop = fpsFireRateDrop(60, 600);
  const lim = withFpsLimit(AR, 60);
  near(lim.rpm, 600 * (1 - drop), 1e-9);
  near(dps(lim, { range: 0 }).burst, 1670 * (1 - drop), 1e-6);
  near(idealTtk(lim, { hp: 500 }), 200 / (1 - drop), 1e-9);
  assert.equal(lim.reloadMs, AR.reloadMs);
  assert.equal(withFpsLimit(AR, 0), AR, "off returns the profile unchanged");
});

test("FPS limit: burst weapons stretch the in-burst gap and the between-burst wait", () => {
  const burst = withCadence(AR, [3, 100, 200, 0], "Test Burst");
  const lim = withFpsLimit(burst, 60);
  assert.equal(lim.burstN, 3);
  const s = 1 / (1 - fpsFireRateDrop(60, 600));
  near(lim.autoMs, 100 * s, 1e-9);
  near(lim.refireMs, 200 * s, 1e-9);
});

test("every real profile in assets/weapons/profiles.json gives a finite ideal TTK", () => {
  const { profiles } = JSON.parse(readFileSync(new URL("../assets/weapons/profiles.json", import.meta.url), "utf8"));
  let n = 0;
  for (const t of Object.values(profiles)) {
    const p = toProfile(t);
    if (!p) continue;
    n++;
    for (const range of [0, 50, 150]) {
      const v = idealTtk(p, { range, hp: 500 });
      assert.ok(Number.isFinite(v) && v >= 0, JSON.stringify(t));
    }
  }
  assert.ok(n > 300, "most profiles are usable: " + n);
});

test("TTK and STK histograms from an exact distribution", () => {
  // every shot hits the body at 10 m: 167 a shot, 500 health dies on shot 3 at 200 ms
  const d = ttkDistribution(AR, { acc: 1, hsr: 0, hp: 500, range: 10 });
  assert.deepEqual(d.cdf, [0, 0, 1]);
  const th = ttkHistogram(d, 125, 3000);
  assert.equal(th[0].p, 0, "no kill in the first 125 ms");
  assert.equal(th[1].p, 1, "the kill lands in the 125-250 ms bin");
  assert.equal(th[1].cum, 1);
  assert.equal(th[th.length - 1].p, 0, "nothing past the end or never");
  assert.ok(Math.abs(th.reduce((s, b) => s + b.p, 0) - 1) < 1e-12, "bins sum to 1");
  const sh = stkHistogram(d, 25);
  assert.equal(sh[2].p, 1, "3 shots to kill");
  assert.equal(sh[0].p, 0);
  assert.equal(sh[sh.length - 1].p, 0, "nothing past 25 shots");
  assert.ok(Math.abs(sh.reduce((s, b) => s + b.p, 0) - 1) < 1e-12, "bins sum to 1");
  // a spread distribution still sums to 1 with a monotone cumulative
  const d2 = ttkDistribution(AR, { acc: 0.5, hsr: 0, hp: 500, range: 10 });
  const th2 = ttkHistogram(d2);
  assert.ok(Math.abs(th2.reduce((s, b) => s + b.p, 0) - 1) < 1e-9);
  for (let i = 1; i < th2.length; i++) assert.ok(th2[i].cum + 1e-12 >= th2[i - 1].cum);
});

test("deep dive bands are Dorf's reference tables, ordered and growing", () => {
  const b1 = deepBands(1), b50 = deepBands(50), b200 = deepBands(200);
  assert.equal(b1.green, 449.8);
  assert.equal(b1.yellow, 528.5);
  assert.equal(b50.green, 901.0);
  assert.equal(b50.yellow, 1579.2);
  assert.equal(b200.green, 1311.9);
  assert.equal(b200.yellow, 5878.4);
  assert.ok(b1.green < b1.yellow && b50.green < b50.yellow && b200.green < b200.yellow);
  assert.ok(b1.green < b50.green && b50.green < b200.green);
  const mid = deepBands(28);
  assert.ok(mid.green > 622.3 && mid.green < 656.1, `interpolated green at 28 m: ${mid.green}`);
});
