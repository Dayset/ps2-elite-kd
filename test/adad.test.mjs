// Ideal ADAD calculator (a folded section of weapon-compare.html since 2026-11-09; weapon-adad.html forwards): the free-still-shot formula, the
// 2018 Toolbox dataset, and the current Census derivation. No network.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  SHOTS, RECOVERY_RATE, TARGET_D, COST_DISTANCES, nStill, simulate, simulatePlain, resetInfo,
  paramsFor, deriveCurrent, finalsHtml, spreadD, hitChance, burstHitAvg, costSummary, costCurve, COST_MAX_D, pctNum, fmt, fmtT,
  SORT_KEYS, sortValue, compareValues, sortEntries, orderEntries, imageSrcFor, compareHrefFor, slugName, detailHtml, rowHtml, lossPair, lossCell,
  ATT_KEYS, ATT_EFFECTS, attTogglesFor, applyAttachments, chooseAtt, attSlot, groupByCategory,
} from "../weapon-adad.mjs";

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const d2018 = JSON.parse(read("../assets/weapons/adad-2018.json"));
const itemIds = JSON.parse(read("../assets/weapons/adad-item-ids.json"));
const images = JSON.parse(read("../assets/weapons/adad-images.json"));
const recoil = JSON.parse(read("../assets/weapons/recoil.json"));
const catalog = JSON.parse(read("../assets/weapons/catalog.json"));
const byName = (n) => d2018.weapons.find((w) => w.n === n);
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

test("nStill: the artifact's formula, floor with the exact-landing rule", () => {
  assert.equal(nStill(0.1, 0.3, 0.05), 4, "TRAC-5 ADS, Iridar's Example 3");
  assert.equal(nStill(0.15, 0.4, 0.06), 4, "Naginata ADS");
  assert.equal(nStill(3, 4.5, 0.12), 12, "Naginata hipfire");
  assert.equal(nStill(0.1, 0.25, 0.05), 3, "NS-11C ADS: the sheet computes 3, not the article's 5");
  assert.equal(nStill(0.1, 0.3, 0.05), 4, "landing exactly on the moving minimum counts as free");
  assert.equal(nStill(0.1, 0.3, 0), Infinity, "bloom 0: every still shot is free");
  assert.equal(nStill(0.3, 0.3, 0.05), 0, "moving minimum at the still minimum: strafe at once");
  assert.equal(nStill(0.4, 0.3, 0.05), 0, "moving minimum below the still minimum: strafe at once");
  assert.equal(nStill(null, 0.3, 0.05), null, "missing still minimum");
  assert.equal(nStill(0.1, null, 0.05), null, "missing moving minimum");
  assert.equal(nStill(0.1, 0.3, null), null, "missing bloom");
});

test("simulate: the Naginata's 10-round ideal burst ends at 0.76 deg, strafing from shot 5", () => {
  const plan = simulate(0.15, 0.4, 0.06, 4, SHOTS);
  assert.equal(plan.length, 10);
  assert.deepEqual(plan.map((r) => r.moving), [false, false, false, false, true, true, true, true, true, true]);
  near(plan[3].cof, 0.39, 1e-9, "shot 4, still");
  near(plan[4].cof, 0.46, 1e-9, "shot 5, switch lifts the cone to the moving floor first");
  near(plan[9].cof, 0.76, 1e-9, "shot 10, ideal rhythm");
  near(simulatePlain(0.15, 0.06, SHOTS)[9], 0.75, 1e-9, "still throughout");
  near(simulatePlain(0.4, 0.06, SHOTS)[9], 1.0, 1e-9, "moving throughout");
  assert.equal(RECOVERY_RATE, 20, "CoF recovery is 20 deg/s");
});

test("spreadD / hitChance: the cone is the full angle, the target a 0.5 m torso circle", () => {
  assert.equal(TARGET_D, 0.5, "the torso circle is 0.5 m across");
  assert.deepEqual(COST_DISTANCES, [35, 60], "the panel shows 35 m and 60 m");
  near(spreadD(0.15, 200), 0.5236, 0.0001, "0.15 deg at 200 m spreads 0.52 m — Dorf's Naginata anchor");
  near(spreadD(3, 8), 0.419, 0.001, "GD-22S hipfire standing at 8 m: 0.42 m, as the sage guide shows");
  assert.equal(hitChance(0.03, 35), 1, "the GD-22S's 0.03 deg ADS cone at 35 m cannot miss the torso");
  near(hitChance(0.15, 200), 0.9119, 0.0001, "the Naginata's first shot at 200 m");
  near(hitChance(1.0, 60), 0.228, 0.001, "a 1 deg cone at 60 m");
  assert.equal(hitChance(0, 60), 1, "a zero cone always hits");
});

test("costSummary: the acceptance numbers — miss % and DPS loss of full movement vs the ideal rhythm", () => {
  // { still, move, bloom, nFree } per gun; expected fractions (miss = 1 - avg hit).
  const guns = {
    "NSX Naginata": [0.15, 0.4, 0.06, 4, { 35: [0, 0.038, 0.038, 0], 60: [0.1457, 0.4171, 0.3177, 0.0103] }],
    "GD-22S": [0.03, 0.35, 0.06, 5, { 35: [0, 0.0182, 0.0182, 0], 60: [0.0534, 0.3539, 0.3174, 0.0117] }],
    "TRAC-5": [0.1, 0.3, 0.05, 4, { 35: [0, 0, 0, 0], 60: [0.0335, 0.2291, 0.2024, 0] }],
  };
  for (const [name, [still, move, bloom, n, want]] of Object.entries(guns)) {
    const rows = costSummary(still, move, bloom, n, SHOTS);
    assert.deepEqual(rows.map((r) => r.dist), [35, 60], `${name}: both distances`);
    for (const r of rows) {
      const [missIdeal, missMoving, lossMoving, lossIdeal] = want[r.dist];
      near(1 - r.ideal, missIdeal, 0.0005, `${name} @${r.dist} m ideal miss`);
      near(1 - r.moving, missMoving, 0.0005, `${name} @${r.dist} m moving miss`);
      near(r.lossMoving, lossMoving, 0.0005, `${name} @${r.dist} m DPS loss, moving vs ideal`);
      near(r.lossIdeal, lossIdeal, 0.0005, `${name} @${r.dist} m cost of the ideal rhythm vs standing still`);
    }
  }
});

