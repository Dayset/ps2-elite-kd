// 🪳 Zerg meter (zerg-meter.html): pure geometry + motion. No DOM, no network.
// The meter is the clean LED bar (assets/zerg-meter-bg.jpg, 480×2239): the
// glowing bar with the 0–100 scale on its right, on pure black. The roach
// (assets/zerg-roach.png, 360×360, white outline baked in) rides the bar;
// a short red laser line at the roach's eye level marks the precise value
// against the scale. No display window on this version — the laser IS the
// readout (owner 2026-11-13, "clean meter version" replaces the device photo).
//
// Geometry, measured off the image 2026-11-13 (fractions of the image):
// - scale labels ("100" … "0") sit at y 3.53% … 96.23% (digit-blob centres,
//   linear to 0.4 units), so y(v) = Y0 − v·(Y0−Y100)/100.
// - LED bar centre x 35.3%; scale digits start x ≈ 62.7% ("100").
// - roach display width 35% of the image width: its content (15.6–84.2% of
//   the sprite) then spans 23.3–47.3% — clear of the numbers — and its
//   content fits inside the image at both v=0 and v=100.
// - eye level: the two eyes sit at 42.4% / 40.3% of the sprite height;
//   the laser runs at their mean, 41.4%, from just behind the face
//   (x 46%) to just left of the digits (x 61.5%).
export const METER = {
  /** Scale anchors: image-height fractions of the "100" and "0" label centres. */
  y100: 0.0353,
  y0: 0.9623,
  /** LED bar centre, fraction of image width. */
  barX: 0.3527,
  /** Laser line: left/right, fractions of image width. */
  laser: { x0: 0.46, x1: 0.615 },
  /** Roach display width, fraction of image width (sprite is square). */
  roachW: 0.35,
  /** Eye line, fraction of the sprite height from its top. */
  eyeY: 0.414,
  /** Image aspect (width ÷ height). */
  aspect: 480 / 2239,
};

/** Clamp a Zerg score to the meter's 0–100 scale. Non-finite → null (no reading). */
export function clampZerg(v) {
  if (!Number.isFinite(v)) return null;
  return Math.min(100, Math.max(0, v));
}

/**
 * The meter's reading (owner 2026-11-13): the last opponent's lifetime 🪳
 * once one is known — the victim's on a kill, the killer's on a death —
 * else the followed player's lifetime 🪳 as the resting position (null when
 * neither exists). The session value it replaced changed too slowly to
 * read live (anchored) and pinned near 0 whenever the session's mean enemy
 * was at the player's own level (plain session); the last opponent's own
 * score moves on every fight, by construction.
 *
 * "Last" is refreshed every second (owner 2026-11-13): the page polls
 * Census characters_event for the followed player's latest KILL and latest
 * DEATH and takes the newer — so the meter catches up on load (it shows
 * the last fight even if it happened before the page opened) and can never
 * freeze on a stale value if the live stream stalls. The stream is kept
 * for instant updates; both sources feed the fight queue below.
 *
 * Queue (owner 2026-11-13): every kill and death gets its turn on the
 * meter — no fight is skipped when several land at once, and kills and
 * deaths are both in it. The queue plays them in fight order, one per
 * dwell (2 s), oldest first; the title says which it was ("killed X" vs
 * "killed by Y") because the number alone can't tell them apart.
 *
 * Odometer counter (owner 2026-11-13): a simple odometer-style Zerg
 * value counter underneath the meter — black housing, white digits on
 * black wheels, like a car odometer. It shows the same value the roach
 * and the laser show, rounded to a whole number (000–100); the title
 * carries the decimal. A dash when there is no value yet.
 *
 * Decay (owner 2026-11-13): 10 s with no kills or deaths, then the next
 * 10 s sinking (or rising) back to the followed player's own lifetime 🪳
 * on a slow linear glide — gradually, not the fall motion — and the laser
 * goes blue. When the meter goes back to blue the marks clear and the
 * notch counter resets to 0, so the next burst starts at 1; a new fight
 * interrupts the glide at once. Marks (owner 2026-11-13): on a kill or death the roach leaves
 * a laser mark at that level — placed when the roach ARRIVES there (not
 * when the fight starts showing, while the roach is still travelling),
 * or when it departs to the next fight, whichever comes first — plus a
 * further 1 s delay (owner 2026-11-13), so the mark lands a second after
 * the roach is there; a kill or death mark stays 10 s from placement, an
 * unknown mark 4 s, then disappears outright. Each mark carries a small
 * queue number beside it in the mark's colour — its position among the
 * marks on screen (1 for the oldest visible mark, then 2, 3, …) — but
 * only while multiple marks are visible; a lone mark carries no number.
 * When a mark expires the rest renumber, and when all marks are gone the
 * count is 0 and the next mark is 1 again. Unknown
 * opponents (owner 2026-11-13): a killer or victim with no lifetime 🪳
 * still joins the queue — when it shows, the roach mirrors horizontally
 * back and forth a few times (an indicator of unknown value) and leaves
 * a laser mark at the level it's standing on, and the title reads
 * "Zerg ?" instead of a number.
 */
