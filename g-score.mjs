// 🌈 G (owner 2026-11-08): the two-factor product score, shown as a visible
// stats column in both tables (after 🧘‍♂️ Pure iVi, before 🪖 Infantry) — one
// value per player. It used to multiply in a third 🪖 Infantry factor; that
// let the score highlight vehicle mains (low Infantry) and "saved" real
// cheesy players like LapinFonce (K/D #70, Brave #103, Infantry 95.6% —
// 25.99%, #1042 under the old formula, 99.07%, #4 under this one). So
// Infantry no longer scores: it lives only in the gate — the cheesy set is
// Brave under 1.7 on PC (2.9 on PlayStation, same trimmed-mean method) and
// Infantry under 50% (see the columns page card).
//   G = (1 − rkdRank/N) × (1 − braveRank/N) × 100,
// the share of the population you beat on K/D and Brave at once (N =
// players with a K/D; ranks 1 = best — K/D high, Brave low). Most players
// sit at 10–23% (median 17.21%); the cheesiest near 99.7%. No magic
// constants, no explosion from Brave near zero (a 0.004 vs 0.024 gap is
// rank 1 vs rank 8, not a 6x multiplier). Missing Brave takes the shared
// worst rank N, so unknown never helps; missing Infantry no longer matters
// (it used to zero 1,696 players outright). Tied values get adjacent ranks
// (stable sort); the gap is ~1/N, so the score is stable to well under a
// hundredth of a percent.
// Pure: rows are plain { rkd, pvs, inf } objects (rankings.mjs row shape);
// stats-table.mjs and columns-example.mjs build them from the payload.
// inf rides along in the row shape but is not scored.

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
  for (const r of all) {
    out.set(r, ((1 - rkdRank.get(r) / n) * (1 - braveRank.get(r) / n)) * 100);
  }
  return out;
}
