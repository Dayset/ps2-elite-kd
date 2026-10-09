/**
 * One shared bin classifier for build-log.html (user rule, 2026-10-09 t280u):
 *   "If the guy is flagged because of the chart he only gets a chart bin.
 *    If there is another non-binned anomaly, then it's flagged."
 *
 * Two bins:
 *   📉 Chart anomalies — chart / stat-integrity issues only (CHART_PATTERNS):
 *      "padding" (🌾 *: farm kills ≥ the padding line, excluded; user t288u:
 *      "chart padding should not be in the same bin as red flags"),
 *      "adjusted" (†: farm kills excluded under the padding line) and
 *      "outlier" (🧪 outlier guard: a shown value far outside everyone else).
 *   🚩 Red flags — ANY other pattern (aim, vehicle, rampage, and any future
 *      rule by default, so a new pattern can't silently drop out of 🚩).
 *
 * A player with only chart patterns → 📉 only. A player with a red pattern →
 * 🚩; if they also have chart patterns ("both") the 🚩 row carries a
 * cross-reference to their 📉 entry (and back), never a duplicate full row.
 * Public marks (* padding, † adjusted) are NOT decided here (padding.mjs).
 * DOM-free, no imports (used by red-flags.mjs, outlier-guard.mjs, build-log.html).
 */
export const CHART_PATTERNS = Object.freeze(["padding", "adjusted", "outlier"]);

/** Patterns that put a player in 🚩 (documentation / tests; classifyBins treats any non-chart pattern as red). */
export const RED_PATTERNS = Object.freeze(["aim", "vehicle", "rampage"]);

/**
 * { patterns: [...], outlier: bool } → { bin: "red" | "chart" | "", red: [...], chart: [...], both }
 * bin "red" wins over "chart" (the 🚩 row cross-references the 📉 entry).
 */
export function classifyBins({ patterns = [], outlier = false } = {}) {
  const pats = Array.isArray(patterns) ? patterns.filter(Boolean) : [];
  const red = [...new Set(pats.filter((p) => !CHART_PATTERNS.includes(p)))];
  const chart = [...new Set(pats.filter((p) => CHART_PATTERNS.includes(p)))];
  if (outlier && !chart.includes("outlier")) chart.push("outlier");
  const bin = red.length ? "red" : chart.length ? "chart" : "";
  return { bin, red, chart, both: red.length > 0 && chart.length > 0 };
}

/** Short labels for chart patterns (cross-reference chips / reasons). */
export const CHART_LABELS = Object.freeze({ padding: "🌾 stat padding", adjusted: "† adjusted", outlier: "🧪 outlier" });