export function meterValue(lifeZerg, zerg) {
  if (Number.isFinite(zerg)) return zerg;
  if (Number.isFinite(lifeZerg)) return lifeZerg;
  return null;
}

/**
 * Parse one characters_event row into the meter's "last fight" shape.
 * kind is which query returned it: "kill" (the followed player is the
 * attacker, so the opponent is the victim in character_id) or "death"
 * (the followed player is the victim, so the opponent is the killer in
 * attacker_character_id). Returns null when the row has no opponent or
 * no usable timestamp. Pure — unit-tested in test/zerg-meter.test.mjs.
 */
export function parseLastEventRow(row, kind) {
  if (!row || typeof row !== "object") return null;
  const opp = kind === "kill" ? row.character_id : kind === "death" ? row.attacker_character_id : null;
  const ts = Number(row.timestamp);
  if (typeof opp !== "string" || !/^[1-9]\d*$/.test(opp)) return null;
  if (!Number.isFinite(ts)) return null;
  return { opp, ts, kind };
}

/**
 * The fight queue: every kill and death gets its turn on the meter, in
 * fight order, one per dwell. offer() dedups (the stream and the 1 s poll
 * deliver the same fight twice) and inserts by timestamp, so a slow
 * lookup can't reorder two fights; entries past the cap drop the oldest.
 * tick(nowMs) returns the entry to show now, or null to keep showing the
 * current one (queue empty, or the dwell hasn't elapsed). Pure — the page
 * only feeds it opponents whose name resolved (zerg known, or null for
 * an unknown opponent) and applies what tick() returns. Unit-tested in
 * test/zerg-meter.test.mjs.
 */
