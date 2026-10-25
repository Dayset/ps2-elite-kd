/**
 * Long player names: CSS truncates .nm with an ellipsis, either at NAME_MAX_CH ch
 * (dense lists / tables) or by available space (name chips, legend), and
 * every .nm carries the full name in its title. Touch screens never show titles,
 * so this module adds a small "name peek" popup with the full name:
 *   - plain-text names (tables, lists): tap a truncated name;
 *   - names inside a link / button / chip (Honu links, name chips, cache chips):
 *     long-press (~0.45 s) — a normal tap keeps its usual action (open link,
 *     add / remove name); the click after a long-press is swallowed.
 * The popup shows the player's legend (data-desc) with a 📖 icon, and the
 * name itself links to the player's profile when the tapped name sits inside
 * a profile link. Which profile URL is NOT chosen here: the popup reuses the
 * page's own profile link (built by honuProfileUrl), so when a settings
 * switch later points names at Fisu or another site, the popup follows
 * automatically. That switch is not implemented. The link always opens in a
 * NEW window: the anchor carries target="_blank", and its click handler also
 * calls window.open explicitly — an installed-app (standalone) shell can
 * ignore an anchor's target and navigate the app window itself, which used
 * to throw the user out of the app onto the other site (owner, 2026-10-20).
 * One reusable popup, auto-hides after 10 s, on tap, scroll or resize. Import once per page.
 */

/** ~80% of cached names (incl. "[TAG] ") are ≤ 18 characters (2026-10-07, 461 players). */
export const NAME_MAX_CH = 18;
import { watchDismiss } from "./tip-dismiss.mjs?v=20261025-tipx1";

export const LONG_PRESS_MS = 450;
const PEEK_MS = 10000;
const MOVE_TOLERANCE_PX = 10;

/** True when the element's text is cut off (ellipsis showing). */
export function isTruncated(el) {
  return !!el && el.scrollWidth > el.clientWidth + 1;
}

/**
 * Popup position next to an anchor rect: centred above it, below when there is
 * no room above, clamped inside the viewport (all values in px).
 */
export function peekPosition(rect, size, viewport, gap = 8) {
  let left = rect.left + rect.width / 2 - size.width / 2;
  left = Math.max(gap, Math.min(left, viewport.width - size.width - gap));
  let top = rect.top - size.height - gap;
  if (top < gap) top = rect.bottom + gap;
  top = Math.max(gap, Math.min(top, viewport.height - size.height - gap));
  return { left: Math.round(left), top: Math.round(top) };
}

/** Full name for a .nm element (title wins; falls back to its text). */
function fullName(el) {
  return (el.getAttribute("data-full") || el.getAttribute("title") || el.textContent || "").trim();
}

/**
 * What the popup shows for a .nm element: the full name, plus its stored legend
 * (data-desc, set on the stats-table name cells) when there is one, plus the
 * profile link. The link comes from the enclosing profile anchor (stats-table /
 * chart-legend Honu links) or from the element's own data-profile (chart-legend
 * names carry it — their name under the graph is plain text, not a link, so
 * the profile link isn't duplicated). Only real profile URLs count:
 * "#" / in-page links are ignored.
 */
export function peekParts(el) {
  const urlEl = el && el.closest ? el.closest("a[href]") : null;
  const href = (urlEl && urlEl.getAttribute && urlEl.getAttribute("href")) || "";
  const profile = (el && el.getAttribute && el.getAttribute("data-profile")) || "";
  const url = href.startsWith("https://") ? href : profile.startsWith("https://") ? profile : "";
  return {
    name: fullName(el),
    desc: ((el && el.getAttribute && el.getAttribute("data-desc")) || "").trim(),
    url,
  };
}

let peekEl = null;
let peekTimer = 0;
let peekOpened = () => {};

export function hideNamePeek() {
  if (peekTimer) {
    clearTimeout(peekTimer);
    peekTimer = 0;
  }
  if (peekEl) peekEl.hidden = true;
}

