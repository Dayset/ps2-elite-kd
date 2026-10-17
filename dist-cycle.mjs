/**
 * 📊 Distribution auto-cycle timing (t373u): the chart steps to the next
 * metric every STEP_MS; any interaction holds it for HOLD_MS, then cycling
 * resumes at the normal pace. While it can't run (section folded, tab hidden,
 * chart off screen, a tooltip open) it just waits and checks again.
 *
 * DOM-free and clock-injectable so the timing is Node-tested
 * (test/dist-cycle.test.mjs); rankings.mjs supplies the chart hooks.
 */

export const STEP_MS = 5000;
export const HOLD_MS = 15000;
/** How often a paused cycle (can't run right now) checks again. */
export const RETRY_MS = 1000;

/**
 * @param {{
 *   ids: () => string[],          // metrics in menu order
 *   current: () => string,        // metric shown now
 *   show: (id: string) => void,   // switch the chart (crossfade is the caller's)
 *   canRun?: () => boolean,       // false = wait (folded / hidden / off screen / tooltip)
 *   now?: () => number,
 *   setTimer?: (fn: Function, ms: number) => any,
 *   clearTimer?: (t: any) => void,
 *   stepMs?: number, holdMs?: number, retryMs?: number,
 * }} opts
 */
export function createDistCycler(opts) {
  const {
    ids,
    current,
    show,
    canRun = () => true,
    now = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (t) => clearTimeout(t),
    stepMs = STEP_MS,
    holdMs = HOLD_MS,
    retryMs = RETRY_MS,
  } = opts;

  let timer = null;
  let holdUntil = 0;
  let nextAt = 0;
  let running = false;

  function schedule(ms) {
    if (timer != null) clearTimer(timer);
    timer = setTimer(tick, Math.max(0, ms));
  }

  /** Next metric after the current one (wraps); null when there's nothing to cycle. */
  function nextId() {
    const list = ids() || [];
    if (list.length < 2) return null;
    const i = list.indexOf(current());
    return list[(i + 1) % list.length];
  }

  function tick() {
    timer = null;
    if (!running) return;
    const t = now();
    if (t < holdUntil) { schedule(holdUntil - t); return; }
    if (!canRun()) { schedule(retryMs); return; }
    if (t < nextAt) { schedule(nextAt - t); return; }
    const id = nextId();
    if (id) show(id);
    nextAt = t + stepMs;
    schedule(stepMs);
  }

  return {
    /** Start cycling: the first switch comes one step from now. */
    start() {
      if (running) return;
      running = true;
      nextAt = now() + stepMs;
      schedule(stepMs);
    },
    stop() {
      running = false;
      if (timer != null) clearTimer(timer);
      timer = null;
    },
    /** The person used the chart: hold, then resume at the normal pace. */
    interact() {
      holdUntil = now() + holdMs;
      nextAt = holdUntil;
      if (running) schedule(holdMs);
    },
    get running() { return running; },
    /** Milliseconds until the hold ends (0 when not holding). */
    holdLeft() { return Math.max(0, holdUntil - now()); },
  };
}

/* ---------- 👆 swipe between metrics (t383u, carousel direction t385u) ----------
 * Normal carousel: the chart follows the finger. Drag LEFT = next (it comes
 * in from the right), drag RIGHT = previous (comes in from the left).
 * A swipe must be mostly sideways, long enough and quick enough, so taps on
 * bars and vertical page scrolls never count. */
export const SWIPE_MIN_PX = 50;
export const SWIPE_MAX_MS = 900;
export const SWIPE_RATIO = 1.5; // |dx| must beat |dy| by this much

/** +1 = next, -1 = previous, 0 = not a swipe. */
export function swipeStep({ dx, dy, dt }, { minPx = SWIPE_MIN_PX, maxMs = SWIPE_MAX_MS, ratio = SWIPE_RATIO } = {}) {
  const ax = Math.abs(+dx || 0);
  const ay = Math.abs(+dy || 0);
  if (!(ax >= minPx) || ax < ratio * ay || !(dt >= 0) || dt > maxMs) return 0;
  return dx < 0 ? 1 : -1;
}

/**
 * Trackpad two-finger sideways swipes arrive as wheel events: add up deltaX
 * (only while it dominates deltaY) and fire once per gesture.
 * Wheel deltaX > 0 = fingers moving LEFT (content scrolls right) → next,
 * like a carousel.
 */
export function createWheelSwiper({ threshold = 80, quietMs = 250, now = () => Date.now() } = {}) {
  let acc = 0;
  let last = 0;
  let fired = false;
  return {
    /** Feed one wheel event; returns +1 / -1 when a swipe completes, else 0. */
    push(dx, dy) {
      const t = now();
      if (t - last > quietMs) { acc = 0; fired = false; } // new gesture
      last = t;
      if (Math.abs(dx) <= Math.abs(dy)) return 0;
      acc += dx;
      if (fired || Math.abs(acc) < threshold) return 0;
      fired = true;
      return acc > 0 ? 1 : -1;
    },
    /** True while a sideways gesture is in progress (to stop browser back / forward). */
    active() { return now() - last <= quietMs && acc !== 0; },
  };
}