export function createFightQueue({ dwellMs = 2000, max = 20 } = {}) {
  const entries = []; // { opp, ts, kind, zerg, name }, sorted by ts
  const seen = new Set(); // "opp:ts" — one showing per fight
  let current = null;
  let currentSince = null;
  function offer(e) {
    // zerg may be null: an unknown opponent (no lifetime 🪳) still joins
    // the queue — it shows as a mirror event, not a number.
    if (!e || typeof e.opp !== "string" || !Number.isFinite(e.ts)) return false;
    const key = `${e.opp}:${e.ts}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size > 200) { let n = 0; for (const k of seen) { seen.delete(k); if (++n >= 100) break; } }
    let i = entries.length;
    while (i > 0 && entries[i - 1].ts > e.ts) i--;
    entries.splice(i, 0, e);
    while (entries.length > max) entries.shift();
    return true;
  }
  function tick(nowMs) {
    if (!entries.length) return null;
    if (current == null || nowMs - currentSince >= dwellMs) {
      current = entries.shift();
      currentSince = nowMs;
      return current;
    }
    return null;
  }
  return { offer, tick, get size() { return entries.length; }, get current() { return current; }, get currentSince() { return currentSince; } };
}

/** Idle window after the last shown fight before the meter fades down to rest. */
export const FADE_IDLE_MS = 10000;

/**
 * True when the meter has sat on one fight with an empty queue for the
 * whole idle window: time to fade down to rest. Pure — unit-tested in
 * test/zerg-meter.test.mjs.
 */
export function shouldFadeDown({ queueEmpty, hasCurrent, currentSinceMs, nowMs, faded }) {
  return queueEmpty && hasCurrent && currentSinceMs != null && !faded && nowMs - currentSinceMs >= FADE_IDLE_MS;
}

/** How close the roach must be to a fight's level before it leaves the mark there (one Zerg point — visually on the line). */
export const MARK_ARRIVE_EPS = 1.0;

/** True when the roach has arrived at a level (visually on it). Pure — unit-tested in test/zerg-meter.test.mjs. */
export function hasArrived(shown, target) {
  return shown != null && target != null && Math.abs(shown - target) <= MARK_ARRIVE_EPS;
}

/** Tab title for the fight on display — kills and deaths read differently. An unknown value reads "?" (never a number that isn't the opponent's). */
export function fightTitle(kind, name, value) {
  const v = Number.isFinite(value) ? value.toFixed(1) : "?";
  if (kind === "kill") return `🪳 killed ${name} — Zerg ${v}`;
  if (kind === "death") return `🪳 killed by ${name} — Zerg ${v}`;
  return `🪳 ${name} Zerg ${v}`;
}

/** Odometer counter: the displayed value as 3 wheels (000–100), rounded
    to a whole number; null when there is no value yet (the wheels show
    dashes). The title carries the decimal; the counter is the whole
    number. Pure — unit-tested in test/zerg-meter.test.mjs. */
export function odoDigits(value) {
  if (value == null || Number.isNaN(value)) return null;
  const n = Math.max(0, Math.min(100, Math.round(value)));
  return String(n).padStart(3, "0");
}

/** Value → height fraction (0 = top of the image) of the value's level. */
export function valueToY(v) {
  const c = clampZerg(v);
  if (c == null) return null;
  return METER.y0 - (c / 100) * (METER.y0 - METER.y100);
}

/** Roach height, fraction of the image height (square sprite, image aspect). */
export function roachHeight() {
  return METER.roachW * METER.aspect;
}

/** Roach top (fraction of image height) that puts its eyes on the value's level. */
export function roachTop(v) {
  const y = valueToY(v);
  if (y == null) return null;
  return y - METER.eyeY * roachHeight();
}

// DPS-meter motion (owner 2026-11-13): the position jumps up, more slowly
// than instant, then slides down. Exponential approach with a different
// time constant per direction — rise τ 250 ms (a slowed jump, ~95% in
// ~0.75 s), fall τ 800 ms (a slide, ~95% in ~2.4 s). The displayed value
// is what the roach and the laser both show, so the two never disagree.
// Decay (owner 2026-11-13): after 10 s with no fights, the meter takes
// the NEXT 10 s to sink (or rise) back to the player's own value — a slow
// linear glide, not the fall motion — so it descends gradually instead of
// dropping in ~2 s.
export const RISE_TAU_MS = 250;
export const FALL_TAU_MS = 800;
export const DECAY_MS = 10000;

/** Stateful motion: createMotion().update(target, nowMs) → displayed value. */
export function createMotion({ riseTauMs = RISE_TAU_MS, fallTauMs = FALL_TAU_MS } = {}) {
  let displayed = null;
  let last = null;
  let decay = null; // { from, to, startMs, durationMs } — a slow linear glide back to rest
  return {
    get displayed() {
      return displayed;
    },
    // Start a slow, gradual glide from the current displayed value to `to`
    // over `durationMs` (the decay back to the player's own value, whether
    // that means sinking or rising). While a decay is active, update()
    // follows the ramp, not the exponential approach.
    startDecay(to, durationMs, nowMs) {
      if (displayed == null) { displayed = to; return; }
      decay = { from: displayed, to, startMs: nowMs, durationMs };
    },
    // A new fight interrupts the decay at once — the exponential approach
    // to the new fight's value takes over from wherever the roach is.
    cancelDecay() {
      decay = null;
    },
    update(target, nowMs) {
      const t = clampZerg(target);
      if (t == null) return displayed;
      if (displayed == null || last == null) {
        displayed = t;
        last = nowMs;
        return displayed;
      }
      const dt = Math.max(0, nowMs - last);
      last = nowMs;
      if (dt === 0) return displayed;
      if (decay) {
        const p = (nowMs - decay.startMs) / decay.durationMs;
        if (p >= 1) { displayed = decay.to; decay = null; }
        else displayed = decay.from + (decay.to - decay.from) * p;
        return displayed;
      }
      const tau = t > displayed ? riseTauMs : fallTauMs;
      displayed += (t - displayed) * (1 - Math.exp(-dt / tau));
      if (Math.abs(t - displayed) < 0.005) displayed = t;
      return displayed;
    },
  };
}
