// Strip-stage slot layout (#105, pure, node-tested).
// The scene is a horizontal band: canvas 1280x400, one front lane (full size,
// full brightness) holding at most 6 fighters — 3 left (player side), 3 right
// (enemy side) — and at most one back lane, dimmed at ~70% size, for the crowd.
// Slots are innermost-first: the duel pair (main + rival) takes the two slots
// flanking the middle, so the duel is always on the front lane.
// Rig bounding box (replay/rigs.json, all factions within these): 334 wide, 523 tall.
export const STRIP = { W: 1280, H: 400, GROUND: 333, FRONT_SCALE: 0.30, BACK_K: 0.7, BACK_DY: -70 };
export const FRONT_L = [510, 330, 150];   // player side, innermost first (main takes [0])
export const FRONT_R = [770, 950, 1130];  // enemy side, innermost first (rival takes [0])
export const BACK_L = [110, 270, 430, 590];
export const BACK_R = [850, 1050];
export const RIG_W = 334, RIG_H = 523;

// Enemy size signal (Enemy iVi) rescaled into the strip budget: at the old
// 0.46–0.56 enemy scale the tallest rig (523 px) would break the 180 px cap,
// so the same relative variation rides on the 0.30 strip scale instead.
export function frontScale(enemyScale) {
  return STRIP.FRONT_SCALE * (enemyScale / 0.5);
}

// Cover tile for a soldier at (x, y) with scale and facing: same geometry
// player.js used before (tile on the far side from the enemy, top just under
// the eyes). player.js delegates to this so the tests see the same numbers.
export function coverOf(x, y, scale, facing) {
  const w = 310 * scale, h = 370 * scale + 8;
  const wx = facing > 0 ? x - 30 - w : x + 30;
  return { wall: { x: wx, y: y + 8, w, h }, hiddenX: wx + w / 2, peekX: x };
}

// Lane assignment for a cast. nAllies/nEnemies are the crowd counts (bots only;
// the rival is placed separately). Returns positions in cast order; player.js
// applies them (x, y, slot, home, lane, scale, dim).
// Dim rule: back lane dimmed, front lane full brightness — except in pair mode,
// where every bot stays dimmed (third parties stay background, #98) while the
// duelists are never dimmed.
export function assignLanes({ nAllies, nEnemies, rival, enemyScale, pairMode }) {
  const eScale = frontScale(enemyScale);
  const main = { lane: 0, x: FRONT_L[0], y: STRIP.GROUND, scale: STRIP.FRONT_SCALE, dim: false };
  const allies = [];
  for (let i = 0; i < nAllies; i++) {
    const front = i < FRONT_L.length - 1, x = front ? FRONT_L[1 + i] : BACK_L[i - (FRONT_L.length - 1)];
    allies.push({ lane: front ? 0 : 1, x, y: STRIP.GROUND + (front ? 0 : STRIP.BACK_DY),
      scale: STRIP.FRONT_SCALE * (front ? 1 : STRIP.BACK_K), dim: !front });
  }
  const enemies = [];
  const rightFront = rival ? FRONT_R.slice(1) : FRONT_R;
  for (let i = 0; i < nEnemies; i++) {
    const front = i < rightFront.length, x = front ? rightFront[i] : BACK_R[i - rightFront.length];
    enemies.push({ lane: front ? 0 : 1, x, y: STRIP.GROUND + (front ? 0 : STRIP.BACK_DY),
      scale: eScale * (front ? 1 : STRIP.BACK_K), dim: pairMode ? true : !front });
  }
  const rivalPos = rival ? { lane: 0, x: FRONT_R[0], y: STRIP.GROUND, scale: eScale, dim: false } : null;
  return { main, allies, enemies, rival: rivalPos };
}
