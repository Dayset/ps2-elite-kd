/**
 * Glicko-2 for one pair of players (#112). Pure, no dependencies, browser + Node.
 *
 * Part 1 is a faithful port of melbaa/ps2ranks libs/glicko2.py (Heungsub Lee's glicko2, BSD):
 * scaleDown / scaleUp, reduceImpact, expectScore, determineSigma (Illinois iteration), rate,
 * rate1vs1, winpct1vs1. Same constants, same quirks (winpct1vs1 weighs each side by its OWN RD,
 * so the two numbers need not add up to 100). test/duels-glicko.test.mjs checks it against the
 * Python reference (Glickman's paper example + fixed kill sequences run through glicko2.py).
 *
 * Part 2 (duelGlicko) replays the kills between two players, oldest first, one rate1vs1 per kill
 * (the killer wins, the victim loses). Not a ladder: nothing is stored, nobody is re-ranked.
 * Choices (measured, see DUEL_GLICKO and claude/duels-glicko.md):
 *   - seed: both start from the 🎲 prediction (duelExpected of their ⚔️ iVi), not flat 1500;
 *   - vehicle kills: left out of the replay (infantry-only), the row says so;
 *   - RD widens with the days between kills and since the last kill (Glicko-2 step 6 per day);
 *   - fewer than DUEL_FIT_MIN infantry kills → no verdict.
 */
import { DUEL_FIT_MIN, duelExpected } from "./duels.mjs?v=20261102-luck5";

export const WIN = 1;
export const DRAW = 0.5;
export const LOSS = 0;
export const MU = 1500;
export const PHI = 350;
export const SIGMA = 0.06;
export const TAU = 1.0;
export const EPSILON = 0.000001;
export const RATIO = 173.7178;
/** Standardizes 1/(1+10^(-r/400)) to 1/(1+exp(-x)). */
export const Q = Math.log(10) / 400;

export const rating = (mu, phi, sigma) => ({ mu, phi, sigma });

/** env = { mu, phi, sigma, tau, epsilon } (ps2ranks Glicko2 object); missing fields take the module defaults. */
export const glickoEnv = (o = {}) => ({ mu: MU, phi: PHI, sigma: SIGMA, tau: TAU, epsilon: EPSILON, ...o });

export const scaleDown = (env, r, ratio = RATIO) => rating((r.mu - env.mu) / ratio, r.phi / ratio, r.sigma);
export const scaleUp = (env, r, ratio = RATIO) => rating(r.mu * ratio + env.mu, r.phi * ratio, r.sigma);
/** g(RD): reduces the impact of games as a function of an opponent's RD (scaled phi). */
export const reduceImpact = (r) => 1 / Math.sqrt(1 + (3 * r.phi ** 2) / (Math.PI ** 2));
export const expectScore = (r, o, impact) => 1 / (1 + Math.exp(-impact * (r.mu - o.mu)));

export function determineSigma(env, r, difference, variance) {
  const phi = r.phi;
  const d2 = difference ** 2;
  const alpha = Math.log(r.sigma ** 2);
  const tau2 = env.tau ** 2;
  const f = (x) => {
    const tmp = phi ** 2 + variance + Math.exp(x);
    const a = (Math.exp(x) * (d2 - tmp)) / (2 * tmp ** 2);
    const b = (x - alpha) / tau2;
    return a - b;
  };
  let a = alpha, b;
  if (d2 > phi ** 2 + variance) b = Math.log(d2 - phi ** 2 - variance);
  else {
    let k = 1;
    while (f(alpha - k * Math.sqrt(tau2)) < 0) k += 1;
    b = alpha - k * Math.sqrt(tau2);
  }
  let fa = f(a), fb = f(b);
  while (Math.abs(b - a) > env.epsilon) {
    const c = a + ((a - b) * fa) / (fb - fa);
    const fc = f(c);
    if (fc * fb < 0) { a = b; fa = fb; } else fa /= 2;
    b = c; fb = fc;
  }
  return Math.E ** (a / 2);
}

/** One rating period: series = [[actualScore, otherRating], …] (original scale in and out). */
export function rate(env, r0, series) {
  const r = scaleDown(env, r0);
  let dSquareInv = 0, varianceInv = 0, difference = 0;
  for (const [actual, other0] of series) {
    const other = scaleDown(env, other0);
    const impact = reduceImpact(other);
    const e = expectScore(r, other, impact);
    varianceInv += impact ** 2 * e * (1 - e);
    difference += impact * (actual - e);
    dSquareInv += e * (1 - e) * Q ** 2 * impact ** 2;
  }
  difference /= varianceInv;
  const variance = 1 / varianceInv;
  const sigma = determineSigma(env, r, difference, variance);
  const phiStar = Math.sqrt(r.phi ** 2 + sigma ** 2);
  const phi = 1 / Math.sqrt(1 / phiStar ** 2 + 1 / variance);
  const mu = r.mu + phi ** 2 * (difference / variance);
  return scaleUp(env, rating(mu, phi, sigma));
}

export const rate1vs1 = (env, r1, r2, drawn = false) => [
  rate(env, r1, [[drawn ? DRAW : WIN, r2]]),
  rate(env, r2, [[drawn ? DRAW : LOSS, r1]]),
];

