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
import { REV_CONFIRM, zrevConfirmedTip } from "./zerg-revive.mjs?v=20261023-short1";
import { nbdFromTip } from "./newbie-diff.mjs?v=20261023-short1";
import { HUT_MARK_MIN } from "./hut.mjs?v=20261023-short1";
import { fmtSigned } from "./trait-tips.mjs?v=20261023-short1";
import { flairsFor } from "./flairs.mjs?v=20261010-sav1";
import { t as tr, currentLang } from "./i18n.mjs";

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

/**
 * 🪦 Inactive (owner 2026-10-23: brought back from the old graph name list,
 * flairs.mjs rule unchanged): last activity (Census last_save / last_login)
 * more than 365 days ago. 👶 new / 👴🏽 veteran stay hidden.
 * times = { created, last } in UNIX seconds (flairs.mjs cleanTimes shape).
 */
export const INACTIVE_MARK = "🪦";
function lastPlayed(sec) {
  const d = new Date(sec * 1000);
  try {
    return new Intl.DateTimeFormat(currentLang() || "en", { month: "short", year: "numeric", timeZone: "UTC" }).format(d);
  } catch {
    return `${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`;
  }
}
export function inactiveMark(times, now = Date.now()) {
  const f = flairsFor(times, now).find((x) => x.id === "inactive");
  if (!f) return null;
  return { id: "inactive", mark: INACTIVE_MARK, tip: tr("flair.inactive", "🪦 Inactive: no activity for over a year (last played {date})", { date: lastPlayed(+times.last) }) };
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Order after the name: (* / 💩 / 🛖 drawn by the caller) 🪳 🐣 🪦. Same look as 🛖 (poop-mark class: name width rules already reserve room). */
export function autoMarksHtml(g, z, times = null, now = Date.now()) {
  const ina = times ? inactiveMark(times, now) : null;
  return [...autoMarks(g, z), ...(ina ? [ina] : [])]
    .map((m) => `<span class="poop-mark auto-mark auto-mark-${m.id}" title="${esc(m.tip)}" aria-label="${esc(m.tip)}">${m.mark}</span>`)
    .join("");
}
