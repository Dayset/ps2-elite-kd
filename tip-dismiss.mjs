/**
 * Early close for hint bubbles (owner t642u–t644u). A bubble keeps its usual
 * timer while the user just reads (new users need the 5 s), but closes at once on:
 *   - any page / box move: a scroll of even a few px (window or an inner box,
 *     e.g. the Rankings list), a wheel turn, a finger drag (touchmove);
 *   - a tap / click anywhere outside the bubble (a new tab's tap then shows
 *     the new tab's bubble, replacing the old one right away);
 *   - the browser tab going to the background.
 * PC hover is untouched (callers still show / hide on hover as before).
 * Static: no animation. DOM helper; one set of document listeners per bubble.
 *
 * watchDismiss(isOpen, hide, { inside, graceMs }):
 *   isOpen() → bubble shown?   hide() → close it.
 *   inside(target) → true when the tap is on the bubble itself (kept open).
 *   graceMs: scroll events right after markOpened() are ignored (the tap that
 *   opened it may scroll the list itself: sort → top); wheel / touchmove are
 *   user moves and always close.
 * Returns markOpened(): call it whenever the bubble is shown.
 */
export const TIP_SCROLL_GRACE_MS = 300;

export function watchDismiss(isOpen, hide, { inside = () => false, graceMs = TIP_SCROLL_GRACE_MS } = {}) {
  let openedAt = 0;
  let armed = true;
  // The scroll the opening tap itself causes (sort → list jump, Locate player t648u) lands in
  // the next frame, which can be >graceMs away after a big re-render: ignore scrolls until two
  // frames have painted, AND for graceMs. Wheel / touchmove are user moves and always close.
  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : null;
  const markOpened = () => {
    openedAt = Date.now();
    if (!raf) return;
    armed = false;
    const id = openedAt;
    raf(() => raf(() => { if (openedAt === id) armed = true; }));
  };
  if (typeof document === "undefined") return markOpened;
  const close = () => { if (isOpen()) hide(); };
  const onScroll = () => { if (isOpen() && armed && Date.now() - openedAt >= graceMs) hide(); };
  const opt = { passive: true, capture: true };
  window.addEventListener("scroll", onScroll, opt);
  document.addEventListener("scroll", onScroll, opt);
  window.addEventListener("wheel", close, opt);
  window.addEventListener("touchmove", close, opt);
  document.addEventListener("pointerdown", (e) => { if (isOpen() && !inside(e.target)) hide(); }, opt);
  document.addEventListener("visibilitychange", () => { if (document.hidden) close(); });
  return markOpened;
}
