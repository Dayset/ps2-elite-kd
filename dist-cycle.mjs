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
