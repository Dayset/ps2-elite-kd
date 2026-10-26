/**
 * Weekly PlayStation baseline check (owner t698, 2026-10-26).
 *
 * gap = median 🎯 opponent KPM (ekpm) of PC players ÷ the same median on
 * PlayStation, over the shared caches the site already has:
 * data/ranks.json vs data-ps/ranks.json, rows with enough fights (not thin)
 * and a finite ⚔️ iVi. No Census / Honu calls.
 * PS baseline = 600 ÷ gap (ps-baseline.mjs). Writes data-ps/kpm-ratio.json
 * only when the rounded gap changed; prints changed=1 / 0 to $GITHUB_OUTPUT.
 *
 *   node scripts/ps-kpm-ratio.mjs [--dry]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clampPsKpmRatio, PS_KPM_RATIO_MIN, PS_KPM_RATIO_MAX } from "../ps-baseline.mjs";

/** Fewer measured players than this on either side → keep the stored gap. */
export const MIN_ROWS = { pc: 1000, ps: 300 };
const HISTORY_MAX = 26; // about half a year of weekly checks

export function ranksRows(d) {
  const cols = (d && d.cols) || [];
  return ((d && d.rows) || []).map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
}
/** Upper median (same as the research script: sorted[length >> 1]). */
export function median(v) {
  const s = v.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : NaN;
}
const measured = (r) => !r.thin && Number.isFinite(r.adjs) && Number.isFinite(r.ekpm);

/** { ratio (clamped, 3 dp), raw, baseline, pc: { n, ekpm }, ps: { n, ekpm } } or { error }. */
export function measureGap(pcRanks, psRanks) {
  const pc = ranksRows(pcRanks).filter(measured), ps = ranksRows(psRanks).filter(measured);
  if (pc.length < MIN_ROWS.pc || ps.length < MIN_ROWS.ps) return { error: `too few measured players (PC ${pc.length}, PS ${ps.length})` };
  const pcE = median(pc.map((r) => r.ekpm)), psE = median(ps.map((r) => r.ekpm));
  const raw = pcE / psE;
  const c = clampPsKpmRatio(raw);
  if (!Number.isFinite(c)) return { error: `bad medians (PC ${pcE}, PS ${psE})` };
  const ratio = Math.round(c * 1000) / 1000;
  return { ratio, raw: Math.round(raw * 10000) / 10000, baseline: Math.round(600 / ratio), pc: { n: pc.length, ekpm: Math.round(pcE * 10000) / 10000 }, ps: { n: ps.length, ekpm: Math.round(psE * 10000) / 10000 } };
}

/** New kpm-ratio.json content, or null when the stored gap is the same. */
export function nextRatioFile(prev, m, now = new Date()) {
  if (!m || m.error) return null;
  if (prev && Math.abs((+prev.ratio || 0) - m.ratio) < 0.0005) return null;
  const at = now.toISOString().slice(0, 10);
  const history = [{ at, ratio: m.ratio, baseline: m.baseline }, ...((prev && prev.history) || [])].slice(0, HISTORY_MAX);
  return {
    about: "PlayStation adjusted-iVi baseline = 600 ÷ (PC median opponent KPM ÷ PS median opponent KPM). Rechecked weekly by scripts/ps-kpm-ratio.mjs.",
    ratio: m.ratio,
    baseline: m.baseline,
    rawRatio: m.raw,
    clamp: [PS_KPM_RATIO_MIN, PS_KPM_RATIO_MAX],
    pc: m.pc,
    ps: m.ps,
    measuredAt: at,
    history,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(root, f), "utf8")); } catch { return null; } };
  const out = path.join(root, "data-ps", "kpm-ratio.json");
  const prev = read("data-ps/kpm-ratio.json");
  const m = measureGap(read("data/ranks.json"), read("data-ps/ranks.json"));
  const next = nextRatioFile(prev, m);
  if (m.error) console.log(`PS kill-speed gap not measured: ${m.error}; keeping ${prev ? prev.ratio : "the default"}.`);
  else console.log(`PS kill-speed gap ${m.ratio} (PC ${m.pc.ekpm} over ${m.pc.n}, PS ${m.ps.ekpm} over ${m.ps.n}) → baseline ${m.baseline}; stored ${prev ? prev.ratio : "none"}.`);
  if (next && !process.argv.includes("--dry")) fs.writeFileSync(out, JSON.stringify(next, null, 2) + "\n");
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${next ? 1 : 0}\nratio=${next ? next.ratio : prev ? prev.ratio : ""}\nbaseline=${next ? next.baseline : prev ? prev.baseline : ""}\nold=${prev ? prev.baseline : ""}\n`);
  }
}