test("lossPair: the acceptance numbers — the cost panel's loss lines, as table columns", () => {
  // { still, move, bloom } ADS standing; expected fractions from costSummary.
  const guns = {
    "NSX Naginata": [0.15, 0.4, 0.06, { m35: 0.038, i35: 0, m60: 0.3177, i60: 0.0103 }],
    "GD-22S": [0.03, 0.35, 0.06, { m35: 0.0182, i35: 0, m60: 0.3174, i60: 0.0117 }],
    "TRAC-5": [0.1, 0.3, 0.05, { m35: 0, i35: 0, m60: 0.2024, i60: 0 }],
  };
  for (const [name, [still, move, bloom, want]] of Object.entries(guns)) {
    const rec = { as: [still, move], ac: [still, move], hs: [still, move], hc: [still, move], ba: bloom, bh: bloom, rpm: 600 };
    const p = lossPair(rec);
    assert.ok(p, `${name}: computable`);
    near(p.m35, want.m35, 0.0005, `${name} @35 m moving-vs-ideal loss`);
    near(p.i35, want.i35, 0.0005, `${name} @35 m ideal-vs-still cost`);
    near(p.m60, want.m60, 0.0005, `${name} @60 m moving-vs-ideal loss`);
    near(p.i60, want.i60, 0.0005, `${name} @60 m ideal-vs-still cost`);
    assert.equal(pctNum(p.m60), (want.m60 * 100).toFixed(1), `${name} @60 m prints one decimal`);
  }
  assert.equal(pctNum(lossPair({ as: [0.15, 0.4], ac: [0.15, 0.35], hs: [3, 4.5], hc: [2.25, 4], ba: 0.06, bh: 0.12, rpm: 659 }).m60), "31.8", "Naginata 60 m: 31.8%");
  assert.equal(pctNum(lossPair({ as: [0.15, 0.4], ac: [0.15, 0.35], hs: [3, 4.5], hc: [2.25, 4], ba: 0.06, bh: 0.12, rpm: 659 }).i60), "1.0", "Naginata 60 m ideal cost: 1.0%");
  assert.equal(pctNum(lossPair({ as: [0.03, 0.35], ac: [0.03, 0.2], hs: [3, 3.75], hc: [2.25, 3], ba: 0.06, bh: 0.12, rpm: 577 }).i60), "1.2", "GD-22S 60 m ideal cost is 1.2%, not 1.0% — check the model, never guess");
  assert.equal(pctNum(lossPair({ as: [0.03, 0.35], ac: [0.03, 0.2], hs: [3, 3.75], hc: [2.25, 3], ba: 0.06, bh: 0.12, rpm: 577 }).m35), "1.8", "GD-22S 35 m: 1.8%");
});

test("lossPair: the same acceptance numbers from both data versions, and nulls where there is no data", () => {
  for (const name of ["NSX Naginata", "GD-22S", "TRAC-5"]) {
    const hist = lossPair(byName(name));
    const cur = lossPair(deriveCurrent(byName(name), recoil, itemIds[name]));
    assert.ok(hist && cur, `${name}: computable in both versions`);
    for (const k of ["m35", "i35", "m60", "i60"]) near(hist[k], cur[k], 0.0005, `${name} ${k}: both versions agree`);
  }
  assert.equal(lossPair(byName("MANA Anti-Personnel Turret")), null, "the turret has no moving ADS value in 2018");
  assert.equal(lossPair(byName("NSX Fujin")), null, "the Fujin has no bloom in 2018");
  assert.equal(lossPair(deriveCurrent(byName("ML-7"), recoil, itemIds["ML-7"])), null, "rocket launchers have no current data");
  assert.equal(lossPair(deriveCurrent(byName("NS-AM7 Archer"), recoil, itemIds["NS-AM7 Archer"])), null);
  assert.equal(lossPair(deriveCurrent(byName("NSX Fujin"), recoil, itemIds["NSX Fujin"])), null);
  assert.equal(lossPair(deriveCurrent(byName("Equinox VE2 Burst"), recoil, null)), null, "the variant has no Census item");
  assert.equal(lossPair({ as: [null, null, null], ac: [null, null, null], hs: [null, null, null], hc: [null, null, null], ba: null, bh: null, rpm: null }), null, "an all-null record");
  assert.equal(lossPair(null), null);
});

test("lossCell: main loss % with the ideal cost underneath; a dash for nulls", () => {
  const nag = { m35: 0.038, i35: 0, m60: 0.3177, i60: 0.0103 };
  assert.equal(lossCell(nag, "m60", "i60"), '<span class="loss">31.8%<span class="loss-sub">ideal −1.0%</span></span>');
  assert.equal(lossCell(nag, "m35", "i35"), '<span class="loss">3.8%<span class="loss-sub">ideal −0.0%</span></span>');
  assert.equal(lossCell({ m35: 0.0182, i35: 0, m60: 0.3174, i60: 0.0117 }, "m60", "i60"), '<span class="loss">31.7%<span class="loss-sub">ideal −1.2%</span></span>', "GD-22S 60 m: 31.7%, ideal −1.2%");
  assert.equal(lossCell({ m35: 0, i35: 0, m60: 0.2024, i60: 0 }, "m60", "i60"), '<span class="loss">20.2%<span class="loss-sub">ideal −0.0%</span></span>', "TRAC-5 60 m: 20.2%");
  assert.equal(lossCell(null, "m60", "i60"), "—");
  assert.equal(lossCell({ m35: null, i35: null, m60: null, i60: null }, "m60", "i60"), "—");
});

test("costSummary: the ideal rhythm costs almost nothing vs standing still — the movement is nearly free", () => {
  for (const [still, move, bloom, n] of [[0.15, 0.4, 0.06, 4], [0.03, 0.35, 0.06, 5], [0.1, 0.3, 0.05, 4]]) {
    const r60 = costSummary(still, move, bloom, n, SHOTS).find((r) => r.dist === 60);
    assert.ok(r60.lossIdeal >= 0 && r60.lossIdeal <= 0.012, `ideal vs still at 60 m is 0–1.2% (got ${(r60.lossIdeal * 100).toFixed(1)}%)`);
  }
});

test("burstHitAvg edges: bloom 0 and zero free shots", () => {
  assert.equal(burstHitAvg(0.4, 1.0, 0, Infinity, SHOTS, 60, "ideal"), 1, "bloom 0: the ideal rhythm fires all 10 from the still cone");
  assert.equal(burstHitAvg(0.4, 1.0, 0, Infinity, SHOTS, 60, "still"), 1, "bloom 0: still throughout is the same burst");
  near(burstHitAvg(0.4, 1.0, 0, Infinity, SHOTS, 60, "moving"), 0.228, 0.001, "bloom 0: moving fires all 10 from the moving cone");
  const zero = costSummary(0.1, 0.3, 0.05, 0, SHOTS);
  for (const r of zero) assert.equal(r.lossMoving, 0, `no free shots: the ideal rhythm IS moving, so the loss is 0 at ${r.dist} m`);
  assert.equal(pctNum(0.3177), "31.8", "one-decimal percent, bare number");
  assert.equal(pctNum(null), "—", "null loss prints a dash, never NaN");
});

test("costCurve: one point per metre, and it agrees with costSummary at 35 m and 60 m", () => {
  const rows = costCurve(0.15, 0.4, 0.06, 4, SHOTS);
  assert.equal(rows.length, COST_MAX_D);
  assert.equal(rows[0].dist, 1);
  assert.equal(rows[COST_MAX_D - 1].dist, COST_MAX_D);
  const sum = costSummary(0.15, 0.4, 0.06, 4, SHOTS);
  for (const s of sum) {
    const r = rows[s.dist - 1];
    near(r.ideal, s.ideal, 1e-12, `ideal hits at ${s.dist} m`);
    near(r.moving, s.moving, 1e-12, `moving hits at ${s.dist} m`);
    near(r.lossMoving, s.lossMoving, 1e-12, `strafing loss at ${s.dist} m`);
    near(r.lossIdeal, s.lossIdeal, 1e-12, `ideal-rhythm cost at ${s.dist} m`);
  }
  assert.ok(rows.every((r) => r.ideal >= r.moving - 1e-12), "the ideal rhythm never hits less than moving the whole burst");
  assert.ok(rows.every((r) => r.still >= r.ideal - 1e-12), "standing still never hits less than the ideal rhythm");
  assert.ok(rows.every((r) => r.lossMoving >= 0 && r.lossMoving <= 1 && r.lossIdeal >= 0 && r.lossIdeal <= 1), "losses are fractions, never NaN");
  assert.equal(rows[0].lossMoving, 0, "at 1 m everything hits: no loss");
});

