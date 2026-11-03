/**
 * 🎬 Duel planner (replay #96): a timeline of engagements between two
 * regulars, true to their pair history. Pure and seeded; player.js uses it
 * when a pair exists (crowd mode keeps planCycle).
 *
 * Inputs: two shooter() outputs (replay/engagement.mjs) plus pair context:
 *   pA (A's share of decisive pair kills), a pair-model (replay/pair-model
 *   .mjs aggregate or null → the ticket's placeholders), and per-side
 *   extras { kpm, classShares, revivedShare, resupplyPm }.
 *
 * Timing: gaps between pair kills inside a fight come from the lognormal
 * (gapMedianS, gapSigma). A kill's gap budget is split across everything
 * since the last kill: intervening break/third engagements take their base
 * time, the victim's respawn or revive (revived share) waits out, and the
 * kill engagement's approach absorbs the slack (floored by its base, so a
 * sampled gap shorter than its components stretches to fit them). A fight
 * lasts killsPerFight pair kills (sampled once per fight from the [p10,
 * p50, p90] triple by log-linear interpolation), then a "next fight" cut
 * card. Everything is in data seconds; no playback speed here.
 *
 * Outcomes: breaks and third parties first (breakP fixed; thirdP grows with
 * crowdPerMin and shrinks with oneVoneShare), else a decisive engagement
 * whose winner follows a two-state Markov chain: P(same killer as last) =
 * streakP, solved so the long-run share stays pA. When (streakP, pA) is
 * infeasible (a heavy underdog cannot alternate often), the chain keeps the
 * share exact and takes the nearest feasible streakP.
 *
 * Who does what: the pusher is sampled from the KPM share, shifted +0.1
 * toward the last engagement's winner (the healthier side pushes); LA
 * flanks and hops, HA pops the overshield on commit (in engage()), medic
 * heals after a won exchange, engineer drops ammo in the aftermath when he
 * has a resupply rate. Class is sampled per life from each side's class
 * shares; each side shoots his own main weapon (the shooter profile).
 *
 * Shots: each engagement's shot list IS engage()'s output, time-shifted
 * into the plan. The engagement's rng is a per-engagement stream derived
 * from the master seed, so any engagement can be reproduced standalone
 * with engage(a, b, mulberry(derivedSeed), { outcome, wA }).
 */
import { engage, mulberry } from "./engagement.mjs?v=20261103-duel1";

export const DEFAULTS = { gapMedianS: 45, gapSigma: 0.6, killsPerFight: [2, 4, 9], streakP: 0.55, oneVoneShare: 0.3 };
const BREAK_P = 0.15;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const U = (rng, lo, hi) => lo + rng() * (hi - lo);
const lognormal = (rng, median, sigma) => {
  const u1 = Math.max(1e-9, rng()), u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return median * Math.exp(sigma * z);
};
const sampleKillsPerFight = (rng, [p10, p50, p90]) => {
  const u = rng();
  let k;
  if (u < 0.1) k = 1 + (p10 - 1) * (u / 0.1);
  else if (u < 0.5) k = p10 + (p50 - p10) * ((u - 0.1) / 0.4);
  else if (u < 0.9) k = p50 + (p90 - p50) * ((u - 0.5) / 0.4);
  else k = p90 + p90 * 0.5 * ((u - 0.9) / 0.1);
  return Math.max(1, Math.round(k));
};
const sampleClass = (rng, shares) => {
  const entries = Object.entries(shares || {}).filter(([, s]) => s > 0);
  if (!entries.length) return null;
  const total = entries.reduce((s, [, v]) => s + v, 0);
  let r = rng() * total;
  for (const [c, s] of entries) { r -= s; if (r <= 0) return c; }
  return entries[entries.length - 1][0];
};
/** Markov repeat/switch probabilities for (pA, streakP); share stays exact.
 * Feasibility: a share pA needs streakP ≥ |2·pA − 1| (a heavy favorite must
 * repeat often). When the target streakP is below that floor, α rises to
 * the feasible minimum and the streakP comes out at the floor instead —
 * the share never bends. */
export function streakChain(pA, streakP) {
  const alphaMin = Math.max(0, (2 * pA - 1) / pA);
  const alpha = clamp((streakP - 1 + 2 * pA) / (2 * pA), alphaMin, 1); // P(A wins | last was A)
  const beta = clamp((pA * (1 - alpha)) / (1 - pA), 0, 1); // P(A wins | last was B)
  return { alpha, beta };
}
export const deriveSeed = (master, idx) => (Math.imul((master >>> 0) ^ 0x9e3779b9, 2654435761) + Math.imul(idx + 1, 40503)) >>> 0;

