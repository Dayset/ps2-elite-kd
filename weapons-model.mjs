// Weapon comparison model (pure, no DOM). Used by weapon-compare.html / weapon-compare.mjs.
//
// Input is the 10-field fire profile from assets/weapons/profiles.json
// (see replay/weapons.mjs toProfile): rpm, mag, reloadMs, dmgMax, dmgMin,
// rangeMaxDmg, rangeMinDmg, hsMult, pellets, mode, plus the firing rhythm from
// assets/weapons/cadence.json (withCadence: bursts, wind-up). Everything here is derived
// from those numbers only (Census data): no recoil, bloom, attachments or
// armor values, because Census does not carry them. The target is a plain
// health pool (HP).
//
// Time to kill (TTK) is the time from the first shot to the shot that
// removes the last HP. The first shot is at t = 0, so a 3-shot kill at 600 rpm
// is 200 ms. A reload is added after every full magazine.
//
// With accuracy < 100 % the result is a distribution, not one number: each
// pellet hits with probability `acc`, a hit is a headshot with probability
// `hsr`. The distribution of "shots needed" comes from an exact dynamic
// program over the damage already dealt (no random sampling), so charts are
// stable and tests can compare exact numbers.

export const HP_PRESETS = Object.freeze([500, 750, 1000]);

/**
 * Wind-up before the first shot of every trigger pull that Census does not carry (fire_delay_ms is 0 or
 * missing there). Typed in by hand, keyed by weapon name. NSX Kuwa: the item text says it fires
 * "after a short windup"; 200 ms is the owner's value (6 Nov 2026). The wiki calls it the same wind-up
 * as the NSX Yumi, whose Census fire_delay_ms is 250.
 */
export const HAND_WINDUP = Object.freeze({ "NSX Kuwa": 200, "NSX-A Kuwa": 200 });

/**
 * Add the firing rhythm to a profile. `row` = assets/weapons/cadence.json entry
 * [burstCount, autoFireMs, refireMs, delayMs] from the hip fire mode in Census (fire_mode_2):
 * a trigger pull waits `delayMs` (wind-up), then fires `burstCount` shots `autoFireMs` apart (1 for
 * automatic / semi weapons), and the next pull can start `refireMs` after the last shot.
 * Automatic weapons keep firing every 60000 / rpm ms while the trigger is held.
 */
export function withCadence(p, row, name) {
  if (!p) return p;
  const [n, auto, refire, delay] = Array.isArray(row) ? row : [];
  const burstN = Number.isInteger(n) && n > 1 ? n : 1;
  const hand = HAND_WINDUP[String(name || "").trim()];
  const delayMs = Math.max(0, Number.isFinite(delay) && delay > 0 ? delay : hand || 0);
  if (burstN === 1 && !delayMs) return p;
  const out = { ...p, delayMs, delayHand: !(delay > 0) && !!hand };
  if (burstN > 1) {
    const autoMs = auto > 0 ? auto : 60000 / p.rpm;
    // profiles.json takes rpm from fire_refire_ms, which for a burst weapon is the wait between bursts: rpm is the in-burst rate here
    Object.assign(out, { burstN, autoMs, refireMs: refire > 0 ? refire : 60000 / p.rpm, rpm: Math.round(60000 / autoMs) });
  }
  return out;
}

/** Shots per minute over a whole magazine (bursts, wind-up and refire waits counted, reload not). */
export function effectiveRpm(p) {
  return p.mag * 60000 / (magPeriod(p) - p.reloadMs);
}

/**
 * Low frame rates slow the fire rate. Fitted curve from measurements (fire rate 600 rpm in the
 * chart: 30 FPS -> -24.6 %, 60 FPS -> -13.5 %, 120 FPS -> -6.7 %, 210 FPS -> -5.3 %):
 *   decrease = b1 * e^(b2 * fps) + b3 * rpm
 * with b1 = 0.451, b2 = -0.028, b3 = 8.56e-5. The b3 term is the floor: faster weapons lose
 * more even at high frame rates (600 rpm -> 5.1 %, 1000 rpm -> 8.6 %). The fit covers ~30-210 FPS;
 * the slider clamps to 30-500 FPS, so outside the fitted range the curve is just extended flat.
 */
export const FPS_LIMIT = Object.freeze({ b1: 0.451, b2: -0.028, b3: 8.56e-5, min: 30, max: 500, def: 60 });

/** Share of the fire rate lost at `fps` for a weapon firing `rpm` rounds per minute (0..0.9). */
export function fpsFireRateDrop(fps, rpm) {
  if (!(fps > 0) || !(rpm > 0)) return 0;
  const f = Math.min(FPS_LIMIT.max, Math.max(FPS_LIMIT.min, fps));
  const d = FPS_LIMIT.b1 * Math.exp(FPS_LIMIT.b2 * f) + FPS_LIMIT.b3 * rpm;
  return Math.min(0.9, Math.max(0, d));
}

