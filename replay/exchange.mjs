// #106: 1v1 exchanges and recovery, pure.
//
// An exchange is one front-lane enemy vs the player. The victim fires back
// from the first shot; the winner ends hurt (500 shield + 500 health, the
// ticket's simple pool — #95's richer model owns pair mode); after a won
// exchange where the player took damage, recovery runs before the next
// fight, in free time only: cover first (the ~3 s shield delay, hidden),
// then the visible shield refill, then a health fix when health is down —
// a medic's heal when one is near, else a medkit. The reload after recovery
// is the existing gap reload, not a step here.
//
// Pair mode reuses recoveryFor with the winner's end HP from the engage()
// traces; the medic roll there draws from a derived seed, never the plan's
// main stream, so recovery never moves an engagement's outcome or gap draw.
export const SHIELD = 500, HEALTH = 500, DMG_PER_HIT = 150;

// Enemy return fire: a short burst, mostly misses at range, a few hits.
export function returnBurst(r) {
  const n = 5 + Math.floor(r() * 5); // 5–9 shots
  let h = 0;
  for (let i = 0; i < n; i++) if (r() < 0.25) h++;
  return { n, h };
}

// Shield absorbs first, health takes the overflow. MAX health pools are
// larger than HEALTH; callers pass the real maxima via recoveryFor.
export function applyHits(shield, health, hits, dmg = DMG_PER_HIT) {
  let left = hits * dmg;
  const shieldLost = Math.min(shield, left);
  shield -= shieldLost; left -= shieldLost;
  health = Math.max(0, health - left);
  return { shield, health, tookDamage: hits > 0 };
}

// Medic chance rises with allies on screen and the revived share; 0 allies
// means no medic, however high the share.
export function medicChance(allies, revivedShare) {
  if (!allies) return 0;
  return Math.min(0.85, 0.3 + 0.08 * allies + 0.4 * (revivedShare || 0));
}

// Null when the exchange left the player untouched; otherwise the recovery
// steps in order, with their total duration for the planner's gap math.
export function recoveryFor({ shield, shieldMax = SHIELD, health, healthMax = HEALTH, allies = 0, revivedShare = 0, r }) {
  if (shield >= shieldMax && health >= healthMax) return null;
  const steps = [{ id: "recover", dur: 3 }];
  if (shield < shieldMax) steps.push({ id: "shieldRegen", dur: 1.5 });
  if (health < healthMax) {
    const medic = r() < medicChance(allies, revivedShare);
    steps.push(medic ? { id: "medicHeal", dur: 1.5 } : { id: "medkit", dur: 1.2 });
  }
  return { steps, dur: steps.reduce((a, s) => a + s.dur, 0) };
}
