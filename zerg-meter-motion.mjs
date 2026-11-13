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
export const RISE_TAU_MS = 250;
export const FALL_TAU_MS = 800;

/** Stateful motion: createMotion().update(target, nowMs) → displayed value. */
export function createMotion({ riseTauMs = RISE_TAU_MS, fallTauMs = FALL_TAU_MS } = {}) {
  let displayed = null;
  let last = null;
  return {
    get displayed() {
      return displayed;
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
      const tau = t > displayed ? riseTauMs : fallTauMs;
      displayed += (t - displayed) * (1 - Math.exp(-dt / tau));
      if (Math.abs(t - displayed) < 0.005) displayed = t;
      return displayed;
    },
  };
}
