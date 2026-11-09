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
 * Low frame rates slow the fire rate. The chart's data ends at ~210 FPS, and the fitted
 * exponential-plus-floor curve levels off at 5.1 % (600 rpm) — but a constant loss at
 * arbitrarily high frame rates is physically implausible, and the flattening is treated as
 * measurement error in the chart (the 95 % HDI band is too wide to tell it from a continued
 * decline). The mechanism is frame quantisation: each shot waits for the next frame, so the
 * fractional loss scales with the fire rate and inversely with the frame rate — a 1/fps law:
 *   decrease = k * rpm / fps,  k = 0.0132
 * fitted to the chart's mean curve at 600 rpm (least squares: loss % = 790 / fps).
 * At 600 rpm: 30 FPS -> 26.4 %, 60 FPS -> 13.2 %, 120 FPS -> 6.6 %, 210 FPS -> 3.8 %,
 * 500 FPS -> 1.6 % — the loss vanishes as the frame rate rises, as it should. The fps clamp
 * below is only the slider's range (30-1000); the law itself has no floor.
 */
export const FPS_LIMIT = Object.freeze({ k: 0.0132, min: 30, max: 1000, def: 60 });

/** Share of the fire rate lost at `fps` for a weapon firing `rpm` rounds per minute (0..0.9). */
export function fpsFireRateDrop(fps, rpm) {
  if (!(fps > 0) || !(rpm > 0)) return 0;
  const f = Math.min(FPS_LIMIT.max, Math.max(FPS_LIMIT.min, fps));
  return Math.min(0.9, Math.max(0, FPS_LIMIT.k * rpm / f));
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

/** Legs take 0.9x damage (EmperorDorf's LSM); KCAP ammunition flips them to 1.2x (p.legMult). */
export const LEG_MULT = 0.9;

/** Damage of a body / head / leg hit at `range`, unrounded: the falloff value accumulates as a
 * float, the way EmperorDorf's workbook does it. Rounding per hit invents shot-count errors at
 * falloff boundaries — the Gauss at 56 m is 8 shots (7 x 142.85 = 999.95), not 7 — and the same
 * boundary can bite any other gun, so nothing rounds. The Math.max guards only keep a hit at 1+. */
export function hitDamage(p, range) {
  const base = damageAt(p, range);
  const body = Math.max(1, base);
  const head = Math.max(body, base * p.hsMult);
  const leg = Math.max(1, base * (p.legMult ?? LEG_MULT));
  return { body, head, leg };
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
 * Histogram of the time to kill from an exact distribution (Dorf's TTK Histogram, exact instead of
 * sampled): bins of `binMs` ms, each { t, p, cum } — the share of kills whose time falls in the bin
 * and the cumulative share. The distribution is discrete over shot times, so a bin collects the shots
 * whose time lands in it; the last bin holds everything past `maxMs` plus the share that never kills.
 */
export function ttkHistogram(dist, binMs = 125, maxMs = 3000) {
  const n = Math.max(1, Math.ceil(maxMs / binMs));
  const bins = Array.from({ length: n + 1 }, (_, i) => ({ t: i * binMs, p: 0, cum: 0 }));
  let prev = 0;
  for (let i = 0; i < dist.cdf.length; i++) {
    const mass = dist.cdf[i] - prev; prev = dist.cdf[i];
    const b = dist.ms[i] > maxMs ? n : Math.min(n - 1, Math.floor(dist.ms[i] / binMs));
    bins[b].p += mass;
  }
  bins[n].p += 1 - (dist.cdf[dist.cdf.length - 1] ?? 0);
  let cum = 0;
  for (const b of bins) { cum += b.p; b.cum = cum; }
  return bins;
}

/**
 * Histogram of the shots to kill from an exact distribution: [{ k, p, cum }] for k = 1..maxK, plus a
 * ">maxK" tail that holds the share needing more shots, including the share that never kills.
 */
export function stkHistogram(dist, maxK = 25) {
  const bins = Array.from({ length: maxK + 1 }, (_, i) => ({ k: i + 1, p: 0, cum: 0 }));
  let prev = 0;
  for (let i = 0; i < dist.cdf.length; i++) {
    const mass = dist.cdf[i] - prev; prev = dist.cdf[i];
    const k = i + 1;
    bins[k > maxK ? maxK : k - 1].p += mass;
  }
  bins[maxK].p += 1 - (dist.cdf[dist.cdf.length - 1] ?? 0);
  let cum = 0;
  for (const b of bins) { cum += b.p; b.cum = cum; }
  return bins;
}

// Dorf's TTK bands (Weapon Surgeon): Green = the 15th-percentile TTK across his 40-weapon reference
// set at each distance (CX34:CX55); Yellow = the geometric mean of the class-average TTKs (CW34:CW55 —
// the live formula behind his stored Yellow values, which are stale past ~50 m and run to 12.8 s at
// 200 m). The labels Recommended / Not recommended / Avoid are not in the workbook at all; they are
// our reading of Green / Yellow / above Yellow. Linear interpolation between his 22 distances.
const DEEP_BAND_RANGES = [1, 3, 5, 7, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 125, 150, 175, 200];
const DEEP_BAND_GREEN = [449.8, 449.8, 449.8, 467.5, 480.0, 540.1, 599.6, 622.3, 656.1, 725.5, 765.1, 813.4, 901.0, 1027.3, 1094.5, 1197.4, 1289.1, 1311.9, 1311.9, 1311.9, 1311.9, 1311.9];
const DEEP_BAND_YELLOW = [528.5, 528.5, 528.7, 591.7, 628.3, 716.5, 850.4, 944.6, 1044.5, 1167.2, 1316.6, 1455.4, 1579.2, 1801.6, 2047.9, 2228.9, 2379.4, 2497.6, 2849.3, 3407.2, 4177.5, 5878.4];
export function deepBands(range) {
  const interp = (arr) => {
    if (range <= DEEP_BAND_RANGES[0]) return arr[0];
    for (let i = 1; i < DEEP_BAND_RANGES.length; i++) {
      if (range <= DEEP_BAND_RANGES[i]) {
        const f = (range - DEEP_BAND_RANGES[i - 1]) / (DEEP_BAND_RANGES[i] - DEEP_BAND_RANGES[i - 1]);
        return arr[i - 1] + f * (arr[i] - arr[i - 1]);
      }
    }
    return arr[arr.length - 1];
  };
  return { green: interp(DEEP_BAND_GREEN), yellow: interp(DEEP_BAND_YELLOW) };
}

/**
 * Median-TTK curve over `ranges`. Distributions only change when the damage changes,
 * so results are cached on (body, head).
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
