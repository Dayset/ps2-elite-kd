/**
 * 🧪 Outlier guard: catches metric values far outside the cached population,
 * so a formula gap like add1ti0nal's 🦁 Brave 6094 (75 kills / 2 deaths) is
 * spotted automatically instead of by eye.
 *
 * Runs on the values AS SHOWN (shownValue: tiny samples are already "—"), over
 * every ranks.html metric. A value is an outlier when BOTH hold:
 *   - robust z = (v − median) / (1.4826 × MAD) beyond ±Z, and
 *   - it sits past p99 + K × (p99 − median)   (or p01 − K × (median − p01)).
 * Each outlier is "explained" when the player is already in the 🚩 bin, has a 🌾
 * padding or † adjusted entry, or is reviewed in KNOWN_EXTREMES; anything else is a warning.
 * Bin routing (bins.mjs classifyBins, user rule t280u): an outlier is a 📉 chart
 * anomaly; a player with only chart issues stays in 📉, a player who also has a
 * 🚩 pattern is listed in 🚩 with a cross-reference to this 📉 entry.
 *
 * Used by scripts/build-ranks.mjs (writes data/status.json → build-log.html)
 * and test/outlier-guard.test.mjs (fails on unexplained outliers).
 * DOM-free.
 */
import { classifyBins } from "./bins.mjs?v=20261010-guardcheat";
import { SESSION_LABELS } from "./session-stats.mjs?v=20261010-guardcheat";

export const GUARD_RULE = Object.freeze({ Z: 6, SPAN_K: 3, MIN_N: 50 });

/**
 * Reviewed real extremes (slug → why). Real data, not a formula gap; still shown.
 * Add a line here only after checking the player's sample by hand.
 */
export const KNOWN_EXTREMES = Object.freeze({
  lololollala: "Reviewed 2026-10-09: 826 kills / 48 deaths, K/D 17 vs opponents; real data, big sample",
  geilovs: "Reviewed 2026-10-09: lifetime Census KD 146 (LA bail-out vehicle hunter, user: stays unflagged); opponent metrics already — (1 death)",
  add1ti0nal: "Confirmed cheater 2026-10-10 (t319u): throwaway account, rampage (75 kills / 2 deaths, KD 24.7); on the 🙈 hide list as a reference",
  teritch: "Reviewed 2026-10-09: steep slope −6.7 from 278 kills / 37 deaths; real data, watch as it grows",
});

const fin = (v) => typeof v === "number" && Number.isFinite(v);
const q = (s, f) => s[Math.floor(f * (s.length - 1))];

/** Population bounds for one metric (values may include null / NaN). */
export function metricBounds(values, rule = GUARD_RULE) {
  const s = values.filter(fin).sort((a, b) => a - b);
  const n = s.length;
  if (n < rule.MIN_N) return { n, ok: false };
  const median = q(s, 0.5);
  const mad = q(s.map((x) => Math.abs(x - median)).sort((a, b) => a - b), 0.5) * 1.4826;
  const p01 = q(s, 0.01);
  const p99 = q(s, 0.99);
  return {
    n, ok: mad > 0, median, mad, p01, p99, max: s[n - 1], min: s[0],
    hi: p99 + rule.SPAN_K * (p99 - median),
    lo: p01 - rule.SPAN_K * (median - p01),
  };
}

/** Short metric labels (same as ranks.html / app.js) for the grouped build-log rows. */
export const METRIC_LABELS = Object.freeze({
  adjs: "⚔️ iVi", rf: "🛡️ Resist", act: "🏃 Activity", pvs: "🦁 Brave", rkd: "☠️ K/D", mech: "⚙️ Mech%",
  inflation: "🎈 Inflation", adj: "🎯🎈 ivi", ekpm: "eKPM", own: "own KPM", coi: "📊 COI", slope: "📉 Slope",
  kd: "KD", kpm: "KPM", ownKpm: "own KPM (public)", acc: "Acc %", hsr: "HSR %", ivi: "IvI",
  // 🧪 Honu session metrics (session-stats.mjs; build-log only, never public).
  ...SESSION_LABELS,
});

/** Why an outlier is already accounted for ("" = unexplained). 🚩 patterns first, then reviewed, then † adjusted. */
function outlierReason(p, known) {
  const b = classifyBins({ patterns: p.patterns || [], outlier: true });
  if (b.red.length) return "Also in 🚩 red flags (" + b.red.join(", ") + "), listed there";
  if (known[p.slug]) return known[p.slug];
  if (b.chart.includes("padding")) return "In 📉 chart anomalies only (🌾 stat padding)";
  if (b.chart.includes("adjusted")) return "In 📉 chart anomalies only († adjusted — needs review)";
  return "";
}

