// 🌈 G (debug table, owner 2026-11-08): the most cheesy players possible —
// top N by ☠️ K/D (rkd). A player is IN only behind a double gate (owner
// 2026-11-08): Brave under CHEESE_BRAVE_OK AND Infantry under CHEESE_LOW_INF.
// One gate alone misfires both ways: Rope (Brave 1.42, Infantry 99%) is a
// good pure-infantry player who happens to sit low on Brave, while Bobeqh
// (Brave 1.23, Infantry 3.6%) clears a Brave-only line of 1.0 yet barely
// plays infantry at all — he is the one the second gate catches. The table
// splits at the gate: the in-gate rows first, a divider, then the rest.
//   - Brave gate 1.7: the trimmed mean of top-100 Brave. The raw mean (6.68)
//     is wrecked by two outliers (461, 41); dropping them gives 1.70
//     (dropping top+bottom two gives 1.73 — same line).
//   - Infantry gate 50: below the population p10 (54%) — genuinely low
//     infantry. Every known-legit reference sits at 80%+ (Simplenubb 99.9,
//     Zyr0s 98.2, xCloneKano 98.3, Fantom220TR 80.6, ShloDog 95.4,
//     Bhorn 80.1, Rope 99), so the line keeps them out with room to spare.
//     The count barely moves for any line in 30–50 (34–36 in), so 50 is the
//     round, principled pick.
// Every row also carries a 🌈 G score (owner 2026-11-08): the gate alone is
// yes/no, so the order inside each block — and the #1 — comes from the
// score. G is scored over the WHOLE population, not the crowd (owner
// 2026-11-08: "Everyone should be scored with G"): with N the count of
// players with a K/D and ranks 1 = best on each dimension (K/D high,
// Brave low, Infantry low),
//   G = (1 − rkdRank/N) × (1 − braveRank/N) × (1 − infRank/N) × 100,
// the share of the population you beat on all three at once. Most players
// sit at 5–20%; the cheesiest near 98%. No magic constants, no explosion
// from Brave near zero (a 0.004 vs 0.024 gap is rank 1 vs rank 8, not a
// 6x multiplier). It is shown as G% with two decimals. Ties in G are
// broken by the rank-sum inside the crowd, then Brave, then rkd. Missing
// values take the worst rank, so unknown never helps. The same score is
// the visible 🌈 G column in both tables (after 🧘‍♂️ Pure iVi, before
// 🪖 Infantry) — one value per player, no extra tag.
// Means are reported next to medians because the same two Brave outliers
// drag every mean up — the median is the honest average here.
// Pure: rows are plain { name, rkd, pvs, inf } objects (rankings.mjs row shape).

export const CHEESE_TOP_N = 100;
export const CHEESE_BRAVE_OK = 1.7;
export const CHEESE_LOW_INF = 50;

const fin = (v) => typeof v === "number" && Number.isFinite(v);

