/**
 * Hover texts for 🤥😤 Impostor–DieHard and 🪳 Zerg (trait-scores.mjs), shared by
 * app.js (✨ Stats) and rankings.mjs (🏆 table / 🏅 positions / 📊 chart).
 * English defaults here; translations under the same keys in i18n/*.json.
 */
import { t as tr } from "./i18n.mjs";
import { percentileOf } from "./dist.mjs?v=20261010-sav1";
import { zrevConfirmedTip, zrevSoftTip, zrevPlainTip } from "./zerg-revive.mjs?v=20261023-short1";
import { vdiffFromTip } from "./diff-vehicle.mjs?v=20261023-short1";
import { nbdFromTip } from "./newbie-diff.mjs?v=20261023-nbh1";

export const AIMGAP_HINT = "🔀 Results vs aim (−99…+99). 🤥 ≤ −33: aim beats results. 😤 ≥ +33: the reverse. A style, not cheating.";
export const ZERG_HINT = "🪳 How much your results lean on a big group (🎈 Inflation and 🤝 Assists), 0–99. Lower is better.";
export const AIMGAP_MISSING = "Needs ⚔️ iVi (enough fights) and a public IvI";
export const ZERG_MISSING = "Needs 🤝 Assists (100 kills in recent Honu sessions) and 🎈 Inflation (enough fights)";

const fin = (v) => typeof v === "number" && Number.isFinite(v);
/** "+29" / "−90" / "0" (real minus sign). */
export function fmtSigned(v) {
  if (!fin(v)) return "—";
  return v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : "0";
}
/** " — top 12%" / " — bottom 3%" (same wording as 🤝 Assists and 🪖 Infantry). */
function rel(pool, v) {
  const p = pool && pool.length && fin(v) ? percentileOf(pool, v) : null;
  return p == null ? "" : p >= 50 ? tr("rk.apkTop", " — top {n}%", { n: Math.max(1, 100 - p) }) : tr("rk.apkBottom", " — bottom {n}%", { n: Math.max(1, p) });
}

/** 🔀 Diff thirds of the −99…+99 scale: ≤ −33 🤥 Impostor, ≥ +33 😤 DieHard, between = balanced (cells show only the signed number since t494u). */
export const DIFF_THIRD = 33;
export function diffEmoji(v) {
  return !fin(v) ? "" : v <= -DIFF_THIRD ? "🤥" : v >= DIFF_THIRD ? "😤" : "";
}
/**
 * t492u/t494u: 🔀 value markup — plain signed number (no 🤥/😤 in cells since
 * t494u; the sides live in the hover / popup hint and the chart's ±33 lines).
 * The +/− sign sits in .sgn-pre: on PC (stats-carousel, styles.css) it hangs
 * left of the digits, out of the flow, so "+5" and "5" center their digits
 * identically under the header; elsewhere it renders inline as before.
 */
export function diffValueHtml(v) {
  if (!fin(v)) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `<span class="sgn-num">${sign ? `<span class="sgn-pre">${sign}</span>` : ""}${Math.abs(v)}</span>`;
}

/** 🔀 cell hover: score, side, percentile among all players, both parts; veh = 🪖 vehicle share % (for the 🚜 damp line). */
export function aimGapCellTip(v, g, pool, veh = null) {
  const e = diffEmoji(v);
  const side = e === "🤥" ? tr("diff.imp", "🤥 Impostor: aim beats results") : e === "😤" ? tr("diff.dh", "😤 DieHard: results beat aim") : tr("diff.even", "balanced: aim and results roughly agree");
  const parts = g ? tr("diff.parts", "Practice ⚔️ percentile {a} − theory IvI percentile {i}", { a: g.practice, i: g.theory }) : "";
  const base = tr("diff.tip", "{v}: {side}{rel}. {parts}", { v: fmtSigned(v), side, rel: rel(pool, v), parts }).trim();
  // 🛖 safe-spot damping (hut.mjs): say where the shown score came from.
  // 🔀 vehicle damp (diff-vehicle.mjs) or 🛖 — whichever factor counted (the lower one).
  const reduced = g && g.raw !== g.score;
  const hut = reduced && g.by === "hut" ? " " + tr("diff.hutFrom", "🛖 Reduced from {raw} (rarely dies, slow pace, low accuracy).", { raw: fmtSigned(g.raw) }) : "";
  const vd = reduced && g.by === "veh" ? " " + vdiffFromTip(fmtSigned(g.raw), fin(veh) ? Math.round(veh) : "?") : "";
  // 🐣 newbie softening (newbie-diff.mjs) on a negative Diff.
  const nb = reduced && g.by === "nbd" ? " " + nbdFromTip(fmtSigned(g.raw)) : "";
  return base + hut + vd + nb;
}

/** 🪳 cell hover: score, percentile among measured players, both parts. */
export function zergCellTip(v, z, pool) {
  const parts = z ? tr("zerg.parts", "🎈 Inflation {f} · 🤝 Assists {a}", { f: z.infl, a: z.apk }) : "";
  // 🪳 revive check (zerg-revive.mjs): only where Honu XP detail exists.
  const rv = z && fin(z.rvp) ? " " + (z.softened ? zrevSoftTip(z.raw, z.rvp) : z.confirmed ? zrevConfirmedTip(z.rvp) : zrevPlainTip(z.rvp)) : "";
  return tr("zerg.tip", "Zerg {v}{rel}. {parts}", { v, rel: rel(pool, v), parts }).trim() + rv;
}
