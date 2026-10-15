/**
 * Debug battle simulator (pure math, shared by the browser panel and Node tests).
 * Keep this free of DOM / fetch / localStorage.
 *
 * Model:
 * - Mean strength μ = 2^(adjS / 600) × √act. adjS is the adjusted score
 *   (negatives floored at 0); act is activity (K/D × own KPM).
 * - Consistency sets the spread, not the mean: σ = SPREAD_K × (1 − cons).
 *   A steady player (cons 1) always performs at μ; a swingy one (cons 0.5)
 *   varies around it. Each fight draws strength s = μ × exp(σ·Z), Z ~ N(0,1).
 * - 1v1 odds are closed form: P(A beats B) = Φ((ln μA − ln μB) / √(σA² + σB²)).
 * - Group fights are simulated over seeded trials: opponents with similar
 *   activity fight together (combined strength (Σ√sᵢ)²), otherwise they fall
 *   one by one, each duel costing s²/a of the champion's remaining strength.
 */

export const SCORE_BASE = 600;
/** Slowest opponent's activity ÷ fastest opponent's activity needed to count as "similar". */
export const ACTIVITY_SIMILAR_MIN = 0.5;
/** Spread per unit of lost consistency. Tuning constant, not calibrated yet. */
export const SPREAD_K = 1;
/** Simulated trials for group fights. */
export const DEFAULT_TRIALS = 4000;
const MU_FLOOR = 1e-6;

const finite = (v) => typeof v === "number" && Number.isFinite(v);

function colIndex(cols, key) {
  return Array.isArray(cols) ? cols.indexOf(key) : -1;
}

/** Turn one ranks.json row into a fighter, or null when stats are missing. */
export function fighterFromRow(row, cols) {
  const get = (key) => {
    const i = colIndex(cols, key);
    return i < 0 ? NaN : row[i];
  };
  const name = String(get("name") ?? "");
  const query = String(get("query") ?? "");
  const adjs = get("adjs");
  const act = get("act");
  const cons = get("cons");
  if (!finite(adjs) || !finite(act) || !finite(cons)) return null;
  const score = Math.max(adjs, 0);
  const actC = Math.max(act, 0);
  const consC = Math.min(Math.max(cons, 0), 1);
  const mu = Math.max(Math.pow(2, score / SCORE_BASE) * Math.sqrt(actC), MU_FLOOR);
  const sigma = SPREAD_K * (1 - consC);
  return { name, query, adjs, act: actC, cons: consC, strength: mu, mu, sigma };
}

/**
 * Find a player by typed name: exact (case-insensitive) match on name or query
 * first, otherwise a single unambiguous substring match on the name.
 * Returns { fighter } or { error }.
 */
export function findFighter(rows, cols, typed) {
  const q = String(typed || "").trim().toLowerCase();
  if (!q) return { error: "Type a player name first." };
  const all = [];
  for (const row of rows || []) {
    const f = fighterFromRow(row, cols);
    if (f) all.push(f);
  }
  const exact = all.find((f) => f.name.toLowerCase() === q || f.query.toLowerCase() === q);
  if (exact) return { fighter: exact };
  const partial = all.filter((f) => f.name.toLowerCase().includes(q));
  if (partial.length === 1) return { fighter: partial[0] };
  if (partial.length > 1) return { error: `"${typed}" matches ${partial.length} players. Type the full tag.` };
  return { error: `No player named "${typed}" in the ranks data.` };
}

/**
 * Pick the n opponents whose adjusted scores are closest to the champion's,
 * excluding the champion. Deterministic: ties break by name.
 */
export function pickOpponents(rows, cols, champion, n) {
  const count = Math.max(0, Math.floor(+n) || 0);
  const pool = [];
  for (const row of rows || []) {
    const f = fighterFromRow(row, cols);
    if (!f || f.name === champion.name) continue;
    pool.push(f);
  }
  pool.sort((x, y) => {
    const dx = Math.abs(x.adjs - champion.adjs);
    const dy = Math.abs(y.adjs - champion.adjs);
    return dx - dy || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0);
  });
  return pool.slice(0, count);
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf approximation). */
export function normalCdf(z) {
  if (z === Infinity) return 1;
  if (z === -Infinity) return 0;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return 0.5 * (1 + (z >= 0 ? erf : -erf));
}

