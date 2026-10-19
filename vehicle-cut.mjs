/**
 * 🚜 Vehicle / MAX cut (owner-approved 2026-10-19): ⚔️ adjusted iVi is cut by
 * the share of lifetime kills NOT made as plain infantry = vehicle / turret
 * kills + MAX-weapon kills (infantry.mjs infVeh + infMax), on ONE curve with
 * one cap (never −40%). Aimed at farming infantry from vehicles or a MAX suit,
 * so the iVi board ranks plain infantry play. (The 🪖 Infantry column still
 * counts MAX as infantry; its hover shows the MAX share.)
 *
 *   vehicle + MAX share ≤ 10%  → no cut
 *   10% … 60%            → cut grows linearly
 *   ≥ 60%                → −20% (cap)
 *
 * No infantry data (or < 100 kills) → no cut. Applied inside playerMetrics()
 * AFTER the 💩 padder penalty (they stack), so every page, ranks.json and the
 * regular refresh use the same number. A score at or below 0 gets the fixed
 * drop cut × VEH_CUT.REF instead (same rule as the 💩 penalty, so it never rises).
 * Public mark: "‡" after the ⚔️ iVi value with the reason on hover.
 * Owner override: data/reviewed.json "vehicleCutCleared": { "<slug>": { "note", "at" } }.
 */
import { infantryShares } from "./infantry.mjs?v=20261019-inf1";

export const VEH_CUT = Object.freeze({ START: 0.1, FULL: 0.6, CAP: 0.2, REF: 610.6 });
export const VEH_CUT_MARK = "‡";

const state = { cleared: {} };
const key = (s) => String(s || "").trim().toLowerCase().replace(/^\[.*?\]\s*/, "").replace(/[^a-z0-9]+/g, "");

/** Replace the owner overrides (reviewed.json content; null clears). */
export function setVehicleCutReviewed(json) {
  state.cleared = (json && json.vehicleCutCleared) || {};
}
/** True when the owner exempted this player (slug or display name). */
export function isVehicleCutCleared(nameOrSlug) {
  return Object.prototype.hasOwnProperty.call(state.cleared, key(nameOrSlug));
}

/** Cut fraction (0 … CAP) for a vehicle share 0 … 1. */
export function vehicleCutFrac(share) {
  if (typeof share !== "number" || !Number.isFinite(share)) return 0;
  const t = (share - VEH_CUT.START) / (VEH_CUT.FULL - VEH_CUT.START);
  return VEH_CUT.CAP * Math.min(1, Math.max(0, t));
}

/** { share, veh, max, cut } (fractions) from a stored infantry summary, or null (no data / too few kills). */
export function vehicleCutFor(infantry) {
  const sh = infantryShares(infantry);
  if (!sh) return null;
  const veh = sh.veh / 100, max = sh.max / 100;
  const share = Math.min(1, veh + max);
  return { share, veh, max, cut: vehicleCutFrac(share) };
}

/** Score after the cut (non-finite values pass through). */
export function applyVehicleCut(v, cut) {
  if (typeof v !== "number" || !Number.isFinite(v) || !(cut > 0)) return v;
  return v > 0 ? v * (1 - cut) : v - cut * VEH_CUT.REF;
}

/** Hover text, e.g. "‡ vehicle kills 40% + MAX kills 5%: −14% iVi …" (percent values). */
export function vehicleCutTip(vehPct, maxPct, cutPct) {
  const r = (x) => (typeof x === "number" && Number.isFinite(x) ? Math.round(x) : 0);
  const c = Math.round(cutPct * 10) / 10;
  return `${VEH_CUT_MARK} vehicle kills ${r(vehPct)}% + MAX kills ${r(maxPct)}%: −${c < 10 ? c.toFixed(1) : Math.round(c)}% iVi (cut starts above 10% vehicle + MAX kills, −20% at 60%+)`;
}

try {
  if (typeof window !== "undefined" && typeof fetch === "function") {
    const res = await fetch(new URL("./data/reviewed.json", import.meta.url).href, { cache: "no-cache" });
    if (res.ok) setVehicleCutReviewed(await res.json());
  } else {
    const fs = await import("node:fs");
    setVehicleCutReviewed(JSON.parse(fs.readFileSync(new URL("./data/reviewed.json", import.meta.url), "utf8")));
  }
} catch {
  /* no reviewed.json → nobody exempted */
}
