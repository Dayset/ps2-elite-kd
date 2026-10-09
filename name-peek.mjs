/**
 * Long player names: CSS truncates .nm with an ellipsis, either at NAME_MAX_CH ch
 * (dense lists / tables) or by available space (name chips, legend), and
 * every .nm carries the full name in its title. Touch screens never show titles,
 * so this module adds a small "name peek" popup with the full name:
 *   - plain-text names (tables, lists): tap a truncated name;
 *   - names inside a link / button / chip (Honu links, name chips, cache chips):
 *     long-press (~0.45 s) — a normal tap keeps its usual action (open link,
 *     add / remove name); the click after a long-press is swallowed.
 * One reusable popup, auto-hides after 3 s, on tap, scroll or resize. Import once per page.
 */

/** ~80% of cached names (incl. "[TAG] ") are ≤ 18 characters (2026-10-07, 461 players). */
export const NAME_MAX_CH = 18;
export const LONG_PRESS_MS = 450;
const PEEK_MS = 3000;
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

let peekEl = null;
let peekTimer = 0;

export function hideNamePeek() {
  if (peekTimer) {
    clearTimeout(peekTimer);
    peekTimer = 0;
  }
  if (peekEl) peekEl.hidden = true;
}

export function showNamePeek(anchor, text) {
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
  peekEl.textContent = text;
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
}

function nameTarget(t) {
  const el = t && t.closest ? t.closest(".nm") : null;
  return el && isTruncated(el) ? el : null;
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

  const cancelPress = () => {
    if (press && press.timer) clearTimeout(press.timer);
    press = null;
  };

  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "mouse") return;
      const el = nameTarget(e.target);
      if (!el || !inInteractive(el)) return;
      cancelPress();
      press = { el, x: e.clientX, y: e.clientY, fired: false, timer: 0 };
      press.timer = setTimeout(() => {
        if (!press) return;
        press.fired = true;
        swallowClickUntil = Date.now() + 800;
        showNamePeek(press.el, fullName(press.el));
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
    if (Date.now() < swallowClickUntil && nameTarget(e.target)) e.preventDefault();
  });

  document.addEventListener(
    "click",
    (e) => {
      if (Date.now() < swallowClickUntil) {
        // The click that ends a long-press must not add/remove a name or follow a link.
        if (nameTarget(e.target) || (e.target.closest && e.target.closest(".name-peek"))) {
          e.preventDefault();
          e.stopPropagation();
          swallowClickUntil = 0;
          return;
        }
      }
      const el = nameTarget(e.target);
      if (el && !inInteractive(el)) showNamePeek(el, fullName(el));
    },
    true
  );
  window.addEventListener("scroll", () => { if (peekEl && !peekEl.hidden) hideNamePeek(); }, { passive: true });
  window.addEventListener("resize", () => { if (peekEl && !peekEl.hidden) hideNamePeek(); });
}

if (typeof document !== "undefined") installNamePeek();