function medianOf(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function meanOf(xs) {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Ranks of each row in the crowd by one key: 1 is best. Missing values take the worst rank. */
function rankWithin(crowd, key, asc) {
  const sorted = crowd.slice().sort((a, b) => {
    const va = fin(key(a)) ? key(a) : Infinity;
    const vb = fin(key(b)) ? key(b) : Infinity;
    return asc ? va - vb : vb - va;
  });
  const ranks = new Map();
  sorted.forEach((r, i) => ranks.set(r, i + 1));
  return ranks;
}

/**
 * Population-wide 🌈 G for every row with a K/D: a Map row → g (0–100).
 * Ranks 1 = best on each dimension — K/D high, Brave low, Infantry low —
 * over all N rows, missing values taking the shared worst rank N.
 * G = (1 − rkdRank/N) × (1 − braveRank/N) × (1 − infRank/N) × 100, the
 * share of the population beaten on all three at once. Tied values get
 * adjacent ranks (stable sort); the gap is ~1/N, so the score is stable
 * to well under a hundredth of a percent.
 */
export function gScores(rows) {
  const all = (Array.isArray(rows) ? rows : []).filter((r) => r && fin(r.rkd));
  const out = new Map();
  const n = all.length;
  if (!n) return out;
  const rankBy = (key, asc) => {
    const sorted = all.slice().sort((a, b) => {
      const va = fin(key(a)) ? key(a) : Infinity;
      const vb = fin(key(b)) ? key(b) : Infinity;
      return asc ? va - vb : vb - va;
    });
    const m = new Map();
    sorted.forEach((r, i) => m.set(r, fin(key(r)) ? i + 1 : n));
    return m;
  };
  const rkdRank = rankBy((r) => r.rkd, false);
  const braveRank = rankBy((r) => r.pvs, true);
  const infRank = rankBy((r) => r.inf, true);
  for (const r of all) {
    out.set(r, ((1 - rkdRank.get(r) / n) * (1 - braveRank.get(r) / n) * (1 - infRank.get(r) / n)) * 100);
  }
  return out;
}

/** In the double gate: Brave under the line AND Infantry under the line. Unknown values never pass. */
export function inCheeseGate(r) {
  return !!r && fin(r.pvs) && r.pvs < CHEESE_BRAVE_OK && fin(r.inf) && r.inf < CHEESE_LOW_INF;
}

/**
 * Top `top` rows by rkd, in-gate rows first, then the rest, each block
 * ordered by the 🌈 G score (population product, high first; ties by the
 * rank-sum inside the crowd, then Brave, then rkd).
 * Returns { rows: [{ name, rkd, brave, inf, g }], edgeIndex, stats }.
 * g is the population G% (float 0–100, two decimals at render).
 * edgeIndex is where the in-gate block ends (= stats.inCount); it is 0
 * when the gate catches nobody, so the divider always renders at the top.
 */
export function cheeseList(rows, { top = CHEESE_TOP_N } = {}) {
  const all = Array.isArray(rows) ? rows : [];
  const crowd = all
    .filter((r) => r && fin(r.rkd))
    .sort((a, b) => b.rkd - a.rkd)
    .slice(0, top);
  const n = crowd.length;
  const gMap = gScores(all);
  const rkdRank = rankWithin(crowd, (r) => r.rkd, false);
  const braveRank = rankWithin(crowd, (r) => r.pvs, true);
  const infRank = rankWithin(crowd, (r) => r.inf, true);
  const sumOf = (r) => rkdRank.get(r) + braveRank.get(r) + infRank.get(r);
  const byScore = (a, b) => {
    const ga = gMap.get(a) ?? 0;
    const gb = gMap.get(b) ?? 0;
    if (gb !== ga) return gb - ga;
    const d = sumOf(a) - sumOf(b);
    if (d) return d;
    const ba = fin(a.pvs) ? a.pvs : Infinity;
    const bb = fin(b.pvs) ? b.pvs : Infinity;
    if (ba !== bb) return ba - bb;
    return b.rkd - a.rkd;
  };
  const inGate = crowd.filter(inCheeseGate).sort(byScore);
  const outGate = crowd.filter((r) => !inCheeseGate(r)).sort(byScore);
  const ordered = [...inGate, ...outGate];
  const braves = ordered.map((r) => r.pvs).filter(fin);
  const popBraves = all.map((r) => (r ? r.pvs : null)).filter(fin);
  return {
    rows: ordered.map((r) => ({
      name: r.name,
      rkd: r.rkd,
      brave: fin(r.pvs) ? r.pvs : null,
      inf: fin(r.inf) ? r.inf : null,
      g: gMap.get(r) ?? 0,
    })),
    edgeIndex: inGate.length,
    stats: {
      n: ordered.length,
      inCount: inGate.length,
      popN: gMap.size,
      meanBrave: meanOf(braves),
      medianBrave: medianOf(braves),
      popMedianBrave: medianOf(popBraves),
    },
  };
}
