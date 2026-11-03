// #106 1v1 exchanges + recovery (node): the pure exchange module, and the
// pair planner's recovery aftermath — every decisive engagement trades
// shots from both sides, and a hurt winner recovers instead of idling.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SHIELD, HEALTH, returnBurst, applyHits, medicChance, recoveryFor } from "../replay/exchange.mjs";
import { planDuel } from "../replay/duel-plan.mjs";
import { shooter, mulberry } from "../replay/engagement.mjs";
import { toProfile, FALLBACK } from "../replay/weapons.mjs";

const r123 = mulberry(42);

test("return burst: short, mostly misses, never more hits than shots", () => {
  for (let i = 0; i < 200; i++) {
    const b = returnBurst(r123);
    assert.ok(b.n >= 5 && b.n <= 9, `burst of ${b.n}`);
    assert.ok(b.h >= 0 && b.h <= b.n, `${b.h} hits of ${b.n} shots`);
  }
  const tot = Array.from({ length: 200 }, () => returnBurst(r123)).reduce((a, b) => a + b.h, 0);
  assert.ok(tot > 100 && tot < 400, `200 bursts land ${tot} hits (mean ~1.75 each)`);
});

test("applyHits: shield absorbs first, health takes the overflow", () => {
  assert.deepEqual(applyHits(SHIELD, HEALTH, 2), { shield: 200, health: 500, tookDamage: true });
  assert.deepEqual(applyHits(SHIELD, HEALTH, 4), { shield: 0, health: 400, tookDamage: true });
  assert.deepEqual(applyHits(SHIELD, HEALTH, 0), { shield: 500, health: 500, tookDamage: false });
  assert.deepEqual(applyHits(100, 500, 10), { shield: 0, health: 0, tookDamage: true }, "health floors at zero");
});

test("medic chance: zero allies means no medic, then rises with allies and revived share", () => {
  assert.equal(medicChance(0, 0.9), 0);
  assert.equal(medicChance(0, 0), 0);
  const low = medicChance(1, 0), mid = medicChance(3, 0.3), high = medicChance(10, 1);
  assert.ok(low < mid && mid < high, `${low} < ${mid} < ${high}`);
  assert.ok(high <= 0.85, "capped");
});

test("recoveryFor: untouched means none; shield, then health; medic iff the roll beats the chance", () => {
  assert.equal(recoveryFor({ shield: 500, health: 500, r: r123 }), null);
  assert.deepEqual(recoveryFor({ shield: 300, health: 500, r: r123 }).steps.map((s) => s.id), ["recover", "shieldRegen"]);
  // A fixed roll of 0 always beats any nonzero chance (medic), 0.99 never does (medkit).
  assert.deepEqual(recoveryFor({ shield: 0, health: 400, allies: 5, revivedShare: 0.3, r: () => 0 }).steps.map((s) => s.id),
    ["recover", "shieldRegen", "medicHeal"]);
  assert.deepEqual(recoveryFor({ shield: 0, health: 400, allies: 5, revivedShare: 0.3, r: () => 0.99 }).steps.map((s) => s.id),
    ["recover", "shieldRegen", "medkit"]);
  assert.deepEqual(recoveryFor({ shield: 0, health: 400, allies: 0, revivedShare: 0.9, r: () => 0 }).steps.map((s) => s.id),
    ["recover", "shieldRegen", "medkit"], "no allies, no medic even at a high revived share");
  const rec = recoveryFor({ shield: 0, health: 400, allies: 5, revivedShare: 0.3, r: () => 0.99 });
  assert.equal(rec.dur, 3 + 1.5 + 1.2, "dur is the steps' total, for the planner's gap math");
});

