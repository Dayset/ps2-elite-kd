// Tier lists for weapon-compare.html: rank bands, the strafing effective-DPS
// metric, and the synthetic-row derivation (a catalog record stands in for
// the 2018 row — the cone numbers come from recoil.json either way).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tierBand, TIER_BANDS, TIER_MIN_CLASS, weaponEff, computeTiers } from "../weapon-tiers.mjs";
import { deriveCurrent } from "../weapon-adad.mjs";
import { toProfile } from "../replay/weapons.mjs";
import { withCadence } from "../weapons-model.mjs";

const read = (p) => JSON.parse(fs.readFileSync(new URL("../" + p, import.meta.url), "utf8"));
const recoil = read("assets/weapons/recoil.json");
const catalog = read("assets/weapons/catalog.json").items;
const profiles = read("assets/weapons/profiles.json").profiles;
const cadence = read("assets/weapons/cadence.json").cadence || {};
const d2018 = read("assets/weapons/adad-2018.json");
const itemIds = read("assets/weapons/adad-item-ids.json");

// the compare page's weapon records: every usable profile, by item id
const weapons = [];
for (const [id, tuple] of Object.entries(profiles)) {
  const item = catalog[id];
  const p = withCadence(toProfile(tuple), cadence[id], item && item[0]);
  if (!item || !p) continue;
  weapons.push({ id: Number(id), name: item[0], cat: item[1], fac: item[2], img: item[3], p });
}

test("tier bands: S top 10%, A next 20%, B next 30%, C next 25%, D the rest", () => {
  assert.deepEqual(TIER_BANDS.map((b) => b.id), ["S", "A", "B", "C", "D"]);
  // class of 20: ranks 0-1 S, 2-5 A, 6-11 B, 12-16 C, 17-19 D
  assert.equal(tierBand(0, 20), "S");
  assert.equal(tierBand(1, 20), "S");
  assert.equal(tierBand(2, 20), "A");
  assert.equal(tierBand(5, 20), "A");
  assert.equal(tierBand(6, 20), "B");
  assert.equal(tierBand(11, 20), "B");
  assert.equal(tierBand(12, 20), "C");
  assert.equal(tierBand(16, 20), "C");
  assert.equal(tierBand(17, 20), "D");
  assert.equal(tierBand(19, 20), "D");
  // out of range and too-small classes get no tier; in a class of 5 the
  // top weapon is the top 20%, so it is A, not S (S needs a class of 10+)
  assert.equal(tierBand(-1, 20), null);
  assert.equal(tierBand(20, 20), null);
  assert.equal(tierBand(0, 4), null);
  assert.equal(tierBand(0, 1), null);
  assert.equal(tierBand(0, 5), "A");
  assert.equal(tierBand(0, 10), "S");
});

test("a synthetic catalog row derives the same cones as the 2018 row", () => {
  for (const row of d2018.weapons) {
    const id = itemIds[row.n];
    if (!id) continue;
    const real = deriveCurrent(row, recoil, id);
    const synth = deriveCurrent({ n: row.n, f: row.f, c: row.c }, recoil, id);
    if (!real && !synth) continue;
    assert.ok(real && synth, `${row.n}: one derivation failed`);
    assert.deepEqual([synth.hs, synth.bh, synth.as, synth.ba], [real.hs, real.bh, real.as, real.ba], row.n);
  }
});

test("the Naginata is the walk-cost poster child: D-tier hip, mid C-tier ADS (35 m, 60 FPS)", () => {
  const opts = { range: 35, fpsOn: true, fps: 60 };
  const { classes } = computeTiers(weapons, recoil, { ...opts, stance: "hip" });
  const lmg = classes.find((c) => c.cat === "LMG");
  assert.ok(lmg.rows.length >= 20, `LMG rows: ${lmg.rows.length}`);
  const nag = lmg.rows.find((r) => r.name === "NSX Naginata");
  const beet = lmg.rows.find((r) => r.name === "Betelgeuse 54-A");
  assert.equal(nag.tier, "D");
  assert.equal(beet.tier, "S");
  assert.ok(Math.abs(Math.round(nag.eff) - 35) <= 1, `Naginata hip eff ${nag.eff}`);
  assert.ok(Math.abs(Math.round(beet.eff) - 67) <= 1, `Betelgeuse hip eff ${beet.eff}`);
  assert.ok(nag.loss > 0.5, `Naginata hip walk loss ${nag.loss}`);
  assert.equal(nag.nFree, 12);
  const ads = computeTiers(weapons, recoil, { ...opts, stance: "ads" });
  const lmgAds = ads.classes.find((c) => c.cat === "LMG");
  const nagAds = lmgAds.rows.find((r) => r.name === "NSX Naginata");
  assert.equal(nagAds.tier, "C");
  assert.equal(lmgAds.rows.find((r) => r.name === 'T9A "Butcher"').tier, "S");
});