test("finalsHtml: .win is hardcoded on the ideal rhythm, as in the artifact", () => {  const html = finalsHtml(0.76, 0.75, 1.0, { ideal: "Ideal rhythm", still: "Still throughout", moving: "Moving throughout" });
  assert.match(html, /<div class="final win"><div class="t">Ideal rhythm<\/div><div class="v">0.76°<\/div><\/div>/);
  assert.match(html, /<div class="final"><div class="t">Still throughout<\/div><div class="v">0.75°<\/div><\/div>/);
  assert.match(html, /<div class="final"><div class="t">Moving throughout<\/div><div class="v">1°<\/div><\/div>/);
  assert.equal((html.match(/final win/g) || []).length, 1, "exactly one .win, even though still-throughout ends lower");
});

test("resetInfo: one refire of delay, then 20 deg/s; a known still max clamps first", () => {
  const nag = resetInfo({ still: 0.15, endCof: 0.76, maxCof: null, refireMs: 60000 / 659 });
  near(nag.refireMs, 91.05, 0.01, "Naginata refire from RPM");
  near(nag.totalMs, 121.55, 0.01, "91.05 + (0.76-0.15)/20 s");
  assert.equal(nag.clamped, false);
  const clamped = resetInfo({ still: 0.15, endCof: 0.76, maxCof: 0.6, refireMs: 60000 / 659 });
  assert.equal(clamped.clamped, true);
  near(clamped.totalMs, 113.55, 0.01, "clamped to 0.6 first: 91.05 + (0.6-0.15)/20 s");
  const trac = resetInfo({ still: 0.1, endCof: 0.6, maxCof: null, refireMs: 60000 / 750 });
  near(trac.totalMs, 105, 0.01, "TRAC-5 full reset is 105 ms");
  assert.equal(resetInfo({ still: 0.1, endCof: 0.6, maxCof: null, refireMs: null }), null, "no refire, no reset");
});

test("fmt / fmtT match the artifact's display", () => {
  assert.equal(fmt(0.15), "0.15");
  assert.equal(fmt(1 / 3), "0.333");
  assert.equal(fmt(null), "—");
  assert.equal(fmtT(91), "91 ms");
  assert.equal(fmtT(1210), "1.21 s");
});

test("2018 dataset: 194 rows, faithful shape, key values, nulls only where the sheet has none", () => {
  assert.equal(d2018.sheetDate, "2018-08-19");
  assert.equal(d2018.weapons.length, 194);
  assert.equal(new Set(d2018.weapons.map((w) => w.n)).size, 194, "no duplicate names");
  assert.equal(new Set(d2018.weapons.map((w) => w.c)).size, 14, "14 categories");
  for (const w of d2018.weapons) {
    assert.deepEqual(Object.keys(w).sort(), ["ac", "as", "ba", "bh", "c", "f", "hc", "hs", "n", "rf", "rpm"], w.n);
    for (const k of ["hc", "hs", "ac", "as"]) assert.equal(w[k].length, 2, `${w.n} ${k}`);
  }
  assert.deepEqual(byName("NSX Naginata"), {
    ac: [0.15, 0.35], as: [0.15, 0.4], ba: 0.06, bh: 0.12, c: "LMG", f: "NS",
    hc: [2.25, 4.0], hs: [3.0, 4.5], n: "NSX Naginata", rf: 91, rpm: 659,
  });
  assert.deepEqual(byName("TRAC-5").as, [0.1, 0.3]);
  assert.deepEqual(byName("NS-11C").as, [0.1, 0.25]);
  assert.equal(byName("NS-44L Showdown").ba, 7.0, "the sheet's odd ADS bloom stays as printed");
  assert.deepEqual(byName("NSX Tanto").as, [0, 0]);
  assert.deepEqual(byName("MANA Anti-Personnel Turret").hs, [0.1, null]);
  assert.equal(byName("NSX Fujin").ba, null);
  const nullRows = d2018.weapons.filter((w) => [w.hc, w.hs, w.ac, w.as].some((p) => p.includes(null)) || w.ba === null);
  assert.deepEqual(nullRows.map((w) => w.n), ["MANA Anti-Personnel Turret", "NSX Fujin"]);
});

test("2018 dataset: per-category sums match the artifact's WEAPONS array (fingerprint)", () => {
  const want = {
    "Assault Rifle": [27, 18007, 2.92, 1.45], "Battle Rifle": [9, 2553, 1.86, 0.9],
    "Carbine": [26, 17683, 2.73, 1.405], "Crossbow": [1, 353, 1, 1],
    "Grenade": [1, 60, 1, 0], // Fujin ba null; contributes nothing to the sum
    "Heavy Gun": [3, 1584, 0, 0], "Infantry Weapons": [1, 550, 0.12, 0.12],
    "LMG": [26, 16996, 2.86, 1.39], "Pistol": [22, 8593, 3.89, 9.54], // includes Showdown ba 7.0
    "Rocket Launcher": [10, 1590, 13.6, 13.6], "Scout Rifle": [8, 3726, 3.1, 1.4],
    "Shotgun": [19, 5405, 0, 0], "SMG": [15, 10904, 0.82, 0.82],
    "Sniper Rifle": [26, 8125, 23.52, 21.91],
  };
  for (const [c, [n, rpm, bh, ba]] of Object.entries(want)) {
    const rows = d2018.weapons.filter((w) => w.c === c);
    assert.equal(rows.length, n, c);
    assert.equal(rows.reduce((a, w) => a + w.rpm, 0), rpm, `${c} rpm`);
    near(rows.reduce((a, w) => a + w.bh, 0), bh, 0.005, `${c} bh`);
    near(rows.filter((w) => w.ba !== null).reduce((a, w) => a + w.ba, 0), ba, 0.005, `${c} ba`);
  }
  assert.equal(d2018.weapons.reduce((a, w) => a + w.rpm, 0), 96129, "grand RPM total");
});

test("paramsFor: the 2018 rows load exactly like the artifact (no max, refire from RPM)", () => {
  const nag = byName("NSX Naginata");
  assert.deepEqual(paramsFor(nag, "ads", "stand"), { still: 0.15, move: 0.4, max: null, bloom: 0.06, rpm: 659, refireMs: 60000 / 659 });
  assert.deepEqual(paramsFor(nag, "ads", "crouch"), { still: 0.15, move: 0.35, max: null, bloom: 0.06, rpm: 659, refireMs: 60000 / 659 });
  assert.deepEqual(paramsFor(nag, "hip", "stand"), { still: 3, move: 4.5, max: null, bloom: 0.12, rpm: 659, refireMs: 60000 / 659 });
  const p11 = paramsFor(byName("NS-11C"), "ads", "stand");
  assert.equal(nStill(p11.still, p11.move, p11.bloom), 3);
  assert.equal(paramsFor(byName("MANA Anti-Personnel Turret"), "ads", "stand").move, null, "the sheet's null moving value stays null");
});

