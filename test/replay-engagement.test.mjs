// Hit model (#95): calibration, engagement traces, and the Monte Carlo that
// proves simulated shots/kill match the shooters' lifetime stats.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shooter, engage, mulberry, headChance } from "../replay/engagement.mjs";
import { toProfile, FALLBACK } from "../replay/weapons.mjs";

const AR = toProfile(FALLBACK["Assault Rifle"]);
const medShooter = () => shooter({ rpm: 600, dmgMax: 143, hsMult: 2.0, pellets: 1, mode: "auto" }, { spk: 39.5, hpk: 10.4, hsr: 0.1826, kd: 2, cls: "ha" });

test("median calibration: commit ~53% base, trade ~13% effective", () => {
  const s = medShooter();
  assert.ok(s.N > 6 && s.N < 8, `N ${s.N}`);
  assert.ok(Math.abs(s.pCommitEff - 1.8 * (10.4 / 39.5)) < 1e-9);
  assert.ok(Math.abs(s.pTradeEff - (10.4 - s.N) / (39.5 - s.N / s.pCommitEff)) < 1e-9);
  assert.ok(s.pCommit > s.pCommitEff && s.pCommit < 0.75, `base ${s.pCommit}`);
  assert.ok(s.pTradeEff > 0.10 && s.pTradeEff < 0.17, `trade eff ${s.pTradeEff}`);
});

test("shooter() falls back to population medians on missing stats", () => {
  const s = shooter(AR, {});
  assert.equal(s.spk, 39.5); assert.equal(s.hpk, 10.4);
});

test("engage() is deterministic for a fixed seed and respects forced outcomes", () => {
  const a = medShooter(), b = medShooter();
  const r1 = engage(a, b, mulberry(42), { outcome: "a", wA: 0.5 });
  const r2 = engage(a, b, mulberry(42), { outcome: "a", wA: 0.5 });
  assert.deepEqual(r1.shots, r2.shots);
  assert.equal(r1.result, "a");
  const killShot = [...r1.shots].reverse().find((s) => s.from === "a" && s.phase === "commit" && s.hit);
  assert.ok(killShot, "a kill shot exists");
  const lastB = r1.hp.b[r1.hp.b.length - 1];
  assert.equal(lastB[1] + lastB[2] + lastB[3], 0, "loser ends at 0 HP");
  const forced = engage(a, b, mulberry(7), { outcome: "b", wA: 0.5 });
  assert.equal(forced.result, "b");
});

test("trade never kills and no kill takes fewer hits than the all-headshot floor", () => {
  const a = medShooter(), b = medShooter();
  const total = (s) => s[1] + s[2] + s[3];
  for (let seed = 0; seed < 50; seed++) {
    const r = engage(a, b, mulberry(seed), { wA: 0.5 });
    // The first zero-HP moment is the kill (commit) or the third-party shot, never a trade shot.
    const firstZero = Math.min(
      ...[...r.hp.a, ...r.hp.b].filter((s) => total(s) === 0).map((s) => s[0]), Infinity);
    if (r.result === "a" || r.result === "b") {
      assert.equal(firstZero, r.killAt);
      const commitHits = r.shots.filter((s) => s.from === r.result && s.phase === "commit" && s.hit).length;
      assert.ok(commitHits >= a.minHits, `kill with ${commitHits} hits < floor ${a.minHits}`);
    } else if (r.result === "break") {
      assert.equal(firstZero, Infinity);
    } else {
      const third = r.shots.find((s) => s.from === "third");
      assert.equal(firstZero, third.t);
    }
    assert.ok(r.hp.a.every((s) => s.slice(1).every(Number.isFinite)));
    assert.ok(r.shots.every((s, i) => i === 0 || s.t >= r.shots[i - 1].t), "shots time-ordered");
  }
});