export function showNamePeek(anchor, text, desc = "", url = "") {
  if (typeof document === "undefined" || !anchor) return;
  if (!peekEl) {
    peekEl = document.createElement("div");
    peekEl.className = "name-peek";
    peekEl.setAttribute("role", "status");
    peekEl.hidden = true;
    peekEl.addEventListener("click", hideNamePeek);
    document.body.appendChild(peekEl);
  }
  if (peekTimer) clearTimeout(peekTimer);
  peekEl.textContent = "";
  const nameLine = document.createElement("div");
  nameLine.className = "np-name";
  if (url) {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = text;
    // Force a new window on the tap itself: target="_blank" alone is not
    // enough in an installed-app shell, which can navigate its own window
    // to the other site instead (owner report, 2026-10-20).
    link.addEventListener("click", (e) => {
      e.preventDefault();
      window.open(url, "_blank", "noopener,noreferrer");
      hideNamePeek();
    });
    nameLine.appendChild(link);
  } else {
    nameLine.textContent = text;
  }
  // 🟢/🔴 online dot (online-status.mjs) from the player's table row, if known.
  const row = anchor.closest ? anchor.closest("tr") : null;
  const dot = row ? row.querySelector(".online-slot .online-dot") : null;
  if (dot) nameLine.insertBefore(dot.cloneNode(true), nameLine.firstChild);
  peekEl.appendChild(nameLine);
  if (desc) {
    const descLine = document.createElement("div");
    descLine.className = "np-desc";
    const icon = document.createElement("span");
    icon.className = "np-desc-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "📖";
    const body = document.createElement("span");
    body.textContent = desc;
    descLine.append(icon, body);
    peekEl.appendChild(descLine);
  }
  peekEl.hidden = false;
  peekEl.style.left = "0px";
  peekEl.style.top = "0px";
  const r = anchor.getBoundingClientRect();
  const pos = peekPosition(
    r,
    { width: peekEl.offsetWidth, height: peekEl.offsetHeight },
    { width: window.innerWidth, height: window.innerHeight }
  );
  peekEl.style.left = pos.left + "px";
  peekEl.style.top = pos.top + "px";
  peekEl.classList.remove("name-peek-pop");
  void peekEl.offsetWidth;
  peekEl.classList.add("name-peek-pop");
  peekTimer = setTimeout(hideNamePeek, PEEK_MS);
  peekOpened();
}

/**
 * A .nm worth a popup: truncated, or (when allowDesc) carrying a legend or a
 * profile link (data-desc / data-profile). Touch only: a mouse click on a
 * full name gets the native title on hover instead — except plain (non-link)
 * names, where the click handler passes allowDesc so the popup is reachable.
 */
function nameTarget(t, allowDesc = false) {
  const el = t && t.closest ? t.closest(".nm") : null;
  if (!el) return null;
  if (isTruncated(el)) return el;
  return allowDesc && (el.hasAttribute("data-desc") || el.hasAttribute("data-profile")) ? el : null;
}
function inInteractive(el) {
  return !!(el && el.closest && el.closest("a, button, label, summary, [role='button']"));
}

let installed = false;
export function installNamePeek() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  let press = null; // { el, x, y, timer, fired }
  let swallowClickUntil = 0;
  let lastPointer = "mouse";

  const cancelPress = () => {
    if (press && press.timer) clearTimeout(press.timer);
    press = null;
  };

  document.addEventListener(
    "pointerdown",
    (e) => {
      lastPointer = e.pointerType || "mouse";
      if (e.pointerType === "mouse") return;
      const el = nameTarget(e.target, true);
      if (!el || !inInteractive(el)) return;
      cancelPress();
      press = { el, x: e.clientX, y: e.clientY, fired: false, timer: 0 };
      press.timer = setTimeout(() => {
        if (!press) return;
        press.fired = true;
        swallowClickUntil = Date.now() + 800;
        const parts = peekParts(press.el);
        showNamePeek(press.el, parts.name, parts.desc, parts.url);
      }, LONG_PRESS_MS);
    },
    { passive: true }
  );
  document.addEventListener(
    "pointermove",
    (e) => {
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_TOLERANCE_PX) cancelPress();
    },
    { passive: true }
  );
  document.addEventListener("pointerup", () => { if (press && !press.fired) cancelPress(); else press = null; }, { passive: true });
  document.addEventListener("pointercancel", cancelPress, { passive: true });
  // Long-press on a link opens the OS menu on some phones; skip it when we peeked.
  document.addEventListener("contextmenu", (e) => {
    if (Date.now() < swallowClickUntil && nameTarget(e.target, true)) e.preventDefault();
  });

  document.addEventListener(
    "click",
    (e) => {
      if (Date.now() < swallowClickUntil) {
        // The click that ends a long-press must not add/remove a name or follow a link.
        if (nameTarget(e.target, true) || (e.target.closest && e.target.closest(".name-peek"))) {
          e.preventDefault();
          e.stopPropagation();
          swallowClickUntil = 0;
          return;
        }
      }
      // Touch taps open the legend popup; a mouse click too when the name is
      // plain text (chart-legend names) — its only action is the popup, since
      // the profile link lives inside it. Names inside links keep their
      // usual action (a mouse click only opens the popup for truncated ones).
      const cand = e.target && e.target.closest ? e.target.closest(".nm") : null;
      const el = nameTarget(e.target, lastPointer !== "mouse" || (cand && !inInteractive(cand)));
      if (el && !inInteractive(el)) {
        const parts = peekParts(el);
        showNamePeek(el, parts.name, parts.desc, parts.url);
      }
    },
    true
  );
  window.addEventListener("scroll", () => { if (peekEl && !peekEl.hidden) hideNamePeek(); }, { passive: true });
  // Owner t642u–t644u: also closes at once on a scroll inside a box (Rankings list), a wheel turn,
  // a finger drag, a tap outside the popup or the tab going to the background (tip-dismiss.mjs).
  peekOpened = watchDismiss(() => !!peekEl && !peekEl.hidden, hideNamePeek, { inside: (t) => !!(peekEl && t && peekEl.contains(t)) });
  window.addEventListener("resize", () => { if (peekEl && !peekEl.hidden) hideNamePeek(); });
}

if (typeof document !== "undefined") installNamePeek();