test("deriveCurrent: the Census snapshot reproduces the three hand-checked weapons", () => {
  const nag = deriveCurrent(byName("NSX Naginata"), recoil, itemIds["NSX Naginata"]);
  assert.equal(itemIds["NSX Naginata"], 804249);
  assert.deepEqual(nag.as, [0.15, 0.4, 0.6], "ADS still / moving / still max");
  assert.deepEqual(nag.hs, [3, 4.5, 4.25]);
  assert.deepEqual(nag.ac, [0.15, 0.35, 0.4]);
  assert.deepEqual(nag.hc, [2.25, 4, 3.75]);
  assert.equal(nag.ba, 0.06);
  assert.equal(nag.bh, 0.12);
  assert.equal(nag.refireMs, 91);
  assert.equal(nag.rpm, 659);
  const nagP = paramsFor(nag, "ads", "stand");
  assert.equal(nStill(nagP.still, nagP.move, nagP.bloom), 4);

  const trac = deriveCurrent(byName("TRAC-5"), recoil, itemIds["TRAC-5"]);
  assert.equal(itemIds["TRAC-5"], 43);
  assert.deepEqual([trac.as[0], trac.as[1], trac.ba], [0.1, 0.3, 0.05]);
  assert.deepEqual([trac.hs[0], trac.hs[1], trac.bh], [1.5, 2, 0.1]);
  assert.equal(trac.refireMs, 80);
  assert.equal(trac.rpm, 750);

  const ns11c = deriveCurrent(byName("NS-11C"), recoil, itemIds["NS-11C"]);
  assert.equal(itemIds["NS-11C"], 75005);
  assert.deepEqual([ns11c.as[0], ns11c.as[1], ns11c.ba], [0.1, 0.25, 0.05], "current Census computes 3, like the sheet");
  assert.equal(ns11c.refireMs, 92);
  const p = paramsFor(ns11c, "ads", "stand");
  assert.equal(nStill(p.still, p.move, p.bloom), 3);
});

test("deriveCurrent: bloom is the fire mode's cof_recoil, 0 included; the Mauler differs from 2018", () => {
  const jack = deriveCurrent(byName("NC05 Jackhammer"), recoil, itemIds["NC05 Jackhammer"]);
  assert.equal(jack.ba, 0, "Jackhammer: ADS bloom 0");
  assert.equal(jack.bh, 0, "Jackhammer: hip bloom 0");
  const jackAdsFm = String(recoil.weapons[String(itemIds["NC05 Jackhammer"])][3]);
  assert.equal(recoil.fm2[jackAdsFm].cof_recoil, 0, "the snapshot stores cof_recoil 0 explicitly (all 599 fm2 entries carry it)");
  const jackP = paramsFor(jack, "ads", "stand");
  assert.equal(nStill(jackP.still, jackP.move, jackP.bloom), Infinity, "no bloom: every still shot is free");
  const mauler = deriveCurrent(byName("Mauler S6"), recoil, itemIds["Mauler S6"]);
  assert.deepEqual([byName("Mauler S6").ba, byName("Mauler S6").bh], [0, 0], "the 2018 sheet has the Mauler at bloom 0/0");
  assert.deepEqual([mauler.ba, mauler.bh], [0.15, 0.3], "current Census: the Mauler blooms — a real version difference");
  assert.deepEqual(mauler.as, [0.15, 0.15, 3]);
  assert.deepEqual(mauler.hs, [0.15, 0.15, 7]);
  const maulerP = paramsFor(mauler, "ads", "stand");
  assert.equal(nStill(maulerP.still, maulerP.move, maulerP.bloom), 0, "still and moving minima equal: strafing costs nothing");
});

test("deriveCurrent: rows with no usable Census data come back null (dashes, never invented numbers)", () => {
  assert.equal(itemIds["ML-7"], 85);
  assert.equal(deriveCurrent(byName("ML-7"), recoil, 85), null, "rocket launchers have no recoil entry");
  assert.equal(deriveCurrent(byName("NS-AM7 Archer"), recoil, itemIds["NS-AM7 Archer"]), null);
  assert.equal(deriveCurrent(byName("NSX Fujin"), recoil, itemIds["NSX Fujin"]), null);
  assert.equal(itemIds["Equinox VE2 Burst"], null, "burst variant: no Census item of its own");
  assert.equal(itemIds["Gauss Compact Burst"], null);
  assert.equal(itemIds["Gauss Compact S"], null);
  assert.equal(itemIds["Solstice SF"], null);
  assert.equal(deriveCurrent(byName("Equinox VE2 Burst"), recoil, null), null);
  assert.equal(deriveCurrent(byName("MANA Anti-Personnel Turret"), recoil, itemIds["MANA Anti-Personnel Turret"]), null, "item exists, recoil data does not");
  const showdown = deriveCurrent(byName("NS-44L Showdown"), recoil, itemIds["NS-44L Showdown"]);
  assert.ok(showdown, "hipfire side still derives");
  assert.deepEqual(showdown.as, [null, null, null], "no ADS fire mode in the snapshot");
  assert.equal(showdown.ba, null);
  assert.notEqual(showdown.bh, null, "hip bloom present");
});

test("item map: every 2018 row is mapped, every id is a real catalog item, derivation never throws", () => {
  assert.equal(Object.keys(itemIds).length, 194);
  assert.deepEqual(Object.keys(itemIds).sort(), d2018.weapons.map((w) => w.n).sort());
  assert.equal(Object.values(itemIds).filter((v) => v === null).length, 4, "only the four variant rows are unmapped");
  let derived = 0, nulled = 0;
  for (const w of d2018.weapons) {
    const id = itemIds[w.n];
    if (id !== null) assert.ok(catalog.items[String(id)], `${w.n}: ${id} is in the catalog`);
    const rec = deriveCurrent(w, recoil, id);
    if (rec) {
      derived++;
      assert.equal(rec.n, w.n);
      assert.equal(rec.f, w.f);
      assert.equal(rec.c, w.c);
    } else nulled++;
  }
  assert.ok(derived > 170, `most rows derive current numbers (got ${derived})`);
  assert.ok(nulled < 25, `few rows are current-dataless (got ${nulled})`);
});

test("images map: every mapped weapon has a local render; the four variants have none", () => {
  assert.equal(Object.keys(images).length, 190, "190 of 194 weapons have a Census item");
  const mapped = Object.keys(itemIds).filter((n) => itemIds[n] !== null);
  assert.deepEqual(Object.keys(images).sort(), mapped.sort(), "the map covers exactly the mapped weapons");
  const webp = new Set(fs.readdirSync(new URL("../assets/weapons/", import.meta.url)).filter((f) => f.endsWith(".webp")).map((f) => f.slice(0, -5)));
  for (const [name, img] of Object.entries(images)) assert.ok(webp.has(String(img)), `${name}: ${img}.webp exists on the site`);
  assert.equal(images["GD-22S"], 5340, "the GD-22S render is Census 5340, as the sage guide uses");
  assert.equal(images["TRAC-5"], 5364);
  for (const n of ["Equinox VE2 Burst", "Gauss Compact Burst", "Gauss Compact S", "Solstice SF"]) assert.equal(images[n], undefined, `${n} has no image`);
});

