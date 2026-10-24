import { t as tr } from "./i18n.mjs";
/**
 * 🚜 / 🪖 infantry dial (owner t590u). Pure, no imports: used by LIVE (live.mjs fill meter) and the main site
 * (app.js stats table + rankings.mjs: a static 🚜 mark by the name, owner t591u–t593u — no fill, glow or animation there).
 *
 * M = the median infantry % over every ranks.json player with a value (taken from the data, never hard-coded;
 * 85.1 over 13,130 players on 2026-10-24).
 *   - inf ≥ M  → 🪖, fill = (inf − M) / (100 − M): M = empty, 100 = full.
 *   - inf < M  → 🚜, fill = (M − inf) / (M − M/2), clamped 0–1: just under M = almost empty,
 *                M/2 (≈ 42.5) and below = full (and shiny on LIVE). The less infantry, the fuller the tractor.
 */
export const INFANTRY_EMOJI = "🪖";
export const TRACTOR_EMOJI = "🚜";

/** Median of a sorted (ascending) array of finite numbers; null when empty. */
export function infMedian(sorted) {
  const a = Array.isArray(sorted) ? sorted.filter((x) => typeof x === "number" && Number.isFinite(x)) : [];
  if (!a.length) return null;
  const h = a.length >> 1;
  return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
}

/** True when this infantry % is below the median M (→ 🚜). No value or no median → false. */
export function isTractor(inf, M) {
  return typeof inf === "number" && Number.isFinite(inf) && typeof M === "number" && Number.isFinite(M) && inf < M;
}

/** { emoji, tractor, fill 0..100 (1 decimal) } for one infantry %, or null when there is no value / no median. */
export function infDial(inf, M) {
  if (typeof inf !== "number" || !Number.isFinite(inf) || typeof M !== "number" || !Number.isFinite(M) || M <= 0 || M >= 100) return null;
  const v = Math.min(100, Math.max(0, inf));
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const tractor = v < M;
  const f = tractor ? clamp01((M - v) / (M - M / 2)) : clamp01((v - M) / (100 - M));
  return { emoji: tractor ? TRACTOR_EMOJI : INFANTRY_EMOJI, tractor, fill: Math.round(f * 1000) / 10 };
}

/* ---------- main site (owner t591u–t593u): a static 🚜 name mark (auto-marks.mjs, next to 🪦), no fill / glow / animation ---------- */
export const TRACTOR_HINT = "🚜 Vehicle mark: plays mostly in vehicles.\nInfantry share below the median ({m}%).\nJust a label: no score is changed.";
/** 2-line hover for the 🚜 (all 9 languages: i18n "inf.tractor"); M = the data's median infantry %. */
export function tractorHint(M) {
  return tr("inf.tractor", TRACTOR_HINT, { m: typeof M === "number" && Number.isFinite(M) ? M.toFixed(1) : "?" });
}
