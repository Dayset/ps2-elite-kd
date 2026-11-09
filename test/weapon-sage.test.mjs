// weapon-sage.mjs: plain-language verdicts computed from the recoil simulator.
// The lines are thresholds on seeded sim numbers, so the expected values below are exact.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toProfile } from "../replay/weapons.mjs";
import { simParams, compareBursts } from "../weapon-sim.mjs";
import { sageLines, SAGE_TEXT } from "../weapon-sage.mjs";

const root = new URL("../", import.meta.url);
const cat = JSON.parse(readFileSync(new URL("assets/weapons/catalog.json", root), "utf8"));
const { profiles } = JSON.parse(readFileSync(new URL("assets/weapons/profiles.json", root), "utf8"));
const rec = JSON.parse(readFileSync(new URL("assets/weapons/recoil.json", root), "utf8"));
const en = JSON.parse(readFileSync(new URL("i18n/en.json", root), "utf8"));

const FM = { cof_recoil: 0.12, fire_refire_ms: 100, recoil_magnitude_min: 0.5, recoil_magnitude_max: 0.5, recoil_first_shot_modifier: 1, recoil_horizontal_min: 0.1, recoil_horizontal_max: 0.2, recoil_horizontal_tolerance: 0.4, recoil_recovery_rate: 20 };
const STATES = [{ player_state_id: 0, cof_min: 3, cof_max: 4.5, cof_recovery_rate: 20 }, { player_state_id: 1, cof_min: 2.25, cof_max: 4, cof_recovery_rate: 20 }];

const compDescOf = (id) => {
  for (const [name, d] of ((rec.att && rec.att[id]) || []).map((i) => rec.atts[i])) {
    if ((name === "Compensator" || name === "Muzzle Brake") && d >= 0) return rec.descs[d];
  }
  return null;
};

// the demo settings: 20 m, 1000 HP, standing moving, ADS, 20% accuracy / headshot rate, no pulldown
function realWeapon(name, opts = {}) {
  const id = +Object.entries(cat.items).find(([, v]) => v[0] === name)[0];
  const p = toProfile(profiles[id]);
  const r = rec.weapons[id];
  const fm = rec.fm2[r[0]], states = rec.groups[r[1]] || [];
  const adsFm = (r[3] && rec.fm2[r[3]]) || null, adsStates = (r[4] && rec.groups[r[4]]) || [];
  const P = simParams(p, fm, states, { stance: "standMove", aim: "ads", acc: 0.2, hsr: 0.2, comp: 0, compX: 0, adsFm, adsStates, ...opts });
  const base = compareBursts(P, { distance: 20, hp: 1000, runs: 300, seed: 1 });
  return { P, base, ctx: { distance: 20, hp: 1000, runs: 300, seed: 1, weaponName: name, hip: false, compDesc: compDescOf(id) } };
}

function synth(profile, opts = {}, distance = 20, hp = 1000) {
  const P = simParams(profile, FM, STATES, { stance: "standMove", aim: "ads", ...opts });
  const base = compareBursts(P, { distance, hp, runs: 300, seed: 1 });
  return { P, base, ctx: { distance, hp, runs: 300, seed: 1, weaponName: "Synthetic", hip: false, compDesc: null } };
}

test("Gauss Rifle at the demo settings: range, burst, pulldown, head, Compensator", () => {
  const { P, base, ctx } = realWeapon("NC1 Gauss Rifle");
  assert.deepEqual(sageLines(P, base, ctx), [
    { key: "rangeFar", m: 50 },
    { key: "burstRate", n: 2, pct: 60 },
    { key: "pulldown", pct: 42 },
    { key: "aimHead", pct: 15 },
    { key: "compSkip" },
  ]);
});

test("T1 Cycler at the demo settings: chest aim, and it is unforgiving", () => {
  const { P, base, ctx } = realWeapon("T1 Cycler");
  assert.deepEqual(sageLines(P, base, ctx), [
    { key: "rangeFar", m: 50 },
    { key: "burstRate", n: 4, pct: 22 },
    { key: "pulldown", pct: 27 },
    { key: "aimTorso" },
    { key: "compSkip" },
    { key: "unforgiving" },
  ]);
});