// Pair planner recovery (same fixture shape as the duel-plan tests).
const AR = toProfile(FALLBACK["Assault Rifle"]);
const profs = JSON.parse(readFileSync("assets/weapons/profiles.json", "utf8")).profiles || {};
const CLASSES = ["inf", "la", "med", "eng", "ha", "max"];
const side = (shard) => {
  const v = shard.v;
  const profile = toProfile(profs[String(shard.m?.[0])]) ?? AR;
  const c = Array.isArray(shard.c) ? shard.c.slice(1) : [];
  const shares = {};
  c.forEach((s, i) => { if (s > 0) shares[CLASSES[i]] = s; });
  return {
    sh: shooter(profile, { kd: v[0] ?? 1, spk: v[5] ?? 39.5, hpk: v[6] ?? 10.4, hsr: (v[4] ?? 18.26) / 100 }),
    info: { kpm: v[1] ?? 1, classShares: shares, revivedShare: v[13] ?? 0.3, resupplyPm: v[16] ?? 0 },
  };
};
const fx = JSON.parse(readFileSync("test/fixtures/replay-pairs.json", "utf8"));
const pair = fx.pairs[0];
const A = side(pair.aShard), B = side(pair.bShard);
const pA = pair.aRow.kills / (pair.aRow.kills + pair.aRow.deaths);
const plan = planDuel(A.sh, B.sh, { seed: 12345, durationSec: 7200, pA, aInfo: A.info, bInfo: B.info, allies: 3 });

test("pair engagements: the winner fires in commit, the loser fires in trade", () => {
  const dec = plan.engagements.filter((e) => e.outcome === "a" || e.outcome === "b");
  assert.ok(dec.length > 50, `${dec.length} decisive engagements`);
  let silentLoser = 0;
  for (const e of dec) {
    assert.ok(e.shots.some((s) => s.phase === "commit" && s.from === e.outcome), `engagement ${e.idx} has the winner's commit shots`);
    const loser = e.outcome === "a" ? "b" : "a";
    // The loser's trade count is Poisson around the calibrated mean, so a
    // zero-trade loser (who fires nothing all engagement) is possible by
    // model design — rare, not a planner bug. Count it, don't hide it.
    if (!e.shots.some((s) => s.phase === "trade" && s.from === loser)) silentLoser++;
  }
  assert.ok(silentLoser / dec.length < 0.05, `silent losers ${silentLoser}/${dec.length} — the exchange is one-sided too often`);
});

test("pair recovery: a hurt winner recovers in the aftermath, an untouched winner idles", () => {
  const dec = plan.engagements.filter((e) => e.outcome === "a" || e.outcome === "b");
  let hurt = 0, untouched = 0;
  for (const e of dec) {
    const w = e.outcome;
    const snaps = e.hp[w] || [];
    const end = [...snaps].reverse().find(([t]) => t <= e.killAt);
    const healthMax = (e[w === "a" ? "aClass" : "bClass"] === "max" ? 2000 : HEALTH);
    const damaged = end && (end[1] < SHIELD || end[2] < healthMax);
    const healthDown = end && end[2] < healthMax;
    const recs = e.segments.filter((s) => s.phase === "aftermath" && s.rec).map((s) => s.rec);
    if (damaged) {
      hurt++;
      assert.ok(e.recovery, `engagement ${e.idx} records its recovery`);
      assert.deepEqual(recs, e.recovery.steps.map((s) => s.id), `engagement ${e.idx} aftermath carries the recovery steps`);
      assert.equal(recs[0], "recover", "cover first");
      assert.ok(recs.includes("shieldRegen"), "shield refill follows");
      // A health fix is last only when health is actually down; a
      // shield-only winner recovers as [recover, shieldRegen].
      if (healthDown) assert.ok(recs.at(-1) === "medkit" || recs.at(-1) === "medicHeal", `health fix last, got ${recs.at(-1)}`);
      else assert.deepEqual(recs, ["recover", "shieldRegen"]);
      const dur = e.segments.filter((s) => s.phase === "aftermath").reduce((a, s) => a + (s.t1 - s.t0), 0);
      assert.ok(Math.abs(dur - e.recovery.dur) < 1e-9, "aftermath lasts exactly the recovery");
    } else {
      untouched++;
      assert.equal(e.recovery, null, `engagement ${e.idx} has no recovery when untouched`);
      assert.equal(recs.length, 0, "untouched winners keep the plain aftermath");
    }
  }
  assert.ok(hurt > 0, "some winners end hurt (else the recovery path is untested)");
  assert.ok(untouched > 0, "some winners end untouched (else the plain path is untested)");
});
