// Duel scene helpers (#98): HP traces, spark colors, score, lives, states, killcam.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planDuel } from "../replay/duel-plan.mjs";
import { shooter } from "../replay/engagement.mjs";
import { toProfile, FALLBACK } from "../replay/weapons.mjs";
import { hpAt, barFracs, sparkFor, scoreAt, engagementAt, lifeAt, phaseState, killcamFor } from "../replay/duel-scene.mjs";

const AR = toProfile(FALLBACK["Assault Rifle"]);
const CLASSES = ["inf", "la", "med", "eng", "ha", "max"];
const side = (shard) => {
  const v = shard.v;
  const c = Array.isArray(shard.c) ? shard.c.slice(1) : [];
  const shares = {};
  c.forEach((s, i) => { if (s > 0) shares[CLASSES[i]] = s; });
  return {
    sh: shooter(AR, { kd: v[0] ?? 1, spk: v[5] ?? 39.5, hpk: v[6] ?? 10.4, hsr: (v[4] ?? 18.26) / 100 }),
    info: { kpm: v[1] ?? 1, classShares: shares, revivedShare: v[13] ?? 0.3, resupplyPm: v[16] ?? 0 },
  };
};
const fx = JSON.parse(readFileSync("test/fixtures/replay-pairs.json", "utf8"));
const pair = fx.pairs[0]; // tolyano-fantom220tr, both HA mains
const A = side(pair.aShard), B = side(pair.bShard);
const pA = pair.aRow.kills / (pair.aRow.kills + pair.aRow.deaths);
const plan = planDuel(A.sh, B.sh, { seed: 12345, durationSec: 7200, pA, aInfo: A.info, bInfo: B.info });

test("hpAt follows the trace and resets to full at the commit", () => {
  const eng = plan.engagements.find((e) => e.outcome === "a" || e.outcome === "b");
  assert.ok(eng, "a decisive engagement exists");
  const tradeSeg = eng.segments.find((s) => s.phase === "trade");
  assert.deepEqual(hpAt(eng, tradeSeg.t0, "a"), { shield: 500, health: 500, over: 0 });
  // After the engagement, the loser is at 0 and the winner damaged-but-alive.
  const loser = eng.victim, winner = eng.outcome;
  const after = hpAt(eng, eng.t1, loser);
  assert.equal(after.health, 0, "loser health is 0 after the kill");
  const wAfter = hpAt(eng, eng.t1, winner);
  assert.ok(wAfter.health > 0 && wAfter.health <= 500, "winner alive");
  // Bar fractions: full shield + full health = 1, empty = 0.
  assert.deepEqual(barFracs({ shield: 500, health: 500, over: 0 }, "ha"), { shield: 500 / 950, health: 1 });
  assert.deepEqual(barFracs({ shield: 0, health: 0, over: 0 }, "inf"), { shield: 0, health: 0 });
  assert.deepEqual(barFracs({ shield: 500, health: 2000, over: 0 }, "max"), { shield: 1, health: 1 });
});

test("sparkFor is blue on shield damage, red on health damage, null on misses", () => {
  const eng = plan.engagements.find((e) => e.outcome === "a" || e.outcome === "b");
  let blue = 0, red = 0, nulls = 0;
  for (let i = 0; i < eng.shots.length; i++) {
    const c = sparkFor(eng, i);
    if (!eng.shots[i].hit) assert.equal(c, null, "misses spark nothing");
    else if (c === "#4aa8ff") blue++;
    else if (c === "#ff5a4a") red++;
    else nulls++;
  }
  assert.ok(blue > 0, "some shield sparks");
  assert.ok(red > 0, "some health sparks (the kill eats health)");
  assert.equal(nulls, 0, "every hit sparks one color");
});

test("scoreAt counts decisive kills only, engagementAt/lifeAt locate the moment", () => {
  const last = plan.engagements[plan.engagements.length - 1];
  const s = scoreAt(plan, last.t1);
  const dec = plan.engagements.filter((e) => e.outcome === "a" || e.outcome === "b");
  assert.equal(s.a + s.b, dec.filter((e) => e.killAt <= last.t1).length);
  assert.equal(s.a, dec.filter((e) => e.outcome === "a" && e.killAt <= last.t1).length);
  const mid = plan.engagements[0];
  assert.equal(engagementAt(plan, mid.t0 + 0.1), mid);
  assert.equal(engagementAt(plan, -1), null);
  const life = lifeAt(plan, "a", 0);
  assert.ok(life && life.start === 0, "both spawn at 0");
  // A dead gap: between a death and the next life start, lifeAt is null.
  const deadLife = plan.lives.a.find((l) => l.deathBy);
  if (deadLife) {
    const next = plan.lives.a[plan.lives.a.indexOf(deadLife) + 1];
    if (next) assert.equal(lifeAt(plan, "a", (deadLife.end + next.start) / 2), null);
  }
});

test("phaseState maps phases, killcamFor reads the engagement", () => {
  const eng = plan.engagements.find((e) => e.outcome === "a" || e.outcome === "b");
  assert.equal(phaseState("approach", "a", eng), "run");
  assert.equal(phaseState("spot", "a", eng), "idle");
  assert.equal(phaseState("trade", "a", eng), "shoot");
  assert.equal(phaseState("commit", "a", eng), "shoot");
  assert.equal(phaseState("resolution", eng.victim, eng), "die");
  assert.equal(phaseState("resolution", eng.outcome, eng), "idle");
  assert.equal(phaseState("aftermath", "a", eng), "idle");
  const kc = killcamFor(eng, { main: { name: "Anchor", img: 9449 } });
  assert.equal(kc.killer, eng.outcome);
  assert.equal(kc.weapon.name, "Anchor");
  assert.equal(kc.weapon.img, 9449);
  assert.ok(kc.hits >= 1 && kc.hs <= kc.hits && kc.ttk > 0);
});