test("Pulsar VS1 at the demo settings: the Compensator barely matters", () => {
  const { P, base, ctx } = realWeapon("Pulsar VS1");
  assert.deepEqual(sageLines(P, base, ctx), [
    { key: "rangeFar", m: 50 },
    { key: "burstRate", n: 8, pct: 66 },
    { key: "pulldown", pct: 18 },
    { key: "aimHead", pct: 22 },
    { key: "compSmall", pct: 7 },
  ]);
});

test("Betelgeuse 54-A at the demo settings: no Compensator to talk about, unforgiving", () => {
  const { P, base, ctx } = realWeapon("Betelgeuse 54-A");
  assert.equal(ctx.compDesc, null, "the Betelgeuse cannot mount a Compensator");
  assert.deepEqual(sageLines(P, base, ctx), [
    { key: "burstRate", n: 4, pct: 6 },
    { key: "pulldown", pct: 43 },
    { key: "unforgiving" },
  ]);
});

test("synthetic hard falloff: rangeClose names the range where it falls off", () => {
  const { P, base, ctx } = synth(toProfile([600, 30, 1950, 125, 50, 6, 40, 2, 1, "auto"]), { acc: 0.2, hsr: 0.2 });
  assert.deepEqual(sageLines(P, base, ctx), [
    { key: "rangeClose", m: 25 },
    { key: "burstRate", n: 4, pct: 0 },
    { key: "aimHead", pct: 47 },
  ]);
});

test("synthetic flat damage: rangeFar, and no rangeClose", () => {
  const { P, base, ctx } = synth(toProfile([600, 30, 1950, 143, 143, 10, 10, 2, 1, "auto"]), { acc: 0.2, hsr: 0.2 });
  assert.deepEqual(sageLines(P, base, ctx), [
    { key: "rangeFar", m: 50 },
    { key: "burstRate", n: 1, pct: 8 },
    { key: "pulldown", pct: 22 },
    { key: "aimHead", pct: 33 },
    { key: "unforgiving" },
  ]);
});

test("close range, decent accuracy: spraying kills but slowly (burstTime, not burstRate)", () => {
  const { P, base, ctx } = synth(toProfile([600, 30, 1950, 167, 125, 10, 90, 2, 1, "auto"]), { acc: 0.6, hsr: 0.3 }, 10);
  assert.deepEqual(sageLines(P, base, ctx), [
    { key: "rangeFar", m: 50 },
    { key: "burstTime", n: 2, x: "5.8" },
    { key: "pulldown", pct: 18 },
    { key: "aimHead", pct: 29 },
  ]);
});

test("no kill possible: no lines, no crash", () => {
  // 100,000 HP: three magazines cannot kill it, so the best burst is null
  const { P, base, ctx } = synth(toProfile([600, 30, 1950, 167, 125, 10, 90, 2, 1, "auto"]), { acc: 0.2, hsr: 0.2 }, 20, 100000);
  assert.equal(base.best, null);
  assert.deepEqual(sageLines(P, base, ctx), []);
  assert.deepEqual(sageLines(P, { best: null, rows: [] }, ctx), []);
});

test("deterministic: the same input gives the same lines", () => {
  const { P, base, ctx } = realWeapon("NC1 Gauss Rifle");
  assert.deepEqual(sageLines(P, base, ctx), sageLines(P, base, ctx));
});

test("every sage line has an English string in en.json, with matching placeholders", () => {
  const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  const enKeys = Object.keys(en).filter((k) => k.startsWith("wc.sage."));
  assert.deepEqual(enKeys.sort(), Object.keys(SAGE_TEXT).map((k) => "wc.sage." + k).sort());
  for (const [key, text] of Object.entries(SAGE_TEXT)) {
    assert.equal(placeholders(en["wc.sage." + key]), placeholders(text), `wc.sage.${key} placeholders`);
    assert.equal(en["wc.sage." + key], text, `wc.sage.${key} matches the module fallback`);
  }
});

test("every line renders as a sentence: its params fill every placeholder", () => {
  const { P, base, ctx } = realWeapon("T1 Cycler");
  for (const line of sageLines(P, base, ctx)) {
    let s = SAGE_TEXT[line.key];
    for (const [k, v] of Object.entries(line)) if (k !== "key") s = s.replaceAll(`{${k}}`, String(v));
    assert.ok(!/\{\w+\}/.test(s), `${line.key} leaves a placeholder unfilled: ${s}`);
  }
});
