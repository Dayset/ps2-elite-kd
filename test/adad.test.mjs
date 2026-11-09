// Ideal ADAD calculator (weapon-adad.html): the free-still-shot formula, the
// 2018 Toolbox dataset, and the current Census derivation. No network.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  PINNED, SHOTS, RECOVERY_RATE, nStill, simulate, simulatePlain, resetInfo,
  paramsFor, deriveCurrent, finalsHtml, fmt, fmtT,
} from "../weapon-adad.mjs";

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const d2018 = JSON.parse(read("../assets/weapons/adad-2018.json"));
const itemIds = JSON.parse(read("../assets/weapons/adad-item-ids.json"));
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

test("finalsHtml: .win is hardcoded on the ideal rhythm, as in the artifact", () => {
  const html = finalsHtml(0.76, 0.75, 1.0, { ideal: "Ideal rhythm", still: "Still throughout", moving: "Moving throughout" });
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
  assert.deepEqual(PINNED, ["NSX Naginata", "TRAC-5"], "the worked examples");
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

test("the page is wired: pins, ids, back link, and the link from weapon-compare", () => {
  const html = read("../weapon-adad.html");
  assert.match(html, /weapon-adad\.css\?v=/);
  assert.match(html, /weapon-adad\.mjs\?v=/);
  assert.match(html, /href="weapon-compare\.html"/);
  assert.match(html, /Iridars-Toolbox-v6h\.zip/);
  assert.match(html, /Historical \(Toolbox v6h, Aug 2018\)/);
  for (const id of ["adadVerCur", "adadVerHist", "adadBanner", "gunName", "gunMeta", "btnAds", "btnHip", "btnStand", "btnCrouch", "inStill", "inMove", "inBloom", "inRpm", "inMax", "nBig", "nWhat", "nFormula", "shotTable", "finals", "chart", "resetBox", "tblH", "q", "fFac", "fCat", "rowCount", "wtable", "langSelect"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(read("../weapon-compare.html"), /href="weapon-adad\.html"/);
  assert.match(read("../NOTICE"), /weapon-adad\.html/);
});
