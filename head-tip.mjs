/**
 * Column-header hints on touch screens (t-tip, 2026-10-15).
 *
 * Headers carry their description in a native `title`, which phones never show.
 * After a tap sorts a column, this shows that column's description in a small
 * bubble under the header for HEAD_TIP_MS, then hides it. Mouse users keep the
 * normal hover title. DOM helper only; the browser entry points are the two
 * sort handlers (app.js stats tables, rankings.mjs ranks table).
 */

import { watchDismiss } from "./tip-dismiss.mjs?v=20261025-tipx1";

export const HEAD_TIP_MS = 5000; // owner t643u: keep the 5 s read time; tip-dismiss.mjs closes it early on a scroll / tap elsewhere / tab switch

let el = null;
let timer = null;
let markOpened = null; // tip-dismiss.mjs (owner t642u–t644u)

/** True when the primary pointer cannot hover (phones, most tablets). */
export function isTouchUi() {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(hover: none)").matches;
}

/**
 * Split a tip string into plain / bold parts: "**...**" renders bold
 * (owner 2026-10-21: the 🎯 graph-mode tip stresses IN THEORY). Everything
 * else stays a text node, so tip strings remain markup-safe; an unmatched
 * "**" is left as literal text.
 */
export function richParts(text) {
  const s = String(text || "");
  const parts = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) parts.push({ b: false, s: s.slice(last, m.index) });
    parts.push({ b: true, s: m[1] });
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push({ b: false, s: s.slice(last) });
  return parts;
}

/** Show `text` under `anchor` for HEAD_TIP_MS. Re-showing restarts the timer. */
export function showHeadTip(text, anchor) {
  if (typeof document === "undefined" || !text || !anchor || !anchor.getBoundingClientRect) return;
  if (!el) {
    el = document.createElement("div");
    el.className = "dist-tip head-tip";
    el.setAttribute("role", "tooltip");
    document.body.appendChild(el);
    markOpened = watchDismiss(() => !!el && !el.hidden, hideHeadTip, { inside: (t) => !!(t && el.contains(t)) });
  }
  el.textContent = "";
  for (const p of richParts(text)) {
    if (!p.b) {
      el.appendChild(document.createTextNode(p.s));
    } else {
      const b = document.createElement("b");
      b.textContent = p.s;
      el.appendChild(b);
    }
  }
  el.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - w - 8));
  el.style.left = Math.round(left + (window.scrollX || 0)) + "px";
  el.style.top = Math.round(r.bottom + 6 + (window.scrollY || 0)) + "px";
  clearTimeout(timer);
  timer = setTimeout(hideHeadTip, HEAD_TIP_MS);
  if (markOpened) markOpened();
}

export function hideHeadTip() {
  if (el) el.hidden = true;
  clearTimeout(timer);
  timer = null;
}
