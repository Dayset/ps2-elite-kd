// 🎬 Stage and camera for two duelists (#100, pure): the camera frames
// both duelists and zooms with the engagement phase (out at long range,
// in as range closes), cover varies per engagement by seed, and the
// respawning duelist runs in from off-screen in cover-to-cover hops.
//
// Range is in metres, illustrative (the plan has no world units): trade is
// far, commit is near. The hit model reads it through rangeFactor, which
// is bounded and mild so a phase's efficiency moves without moving the
// engagement's outcome (the winner is pre-rolled) or the gap budget.
import { STRIP } from './lanes.mjs';

export const W = STRIP.W, GROUND = STRIP.GROUND;
export const KINDS = ['crate', 'rock', 'lowwall', 'doorway'];
export const CORPSE_KEEP = 4; // data s a duelist's body stays visible after death
export const OFFSCREEN = 300; // px past the canvas edge where a respawn starts

// Range (m) by engagement phase: trade far, commit near.
export function rangeFor(phase) {
  switch (phase) {
    case 'trade': return 40;
    case 'commit': return 12;
    case 'approach': return 55;
    case 'spot': return 40;
    default: return 12; // resolution, aftermath, gap
  }
}

// Hit-probability factor for a range: near hits harder, far hits softer,
// bounded so neither phase runs away (12 m → 1.13, 40 m → 0.85, 60 m → 0.75).
export function rangeFactor(m) {
  return Math.min(1.2, Math.max(0.75, 1.25 - m / 100));
}

// Camera scale by phase: zoomed out at long range, closer as range closes.
export function camScaleFor(phase) {
  switch (phase) {
    case 'trade': return 0.85;
    case 'commit': return 1.18;
    case 'approach': case 'spot': return 0.95;
    case 'resolution': return 1.1;
    default: return 1.0; // aftermath, gap
  }
}

// cameraFor({ ax, bx, phase, w, margin }): { scale, left, top } framing
// both points. The view is centred on the points' midpoint; the scale is
// the phase target, clamped so both points stay inside the frame with a
// margin for the soldier + his wall. Render with scale(s) then
// translate(-left, -top), so canvasX = (worldX - left) × scale.
export function cameraFor({ ax, bx, phase, w = W, h = STRIP.H, margin = 150 }) {
  const span = Math.abs(bx - ax) + 2 * margin;
  const scale = Math.min(camScaleFor(phase), w / span);
  const mid = (ax + bx) / 2;
  // Vertical anchor: the frame is centred on GROUND − 83 (between the
  // head and the ground), not on the ground itself — at commit zoom a
  // ground-centred frame clips the duelists' name tags and HP bars off
  // the top edge. The transient 3-line status stack can still lose its
  // top line at close zoom; the fighters and their overheads never do.
  return { scale, left: mid - w / (2 * scale), top: (GROUND - 83) - h / (2 * scale) };
}

// Cover kinds for one engagement, by its index: the two duelists never
// share a tile in the same engagement.
export function coverKinds(idx) {
  return { a: KINDS[((idx % 4) + 4) % 4], b: KINDS[((idx + 1) % 4 + 4) % 4] };
}

// Hop-cover kinds for an approach path: each hop differs from the last.
export function hopKinds(idx, n) {
  return Array.from({ length: n }, (_, i) => KINDS[((idx + i) % 4 + 4) % 4]);
}

// Deterministic jitter in [-40, 40] from (idx, hop): a hash, not Math.random.
function jitter(idx, hop) {
  let h = (idx * 374761393 + hop * 668265263) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0; h = Math.imul(h, 1274126177) >>> 0; h = (h ^ (h >>> 16)) >>> 0;
  return (h / 4294967295 - 0.5) * 80;
}

// approachPath(eng, slotX, side): the respawner's cover-to-cover run from
// off-screen to his slot. Hops: 2 for short approaches, 3 for long ones.
export function approachPath(eng, slotX, side) {
  const approach = eng.segments.find((s) => s.phase === 'approach');
  const dur = approach ? approach.t1 - approach.t0 : 2;
  const start = side === 'a' ? -OFFSCREEN : W + OFFSCREEN;
  const fracs = dur > 3 ? [0.3, 0.55, 0.8] : [0.4, 0.75];
  const hops = fracs.map((f, i) => start + (slotX - start) * f + jitter(eng.idx, i));
  return { start, hops, end: slotX, t0: approach ? approach.t0 : eng.t0, t1: approach ? approach.t1 : eng.t0 };
}

// approachX(path, t): x along the path at data time t. Each hop moves in
// its first 70% and pauses 30% (behind cover), with smoothstep easing.
export function approachX(path, t) {
  const pts = [path.start, ...path.hops, path.end];
  const n = pts.length - 1, u = Math.min(1, Math.max(0, (t - path.t0) / Math.max(1e-6, path.t1 - path.t0)));
  const local = u * n, i = Math.min(n - 1, Math.floor(local)), f = local - i;
  const move = f < 0.7 ? f / 0.7 : 1, e = move * move * (3 - 2 * move);
  return pts[i] + (pts[i + 1] - pts[i]) * e;
}

// Off-screen x where a respawning side starts (A from the left, B right).
export function offScreenX(side) {
  return side === 'a' ? -OFFSCREEN : W + OFFSCREEN;
}
