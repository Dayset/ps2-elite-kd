/**
 * Marks next to the name for the automatic 🪳 / 🐣 checks (owner t504u: auto
 * changes are marked by the name, never inside numeric cells; owner 2026-10-23:
 * "I can't see badges now, neither zerg or new accounts"). DOM-free.
 *
 *   🪳 Zerg confirmed: the revive check says "confirmed" (revive percentile in
 *      the top quarter, zerg-revive.mjs REV_CONFIRM) AND the 🪳 Zerg score
 *      itself is in the top quarter (same 75 line). Hover = the confirmed tip.
 *   🐣 Newbie softening: a negative 🔀 Diff was raised by the play-time
 *      factor (newbie-diff.mjs) by at least AUTO_MARK_MIN points (same rule as
 *      🛖, hut.mjs HUT_MARK_MIN). Hover = "Softened from …".
 * Players cleared in data/reviewed.json carry no rvp / nbd, so no mark.
 *
 * g = trait-scores aimGap() result, z = zergScore() result (either may be null).
 * Returns [{ id, mark, tip }] in display order.
 */
import { REV_CONFIRM, zrevConfirmedTip } from "./zerg-revive.mjs?v=20261022-zrev1";
import { nbdFromTip } from "./newbie-diff.mjs?v=20261022-nbd1";
import { HUT_MARK_MIN } from "./hut.mjs?v=20261022-spawnroom1";
import { fmtSigned } from "./trait-tips.mjs?v=20261022-nbd1";

export const ZERG_MARK = "🪳";
export const NBD_MARK = "🐣";
export const AUTO_MARK_MIN = HUT_MARK_MIN;

const fin = (v) => typeof v === "number" && Number.isFinite(v);

export function autoMarks(g, z) {
  const out = [];
  if (z && z.confirmed && fin(z.rvp) && fin(z.score) && z.score >= REV_CONFIRM) {
    out.push({ id: "zerg", mark: ZERG_MARK, tip: ZERG_MARK + " " + zrevConfirmedTip(z.rvp) });
  }
  if (g && g.by === "nbd" && fin(g.score) && fin(g.raw) && g.score - g.raw >= AUTO_MARK_MIN) {
    out.push({ id: "nbd", mark: NBD_MARK, tip: nbdFromTip(fmtSigned(g.raw)) });
  }
  return out;
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Same look as 🛖 (poop-mark class: name width rules already reserve room). */
export function autoMarksHtml(g, z) {
  return autoMarks(g, z)
    .map((m) => `<span class="poop-mark auto-mark auto-mark-${m.id}" title="${esc(m.tip)}" aria-label="${esc(m.tip)}">${m.mark}</span>`)
    .join("");
}
