// 🎲 Live luck (owner 2026-11-08): the followed player's luck, live — the
// same actual-vs-expected as the Duels panel's 🎲, but over the last 100
// fights on this page instead of the all-time pair record. Same model
// (duelExpected), same units (percentage points), but the raw value, no
// rounding: +0.73646, -1.47374738393. Rounded to a whole % it would sit at
// -1% forever and never move; raw, you watch it drift with every kill and
// feel whether you're getting luckier or not. Events vs unknown or ≤0-iVi
// opponents can't be scored (same rule as Duels luck) — they stay in the
// window (their iVi can land late, via the background fetch) but don't
// count in n. Below LIVE_LUCK_MIN scorable events there's no number yet.
import { duelExpected } from "./duels.mjs?v=20261102-luck5";

export const LIVE_LUCK_MAX = 100;
export const LIVE_LUCK_MIN = 10;
// Anchor weight, in fights — the same W as the session values
// (SESS_ANCHOR_W in live-session.mjs): the lifetime value counts as this
// many fights already played, so the first session fight moves the displayed
// value by ~1/(W+1) of the way. No waiting for a window to fill — the value
// shows from the first fight, starting at the lifetime number.
export const LUCK_ANCHOR_W = 100;

const fin = (v) => typeof v === "number" && Number.isFinite(v);

/** Push one fight {cid, iv, won} onto the window; the oldest drops past the cap. Returns the window. */
export function luckPush(events, ev) {
  const next = [...(events || []), { cid: ev && ev.cid, iv: ev && ev.iv, won: !!(ev && ev.won) }];
  return next.length > LIVE_LUCK_MAX ? next.slice(next.length - LIVE_LUCK_MAX) : next;
}

/** Fill in an opponent's iVi that landed late (background fetch), by cid. Returns true when one changed. */
export function luckFill(events, cid, iv) {
  let changed = false;
  for (const e of events || []) {
    if (String(e.cid) === String(cid) && !fin(e.iv) && fin(iv)) { e.iv = iv; changed = true; }
  }
  return changed;
}

/**
 * Live luck over the window, no floor: {n, act, exp, gapPp} or null (my iVi
 * ≤ 0/unknown, no scorable fight yet, or no fit). gapPp = (actual − expected
 * kill share) × 100. liveLuck adds the LIVE_LUCK_MIN floor on top of this.
 */
export function liveLuckRaw(events, myIvi, fit) {
  if (!fin(myIvi) || myIvi <= 0) return null;
  const scored = (events || []).filter((e) => e && fin(e.iv) && e.iv > 0);
  const n = scored.length;
  if (n < 1) return null;
  let expSum = 0, wins = 0;
  for (const e of scored) {
    const p = duelExpected(myIvi, e.iv, fit);
    if (p == null) return null; // no fit, no number
    expSum += p;
    if (e.won) wins++;
  }
  const exp = expSum / n, act = wins / n;
  return { n, act, exp, gapPp: (act - exp) * 100 };
}

/**
 * Live luck over the window: {n, act, exp, gapPp} or null (my iVi ≤ 0/unknown,
 * too few scorable fights, or no fit). gapPp = (actual − expected kill share) × 100.
 */
export function liveLuck(events, myIvi, fit) {
  const r = liveLuckRaw(events, myIvi, fit);
  return r && r.n >= LIVE_LUCK_MIN ? r : null;
}

/**
 * Anchor the session gap on the lifetime gap (both in points): the lifetime
 * gap counts as `weight` fights already played, so the first session fight
 * moves the value by ~1/(weight+1) of the way — stable from the first fight.
 * Returns null when there is no session fight yet or no anchor.
 */
export function anchorGap(gapPp, n, anchorGapPp, weight = LUCK_ANCHOR_W) {
  if (!fin(gapPp) || !fin(n) || n < 1) return null;
  if (!fin(anchorGapPp)) return null;
  if (!fin(weight) || weight < 0) return null;
  return (weight * anchorGapPp + gapPp * n) / (weight + n);
}

/** The raw value with an explicit sign: "+0.73646", "-1.47374738393". No rounding — that's the point. */
export function luckText(gapPp) {
  if (!fin(gapPp)) return "–";
  return gapPp > 0 ? `+${gapPp}` : `${gapPp}`;
}