/**
 * A copy of a profile with the FPS limit applied: every inter-shot wait stretches by 1 / (1 - drop),
 * so the fire rate (and with it DPS and time to kill) falls by the drop. Wind-up and reload are
 * fixed waits, not fire rate, so they are left alone. Returns the profile unchanged when off.
 */
export function withFpsLimit(p, fps) {
  if (!p || !(fps > 0)) return p;
  const drop = fpsFireRateDrop(fps, p.rpm);
  if (!(drop > 0)) return p;
  const s = 1 / (1 - drop);
  const out = { ...p, rpm: p.rpm * (1 - drop) };
  if (p.autoMs) out.autoMs = p.autoMs * s;
  if (p.refireMs) out.refireMs = p.refireMs * s;
  return out;
}

// time (ms from the trigger pull) of shot m (0-based) inside one magazine, trigger held / pulled again at once
function shotInMag(p, m) {
  const delay = p.delayMs || 0;
  if (!(p.burstN > 1)) return delay + m * 60000 / p.rpm;
  const pull = Math.floor(m / p.burstN), i = m % p.burstN;
  return pull * (delay + (p.burstN - 1) * p.autoMs + p.refireMs) + delay + i * p.autoMs;
}
// one magazine from trigger pull to the next magazine's trigger pull: last shot, wait to fire again, reload
function magPeriod(p) {
  return shotInMag(p, p.mag - 1) + (p.burstN > 1 ? p.refireMs : 60000 / p.rpm) + p.reloadMs;
}
export const MAX_SHOTS = 400;

/** Damage of one pellet/bullet at `range` metres (linear falloff between the two ranges). */
export function damageAt(p, range) {
  const { dmgMax, dmgMin, rangeMaxDmg, rangeMinDmg } = p;
  // Census records no falloff when the far range is 0: flat damage.
  if (!(rangeMinDmg > 0) || dmgMin === dmgMax) return dmgMax;
  if (range <= rangeMaxDmg) return dmgMax;
  if (range >= rangeMinDmg || rangeMinDmg <= rangeMaxDmg) return dmgMin;
  const k = (range - rangeMaxDmg) / (rangeMinDmg - rangeMaxDmg);
  return dmgMax + (dmgMin - dmgMax) * k;
}

/** Whole-number damage of a body / head hit at `range` (the game rounds each hit). */
export function hitDamage(p, range) {
  const body = Math.max(1, Math.round(damageAt(p, range)));
  const head = Math.max(body, Math.round(damageAt(p, range) * p.hsMult));
  return { body, head };
}

/**
 * Time in ms of shot number k (1-based), including reloads between magazines. The clock starts at the
 * trigger pull: a weapon with a wind-up fires its first shot after the wind-up, others at t = 0.
 */
export function timeOfShot(p, k) {
  const reloads = Math.floor((k - 1) / p.mag);
  if (!(p.burstN > 1) && !p.delayMs) return (k - 1) * 60000 / p.rpm + reloads * p.reloadMs;
  return reloads * magPeriod(p) + shotInMag(p, (k - 1) % p.mag);
}

// Distribution of the damage of ONE shot: each of `pellets` pellets misses
// (1 - acc), hits the body (acc * (1 - hsr)) or hits the head (acc * hsr).
// Returns [[damage, probability], ...] merged by damage value.
function shotOutcomes(pellets, body, head, acc, hsr) {
  const pm = 1 - acc, pb = acc * (1 - hsr), ph = acc * hsr;
  const logFact = [0];
  for (let i = 1; i <= pellets; i++) logFact[i] = logFact[i - 1] + Math.log(i);
  const out = new Map();
  for (let b = 0; b <= pellets; b++) {
    for (let h = 0; b + h <= pellets; h++) {
      const m = pellets - b - h;
      const lp = logFact[pellets] - logFact[b] - logFact[h] - logFact[m]
        + (b ? b * Math.log(pb) : 0) + (h ? h * Math.log(ph) : 0) + (m ? m * Math.log(pm) : 0);
      const pr = Math.exp(lp);
      if (!(pr > 0) || !Number.isFinite(pr)) continue;
      const d = b * body + h * head;
      out.set(d, (out.get(d) || 0) + pr);
    }
  }
  return [...out.entries()];
}

/**
 * Exact "kill by shot k" distribution.
 * opts: { range = 0, acc = 1, hsr = 0, hp = 500 }
 * Returns { cdf, ms, shotsMedian, ... } where cdf[i] is the probability the
 * target is dead by shot i + 1 and ms[i] the time of that shot.
 */
