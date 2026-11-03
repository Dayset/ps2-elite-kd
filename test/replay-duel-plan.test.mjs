// Duel planner (#96): timeline invariants + the Done criteria over long plans.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planDuel, streakChain, deriveSeed, DEFAULTS } from "../replay/duel-plan.mjs";
import { shooter, engage, mulberry } from "../replay/engagement.mjs";
import { rangeFor } from "../replay/camera.mjs";
import { toProfile, FALLBACK } from "../replay/weapons.mjs";

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

test("streakChain keeps the long-run share exact", () => {
  for (const [pA, s] of [[0.5, 0.55], [0.4, 0.55], [0.6, 0.7], [0.3, 0.8], [0.857, 0.55]]) {
    const { alpha, beta } = streakChain(pA, s);
    assert.ok(alpha >= 0 && alpha <= 1 && beta >= 0 && beta <= 1);
    const pi = pA * alpha + (1 - pA) * beta;
    assert.ok(Math.abs(pi - pA) < 1e-9, `share ${pi} vs ${pA}`);
    const streak = pA * alpha + (1 - pA) * (1 - beta);
    assert.ok(streak >= s - 1e-9, `streak ${streak} below target ${s}`);
  }
});

test("plan invariants: no overlaps, nobody shoots while dead, lives alternate, shots are engage() shots", () => {
  const pair = fx.pairs[0];
  const A = side(pair.aShard), B = side(pair.bShard);
  const pA = pair.aRow.kills / (pair.aRow.kills + pair.aRow.deaths);
  const plan = planDuel(A.sh, B.sh, { seed: 12345, durationSec: 7200, pA, aInfo: A.info, bInfo: B.info });
  // Segments ordered and non-overlapping within each engagement; engagements ordered and non-overlapping.
  for (let i = 0; i < plan.engagements.length; i++) {
    const e = plan.engagements[i];
    for (let j = 1; j < e.segments.length; j++) assert.ok(e.segments[j].t0 >= e.segments[j - 1].t1 - 1e-9, `segment overlap ${e.idx}`);
    if (i > 0) assert.ok(e.t0 >= plan.engagements[i - 1].t1 - 1e-9, `engagement overlap ${e.idx}`);
    assert.ok(e.segments.every((s) => ["approach", "spot", "trade", "commit", "resolution", "aftermath"].includes(s.phase)));
    if (e.outcome !== "a" && e.outcome !== "b") assert.ok(!e.segments.some((s) => s.phase === "commit"), "no commit segment without a winner");
  }
  // Nobody shoots while dead: every shot's shooter is alive at that time.
  const deadAt = { a: [], b: [] }; // [start, end) dead intervals per side
  for (const sideName of ["a", "b"]) {
    for (const lf of plan.lives[sideName]) {
      if (lf.deathBy) {
        const next = plan.lives[sideName][plan.lives[sideName].indexOf(lf) + 1];
        deadAt[sideName].push([lf.end, next ? next.start : Infinity]);
      }
    }
  }
  for (const e of plan.engagements) {
    for (const s of e.shots) {
      if (s.from !== "a" && s.from !== "b") continue;
      assert.ok(!deadAt[s.from].some(([d0, d1]) => s.t >= d0 && s.t < d1), `${s.from} shoots while dead at ${s.t}`);
    }
  }
  // Lives alternate: per side, lives are sequential and non-overlapping.
  for (const sideName of ["a", "b"]) {
    const ls = plan.lives[sideName];
    for (let i = 1; i < ls.length; i++) assert.ok(ls[i].start >= ls[i - 1].end - 1e-9, `${sideName} life overlap`);
  }
  // Shots are engage() shots: re-run engage with the derived stream and compare (time-shifted).
  // The plan passes rangeFor (#100), so the recomputation must too.
  for (const e of plan.engagements.slice(0, 20)) {
    const eng = engage({ ...A.sh, cls: e.aClass }, { ...B.sh, cls: e.bClass },
      mulberry(deriveSeed(12345, e.idx)), { outcome: e.outcome, wA: pA, victim: e.victim, rangeFor });
    const expected = eng.shots.map((s) => s.t + e.segments.find((x) => x.phase === "trade").t0);
    const got = e.shots.map((s) => s.t);
    assert.deepEqual(got, expected, `engagement ${e.idx} shots differ from engage()`);
  }
});

test("Done criteria over long plans: kill share, gap median, fight structure", () => {
  for (const pair of fx.pairs) {
    const A = side(pair.aShard), B = side(pair.bShard);
    const pA = pair.aRow.kills / (pair.aRow.kills + pair.aRow.deaths);
    // Statistical checks pool 5 seeds: one draw's share/gap median carries
    // binomial/lognormal noise, so the criterion is judged on the pooled
    // distribution, not a single draw. Structural checks use one plan.
    let decTotal = 0, decA = 0;
    const gaps = [];
    for (let k = 0; k < 5; k++) {
      const plan = planDuel(A.sh, B.sh, { seed: 12345 + k, durationSec: 21600, pA, aInfo: A.info, bInfo: B.info });
      const decisive = plan.engagements.filter((e) => e.outcome === "a" || e.outcome === "b");
      decTotal += decisive.length;
      decA += decisive.filter((e) => e.outcome === "a").length;
      let lastKill = null, lastFight = -1;
      for (const e of decisive) {
        if (lastKill != null && e.fightIdx === lastFight) gaps.push(e.killAt - lastKill);
        lastKill = e.killAt; lastFight = e.fightIdx;
      }
    }
    const share = decA / decTotal;
    assert.ok(Math.abs(share - pA) <= 0.03, `${pair.id}: share ${share.toFixed(3)} vs pA ${pA.toFixed(3)} (${decTotal} decisive)`);
    gaps.sort((x, y) => x - y);
    const median = gaps[Math.floor(gaps.length / 2)];
    assert.ok(Math.abs(median - DEFAULTS.gapMedianS) / DEFAULTS.gapMedianS <= 0.10,
      `${pair.id}: gap median ${median.toFixed(1)} vs ${DEFAULTS.gapMedianS}`);
    const plan = planDuel(A.sh, B.sh, { seed: 12345, durationSec: 21600, pA, aInfo: A.info, bInfo: B.info });
    for (const f of plan.fights) {
      if (f.t1 >= 21600) continue; // trailing partial fight
      assert.ok(f.kills.length >= 1 && f.kills.length <= 14, `${pair.id}: fight with ${f.kills.length} kills`);
    }
    for (const c of plan.cuts) {
      assert.ok(plan.fights.some((f) => Math.abs(f.t1 - c.t) < 1e-9), "cut not on a fight boundary");
    }
  }
});
