/**
 * Marks next to the name for the automatic 🪳 / 🐣 checks (owner t504u: auto
 * changes are marked by the name, never inside numeric cells; owner 2026-10-23:
 * "I can't see badges now, neither zerg or new accounts"). DOM-free.
 *
 *   🪳 Zerg confirmed: the crowd check says "confirmed" (revive OR crowd-score
 *      percentile in the top quarter, zerg-revive.mjs REV_CONFIRM) AND the 🪳
 *      Zerg score itself is in the top quarter (same 75 line). Hover = the
 *      confirmed tip. An estimated "~N" 🪳 (no Zerg score) never gets a mark.
 *   🐣 Newbie softening: a negative 🔀 Diff was raised by the play-time
 *      factor (newbie-diff.mjs) by at least AUTO_MARK_MIN points (same rule as
 *      🛖, hut.mjs HUT_MARK_MIN). Hover = "Softened from …".
 *   🐣 New player (owner 2026-10-23, "A and B"): also when play time is under
 *      the data cut (newbie-diff.mjs NBD_NEW_Q), whatever the Diff. Hover =
 *      "New player (about N h played)" (+ "Diff softened from …" when both).
 * Players cleared in data/reviewed.json carry no rvp / crp / nbd / nbh, so no mark.
 * 🪦 inactive (> 1 year) hides 🐣 (autoMarksHtml; owner 2026-10-23: 🪦 wins).
 *
 * g = trait-scores aimGap() result, z = zergScore() result (either may be null),
 * nbh = new-player hours (newbie-diff.mjs newPlayerHours; null = not new).
 * Returns [{ id, mark, tip }] in display order.
 */
import { REV_CONFIRM, zrevConfirmedTip } from "./zerg-revive.mjs?v=20261024-crowd1";
import { nbdFromTip, nbdNewTip } from "./newbie-diff.mjs?v=20261023-nbh1";
import { HUT_MARK_MIN } from "./hut.mjs?v=20261023-short1";
import { fmtSigned } from "./trait-tips.mjs?v=20261024-crowd1";
import { flairsFor } from "./flairs.mjs?v=20261010-sav1";
import { t as tr, currentLang } from "./i18n.mjs";
import { tractorMarked, tractorHint, TRACTOR_EMOJI } from "./tractor.mjs?v=20261024-trac1";

export const ZERG_MARK = "🪳";
export const NBD_MARK = "🐣";
export const AUTO_MARK_MIN = HUT_MARK_MIN;

const fin = (v) => typeof v === "number" && Number.isFinite(v);

export function autoMarks(g, z, nbh = null) {
  const out = [];
  const chk = z ? (fin(z.chk) ? z.chk : z.rvp) : null; // the higher of revive / crowd percentiles (trait-scores zergScore)
  if (z && z.confirmed && fin(chk) && fin(z.score) && z.score >= REV_CONFIRM) {
    out.push({ id: "zerg", mark: ZERG_MARK, tip: ZERG_MARK + " " + zrevConfirmedTip(chk) });
  }
  const soft = !!(g && g.by === "nbd" && fin(g.score) && fin(g.raw) && g.score - g.raw >= AUTO_MARK_MIN);
  const isNew = fin(nbh) && nbh >= 0;
  if (isNew && soft) {
    out.push({ id: "nbd", mark: NBD_MARK, tip: nbdNewTip(nbh) + " " + tr("diff.nbdFromShort", "Diff softened from {raw}.", { raw: fmtSigned(g.raw) }) });
  } else if (isNew) {
    out.push({ id: "nbd", mark: NBD_MARK, tip: nbdNewTip(nbh) });
  } else if (soft) {
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

/** 🚜 mark (owner t592u, rule t622u): { id, mark, tip } when tractor.mjs tractorMarked(trc, inf, cuts), else null. */
export function tractorMark(trac) {
  if (!trac || !tractorMarked(trac.trc, trac.inf, trac.cuts)) return null;
  const c = trac.cuts || {};
  const k = c.cut + "|" + c.fb + "|" + currentLang(); // one hint per cuts + language (rankings draws ~14k rows)
  if (tracTipKey !== k) { tracTipKey = k; tracTip = tractorHint(c); }
  return { id: "tractor", mark: TRACTOR_EMOJI, tip: tracTip };
}
let tracTipKey = null, tracTip = "";

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * Order after the name: (* / 💩 / 🛖 drawn by the caller) 🪳 🐣 🚜 🪦.
 * Owner t592u/t593u/t622u: 🚜 = the build's vehicle mark (tractor.mjs rule: infantry < p25 + vehicle XP ≥ p75, or infantry < p2),
 * static, same look and hover as 🪦, just before it. trac = { inf, trc, cuts } (infantry %, build mark 1/0/null, ranks "tracCuts") or null. Same look as 🛖 (poop-mark class: name width rules already reserve room).
 * 🪦 wins over 🐣 (owner 2026-10-23): an inactive player shows no 🐣 mark (new-player or softened);
 * only the mark is dropped, the softened Diff itself is unchanged.
 */
export function autoMarksHtml(g, z, times = null, now = Date.now(), nbh = null, trac = null) {
  const ina = times ? inactiveMark(times, now) : null;
  const marks = autoMarks(g, z, nbh).filter((m) => !(ina && m.id === "nbd"));
  const tm = tractorMark(trac);
  return [...marks, ...(tm ? [tm] : []), ...(ina ? [ina] : [])]
    .map((m) => `<span class="poop-mark auto-mark auto-mark-${m.id}" title="${esc(m.tip)}" aria-label="${esc(m.tip)}">${m.mark}</span>`)
    .join("");
}