/** Closed-form 1v1 win chance for A against B under the lognormal model. */
export function duelOdds(a, b) {
  const var2 = a.sigma * a.sigma + b.sigma * b.sigma;
  const diff = Math.log(a.mu) - Math.log(b.mu);
  if (var2 === 0) {
    if (diff > 0) return 1;
    if (diff < 0) return 0;
    return 0.5;
  }
  return normalCdf(diff / Math.sqrt(var2));
}

/** Seeded PRNG (mulberry32): same seed, same trials. */
export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One standard normal draw via Box–Muller. */
function gaussian(rand) {
  let u = 0;
  while (u === 0) u = rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** One fight-time strength draw: μ × exp(σ·Z). */
export function sampleStrength(f, rand) {
  if (f.sigma === 0) return f.mu;
  return f.mu * Math.exp(f.sigma * gaussian(rand));
}

/** Group mode from mean activity (same rule as before, on activity only). */
export function groupMode(opponents) {
  const acts = opponents.map((o) => o.act);
  const maxAct = Math.max(...acts);
  const minAct = Math.min(...acts);
  const similarity = maxAct > 0 ? minAct / maxAct : 1;
  return {
    similarity,
    mode: similarity >= ACTIVITY_SIMILAR_MIN ? "concentrated" : "sequential",
  };
}

/** Resolve one trial's outcome given sampled strengths. */
function trialOutcome(mode, a, bs) {
  if (mode === "concentrated") {
    const enemy = Math.pow(bs.reduce((s, b) => s + Math.sqrt(b), 0), 2);
    return { win: a > enemy, remaining: a > enemy ? (a - enemy) / a : 0 };
  }
  let left = a;
  for (const b of [...bs].sort((x, y) => x - y)) {
    if (left <= 0) break;
    left -= (b * b) / left;
  }
  return { win: left > 0, remaining: left > 0 ? left / a : 0 };
}

/**
 * Run the fight. Single opponent: closed-form odds. Several opponents:
 * seeded Monte Carlo over `trials` fights.
 */
export function runBattle(champion, opponents, { trials = DEFAULT_TRIALS, seed = 1 } = {}) {
  const list = (opponents || []).slice();
  const duels = list.map((o) => ({
    name: o.name,
    adjs: o.adjs,
    act: o.act,
    cons: o.cons,
    strength: o.mu,
    championWinChance: duelOdds(champion, o),
  }));
  if (!list.length) {
    return {
      mode: "none",
      winRate: 1,
      win: true,
      a: champion.mu,
      enemy: 0,
      remaining: 1,
      similarity: null,
      trials: 0,
      duels,
    };
  }
  const { mode, similarity } = groupMode(list);
  const rand = seededRandom(seed);
  let wins = 0;
  let remainingSum = 0;
  let enemySum = 0;
  for (let t = 0; t < trials; t++) {
    const a = sampleStrength(champion, rand);
    const bs = list.map((o) => sampleStrength(o, rand));
    const out = trialOutcome(mode, a, bs);
    if (out.win) wins++;
    remainingSum += out.remaining;
    enemySum += mode === "concentrated"
      ? Math.pow(bs.reduce((s, b) => s + Math.sqrt(b), 0), 2)
      : bs.reduce((s, b) => s + b, 0);
  }
  const winRate = list.length === 1 ? duels[0].championWinChance : wins / trials;
  return {
    mode,
    winRate,
    win: winRate >= 0.5,
    a: champion.mu,
    enemy: enemySum / trials,
    remaining: remainingSum / trials,
    similarity,
    trials,
    duels,
  };
}