export function ttkDistribution(p, opts = {}) {
  const range = opts.range ?? 0;
  const acc = clamp01(opts.acc ?? 1);
  const hsr = clamp01(opts.hsr ?? 0);
  const hp = Math.max(1, Math.round(opts.hp ?? 500));
  const { body, head } = hitDamage(p, range);
  const outcomes = shotOutcomes(p.pellets, body, head, acc, hsr);
  const cdf = [], ms = [];
  // alive: damage so far (< hp) -> probability. Only a few damage totals are reachable (sums of body / head hits),
  // so a sparse map is far faster than a dense array over every health point, with the same exact result.
  let alive = new Map([[0, 1]]);
  let dead = 0;
  for (let k = 1; k <= MAX_SHOTS; k++) {
    const next = new Map();
    let newlyDead = 0;
    for (const [d, pd] of alive) {
      for (const [dmg, pr] of outcomes) {
        const nd = d + dmg;
        if (nd >= hp) newlyDead += pd * pr; else next.set(nd, (next.get(nd) || 0) + pd * pr);
      }
    }
    dead += newlyDead;
    cdf.push(Math.min(1, dead));
    ms.push(timeOfShot(p, k));
    alive = next;
    if (dead >= 0.9999) break;
    if (acc === 0) break;
  }
  return { cdf, ms, body, head, hp };
}

/** Time (ms) by which the kill has happened with probability q (0.5 = median). null = never within MAX_SHOTS. */
export function quantileMs(dist, q = 0.5) {
  for (let i = 0; i < dist.cdf.length; i++) if (dist.cdf[i] >= q - 1e-12) return dist.ms[i];
  return null;
}

/** Probability the kill is done by time t ms. */
export function chanceByMs(dist, t) {
  let c = 0;
  for (let i = 0; i < dist.ms.length; i++) { if (dist.ms[i] <= t) c = dist.cdf[i]; else break; }
  return c;
}

/** Fewest shots that can kill if every pellet hits (body, or head) - the ideal case. */
export function minShots(p, { range = 0, hp = 500, head = false } = {}) {
  const h = hitDamage(p, range);
  return Math.ceil(hp / ((head ? h.head : h.body) * p.pellets));
}

/** Ideal TTK in ms (every pellet hits): body-only or head-only. */
export function idealTtk(p, opts = {}) {
  return timeOfShot(p, minShots(p, opts));
}

/** Median TTK at (range, acc, hsr, hp). null when the weapon can't kill in MAX_SHOTS. */
export function medianTtk(p, opts = {}) {
  return quantileMs(ttkDistribution(p, opts), 0.5);
}

/** Damage per second: `burst` = one magazine's firing time only, `sustained` = reloads included. Body hits, all pellets land. */
export function dps(p, { range = 0 } = {}) {
  const { body } = hitDamage(p, range);
  const perShot = body * p.pellets;
  const magDmg = p.mag * perShot;
  const period = magPeriod(p);                   // pull -> last shot -> refire wait -> reload
  const burst = magDmg * 1000 / (period - p.reloadMs);
  const sustained = magDmg * 1000 / period;
  return { burst, sustained };
}

/** Ranges 0..max step `step` (metres). */
export function rangeAxis(max = 100, step = 2) {
  const xs = [];
  for (let r = 0; r <= max + 1e-9; r += step) xs.push(+r.toFixed(3));
  return xs;
}

/**
 * Median-TTK curve over `ranges`. Distributions only change when the rounded
 * damage changes, so results are cached on (body, head).
 */
export function ttkCurve(p, ranges, { acc = 1, hsr = 0, hp = 500, q = 0.5 } = {}) {
  const cache = new Map();
  return ranges.map((r) => {
    const { body, head } = hitDamage(p, r);
    const key = body + "/" + head;
    if (!cache.has(key)) cache.set(key, quantileMs(ttkDistribution(p, { range: r, acc, hsr, hp }), q));
    return cache.get(key);
  });
}

/** Which weapon (index) has the lowest TTK at each range; -1 for a tie or when none can kill. `tol` = relative tolerance for a tie. */
export function winnerStrip(curves, tol = 0.005) {
  const n = curves.length ? curves[0].length : 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    let best = -1, bestV = Infinity, tie = false;
    curves.forEach((c, w) => {
      const v = c[i];
      if (v == null) return;
      if (v < bestV * (1 - tol)) { best = w; bestV = v; tie = false; }
      else if (Math.abs(v - bestV) <= bestV * tol) tie = true;
    });
    out.push(tie || best < 0 ? -1 : best);
  }
  return out;
}

/** Relative difference: how much slower `v` is than `best`, as a percent of `best` (0 for the best). null if either is missing. */
export function slowerPct(v, best) {
  if (v == null || best == null || !(best > 0)) return null;
  return (v - best) / best * 100;
}

function clamp01(x) { return Math.min(1, Math.max(0, Number(x) || 0)); }