test("imageSrcFor / compareHrefFor: a local render and a compare link, or nothing invented", () => {
  assert.equal(imageSrcFor("GD-22S", images), "assets/weapons/5340.webp");
  assert.equal(imageSrcFor("TRAC-5", images), "assets/weapons/5364.webp");
  assert.equal(imageSrcFor("Equinox VE2 Burst", images), null);
  assert.equal(imageSrcFor("GD-22S", null), null, "no map loaded: dash, not a guess");
  assert.equal(compareHrefFor("NSX Naginata", itemIds), "weapon-compare.html?w=804249");
  assert.equal(compareHrefFor("TRAC-5", itemIds), "weapon-compare.html?w=43");
  for (const n of ["Equinox VE2 Burst", "Gauss Compact Burst", "Gauss Compact S", "Solstice SF"]) assert.equal(compareHrefFor(n, itemIds), null, `${n}: no id, no link`);
  assert.equal(compareHrefFor("NSX Naginata", null), null);
  assert.equal(slugName("NSX Naginata"), "nsx-naginata");
  assert.equal(slugName("T9A \"Butcher\""), "t9a-butcher");
});

test("sortEntries: ascending and descending, nulls last, no-bloom first when descending", () => {
  const entry = (n) => ({ row: byName(n), rec: byName(n) }); // 2018 rows as their own record
  const names = (es) => es.map((e) => e.row.n);
  assert.deepEqual(names(sortEntries([entry("TRAC-5"), entry("NSX Naginata"), entry("GD-22S")], "rpm", 1)), ["GD-22S", "NSX Naginata", "TRAC-5"]);
  assert.deepEqual(names(sortEntries([entry("TRAC-5"), entry("NSX Naginata"), entry("GD-22S")], "rpm", -1)), ["TRAC-5", "NSX Naginata", "GD-22S"]);
  assert.deepEqual(names(sortEntries([entry("NSX Naginata"), entry("TRAC-5"), entry("GD-22S")], "freeHip", 1)), ["TRAC-5", "GD-22S", "NSX Naginata"], "free hip: 5, 6, 12");
  assert.deepEqual(names(sortEntries([entry("NSX Naginata"), entry("TRAC-5")], "name", 1)), ["NSX Naginata", "TRAC-5"]);
  assert.deepEqual(names(sortEntries([entry("NSX Naginata"), entry("TRAC-5")], "name", -1)), ["TRAC-5", "NSX Naginata"]);
  assert.deepEqual(names(sortEntries([entry("GD-22S"), entry("TRAC-5")], "faction", 1)), ["GD-22S", "TRAC-5"], "NC before TR");
  assert.deepEqual(names(sortEntries([entry("Mauler S6"), entry("TRAC-5"), entry("NSX Naginata")], "adsBloom", 1)), ["Mauler S6", "TRAC-5", "NSX Naginata"], "ADS bloom 0, 0.05, 0.06");
  // the MANA turret has no moving ADS value, so its free ADS count is null — last in both directions
  assert.deepEqual(names(sortEntries([entry("MANA Anti-Personnel Turret"), entry("TRAC-5")], "freeAds", 1)), ["TRAC-5", "MANA Anti-Personnel Turret"]);
  assert.deepEqual(names(sortEntries([entry("MANA Anti-Personnel Turret"), entry("TRAC-5")], "freeAds", -1)), ["TRAC-5", "MANA Anti-Personnel Turret"]);
  // the Mauler never blooms in 2018, so its free count is Infinity — last ascending, first descending
  assert.deepEqual(names(sortEntries([entry("Mauler S6"), entry("TRAC-5")], "freeAds", 1)), ["TRAC-5", "Mauler S6"]);
  assert.deepEqual(names(sortEntries([entry("Mauler S6"), entry("TRAC-5")], "freeAds", -1)), ["Mauler S6", "TRAC-5"]);
  assert.equal(sortValue(entry("NSX Naginata"), "freeAds"), 4);
  assert.equal(sortValue(entry("MANA Anti-Personnel Turret"), "freeAds"), null);
  assert.equal(sortValue(entry("Mauler S6"), "freeAds"), Infinity);
  assert.deepEqual(SORT_KEYS, ["name", "faction", "category", "rpm", "adsStill", "adsMove", "adsBloom", "freeAds", "hipStill", "hipMove", "hipBloom", "freeHip", "loss35", "loss60"]);
});

test("sortValue / sortEntries: the loss columns sort, nulls last both ways, and the top loss is not the Naginata", () => {
  const entry = (n) => ({ row: byName(n), rec: byName(n) }); // 2018 rows as their own record
  const entryCur = (n) => {
    const row = byName(n);
    const rec = deriveCurrent(row, recoil, itemIds[n]) || { ...row, as: [null, null, null], ac: [null, null, null], hs: [null, null, null], hc: [null, null, null], ba: null, bh: null, rpm: null };
    return { row, rec };
  };
  near(sortValue(entry("NSX Naginata"), "loss60"), 0.3177, 0.0005, "Naginata 60 m loss");
  near(sortValue(entry("GD-22S"), "loss60"), 0.3174, 0.0005, "GD-22S 60 m loss");
  near(sortValue(entry("TRAC-5"), "loss60"), 0.2024, 0.0005, "TRAC-5 60 m loss");
  near(sortValue(entry("T2 Striker"), "loss60"), 0.821, 0.001, "T2 Striker 2018: ADS 0.1→1.0°, the widest moving cone");
  near(sortValue(entry("Mauler S6"), "loss60"), 0.719, 0.001, "Mauler 2018: bloom 0 but ADS move 0.9° vs still 0.1°");
  assert.equal(sortValue(entry("MANA Anti-Personnel Turret"), "loss60"), null, "no ADS numbers, no loss");
  assert.equal(sortValue(entry("NSX Fujin"), "loss35"), null);
  assert.equal(sortValue(entryCur("ML-7"), "loss60"), null, "no current data, no loss");
  for (const [label, make] of [["2018", entry], ["current", entryCur]]) {
    const entries = d2018.weapons.map((w) => make(w.n));
    for (const [key, dir] of [["loss60", -1], ["loss60", 1], ["loss35", -1], ["loss35", 1]]) {
      const sorted = sortEntries(entries, key, dir);
      const vals = sorted.map((e) => sortValue(e, key));
      const firstNull = vals.findIndex((v) => v === null);
      const nonNull = vals.filter((v) => v !== null);
      assert.ok(firstNull === -1 || firstNull === nonNull.length, `${label} ${key} ${dir > 0 ? "asc" : "desc"}: nulls after every non-null`);
      const ordered = dir > 0 ? [...nonNull].sort((a, b) => a - b) : [...nonNull].sort((a, b) => b - a);
      assert.deepEqual(nonNull, ordered, `${label} ${key} ${dir > 0 ? "asc" : "desc"}: non-nulls in order`);
    }
    const desc = sortEntries(entries, "loss60", -1);
    const max = Math.max(...entries.map((e) => sortValue(e, "loss60")).filter((v) => v !== null));
    assert.equal(sortValue(desc[0], "loss60"), max, `${label}: descending puts the highest loss first`);
    assert.notEqual(desc[0].row.n, "NSX Naginata", `${label}: the top loss is not the Naginata`);
    assert.ok(sortValue(desc[0], "loss60") > sortValue(make("NSX Naginata"), "loss60"), `${label}: the top loss beats the Naginata's 31.8%`);
    const nonNullDesc = desc.filter((e) => sortValue(e, "loss60") !== null);
    assert.equal(sortValue(nonNullDesc[nonNullDesc.length - 1], "loss60"), 0, `${label}: the lowest non-null loss is 0.0%`);
    const asc = sortEntries(entries, "loss60", 1);
    assert.equal(sortValue(asc[0], "loss60"), 0, `${label}: ascending starts at 0.0%`);
  }
});

