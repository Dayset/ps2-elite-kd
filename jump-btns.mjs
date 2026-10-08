/**
 * Shared ⬆ / ⬇ floating quick-jump buttons (fixed bottom-right).
 * Used by ranks.html (whole rankings list) and index.html (shared-cache A–Z
 * names list). Look lives in styles.css (.jump-btns / .jump-btn).
 *
 * Pure helpers (jumpButtonsVisible, sectionJumpState, hopTarget) are unit-tested;
 * mountJumpButtons() is the small DOM glue.
 */

/** true when the user asked for reduced motion. */
export function prefersReducedMotion() {
  return typeof window !== "undefined" && !!window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** "smooth", or "auto" (instant) under prefers-reduced-motion. */
export function scrollBehavior() {
  return prefersReducedMotion() ? "auto" : "smooth";
}

/**
 * Which buttons to show. Both appear once `scrolled` > threshold × viewport
 * (≈ one screen) while `active`; ⬇ hides when `nearEnd`.
 */
export function jumpButtonsVisible({ active = true, scrolled = 0, viewport = 800, nearEnd = false, threshold = 0.9 } = {}) {
  const show = !!active && scrolled > viewport * threshold;
  return { top: show, bottom: show && !nearEnd };
}

/**
 * State for a long section scrolled with the page (index.html shared cache).
 * listTop / listBottom are the list's viewport-relative rect edges.
 * Active = section open, the list's top has scrolled above the viewport
 * (user is inside it) and its end is still on screen (not scrolled past).
 */
export function sectionJumpState({ open, listTop, listBottom, viewport, pageY, endSlack = 40, threshold = 0.9 } = {}) {
  const vh = viewport || 800;
  const active = !!open && listTop < 0 && listBottom > vh * 0.2;
  const nearEnd = listBottom <= vh + endSlack;
  return jumpButtonsVisible({ active, scrolled: pageY, viewport: vh, nearEnd, threshold });
}

/**
 * Long smooth scrolls (tens of thousands of px) take seconds: hop to ~`near`
 * px from the target first, then glide the rest. Returns the hop position,
 * or null when no hop is needed.
 */
export function hopTarget(from, to, near) {
  if (!(near > 0) || Math.abs(to - from) <= near * 3) return null;
  return to > from ? to - near : to + near;
}

/** Scroll `el` (an element, or window when null) to `top`: hop + glide. */
export function glideTo(el, top, behavior = scrollBehavior()) {
  const win = !el || el === window;
  const doc = typeof document !== "undefined" ? document.documentElement : null;
  const from = win ? (window.scrollY || (doc && doc.scrollTop) || 0) : el.scrollTop;
  const near = win ? (window.innerHeight || 800) : el.clientHeight;
  const hop = behavior === "smooth" ? hopTarget(from, top, near) : null;
  if (hop != null) {
    if (win) window.scrollTo({ top: hop, behavior: "auto" });
    else el.scrollTop = hop;
  }
  (win ? window : el).scrollTo({ top, behavior });
}

const CHEVRON = {
  up: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M5 15 12 8l7 7" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

/**
 * Create the two buttons (appended to <body>) and keep them in sync.
 *   state()   → { top: bool, bottom: bool }   (e.g. via jumpButtonsVisible)
 *   jump(end) → scroll to top (false) / bottom (true)
 *   scrollers → extra scroll containers to listen to (window is always on)
 * Returns { root, top, bottom, sync }.
 */
export function mountJumpButtons({
  state,
  jump,
  scrollers = [],
  ids = {},
  topLabel = "Top",
  bottomLabel = "Bottom",
  topHint = "Top",
  bottomHint = "Bottom",
  groupLabel = "Quick jump",
} = {}) {
  const root = document.createElement("div");
  root.className = "jump-btns";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", groupLabel);
  const make = (dir, id, label, hint) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "jump-btn";
    if (id) b.id = id;
    b.hidden = true;
    b.setAttribute("aria-label", label);
    b.setAttribute("data-hint", hint);
    b.innerHTML = CHEVRON[dir];
    b.addEventListener("click", () => jump(dir === "down"));
    root.appendChild(b);
    return b;
  };
  const top = make("up", ids.top, topLabel, topHint);
  const bottom = make("down", ids.bottom, bottomLabel, bottomHint);
  document.body.appendChild(root);

  let raf = 0;
  const apply = () => {
    raf = 0;
    const st = state() || {};
    // Keep keyboard focus sane: if the focused button disappears, drop focus.
    if (!st.top && document.activeElement === top) top.blur();
    if (!st.bottom && document.activeElement === bottom) bottom.blur();
    top.hidden = !st.top;
    bottom.hidden = !st.bottom;
  };
  const sync = () => { if (!raf) raf = requestAnimationFrame(apply); };
  window.addEventListener("scroll", sync, { passive: true });
  window.addEventListener("resize", sync, { passive: true });
  for (const s of scrollers) if (s) s.addEventListener("scroll", sync, { passive: true });
  sync();
  return { root, top, bottom, sync };
}