/** ps2ranks main.py winpct_1vs1: [% for 1, % for 2], each weighed by its own RD. */
export function winpct1vs1(env, r1, r2) {
  const a = scaleDown(env, r1), b = scaleDown(env, r2);
  return [expectScore(a, b, reduceImpact(a)) * 100, expectScore(b, a, reduceImpact(b)) * 100];
}

/* ------------------------------------------------------------------ pair replay (#112) */

/**
 * ps2ranks populate_db: tau 0.3, sigma 0.02, RD 100, min RD 30. RD0 = starting RD of the iVi seed
 * (picked on held-out pairs, see claude/duels-glicko.md): 30 (held-out 2026-11-06, 484 pairs: log loss 0.6405 vs 🎲 0.6453, RD 100 0.6461). STALE_DAYS: older last kill → "stale".
 */
export const DUEL_GLICKO = Object.freeze({ tau: 0.3, sigma: 0.02, rd: 100, rd0: 30, minRd: 30, maxRd: 350, staleDays: 90, day: 86400 });

/**
 * Chance that A gets the next kill, from both RDs (Glickman: g of the combined RD). Symmetric:
 * pairChance(a, b) + pairChance(b, a) = 1, unlike the one-sided winpct1vs1.
 */
export function pairChance(a, b) {
  const s = Math.sqrt(a.phi ** 2 + b.phi ** 2) / RATIO;
  const g = 1 / Math.sqrt(1 + (3 * s * s) / (Math.PI ** 2));
  return 1 / (1 + Math.exp(-g * ((a.mu - b.mu) / RATIO)));
}

/** Glicko-2 step 6 for `days` idle rating periods (one per day), capped at maxRd. */
export function widen(r, days, o = DUEL_GLICKO) {
  if (!(days > 0)) return r;
  const p = Math.sqrt((r.phi / RATIO) ** 2 + days * r.sigma ** 2) * RATIO;
  return rating(r.mu, Math.min(o.maxRd, p), r.sigma);
}

/** Starting ratings. seed "ivi": the pair starts exactly at the 🎲 prediction e0; "flat": 1500 / RD 100 each. */
export function seedPair(e0, seed = "ivi", o = DUEL_GLICKO) {
  if (seed !== "ivi" || !(e0 > 0 && e0 < 1)) return [rating(MU, o.rd, o.sigma), rating(MU, o.rd, o.sigma)];
  const s = (Math.SQRT2 * o.rd0) / RATIO;
  const g = 1 / Math.sqrt(1 + (3 * s * s) / (Math.PI ** 2));
  const gap = (Math.log(e0 / (1 - e0)) / g) * RATIO; // rating points between them
  return [rating(MU + gap / 2, o.rd0, o.sigma), rating(MU - gap / 2, o.rd0, o.sigma)];
}

/**
 * Replay the kills between A and B (pairEvents: { t, aKill, veh } oldest first).
 * opts: { e0 (🎲 share for A), seed "ivi"|"flat", veh "inf"|"all", now (unix s), min, o }.
 * → null below `min` counted kills, else { a, b (rating at the last kill), aNow, bNow (widened to now),
 *    p (chance A gets the next kill, now), n, ka, kb, skipped (vehicle kills left out), last, days, stale, traj }.
 * traj: one point per kill { t, a, b, p } (p = chance before that kill: what the replay expected).
 */
export function duelGlicko(pe, opts = {}) {
  const o = opts.o || DUEL_GLICKO;
  const env = glickoEnv({ tau: o.tau, sigma: o.sigma });
  const all = Array.isArray(pe) ? pe : [];
  const evs = opts.veh === "all" ? all : all.filter((e) => !(Number(e.veh) > 0));
  const min = opts.min == null ? DUEL_FIT_MIN : opts.min;
  if (evs.length < min) return null;
  let [a, b] = seedPair(opts.e0, opts.seed || "ivi", o);
  const traj = [];
  let prev = null, ka = 0;
  for (const e of evs) {
    if (prev != null) { const d = (e.t - prev) / o.day; a = widen(a, d, o); b = widen(b, d, o); }
    prev = e.t;
    const p = pairChance(a, b);
    const ca = rating(a.mu, Math.max(o.minRd, a.phi), a.sigma), cb = rating(b.mu, Math.max(o.minRd, b.phi), b.sigma);
    if (e.aKill) { [a, b] = rate1vs1(env, ca, cb); ka++; } else { [b, a] = rate1vs1(env, cb, ca); }
    traj.push({ t: e.t, a: a.mu, b: b.mu, ra: a.phi, rb: b.phi, p });
  }
  const now = Number.isFinite(opts.now) ? opts.now : prev;
  const days = Math.max(0, (now - prev) / o.day);
  const aNow = widen(a, days, o), bNow = widen(b, days, o);
  return {
    a, b, aNow, bNow, p: pairChance(aNow, bNow), n: evs.length, ka, kb: evs.length - ka,
    skipped: all.length - evs.length, last: prev, days, stale: days > o.staleDays, traj,
  };
}

/** Convenience for the panel: 🎲 share from ⚔️ iVi (same inputs as iviLuck), then the replay. */
export function duelGlickoFromIvi(pe, ia, ib, fit, va = null, vb = null, opts = {}) {
  const e0 = ia > 0 && ib > 0 && fit ? duelExpected(ia, ib, fit, va, vb) : null;
  if (e0 == null && (opts.seed || "ivi") === "ivi") return null;
  const r = duelGlicko(pe, { ...opts, e0 });
  return r ? { ...r, e0 } : null;
}
