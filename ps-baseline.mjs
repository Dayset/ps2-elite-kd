/**
 * PlayStation adjusted-iVi baseline (owner t698, 2026-10-26: "355 but not as
 * solid value but as 600 divided by a kill-speed gap and it should be
 * rechecked once a week").
 *
 * PC rates against the soft RF 0.6 (adjusted iVi 600, math.mjs RF_SOFT).
 * PlayStation lobbies kill slower (controllers, smaller population), so the
 * same fight quality gives a smaller 🛡️ Resist there. The PS baseline is
 *     600 ÷ gap,  gap = PC median opponent KPM ÷ PS median opponent KPM
 * measured from the shared caches (data/ranks.json vs data-ps/ranks.json,
 * non-thin rows, scripts/ps-kpm-ratio.mjs) and stored in
 * data-ps/kpm-ratio.json, refreshed weekly (.github/workflows/ps-kpm-ratio.yml).
 * Only players whose file says room "ps" use it; PC stays at 600.
 *
 * Missing / unreadable file → the last stored value (browser: localStorage;
 * Node: whatever was set before) → PS_KPM_RATIO_DEFAULT (first measurement).
 * The gap is clamped to [PS_KPM_RATIO_MIN, PS_KPM_RATIO_MAX] (sanity).
 */
import { RF_SOFT } from "./math.mjs?v=20261026-psb1";

export const PS_KPM_RATIO_MIN = 1.0;
export const PS_KPM_RATIO_MAX = 3.0;
/** First measurement (2026-10-26: PC 0.8539 ÷ PS 0.5051 = 1.690 → baseline 355). Used only when nothing was ever loaded. */
export const PS_KPM_RATIO_DEFAULT = 1.69;
export const PS_KPM_LS_KEY = "ps2-elite-kd:ps-kpm-ratio";

/** Gap clamped to [MIN, MAX]; NaN when v is not a positive number. Accepts the json object too. */
export function clampPsKpmRatio(v) {
  const r = v && typeof v === "object" ? +v.ratio : +v;
  if (!Number.isFinite(r) || !(r > 0)) return NaN;
  return Math.min(PS_KPM_RATIO_MAX, Math.max(PS_KPM_RATIO_MIN, r));
}

const state = { ratio: PS_KPM_RATIO_DEFAULT, info: null };
function setOne(v) {
  const r = clampPsKpmRatio(v);
  if (!Number.isFinite(r)) return false;
  state.ratio = r;
  state.info = v && typeof v === "object" ? v : null;
  return true;
}

/* Same as padding.mjs: one file can load as several module copies ("?v=" specifiers), so the setter reaches all of them. */
const copies = (globalThis.__ps2PsBaseCopies ||= []);
copies.push(setOne);
/** Set the PC / PS kill-speed gap (number or data-ps/kpm-ratio.json content). Bad values keep the last one. */
export function setPsKpmRatio(v) {
  let ok = false;
  for (const f of copies) ok = f(v) || ok;
  return ok;
}
/** Current PC / PS kill-speed gap (clamped). */
export function psKpmRatio() {
  return state.ratio;
}
/** data-ps/kpm-ratio.json as last loaded (null = default / number only). */
export function psKpmInfo() {
  return state.info;
}
/** PS baseline on the adjusted-iVi scale: 600 ÷ gap (≈ 355 today). */
export function psIviBaseline() {
  return 600 / state.ratio;
}
/** RF baseline for adjustedIvi(ivi, rf, base): PS rooms 0.6 ÷ gap, everything else RF_SOFT. */
export function rfBaseFor(room) {
  return room === "ps" ? RF_SOFT / state.ratio : RF_SOFT;
}

// ---- load the stored value ----
if (typeof window !== "undefined") {
  try {
    const last = JSON.parse(localStorage.getItem(PS_KPM_LS_KEY) || "null");
    if (last) setOne(last);
  } catch { /* no storage */ }
  let isPs = false;
  try { isPs = window.__ps2Room === "ps" || new URLSearchParams(location.search).get("room") === "ps"; } catch {}
  const early = window.__ps2Early && window.__ps2Early.psKpm;
  const p = early || (isPs && typeof fetch === "function"
    ? fetch(new URL("./data-ps/kpm-ratio.json", import.meta.url).href, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    : null);
  if (p) {
    try {
      const d = await p;
      if (d && setOne(d)) {
        try { localStorage.setItem(PS_KPM_LS_KEY, JSON.stringify({ ratio: d.ratio, baseline: d.baseline, measuredAt: d.measuredAt })); } catch {}
      }
    } catch { /* keep the last stored value */ }
  }
} else {
  try {
    const fs = await import("node:fs");
    setOne(JSON.parse(fs.readFileSync(new URL("./data-ps/kpm-ratio.json", import.meta.url), "utf8")));
  } catch { /* no file → default */ }
}