test("orderEntries: no pins — a pure sort, the highest loss first", () => {
  const entry = (n) => ({ row: byName(n), rec: byName(n) });
  const names = (es) => es.map((e) => e.row.n);
  assert.deepEqual(names(orderEntries([entry("T2 Striker"), entry("TRAC-5"), entry("NSX Naginata")], "loss60", -1)), ["T2 Striker", "NSX Naginata", "TRAC-5"], "the 82.1% Striker now sorts first, ahead of the Naginata's 31.8% and the TRAC-5's 20.2%");
  assert.deepEqual(names(orderEntries([entry("T2 Striker"), entry("NSX Naginata")], "loss35", -1)), names(sortEntries([entry("T2 Striker"), entry("NSX Naginata")], "loss35", -1)), "orderEntries is exactly the sort, no pin-first step");
});

test("orderEntries: the worked examples sort like every other gun", () => {
  const entry = (n) => ({ row: byName(n), rec: byName(n) });
  const names = (es) => es.map((e) => e.row.n);
  assert.deepEqual(names(orderEntries([entry("TRAC-5"), entry("GD-22S"), entry("NSX Naginata")], "name", 1)), ["GD-22S", "NSX Naginata", "TRAC-5"], "by name ascending the TRAC-5 sorts after the GD-22S");
  assert.deepEqual(names(orderEntries([entry("GD-22S"), entry("TRAC-5"), entry("NSX Naginata")], "rpm", 1)), ["GD-22S", "NSX Naginata", "TRAC-5"], "by RPM ascending the TRAC-5 (750) sorts after the GD-22S (577) and the Naginata (659)");
  assert.deepEqual(names(orderEntries([entry("GD-22S"), entry("TRAC-5")], "name", -1)), ["TRAC-5", "GD-22S"], "by name descending the TRAC-5 sorts first");
});

test("detailHtml: all four stances and the worked burst for the Naginata", () => {
  const t = {
    h: "All stances", stance: "Stance", still: "Still min", move: "Moving min", bloom: "Bloom",
    adsStand: "ADS, standing", adsCrouch: "ADS, crouching", hipStand: "Hipfire, standing", hipCrouch: "Hipfire, crouching",
    burstH: "Worked burst — 10 rounds, ideal rhythm (ADS, standing)", shot: "Shot", stanceCol: "Stance",
    cof: "CoF after shot", ifMoving: "If moving all along", stillWord: "Still", moving: "Moving",
    switchWord: "start strafing", noData: "No usable numbers for this gun in this version.",
  };
  const html = detailHtml(byName("NSX Naginata"), t);
  for (const label of ["ADS, standing", "ADS, crouching", "Hipfire, standing", "Hipfire, crouching"]) assert.ok(html.includes(label), label);
  assert.match(html, /<td>0\.15<\/td><td>0\.4<\/td><td>0\.06<\/td>/, "ADS stand pair");
  assert.match(html, /<td>0\.15<\/td><td>0\.35<\/td><td>0\.06<\/td>/, "ADS crouch pair");
  assert.match(html, /<td>3<\/td><td>4\.5<\/td><td>0\.12<\/td>/, "hip stand pair");
  assert.match(html, /<td>2\.25<\/td><td>4<\/td><td>0\.12<\/td>/, "hip crouch pair");
  assert.match(html, /0\.76<\/td>/, "the burst ends at 0.76");
  assert.match(html, /start strafing/);
  assert.equal((html.match(/class="switchrow"/g) || []).length, 1, "one switch row, shot 5");
  const empty = detailHtml({ as: [null, null, null], ac: [null, null, null], hs: [null, null, null], hc: [null, null, null], ba: null, bh: null, rpm: null }, t);
  assert.match(empty, /No usable numbers for this gun in this version\./);
  assert.ok(!empty.includes("Worked burst"), "no burst table without numbers");
});

test("rowHtml: the collapsed summary — toggle, image, free counts, Compare; no CoF values", () => {
  const opts = { imgMap: images, idMap: itemIds, open: new Set() };
  const nag = byName("NSX Naginata");
  const html = rowHtml({ row: nag, rec: nag }, opts);
  assert.match(html, /assets\/weapons\/86949\.webp/);
  assert.match(html, /weapon-compare\.html\?w=804249/);
  assert.match(html, /Compare<\/a>/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-controls="detail-nsx-naginata"/);
  assert.match(html, /Show details for NSX Naginata/);
  assert.match(html, /▸/);
  assert.match(html, />4<\/td>/, "free ADS 4");
  assert.match(html, />12<\/td>/, "free hip 12");
  assert.match(html, /31\.8%<span class="loss-sub">ideal −1\.0%<\/span>/, "60 m loss cell: 31.8%, ideal −1.0%");
  assert.match(html, /3\.8%<span class="loss-sub">ideal −0\.0%<\/span>/, "35 m loss cell: 3.8%, ideal −0.0%");
  assert.ok(!html.includes("0.15"), "no ADS still value in the summary");
  assert.ok(!html.includes("0.06"), "no bloom value in the summary");
  assert.ok(!html.includes('class="detail"'), "collapsed: no detail row");
  const open = rowHtml({ row: nag, rec: nag }, { ...opts, open: new Set(["NSX Naginata"]) });
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /Hide details for NSX Naginata/);
  assert.match(open, /▾/);
  assert.match(open, /id="detail-nsx-naginata"/);
  assert.match(open, /0\.76<\/td>/, "the open detail carries the worked burst");
  assert.match(open, /ADS, standing/);
  assert.match(open, /colspan="10"/, "the detail row spans all ten columns");
  const mana = byName("MANA Anti-Personnel Turret");
  assert.match(rowHtml({ row: mana, rec: mana }, opts), /<td class="n" data-l="Loss @ 60 m">—<\/td>/, "no ADS numbers, no invented loss");
  const burst = byName("Equinox VE2 Burst");
  const bhtml = rowHtml({ row: burst, rec: burst }, opts);
  assert.ok(!bhtml.includes("<img"), "the variant has no image");
  assert.ok(!bhtml.includes("weapon-compare.html?w="), "the variant has no Compare link");
});

