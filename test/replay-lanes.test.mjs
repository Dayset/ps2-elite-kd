// Strip-stage layout (#105): slot geometry and lane assignment.
import test from "node:test";
import assert from "node:assert/strict";
import { STRIP, FRONT_L, FRONT_R, BACK_L, BACK_R, RIG_W, RIG_H, frontScale, coverOf, assignLanes } from "../replay/lanes.mjs";

// Soldier box in canvas x, facing-aware (rig x spans -145..+188).
const box = (x, scale, facing) => facing > 0
  ? [x - 145 * scale, x + 188 * scale] : [x - 188 * scale, x + 145 * scale];
const faceX = (x, scale, facing) => x - facing * 4 * scale;

test("front scale fits the strip budget (<=160 wide, <=180 tall)", () => {
  for (const es of [0.46, 0.5, 0.56]) {
    const s = frontScale(es);
    assert.ok(RIG_W * s <= 160, `width ${RIG_W * s} at enemyScale ${es}`);
    assert.ok(RIG_H * s <= 180, `height ${RIG_H * s} at enemyScale ${es}`);
  }
  assert.ok(RIG_W * STRIP.FRONT_SCALE <= 160 && RIG_H * STRIP.FRONT_SCALE <= 180);
});

test("six front slots fit side by side without overlap, walls inside the canvas", () => {
  const a = assignLanes({ nAllies: 6, nEnemies: 4, rival: true, enemyScale: 0.56, pairMode: true });
  const front = [a.main, ...a.allies.filter(p => p.lane === 0), a.rival, ...a.enemies.filter(p => p.lane === 0)];
  assert.equal(front.length, 6);
  const placed = [
    { ...a.main, facing: 1 }, ...a.allies.map((p, i) => ({ ...p, facing: 1 })),
    { ...a.rival, facing: -1 }, ...a.enemies.map(p => ({ ...p, facing: -1 })),
  ].filter(p => p.lane === 0);
  const boxes = placed.map(p => box(p.x, p.scale, p.facing));
  for (const [x0, x1] of boxes) { assert.ok(x0 >= 0 && x1 <= STRIP.W, `box ${x0}..${x1} outside canvas`); }
  const sorted = [...boxes].sort((p, q) => p[0] - q[0]);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i][0] > sorted[i - 1][1], "front soldier boxes overlap");
  // walls inside the canvas and covering no front-lane face
  for (const p of placed) {
    const c = coverOf(p.x, p.y, p.scale, p.facing);
    assert.ok(c.wall.x >= 0 && c.wall.x + c.wall.w <= STRIP.W, "wall outside canvas");
  }
  for (const p of placed) {
    const fx = faceX(p.x, p.scale, p.facing);
    for (const q of placed) {
      const c = coverOf(q.x, q.y, q.scale, q.facing);
      assert.ok(!(fx >= c.wall.x && fx <= c.wall.x + c.wall.w), "wall covers a front-lane face");
    }
  }
});

test("lane assignment counts: crowd and pair mode", () => {
  const crowd = assignLanes({ nAllies: 6, nEnemies: 5, rival: false, enemyScale: 0.5, pairMode: false });
  assert.equal(crowd.allies.filter(p => p.lane === 0).length, 2);
  assert.equal(crowd.allies.filter(p => p.lane === 1).length, 4);
  assert.equal(crowd.enemies.filter(p => p.lane === 0).length, 3);
  assert.equal(crowd.enemies.filter(p => p.lane === 1).length, 2);
  assert.equal(crowd.rival, null);
  const pair = assignLanes({ nAllies: 6, nEnemies: 4, rival: true, enemyScale: 0.5, pairMode: true });
  assert.equal(pair.rival.lane, 0);
  assert.equal(pair.rival.x, FRONT_R[0]);
  assert.equal(pair.enemies.filter(p => p.lane === 0).length, 2);
  assert.equal(pair.enemies.filter(p => p.lane === 1).length, 2);
  assert.equal(pair.main.x, FRONT_L[0]);
  // back lane is ~70% size and dimmed; front lane full brightness (crowd)
  for (const p of crowd.allies.filter(p => p.lane === 1)) assert.ok(p.dim && Math.abs(p.scale / STRIP.FRONT_SCALE - 0.7) < 1e-9);
  for (const p of crowd.allies.filter(p => p.lane === 0)) assert.ok(!p.dim && p.scale === STRIP.FRONT_SCALE);
  // pair-mode bots stay dimmed even on the front lane
  for (const p of pair.enemies) assert.ok(p.dim);
  assert.ok(!pair.rival.dim && !pair.main.dim);
  // no-allies cast: main alone on the left
  const solo = assignLanes({ nAllies: 0, nEnemies: 5, rival: false, enemyScale: 0.5, pairMode: false });
  assert.equal(solo.allies.length, 0);
  assert.equal(solo.main.x, FRONT_L[0]);
  assert.ok(BACK_L.length >= 4 && BACK_R.length >= 2);
});

test("coverOf matches the old makeCover geometry", () => {
  const c = coverOf(510, 333, 0.3, 1);
  assert.equal(c.wall.w, 310 * 0.3);
  assert.equal(c.wall.h, 370 * 0.3 + 8);
  assert.equal(c.wall.x, 510 - 30 - 310 * 0.3);
  assert.equal(c.hiddenX, c.wall.x + c.wall.w / 2);
  assert.equal(c.peekX, 510);
  const e = coverOf(770, 333, 0.3, -1);
  assert.equal(e.wall.x, 770 + 30);
});
