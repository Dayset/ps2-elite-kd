// 🎬 Replay real fight (#101): a recorded fight becomes a duel-plan-shaped
// plan with the real kill order, gaps, weapons, headshots, vehicles and
// classes; the shots in between come from engage() conditioned per kill.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { pairEvents, fightsOf, classOf } from "../duels.mjs";
import { shooter } from "../replay/engagement.mjs";
import { planRealFight } from "../replay/real-fight.mjs";
import { profileOf } from "../replay/weapons.mjs";

const reply = JSON.parse(fs.readFileSync(new URL("./fixtures/duels-pair.json", import.meta.url), "utf8"));
const catalog = JSON.parse(fs.readFileSync(new URL("../assets/weapons/catalog.json", import.meta.url), "utf8"));
const profiles = JSON.parse(fs.readFileSync(new URL("../assets/weapons/profiles.json", import.meta.url), "utf8"));
const weapon = (id) => {
  const it = catalog.items?.[String(id)];
  const prof = id ? profileOf(String(id), it?.[1], profiles.profiles) : null;
  return { profile: prof, name: it?.[0] ?? null, img: it?.[3] != null ? String(it[3]) : null };
};
// Reference pair stats (the batch's fixture pair, #92): Fantom220TR (TR,
// MSW-R) vs TolyaNo (NC, Anchor).
const A = shooter(profileOf("7254", "Assault Rifle", profiles.profiles),
  { spk: 26.8, hpk: 8.26, hsr: 0.281, kd: 4.67, cls: "ha" });
const B = shooter(profileOf("7236", "Assault Rifle", profiles.profiles),
  { spk: 20.2, hpk: 6.85, hsr: 0.298, kd: 4.54, cls: "ha" });
const opts = { seed: 12345, weapon, classOf, allies: 0,
  aInfo: { revivedShare: 0.3 }, bInfo: { revivedShare: 0.3 } };

test("fightsOf groups the fixture reply into two fights, newest first", () => {
  const pe = pairEvents(reply.events, reply.qid, true);
  assert.equal(pe.length, 6); // the context kill is not between them
  const fights = fightsOf(pe, reply.events, reply.pid);
  assert.equal(fights.length, 2);
  assert.equal(fights[0].t0, 1762005000); // newest first
  assert.deepEqual([fights[0].a, fights[0].b], [2, 0]);
  assert.equal(fights[0].one, false); // only 2 kills
  assert.deepEqual([fights[1].a, fights[1].b], [2, 2]);
  assert.equal(fights[1].one, true); // 4 kills, focus 1.0
});

test("planRealFight keeps the real kill order, gaps, weapons, HS and vehicle", () => {
  const pe = pairEvents(reply.events, reply.qid, true);
  const fight = fightsOf(pe, reply.events, reply.pid)[1]; // the 1v1 fight
  const plan = planRealFight(A, B, fight, opts);
  assert.equal(plan.real, true);
  assert.equal(plan.engagements.length, 4);
  assert.deepEqual(plan.engagements.map((e) => e.outcome), ["a", "b", "a", "b"]);
  // Real gaps, exactly: 80 s, 120 s, 130 s between the four kills.
  const kills = plan.engagements.map((e) => e.killAt);
  assert.deepEqual(kills.map((k, i) => (i ? Math.round(k - kills[i - 1]) : 0)), [0, 80, 120, 130]);
  assert.deepEqual(plan.engagements.map((e) => e.killShift), [0, 0, 0, 0]);
  // Classes from the loadouts, weapons from the kill (not the main weapon).
  assert.deepEqual(plan.engagements.map((e) => [e.aClass, e.bClass]),
    [["ha", "ha"], ["ha", "ha"], ["ha", "ha"], ["ha", "ha"]]);
  assert.deepEqual(plan.engagements.map((e) => e.weaponDoc?.name),
    ["MSW-R", "LA1 Anchor", "MSW-R", "LA1 Anchor"]);
  assert.deepEqual(plan.engagements.map((e) => e.veh), [0, 0, 0, 0]);
  assert.deepEqual(plan.engagements.map((e) => e.hs), [false, true, true, false]);
  // The killing blow carries the real headshot flag.
  for (const [i, e] of plan.engagements.entries()) {
    const killing = e.shots.find((s) => s.from === e.outcome && Math.abs(s.t - e.killAt) < 1e-9);
    assert.ok(killing, `engagement ${i} has a killing shot`);
    assert.equal(killing.hs, e.hs, `engagement ${i} killing shot hs`);
  }
  // No overlaps, lives alternate with the deaths.
  for (let i = 1; i < plan.engagements.length; i++)
    assert.ok(plan.engagements[i].t0 >= plan.engagements[i - 1].t1 - 1e-9, `engagement ${i} starts after the previous ends`);
  assert.deepEqual(plan.lives.a.map((l) => l.deathBy), ["b", "b"]);
  assert.deepEqual(plan.lives.b.map((l) => l.deathBy), ["a", "a", null]);
  for (const side of ["a", "b"]) for (const l of plan.lives[side]) assert.ok(l.start < l.end, `${side} life has positive length`);
});

test("planRealFight carries the vehicle kill and the LA classes of the second fight", () => {
  const pe = pairEvents(reply.events, reply.qid, true);
  const fight = fightsOf(pe, reply.events, reply.pid)[0]; // the 2-kill fight
  const plan = planRealFight(A, B, fight, opts);
  assert.equal(plan.engagements.length, 2);
  assert.deepEqual(plan.engagements.map((e) => e.outcome), ["a", "a"]);
  assert.deepEqual(plan.engagements.map((e) => [e.aClass, e.bClass]), [["la", "la"], ["ha", "ha"]]);
  assert.deepEqual(plan.engagements.map((e) => e.veh), [0, 1]);
  assert.equal(Math.round(plan.engagements[1].killAt - plan.engagements[0].killAt), 120);
});

test("planRealFight clamps a tighter-than-lead-in gap instead of overlapping", () => {
  const tight = { t0: 1000, t1: 1003, ev: [
    { t: 1000, aKill: true, w: 7254, hs: false, aL: 13, bL: 20, veh: 0 },
    { t: 1003, aKill: false, w: 7236, hs: false, aL: 13, bL: 20, veh: 0 },
  ] };
  const plan = planRealFight(A, B, tight, opts);
  assert.equal(plan.engagements.length, 2);
  assert.ok(plan.engagements[1].killShift > 0, "the second kill shifts later");
  assert.ok(plan.engagements[1].t0 >= plan.engagements[0].t1 - 1e-9, "no overlap");
  assert.deepEqual(plan.engagements.map((e) => e.outcome), ["a", "b"]);
});

test("planRealFight handles a single kill and rejects an empty fight", () => {
  const one = { t0: 1000, t1: 1000, ev: [{ t: 1000, aKill: true, w: 7254, hs: true, aL: 13, bL: 20, veh: 0 }] };
  const plan = planRealFight(A, B, one, opts);
  assert.equal(plan.engagements.length, 1);
  assert.ok(plan.duration > plan.engagements[0].killAt, "aftermath runs past the kill");
  assert.throws(() => planRealFight(A, B, { t0: 0, t1: 0, ev: [] }, opts), /empty fight/);
});