test("attTogglesFor: only the CoF/bloom attachments the gun can mount", () => {
  assert.deepEqual(ATT_KEYS, ["Laser Sight", "Compensator", "Heavy Barrel", "Short Barrel", "Hybrid Laser", "Weighted Receiver", "Stabilizing Rotor", "Heavy Magazine"]);
  assert.deepEqual(ATT_EFFECTS["Laser Sight"], { hipMinCof: 0.67 }, "the laser factor is weapon-sim.mjs's");
  assert.deepEqual(ATT_EFFECTS["Compensator"], { hipMinCof: 1.15 });
  assert.deepEqual(ATT_EFFECTS["Heavy Barrel"], { adsBloom: 0.8 });
  assert.deepEqual(ATT_EFFECTS["Short Barrel"], { hipBloom: 0.6 });
  assert.deepEqual(ATT_EFFECTS["Weighted Receiver"], { adsZeroCof: 1 }, "the Weighted Receiver zeroes the aimed cone (weapon-sim.mjs)");
  assert.deepEqual(ATT_EFFECTS["Stabilizing Rotor"], { hipBloom: 0.75, adsBloom: 0.75 });
  assert.deepEqual(ATT_EFFECTS["Heavy Magazine"], { hipMinCof: 1.2 });
  assert.equal(itemIds["Blitz GD-10"], 27001);
  assert.deepEqual(attTogglesFor(27001, recoil), ["Laser Sight", "Compensator"], "the Blitz mounts a laser and a compensator, nothing else that matters");
  assert.equal(itemIds["GD-22S"], 7233);
  assert.deepEqual(attTogglesFor(7233, recoil), ["Laser Sight", "Compensator", "Heavy Barrel", "Short Barrel"], "the GD-22S mounts all four");
  assert.equal(itemIds["T9A \"Butcher\""], 1924);
  assert.deepEqual(attTogglesFor(1924, recoil), ["Laser Sight", "Compensator", "Heavy Barrel"], "the Butcher's Muzzle Brake counts as a Compensator (weapon-sim.mjs's alias); no Short Barrel");
  assert.deepEqual(attTogglesFor(null, recoil), [], "a variant row with no Census item gets no toggles");
  assert.deepEqual(attTogglesFor(999999, recoil), [], "an unknown item id gets no toggles");
  assert.deepEqual(attTogglesFor(7233, null), [], "recoil not loaded: no toggles, never a guess");
  assert.deepEqual(attTogglesFor(7233, {}), [], "no att data at all: no toggles");
});

test("applyAttachments: the acceptance numbers — Blitz hip 10 → 6 → 11, GD-22S ADS 5 → 6, hip 6 → 10", () => {
  const n = (p, stance, active) => nStill(...Object.values(applyAttachments(p, stance, new Set(active))).slice(0, 3));
  // Blitz GD-10 hipfire: still 1.0, moving 1.5, bloom 0.05 — base 10 free shots.
  const blitzHip = { still: 1.0, move: 1.5, bloom: 0.05 };
  assert.equal(n(blitzHip, "hip", []), 10, "Blitz hip, base");
  const laser = applyAttachments(blitzHip, "hip", new Set(["Laser Sight"]));
  near(laser.still, 0.67, 1e-9, "laser: still min ×0.67");
  near(laser.move, 1.005, 1e-9, "laser: moving min ×0.67 too");
  assert.equal(n(blitzHip, "hip", ["Laser Sight"]), 6, "Blitz hip with a Laser Sight: floor(0.335 / 0.05) = 6");
  const comp = applyAttachments(blitzHip, "hip", new Set(["Compensator"]));
  near(comp.still, 1.15, 1e-9, "compensator: still min ×1.15");
  near(comp.move, 1.725, 1e-9, "compensator: moving min ×1.15 too");
  assert.equal(n(blitzHip, "hip", ["Compensator"]), 11, "Blitz hip with a Compensator: floor(0.575 / 0.05) = 11");
  assert.equal(n(blitzHip, "hip", ["Laser Sight", "Compensator"]), 7, "both: the factors multiply (0.67 × 1.15), floor(0.38525 / 0.05) = 7");
  assert.equal(n(blitzHip, "hip", ["Heavy Barrel"]), 10, "a Heavy Barrel does nothing to hipfire");
  // Blitz ADS: the cone is flat 0.3° standing and moving — strafe from shot 1, attachments or not.
  const blitzAds = { still: 0.3, move: 0.3, bloom: 0.05 };
  assert.equal(n(blitzAds, "ads", []), 0, "Blitz ADS, base");
  assert.equal(n(blitzAds, "ads", ["Laser Sight", "Compensator", "Heavy Barrel"]), 0, "Blitz ADS stays 0 with any of them");
  // GD-22S ADS: still 0.03, moving 0.35, bloom 0.06 — base 5 free shots.
  const gdAds = { still: 0.03, move: 0.35, bloom: 0.06 };
  assert.equal(n(gdAds, "ads", []), 5, "GD-22S ADS, base");
  const heavy = applyAttachments(gdAds, "ads", new Set(["Heavy Barrel"]));
  near(heavy.bloom, 0.048, 1e-9, "heavy barrel: ADS bloom ×0.8");
  assert.equal(heavy.still, 0.03, "the heavy barrel leaves the minima alone");
  assert.equal(n(gdAds, "ads", ["Heavy Barrel"]), 6, "GD-22S ADS with a Heavy Barrel: floor(0.32 / 0.048) = 6");
  assert.equal(n(gdAds, "ads", ["Laser Sight"]), 5, "a laser does nothing to ADS");
  // GD-22S hipfire: still 3.0, moving 3.75, bloom 0.12 — base 6 free shots.
  const gdHip = { still: 3.0, move: 3.75, bloom: 0.12 };
  assert.equal(n(gdHip, "hip", []), 6, "GD-22S hip, base");
  const short = applyAttachments(gdHip, "hip", new Set(["Short Barrel"]));
  near(short.bloom, 0.072, 1e-9, "short barrel: hip bloom ×0.6");
  assert.equal(n(gdHip, "hip", ["Short Barrel"]), 10, "GD-22S hip with a Short Barrel: floor(0.75 / 0.072) = 10");
  assert.equal(n(gdHip, "hip", ["Heavy Barrel"]), 6, "a heavy barrel does nothing to hipfire");
  // Nulls pass through; an unknown name in the set is inert.
  assert.deepEqual(applyAttachments({ still: null, move: 0.3, bloom: 0.05 }, "hip", new Set(["Laser Sight"])), { still: null, move: 0.201, bloom: 0.05 });
  assert.deepEqual(applyAttachments({ still: 0.1, move: 0.3, bloom: 0.05 }, "ads", new Set(["Forward Grip"])), { still: 0.1, move: 0.3, bloom: 0.05 });
  assert.equal(applyAttachments(null, "ads", new Set()), null);
});

