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
// score. It is a rank-sum within the crowd: rank by rkd (high first) +
// rank by Brave (low first) + rank by Infantry (low first), lowest sum
// cheesiest. No magic constants, no explosion from Brave near zero (a
// 0.004 vs 0.024 gap is rank 1 vs rank 8, not a 6x multiplier). It is
// shown as G%: the share of the crowd with a worse sum — #1 is 99%
// (cheesier than 99 of 100), the bottom row 0%. Tied sums share the
// percentage; row order inside a tie is Brave, then rkd. Missing values
// take the worst rank, so unknown never helps.
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

/** In the double gate: Brave under the line AND Infantry under the line. Unknown values never pass. */
export function inCheeseGate(r) {
  return !!r && fin(r.pvs) && r.pvs < CHEESE_BRAVE_OK && fin(r.inf) && r.inf < CHEESE_LOW_INF;
}

/**
 * Top `top` rows by rkd, in-gate rows first, then the rest, each block
 * ordered by the 🌈 G score (rank-sum, lowest first; ties by Brave, then rkd).
 * Returns { rows: [{ name, rkd, brave, inf, g }], edgeIndex, stats }.
 * g is the G% (integer 0–99): the share of the crowd with a worse sum.
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
  const rkdRank = rankWithin(crowd, (r) => r.rkd, false);
  const braveRank = rankWithin(crowd, (r) => r.pvs, true);
  const infRank = rankWithin(crowd, (r) => r.inf, true);
  const sumOf = (r) => rkdRank.get(r) + braveRank.get(r) + infRank.get(r);
  const sums = crowd.map(sumOf);
  const gOf = (r) => {
    if (!n) return 0;
    const worse = sums.filter((s) => s > sumOf(r)).length;
    return Math.floor((100 * worse) / n);
  };
  const byScore = (a, b) => {
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
      g: gOf(r),
    })),
    edgeIndex: inGate.length,
    stats: {
      n: ordered.length,
      inCount: inGate.length,
      meanBrave: meanOf(braves),
      medianBrave: medianOf(braves),
      popMedianBrave: medianOf(popBraves),
    },
  };
}
