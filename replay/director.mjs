// Playback director for the replay (issue #97, pure).
//
// The data clock is honest: the director only scales how fast wall time turns
// into data time, never what the sim computes. Today's planner segments map to
// the epic's table like this: running -> travel, respawnTimer -> respawn timer,
// beingRevived -> being revived, idle -> idle, reposition -> reposition,
// reloading -> aftermath (the post-fight beat). Everything else plays at x1.
// The duel planner (#96) will feed phase names (approach, trade, commit, ...)
// directly; speedAt takes them as-is when they match a table entry.
//
// speedAt(segment, tToNextKill, kind):
//   kind 'kill' | 'death' = bullet time is active -> x0.2. This is the table's
//     bullet-time floor; player.js runs the ramped envelope (bulletRate) while
//     an envelope is active and passes kind null the rest of the time.
//   tToNextKill <= 1.5 = the last ~1.5 data s before a kill shot -> x0.5
//   otherwise the segment's base rate (x2 calm, x1 the rest)
const FAST = new Set(['running', 'respawnTimer', 'beingRevived', 'idle', 'reposition', 'reloading']);
// #96 phase names, same table (no collision with today's segment ids: 'respawn'
// stays x1 because it is today's 0.9 s beam-in segment)
for (const p of ['travel', 'revived', 'aftermath']) FAST.add(p);
export function baseRate(segment) { return FAST.has(segment) ? 2 : 1; }
export function speedAt(segment, tToNextKill, kind) {
  if (kind === 'kill' || kind === 'death') return 0.2;
  if (tToNextKill != null && tToNextKill <= 1.5) return 0.5;
  return baseRate(segment);
}
// bullet-time envelope in wall seconds since the trigger: ramp in 0.15 s,
// hold x0.2 for ~0.6 s, ramp out 0.3 s (1 when inactive or over)
const ease = (x) => x * x * (3 - 2 * x);
export function bulletRate(wAge) {
  if (wAge == null || wAge < 0) return 1;
  if (wAge < 0.15) return 1 - 0.8 * ease(wAge / 0.15);
  if (wAge < 0.75) return 0.2;
  if (wAge < 1.05) return 0.2 + 0.8 * ease((wAge - 0.75) / 0.3);
  return 1;
}
// next kill moment after t: the end of the next fight (main kills) or dying
// (main dies) segment, or null when none is planned yet
export function nextKillAt(segs, t) {
  let best = null;
  for (const s of segs) {
    if ((s.id === 'fight' || s.id === 'dying') && s.t1 > t && (best == null || s.t1 < best)) best = s.t1;
  }
  return best;
}
// end of the calm stretch starting at/after t: consecutive x2 segments. Null
// when the stretch is 20 data s or shorter (no jump cut).
export function calmStretchEnd(segs, t) {
  let end = null;
  for (const s of segs) {
    if (s.t1 <= t) continue;
    if (baseRate(s.id) !== 2) break;
    end = s.t1;
  }
  return end != null && end - t > 20 ? end : null;
}
