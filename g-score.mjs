// 🌈 G (owner 2026-11-08): the population product score, shown as a visible
// stats column in both tables (after 🧘‍♂️ Pure iVi, before 🪖 Infantry) — one
// value per player. The top-100 debug table that used to live here was
// removed 2026-11-08 (owner: miscommunication, not needed); only the score
// survives, in this module.
//   G = (1 − rkdRank/N) × (1 − braveRank/N) × (1 − infRank/N) × 100,
// the share of the population you beat on all three at once (N = players
// with a K/D; ranks 1 = best — K/D high, Brave low, Infantry low). Most
// players sit at 5–20% (median 7.18%); the cheesiest near 98%. No magic
// constants, no explosion from Brave near zero (a 0.004 vs 0.024 gap is
// rank 1 vs rank 8, not a 6x multiplier). Missing values take the shared
// worst rank N, so unknown never helps. Tied values get adjacent ranks
// (stable sort); the gap is ~1/N, so the score is stable to well under a
// hundredth of a percent.
// Pure: rows are plain { rkd, pvs, inf } objects (rankings.mjs row shape);
// stats-table.mjs and columns-example.mjs build them from the payload.

const fin = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Population-wide 🌈 G for every row with a K/D: a Map row → g (0–100).
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
