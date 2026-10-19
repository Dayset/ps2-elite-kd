/**
 * 🚜 Vehicle + MAX cuts (owner-approved 2026-10-19, curve set the same day):
 * ⚔️ adjusted iVi ranks infantry skill only, so two cuts that ADD UP, no cap:
 *   vehicle cut = max(0, vehicle-kill share − 10%)   (vehicle seats / turrets, infantry.mjs infVeh)
 *   MAX cut     = max(0, MAX-kill share − 10%)       (MAX weapons, infMax)
 * e.g. vehicle 96% → −86%; vehicle 45% + MAX 40% → −35% − 30% = −65%.
 * vehicle% + MAX% ≤ 100%, so the total stays under 100% (at most −80%).
 * (The 🫡 Infantry column still counts MAX as infantry; its hover shows the MAX share.)
 *
 * No infantry data (or < 100 kills) → no cut. Applied inside playerMetrics()
 * AFTER the 💩 padder penalty (they stack), so every page, ranks.json and the
 * regular refresh use the same number. A score at or below 0 never flips sign:
 * it gets the fixed drop cut × VEH_CUT.REF instead (same rule as 💩), so it only falls.
 * Public: names stay clean (owner: no name badges); a small dimmed ‡ after the iVi value,
 * the hover lists each part and the total.
 * Owner override (exempts both): data/reviewed.json "vehicleCutCleared": { "<slug>": { "note", "at" } }.
 */
import { infantryShares } from "./infantry.mjs?v=20261019-inf1";

export const VEH_CUT = Object.freeze({ START: 0.1, REF: 610.6 });
/** Small dimmed mark after the ⚔️ iVi value (public-marking rule for automatic changes); the hover explains. */
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

/** One part's cut (fraction) for a share 0 … 1: max(0, share − 10%). */
export function vehicleCutFrac(share) {
  if (typeof share !== "number" || !Number.isFinite(share)) return 0;
  return Math.max(0, share - VEH_CUT.START);
}

/** { veh, max, cutVeh, cutMax, cut } (fractions; cut = cutVeh + cutMax) from a stored infantry summary, or null. */
export function vehicleCutFor(infantry) {
  const sh = infantryShares(infantry);
  if (!sh) return null;
  const veh = sh.veh / 100, max = sh.max / 100;
  const cutVeh = vehicleCutFrac(veh), cutMax = vehicleCutFrac(max);
  return { veh, max, cutVeh, cutMax, cut: Math.min(0.99, cutVeh + cutMax) };
}

/** Score after the cut (non-finite values pass through; ≤ 0 gets a fixed drop, never a sign flip). */
export function applyVehicleCut(v, cut) {
  if (typeof v !== "number" || !Number.isFinite(v) || !(cut > 0)) return v;
  return v > 0 ? v * (1 - cut) : v - cut * VEH_CUT.REF;
}

const r0 = (x) => (typeof x === "number" && Number.isFinite(x) ? Math.round(x) : 0);
/**
 * iVi hover text (shares and total cut in %):
 * "‡ vehicle kills 45%: −35% · MAX kills 40%: −30% → −65% iVi, infantry skill only".
 * Only the parts above 10% are listed; the arrow total only when both apply.
 */
export function vehicleCutTip(vehPct, maxPct, cutPct) {
  const parts = [];
  if (vehPct > 10) parts.push(`vehicle kills ${r0(vehPct)}%: −${r0(vehPct - 10)}%`);
  if (maxPct > 10) parts.push(`MAX kills ${r0(maxPct)}%: −${r0(maxPct - 10)}%`);
  const total = Number.isFinite(cutPct) ? cutPct : Math.max(0, (vehPct || 0) - 10) + Math.max(0, (maxPct || 0) - 10);
  return `${VEH_CUT_MARK} ${parts.join(" · ")}${parts.length > 1 ? ` → −${r0(total)}%` : ""} iVi, infantry skill only`;
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
