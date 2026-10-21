/**
 * Hover texts for 🤥😤 Impostor–DieHard and 🪳 Zerg (trait-scores.mjs), shared by
 * app.js (✨ Stats) and rankings.mjs (🏆 table / 🏅 positions / 📊 chart).
 * English defaults here; translations under the same keys in i18n/*.json.
 */
import { t as tr } from "./i18n.mjs";
import { percentileOf } from "./dist.mjs?v=20261010-sav1";

export const AIMGAP_HINT = "Aim on paper vs real results: your ⚔️ iVi percentile minus your IvI (aim) percentile, from −99 to +99. 🤥 Impostor (−33 or lower): your aim promises more than your fights deliver. 😤 DieHard (+33 or higher): you win more than your aim predicts. No emoji (−32…+32): balanced, aim and results roughly agree. Neither side is better or worse: it shows a play style, not cheating.";
export const ZERG_HINT = "How much your results lean on a big group, 0–99: the lower of your 🎈 Inflation percentile (K/D lifted by easy fights) and your 🤝 Assists percentile (kills shared with teammates). High only when both are high, so solo farmers of easy fights stay low. Lower is better. Needs 100 kills in recent Honu sessions.";
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

/** 🔀 Diff thirds of the −99…+99 scale: ≤ −33 🤥 Impostor, ≥ +33 😤 DieHard, between = balanced (no emoji). */
export const DIFF_THIRD = 33;
export function diffEmoji(v) {
  return !fin(v) ? "" : v <= -DIFF_THIRD ? "🤥" : v >= DIFF_THIRD ? "😤" : "";
}
/** Emoji slot before the number: balanced cells carry an invisible copy so every number lines up. */
export function diffEmojiSlot(v) {
  const e = diffEmoji(v);
  return e ? `<span class="diff-emo">${e}</span>` : `<span class="diff-emo diff-emo-ph" aria-hidden="true">😤</span>`;
}

/** 🔀 cell hover: score, side, percentile among all players, both parts. */
export function aimGapCellTip(v, g, pool) {
  const e = diffEmoji(v);
  const side = e === "🤥" ? tr("diff.imp", "🤥 Impostor: aim beats results") : e === "😤" ? tr("diff.dh", "😤 DieHard: results beat aim") : tr("diff.even", "balanced: aim and results roughly agree");
  const parts = g ? tr("diff.parts", "Practice ⚔️ percentile {a} − theory IvI percentile {i}", { a: g.practice, i: g.theory }) : "";
  return tr("diff.tip", "{v}: {side}{rel}. {parts}", { v: fmtSigned(v), side, rel: rel(pool, v), parts }).trim();
}

/** 🪳 cell hover: score, percentile among measured players, both parts. */
export function zergCellTip(v, z, pool) {
  const parts = z ? tr("zerg.parts", "🎈 Inflation percentile {f} · 🤝 Assists percentile {a} (the lower one counts)", { f: z.infl, a: z.apk }) : "";
  return tr("zerg.tip", "Zerg {v}{rel}. Lower is better. {parts}", { v, rel: rel(pool, v), parts }).trim();
}