test("shotguns rank on spread-adjusted DPS: the cone is inside the torso, the pellets are not", () => {
  const { classes } = computeTiers(weapons, recoil, { range: 35, fpsOn: true, fps: 60, stance: "hip" });
  const sg = classes.find((c) => c.cat === "Shotgun");
  assert.equal(sg.rows.length, 29);
  // the tightest spread wins now: the three Barons (2.5° spread) tie at 531 eff DPS
  // and the pumps (3–3.5°) sit below them; name order breaks the tie, so the
  // third Baron is A, not S — the band is by rank, not by value
  assert.equal(sg.rows[0].name, "NS \"Lucky\" Baron G5");
  assert.equal(sg.rows[0].tier, "S");
  assert.ok(Math.abs(Math.round(sg.rows[0].eff) - 531) <= 1, `top shotgun eff ${sg.rows[0].eff}`);
  const jack = sg.rows.find((r) => r.name === "TAS-16 Blackjack");
  assert.equal(jack.tier, "B", "was A at 1987 eff DPS with all pellets landing");
  assert.ok(Math.abs(Math.round(jack.eff) - 457) <= 1, `Blackjack eff ${jack.eff}`);
  assert.ok(jack.loss < 0.001, `Blackjack walk loss ${jack.loss}`);
  assert.equal(jack.nFree, 0);
  const deimos = sg.rows.find((r) => r.name === "Deimos VA29");
  assert.equal(deimos.tier, "B", "was S at 1987 eff DPS with all pellets landing");
  assert.ok(Math.abs(Math.round(deimos.eff) - 457) <= 1, `Deimos eff ${deimos.eff}`);
});

test("tiny classes are ranked but untiered", () => {
  const { classes } = computeTiers(weapons, recoil, { range: 35, fpsOn: true, fps: 60, stance: "ads" });
  // the full catalog (not just the 194 ADAD rows) puts 24 weapons in Heavy
  // Weapon and 6 in Crossbow, so both tier now; only Hybrid Rifle (the two
  // Kuwas) stays below the five-weapon line. ADS drops the launchers (no ADS
  // fire mode), so Heavy Weapon is 13 there, 24 at the hip.
  const hip = computeTiers(weapons, recoil, { range: 35, fpsOn: true, fps: 60, stance: "hip" });
  const heavyHip = hip.classes.find((c) => c.cat === "Heavy Weapon");
  assert.equal(heavyHip.rows.length, 24);
  const heavy = classes.find((c) => c.cat === "Heavy Weapon");
  assert.equal(heavy.rows.length, 13);
  assert.ok(heavy.rows.some((r) => r.tier === "S"));
  const bow = classes.find((c) => c.cat === "Crossbow");
  assert.equal(bow.rows.length, 6);
  assert.equal(bow.rows[0].tier, "A"); // top of six is the top 16.7%
  const hybrid = classes.find((c) => c.cat === "Hybrid Rifle");
  assert.ok(hybrid && hybrid.rows.length === 2);
  assert.ok(hybrid.rows.every((r) => r.tier === null));
});

test("rows are sorted by effective DPS inside each class, classes by name", () => {
  const { classes, total, omitted } = computeTiers(weapons, recoil, { range: 20, fpsOn: false, fps: 60, stance: "ads" });
  assert.ok(total > 175, `pool ${total}`);
  assert.ok(omitted >= 0);
  const names = classes.map((c) => c.cat);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  for (const c of classes) {
    for (let i = 1; i < c.rows.length; i++) assert.ok(c.rows[i - 1].eff >= c.rows[i].eff, `${c.cat}: ${c.rows[i - 1].name} vs ${c.rows[i].name}`);
  }
});

test("no recoil data, no tier: null in, null out", () => {
  const w = weapons.find((x) => x.name === "T1 Cycler");
  assert.equal(weaponEff(w, null, { range: 35, fpsOn: false, fps: 60, stance: "ads" }), null);
  assert.equal(weaponEff(w, { weapons: {} }, { range: 35, fpsOn: false, fps: 60, stance: "ads" }), null);
  assert.deepEqual(computeTiers(weapons, null, { range: 35, fpsOn: false, fps: 60, stance: "ads" }), { classes: [], total: 0, omitted: weapons.length });
  // the FPS limit only slows fast guns: the TRV loses more than the SAW at 60 FPS
  const trv = weapons.find((x) => x.name === "Cycler TRV");
  const saw = weapons.find((x) => x.name === "NC6 Gauss SAW");
  const off = (name) => weaponEff(weapons.find((x) => x.name === name), recoil, { range: 35, fpsOn: false, fps: 60, stance: "ads" });
  const on = (name) => weaponEff(weapons.find((x) => x.name === name), recoil, { range: 35, fpsOn: true, fps: 60, stance: "ads" });
  assert.ok(on("Cycler TRV").eff / off("Cycler TRV").eff < on("NC6 Gauss SAW").eff / off("NC6 Gauss SAW").eff);
  void trv; void saw;
});
