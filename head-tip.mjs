/**
 * Column-header hints on touch screens (t-tip, 2026-10-15).
 *
 * Headers carry their description in a native `title`, which phones never show.
 * After a tap sorts a column, this shows that column's description in a small
 * bubble under the header for HEAD_TIP_MS, then hides it. Mouse users keep the
 * normal hover title. DOM helper only; the browser entry points are the two
 * sort handlers (app.js stats tables, rankings.mjs ranks table).
 */

export const HEAD_TIP_MS = 5000;

let el = null;
let timer = null;

/** True when the primary pointer cannot hover (phones, most tablets). */
export function isTouchUi() {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(hover: none)").matches;
}

/** Show `text` under `anchor` for HEAD_TIP_MS. Re-showing restarts the timer. */
export function showHeadTip(text, anchor) {
  if (typeof document === "undefined" || !text || !anchor || !anchor.getBoundingClientRect) return;
  if (!el) {
    el = document.createElement("div");
    el.className = "dist-tip head-tip";
    el.setAttribute("role", "tooltip");
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - w - 8));
  el.style.left = Math.round(left + (window.scrollX || 0)) + "px";
  el.style.top = Math.round(r.bottom + 6 + (window.scrollY || 0)) + "px";
  clearTimeout(timer);
  timer = setTimeout(hideHeadTip, HEAD_TIP_MS);
}

export function hideHeadTip() {
  if (el) el.hidden = true;
  clearTimeout(timer);
  timer = null;
}