/**
 * Outlier hits → one row per player, all metrics inline. Sorted unexplained
 * first, then by number of metrics (most first), then by the biggest |z|.
 * items: findOutliers(...).items or guardStatus(...).items (same fields).
 */
export function groupOutliers(items) {
  const by = new Map();
  for (const o of items) {
    const key = o.slug || o.name;
    let g = by.get(key);
    if (!g) { g = { slug: o.slug, name: o.name, explained: !!o.explained, reason: o.reason || "", red: o.red || [], maxZ: 0, metrics: [] }; by.set(key, g); }
    g.explained = g.explained && !!o.explained;
    if (!o.explained) g.reason = "";
    g.maxZ = Math.max(g.maxZ, Math.abs(o.z) || 0);
    g.metrics.push({ id: o.id, label: METRIC_LABELS[o.id] || o.id, value: o.value, bound: o.bound, z: o.z, side: o.side });
  }
  const out = [...by.values()];
  for (const g of out) g.metrics.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  out.sort((a, b) => a.explained - b.explained || b.metrics.length - a.metrics.length || b.maxZ - a.maxZ);
  return out;
}

/**
 * players: [{ slug, name, flagged: bool, confirmedCheater?: bool, values: { id: number|null } }]
 * confirmedCheater players count toward the bounds but are omitted from items.
 * → { bounds: { id: … }, items: [{ slug, name, id, value, bound, z, side, explained, reason }] }
 */
export function findOutliers(players, ids, { rule = GUARD_RULE, known = KNOWN_EXTREMES } = {}) {
  const bounds = {};
  const items = [];
  for (const id of ids) {
    const b = metricBounds(players.map((p) => p.values[id]), rule);
    bounds[id] = b;
    if (!b.ok) continue;
    for (const p of players) {
      // Confirmed cheaters (data/hidden.json, t323u) are fully explained: they still
      // shape the population bounds above, but never show as an outlier row.
      if (p.confirmedCheater) continue;
      const v = p.values[id];
      if (!fin(v)) continue;
      const z = (v - b.median) / b.mad;
      const side = v > b.hi && z > rule.Z ? "high" : v < b.lo && z < -rule.Z ? "low" : "";
      if (!side) continue;
      const reason = outlierReason(p, known);
      items.push({
        slug: p.slug, name: p.name, id, value: v,
        red: classifyBins({ patterns: p.patterns || [] }).red, // 🚩 patterns ([] = 📉 only)
        bound: side === "high" ? b.hi : b.lo, z, side,
        explained: !!reason, reason,
      });
    }
  }
  items.sort((a, b) => a.explained - b.explained || Math.abs(b.z) - Math.abs(a.z));
  return { bounds, items };
}

/** JSON-safe summary for data/status.json (build-log.html reads it). */
export function guardStatus(result, rule = GUARD_RULE) {
  const r6 = (v) => (fin(v) ? Math.round(v * 1000) / 1000 : null);
  const items = result.items.map((o) => ({
    slug: o.slug, name: o.name, id: o.id, value: r6(o.value), bound: r6(o.bound), z: r6(o.z),
    side: o.side, explained: o.explained, reason: o.reason, red: o.red || [],
  }));
  const players = groupOutliers(items);
  return {
    checkedAt: new Date().toISOString(),
    rule: `robust z beyond ±${rule.Z} AND past p99 + ${rule.SPAN_K}×(p99 − median) (or the mirror below p01)`,
    unexplained: items.filter((o) => !o.explained).length,
    explained: items.filter((o) => o.explained).length,
    items, // one row per metric hit (kept for older readers)
    // One row per player (build-log.html 📉 Chart anomalies); counts are players, not hits.
    players: players.map((g) => ({ ...g, maxZ: r6(g.maxZ) })),
    playersUnexplained: players.filter((g) => !g.explained).length,
    playersExplained: players.filter((g) => g.explained).length,
    // Bin routing (bins.mjs): players also in 🚩 vs chart-only.
    playersAlsoRed: players.filter((g) => (g.red || []).length).length,
    playersChartOnly: players.filter((g) => !(g.red || []).length).length,
  };
}