test("the calculator is wired inside weapon-compare.html (weapon-adad.html only forwards there)", () => {
  const html = read("../weapon-compare.html");
  assert.match(read("../weapon-adad.html"), /weapon-compare\.html#adad/, "the old page forwards");
  assert.match(html, /weapon-adad\.css\?v=20261109-merge1/);
  assert.match(read("../weapon-compare.mjs"), /import\("\.\/weapon-adad\.mjs\?v=20261109-merge1"\)/, "started lazily, when the section is first opened");
  assert.match(html, /data-sort="loss35"/, "the 35 m loss header sorts");
  assert.match(html, /data-sort="loss60"/, "the 60 m loss header sorts");
  assert.match(html, /data-i18n="adad\.col\.loss35"/, "the 35 m loss header is translated");
  assert.match(html, /data-i18n="adad\.col\.loss60"/, "the 60 m loss header is translated");
  assert.match(read("../weapon-adad.css"), /\.loss-sub/, "the loss sub-line has its styles");
  assert.match(html, /id="costBox"/, "the cost panel sits under the finals");
  assert.match(html, /id="attBox"/, "the attachment toggles sit in the calculator");
  assert.match(html, /id="attRow"/);
  assert.match(html, /id="attNote"/);
  assert.match(read("../weapon-adad.mjs"), /adad-images\.json/, "the image map is loaded when the section opens (not preloaded on every compare visit)");
  assert.match(html, /data-sort="name"/, "the name header sorts");
  assert.match(html, /data-sort="faction"/);
  assert.ok(!/data-sort="category"/.test(html), "no category column: every group header names its category");
  assert.match(html, /data-sort="rpm"/);
  assert.match(html, /data-sort="freeAds"/);
  assert.match(html, /data-sort="freeHip"/);
  assert.match(html, /aria-sort="ascending"/, "name is the default sort");
  assert.match(read("../weapon-adad.css"), /\.costbox/, "the cost panel has its styles");
  assert.match(read("../weapon-adad.css"), /\.attbox/, "the attachment toggles have their styles");
  assert.match(read("../weapon-adad.css"), /\.row-toggle/, "the row toggle has its styles");
  assert.match(read("../weapon-adad.css"), /\.detail-box/, "the detail row has its styles");
  assert.match(read("../weapon-adad.css"), /\.sort-ind/, "the sort indicator has its styles");
  assert.match(html, /Iridars-Toolbox-v6h\.zip/);
  assert.match(html, /Historical \(Toolbox v6h, Aug 2018\)/);
  for (const id of ["adadVerCur", "adadVerHist", "adadBanner", "gunName", "gunMeta", "btnAds", "btnHip", "btnStand", "btnCrouch", "inStill", "inMove", "inBloom", "inRpm", "inMax", "attBox", "attRow", "attNote", "nBig", "nWhat", "nFormula", "shotTable", "finals", "costBox", "costChart", "costLegend", "costAt", "costLoss", "costDist", "costDistVal", "costModeLoss", "costModeHits", "chart", "resetBox", "tblH", "q", "fFac", "catChips", "catToggleAll", "rowCount", "wtable", "langSelect"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(read("../weapon-compare.html"), /id="wcAdad"/, "the compare page holds the calculator");
  assert.match(read("../NOTICE"), /weapon-adad\.html/);
});

test("chooseAtt: one part per slot — a barrel part replaces the other barrel part, a rail part stays", () => {
  assert.equal(attSlot("Heavy Barrel"), "barrel");
  assert.equal(attSlot("Short Barrel"), "barrel");
  assert.equal(attSlot("Muzzle Brake"), "barrel", "a Muzzle Brake is a Compensator, a barrel part");
  assert.equal(attSlot("Laser Sight"), "rail");
  assert.equal(attSlot("Weighted Receiver"), "rail");
  let a = chooseAtt(new Set(), "barrel", "Heavy Barrel");
  assert.deepEqual([...a], ["Heavy Barrel"]);
  a = chooseAtt(a, "rail", "Laser Sight");
  assert.deepEqual([...a].sort(), ["Heavy Barrel", "Laser Sight"], "a barrel part and a rail part together are fine");
  a = chooseAtt(a, "barrel", "Short Barrel");
  assert.deepEqual([...a].sort(), ["Laser Sight", "Short Barrel"], "Short Barrel replaces Heavy Barrel: both are barrel parts");
  a = chooseAtt(a, "rail", "Weighted Receiver");
  assert.deepEqual([...a].sort(), ["Short Barrel", "Weighted Receiver"], "two rail parts cannot be fitted together either");
  a = chooseAtt(a, "barrel", "");
  assert.deepEqual([...a], ["Weighted Receiver"], "None empties the slot");
  const before = new Set(["Heavy Barrel"]);
  chooseAtt(before, "barrel", "Short Barrel");
  assert.deepEqual([...before], ["Heavy Barrel"], "pure: the old set is not touched");
});

test("applyAttachments: Weighted Receiver zeroes the ADS cone, Stabilizing Rotor cuts both blooms, Heavy Magazine raises the hip cone", () => {
  const ads = applyAttachments({ still: 0.15, move: 0.4, bloom: 0.06 }, "ads", new Set(["Weighted Receiver"]));
  assert.deepEqual([ads.still, ads.move, ads.bloom], [0, 0, 0.06]);
  assert.equal(nStill(ads.still, ads.move, ads.bloom), 0, "no cone to grow out of: strafe from shot 1");
  assert.deepEqual(applyAttachments({ still: 0.15, move: 0.4, bloom: 0.06 }, "hip", new Set(["Weighted Receiver"])), { still: 0.15, move: 0.4, bloom: 0.06 }, "hipfire is untouched");
  const rotor = new Set(["Stabilizing Rotor"]);
  near(applyAttachments({ still: 1, move: 1.5, bloom: 0.1 }, "ads", rotor).bloom, 0.075, 1e-9, "rotor: ADS bloom ×0.75");
  near(applyAttachments({ still: 1, move: 1.5, bloom: 0.1 }, "hip", rotor).bloom, 0.075, 1e-9, "rotor: hip bloom ×0.75");
  const mag = applyAttachments({ still: 1, move: 1.5, bloom: 0.1 }, "hip", new Set(["Heavy Magazine"]));
  near(mag.still, 1.2, 1e-9); near(mag.move, 1.8, 1e-9);
  assert.deepEqual(applyAttachments({ still: null, move: 0.3, bloom: 0.05 }, "ads", new Set(["Weighted Receiver"])), { still: null, move: 0, bloom: 0.05 }, "a null passes through");
});

test("groupByCategory: category order, every weapon in exactly one group", () => {
  const e = (n, c) => ({ row: { n, c } });
  const g = groupByCategory([e("a", "Pistol"), e("b", "Carbine"), e("c", "Assault Rifle"), e("d", "Carbine"), e("e", "Zeta Gun"), e("f", "Amp Gun")]);
  assert.deepEqual(g.map(([c]) => c), ["Assault Rifle", "Carbine", "Pistol", "Amp Gun", "Zeta Gun"], "known categories in the site's order, others alphabetically after them");
  assert.deepEqual(g[1][1].map((x) => x.row.n), ["b", "d"]);
  assert.equal(g.reduce((m, [, l]) => m + l.length, 0), 6);
});

test("the page has the category groups, the faction chips and no filter dropdowns", () => {
  const html = read("../weapon-compare.html");
  assert.ok(!/id="fCat"/.test(html), "no category dropdown: the table is grouped by category");
  assert.ok(!/<select id="fFac"/.test(html), "no faction dropdown: chips");
  assert.match(html, /data-fac="VS"/);
  assert.match(read("../weapon-adad.css"), /\.cat-head/, "the category header row has its styles");
  assert.match(read("../weapon-adad.css"), /\.att-slot/, "the attachment slot groups have styles");
});