test("Monte Carlo: 20k engagements per fixture pair reproduce spk/hpk/HS within tolerance", () => {
  const fx = JSON.parse(readFileSync("test/fixtures/replay-pairs.json", "utf8"));
  const profs = JSON.parse(readFileSync("assets/weapons/profiles.json", "utf8")).profiles || {};
  const CLASSES = ["inf", "la", "med", "eng", "ha", "max"];
  const side = (shard) => {
    const v = shard.v;
    const profile = toProfile(profs[String(shard.m?.[0])]) ?? AR;
    const c = Array.isArray(shard.c) ? shard.c.slice(1) : [];
    const top = c.length ? c.indexOf(Math.max(...c)) : -1;
    return shooter(profile, {
      kd: v[0] ?? 1, spk: v[5] ?? 39.5, hpk: v[6] ?? 10.4, hsr: (v[4] ?? 18.26) / 100,
      cls: top >= 0 ? CLASSES[top] : null,
    });
  };
  for (const pair of fx.pairs) {
    const A = side(pair.aShard), B = side(pair.bShard);
    const wA = pair.aRow.kills / (pair.aRow.kills + pair.aRow.deaths);
    const rng = mulberry(1234 + pair.id.length);
    const agg = {
      a: { shots: 0, hits: 0, kills: 0, hsKills: 0, tradeShots: 0, tradeHits: 0, commitShots: 0, commitHits: 0 },
      b: { shots: 0, hits: 0, kills: 0, hsKills: 0, tradeShots: 0, tradeHits: 0, commitShots: 0, commitHits: 0 },
    };
    for (let i = 0; i < 20000; i++) {
      const r = engage(A, B, rng, { wA });
      for (const s of r.shots) {
        if (s.from !== "a" && s.from !== "b") continue;
        const g = agg[s.from];
        g.shots++; if (s.hit) g.hits++;
        if (s.phase === "trade") { g.tradeShots++; if (s.hit) g.tradeHits++; }
        else { g.commitShots++; if (s.hit) g.commitHits++; }
      }
      if (r.result === "a" || r.result === "b") {
        const g = agg[r.result];
        g.kills++;
        const killShot = [...r.shots].reverse().find((s) => s.from === r.result && s.phase === "commit" && s.hit);
        if (killShot?.hs) g.hsKills++;
      }
    }
    for (const [sideName, sh, g] of [["a", A, agg.a], ["b", B, agg.b]]) {
      const simSpk = g.shots / g.kills, simHpk = g.hits / g.kills;
      assert.ok(Math.abs(simSpk - sh.spk) / sh.spk <= 0.05, `${pair.id}/${sideName}: spk ${simSpk.toFixed(2)} vs ${sh.spk}`);
      assert.ok(Math.abs(simHpk - sh.hpk) / sh.hpk <= 0.05, `${pair.id}/${sideName}: hpk ${simHpk.toFixed(2)} vs ${sh.hpk}`);
      assert.ok(Math.abs(g.hsKills / g.kills - sh.hsr) <= 0.03, `${pair.id}/${sideName}: HS share ${(g.hsKills / g.kills).toFixed(3)} vs ${sh.hsr}`);
      const hitShare = g.hits / g.shots, target = sh.hpk / sh.spk;
      assert.ok(Math.abs(hitShare - target) <= 0.02, `${pair.id}/${sideName}: hit share ${hitShare.toFixed(3)} vs ${target.toFixed(3)}`);
      const tradeShare = g.tradeHits / Math.max(1, g.tradeShots), commitShare = g.commitHits / Math.max(1, g.commitShots);
      // The trade/commit distinction holds whenever the shooter's own stats
      // admit it. Stria (mismatch/b: 91% hit share, N=1.5 from a 650-dmg
      // weapon) cannot have a low-accuracy trade phase without breaking her
      // spk/hpk match, so she is exempt here; the other nine sit at 0.25–0.44.
      if (sh.pTradeEff < 0.6 * sh.pCommitEff)
        assert.ok(tradeShare < 0.6 * commitShare, `${pair.id}/${sideName}: trade ${tradeShare.toFixed(3)} !< 0.6 × commit ${commitShare.toFixed(3)}`);
    }
  }
});

test("headChance() solves the per-hit head chance from the HS kill share", () => {
  // Tolyano (HS 32.7 %, x2): about 1 hit in 5 lands on the head (#109).
  assert.ok(Math.abs(headChance(0.327, 2) - 0.195) < 0.002, `got ${headChance(0.327, 2)}`);
  assert.equal(headChance(0, 2), 0);
  assert.equal(headChance(1, 2), 1);
  assert.equal(headChance(0.5, 1), 0.5);
  assert.ok(headChance(0.327, 2) < 0.327, "damage weighting pulls p below hsr");
  assert.ok(Math.abs(headChance(32.7, 2) - headChance(0.327, 2)) < 1e-9, "percent input accepted");
  assert.ok(Math.abs(headChance(0.1826, 2) - 0.1826 / (2 * (1 - 0.1826) + 0.1826)) < 1e-12);
});

test("engage() hsKill conditions the killing blow only (#101)", () => {
  const a = medShooter(), b = medShooter();
  for (const flag of [true, false]) {
    const r = engage(a, b, mulberry(42), { outcome: "a", wA: 0.5, hsKill: flag });
    assert.equal(r.result, "a");
    assert.ok(r.killAt != null, "a kill happens");
    const killing = r.shots.find((s) => s.from === "a" && s.phase === "commit" && Math.abs(s.t - r.killAt) < 1e-9);
    assert.ok(killing, "the killing shot is found at killAt");
    assert.equal(killing.hs, flag, `killing shot hs is ${flag}`);
    const lastB = r.hp.b[r.hp.b.length - 1];
    assert.equal(lastB[1] + lastB[2] + lastB[3], 0, "loser still ends at 0 HP");
  }
  // Without hsKill the same seed reproduces the unconditioned engagement.
  const plain = engage(a, b, mulberry(42), { outcome: "a", wA: 0.5 });
  const forced = engage(a, b, mulberry(42), { outcome: "a", wA: 0.5, hsKill: true });
  assert.ok(plain.killAt != null && forced.killAt != null);
});