/**
 * planDuel(a, b, opts): a, b are shooter() outputs (profile + stats inside).
 * opts: { seed, durationSec, pA, model, aInfo, bInfo } where aInfo/bInfo are
 * { kpm, classShares, revivedShare, resupplyPm }.
 * → { v, pA, params, thirdP, breakP, lives: {a, b}, engagements, fights, cuts }
 */
export function planDuel(a, b, opts = {}) {
  const seed = opts.seed ?? 12345;
  const rng = mulberry(seed);
  const m = opts.model?.defaults ?? DEFAULTS;
  const params = {
    gapMedianS: m.gapMedianS ?? DEFAULTS.gapMedianS,
    gapSigma: m.gapSigma ?? DEFAULTS.gapSigma,
    killsPerFight: m.killsPerFight ?? DEFAULTS.killsPerFight,
    streakP: m.streakP ?? DEFAULTS.streakP,
    oneVoneShare: m.oneVoneShare ?? DEFAULTS.oneVoneShare,
  };
  const pA = opts.pA ?? 0.5;
  const crowd = opts.model?.defaults?.crowdPerMin ?? 0;
  const thirdP = clamp(crowd * 0.02, 0.02, 0.15) * (1 - params.oneVoneShare * 0.5);
  const { alpha, beta } = streakChain(pA, params.streakP);
  const info = { a: opts.aInfo || {}, b: opts.bInfo || {} };
  const kpmA = info.a.kpm ?? 1, kpmB = info.b.kpm ?? 1;
  const duration = opts.durationSec ?? 7200;

  const lives = { a: [], b: [] };
  const engagements = [], fights = [], cuts = [];
  let lastWinner = null;
  let curFight = { idx: 0, t0: 0, kills: [] };
  let targetKills = sampleKillsPerFight(rng, params.killsPerFight);
  let t = 0, prevKillAt = null, pendingDeath = null;
  let life = {
    a: { cls: sampleClass(rng, info.a.classShares), start: 0 },
    b: { cls: sampleClass(rng, info.b.classShares), start: 0 },
  };

  let idx = 0;
  while (t < duration && idx < 100000) {
    // ---- the previous victim returns (respawn timer or revive) before this engagement
    let respawnDur = 0, revived = false, respawnSide = null;
    if (pendingDeath) {
      respawnSide = pendingDeath.side;
      const share = info[respawnSide].revivedShare ?? 0;
      if (rng() < share) { revived = true; respawnDur = U(rng, 2, 5); }
      else respawnDur = U(rng, 5, 10);
      life[respawnSide] = { cls: sampleClass(rng, info[respawnSide].classShares), start: pendingDeath.at + respawnDur };
      pendingDeath = null;
    }
    const tStart = Math.max(t, respawnSide ? life[respawnSide].start : 0);

    // ---- outcome: break / third / decisive (Markov on the last decisive winner)
    const r = rng();
    let outcome, victim = null;
    if (r < BREAK_P) outcome = "break";
    else if (r < BREAK_P + thirdP) { outcome = "third"; victim = rng() < 0.5 ? "a" : "b"; }
    else if (lastWinner == null) outcome = rng() < pA ? "a" : "b";
    else outcome = rng() < (lastWinner === "a" ? alpha : beta) ? "a" : "b";
    const decisive = outcome === "a" || outcome === "b";
    if (decisive) lastWinner = outcome;
    if (decisive) victim = outcome === "a" ? "b" : "a";

    // ---- per-life shooters (class varies per life; profile is the side's own)
    const eng = engage({ ...a, cls: life.a.cls }, { ...b, cls: life.b.cls },
      mulberry(deriveSeed(seed, idx)), { outcome, wA: pA, victim });
    // Trade length is the true trade end, not the last trade-phase shot: the
    // loser's deferred return fire carries phase "trade" but lands in the
    // commit window, so taking the max trade-phase time would swallow the
    // commit (commit shots would predate the commit segment). Decisive
    // engagements always open the commit at the first commit-phase shot.
    const commitShots = eng.shots.filter((s) => s.phase === "commit");
    const tradeDur = commitShots.length
      ? Math.min(...commitShots.map((s) => s.t)) - 0.5
      : eng.shots.filter((s) => s.phase === "trade").reduce((mx, s) => Math.max(mx, s.t), 0);
    const commitDur = eng.killAt != null ? eng.killAt - (tradeDur + 0.5) : 0;

    // ---- gap: only kill engagements draw a budget; breaks/thirds take base time.
    // The kill engagement's approach is pure slack: it absorbs the budget
    // remainder (floored at 0.5 s — "already in position"), so a long trade
    // or a respawn wait cannot inflate the median the way a fixed approach
    // base inside the components would.
    const spot = U(rng, 1, 3);
    const approachBase = U(rng, 3, 8);
    let approachDur = approachBase;
    if (decisive && prevKillAt != null) {
      const budget = lognormal(rng, params.gapMedianS, params.gapSigma);
      const sinceKill = tStart - prevKillAt;
      approachDur = Math.max(0.5, budget - sinceKill - spot - tradeDur - 0.5 - Math.max(0, commitDur));
    }
    const t0 = tStart;
    const tSpot = t0 + approachDur, tTrade = tSpot + spot;
    const tKill = decisive ? tTrade + eng.killAt : null;
    const tResolve = decisive ? tKill : tTrade + tradeDur;
    const aftermathDur = U(rng, 1, 3);
    const t1 = tResolve + 0.5 + aftermathDur;

    // ---- intents: pusher from the KPM share, +0.1 toward the last winner
    let pushA = kpmA / (kpmA + kpmB);
    if (lastWinner === "a") pushA = clamp(pushA + 0.1, 0, 1);
    if (lastWinner === "b") pushA = clamp(pushA - 0.1, 0, 1);
    const pusher = rng() < pushA ? "a" : "b";
    const intent = (side, phase) => {
      const cls = life[side].cls;
      if (phase === "approach") return cls === "la" ? "flank" : side === pusher ? "push" : "cover";
      if (phase === "spot") return "cover";
      if (phase === "trade") return side === pusher ? "push" : "cover";
      if (phase === "commit") return "push";
      if (phase === "resolution") return side === outcome ? "push" : "retreat";
      if (phase === "aftermath") {
        if (side === outcome && cls === "med") return "heal";
        if (cls === "eng" && (info[side].resupplyPm ?? 0) > 0) return "ammo";
        return side === outcome ? "reload" : "retreat";
      }
      return "cover";
    };
    const segments = [
      { phase: "approach", t0, t1: tSpot, aIntent: intent("a", "approach"), bIntent: intent("b", "approach") },
      { phase: "spot", t0: tSpot, t1: tTrade, aIntent: intent("a", "spot"), bIntent: intent("b", "spot") },
      { phase: "trade", t0: tTrade, t1: tTrade + tradeDur, aIntent: intent("a", "trade"), bIntent: intent("b", "trade") },
    ];
    if (decisive) {
      segments.push(
        { phase: "commit", t0: tTrade + tradeDur + 0.5, t1: tResolve, aIntent: intent("a", "commit"), bIntent: intent("b", "commit") },
      );
    }
    segments.push(
      { phase: "resolution", t0: tResolve, t1: tResolve + 0.5, aIntent: intent("a", "resolution"), bIntent: intent("b", "resolution") },
      { phase: "aftermath", t0: tResolve + 0.5, t1, aIntent: intent("a", "aftermath"), bIntent: intent("b", "aftermath") },
    );
    const shots = eng.shots.map((s) => ({ ...s, t: s.t + tTrade }));
    engagements.push({
      idx, fightIdx: curFight.idx, t0, t1, outcome, victim, revived, respawnSide, respawnDur,
      aClass: life.a.cls, bClass: life.b.cls, segments, shots,
      killAt: tKill, tradeDur, commitDur: Math.max(0, commitDur),
      // HP traces shifted into plan time (snapshots per shot, plus the commit reset).
      hp: { a: eng.hp.a.map(([t, s, h, o]) => [t + tTrade, s, h, o]), b: eng.hp.b.map(([t, s, h, o]) => [t + tTrade, s, h, o]) },
    });

    // ---- lives: a death closes the victim's life; the next loop reopens it
    if (victim) {
      const deathAt = decisive ? tKill : tResolve;
      lives[victim].push({ ...life[victim], end: deathAt, deathBy: outcome === "third" ? "third" : outcome });
      pendingDeath = { side: victim, at: deathAt };
    }
    if (decisive) {
      curFight.kills.push({ t: tKill, winner: outcome });
      prevKillAt = tKill;
      if (curFight.kills.length >= targetKills && t1 < duration) {
        cuts.push({ type: "cut", t: t1, fightIdx: curFight.idx });
        fights.push({ ...curFight, t1 });
        curFight = { idx: curFight.idx + 1, t0: t1, kills: [] };
        targetKills = sampleKillsPerFight(rng, params.killsPerFight);
      }
    }
    t = t1;
    idx++;
  }
  for (const side of ["a", "b"]) {
    if (pendingDeath && pendingDeath.side === side) continue; // died in the last engagement; already closed
    lives[side].push({ ...life[side], end: duration, deathBy: null });
  }
  if (curFight.kills.length > 0 || fights.length === 0) fights.push({ ...curFight, t1: duration });
  return { v: 1, pA, params, thirdP, breakP: BREAK_P, duration, lives, engagements, fights, cuts };
}
