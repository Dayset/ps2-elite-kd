import test from "node:test";
import assert from "node:assert/strict";
import { baseRate, speedAt, bulletRate, nextKillAt, calmStretchEnd } from "../replay/director.mjs";

test("speedAt table: calm x2, combat x1, pre-kill x0.5, bullet time x0.2", () => {
  for (const s of ['running', 'respawnTimer', 'beingRevived', 'idle', 'reposition', 'reloading', 'travel', 'revived', 'aftermath'])
    assert.equal(speedAt(s, null, null), 2, s);
  for (const s of ['fight', 'assist', 'trading', 'dying', 'respawn', 'inVehicle', 'healing', 'reviving', 'resupplying', 'repairing', 'capturing', 'unknown'])
    assert.equal(speedAt(s, null, null), 1, s);
  assert.equal(speedAt('fight', 1.5, null), 0.5);
  assert.equal(speedAt('fight', 1.49, null), 0.5);
  assert.equal(speedAt('fight', 1.51, null), 1);
  assert.equal(speedAt('idle', 1.0, null), 0.5); // pre-kill anticipation wins over calm x2
  assert.equal(speedAt('fight', null, 'kill'), 0.2);
  assert.equal(speedAt('fight', null, 'death'), 0.2);
  assert.equal(speedAt('idle', null, 'kill'), 0.2);
});

test("bulletRate envelope: ramp in 0.15, hold 0.6, ramp out 0.3", () => {
  assert.equal(bulletRate(null), 1);
  assert.equal(bulletRate(-1), 1);
  assert.equal(bulletRate(0), 1);
  assert.ok(bulletRate(0.075) > 0.2 && bulletRate(0.075) < 1);
  assert.equal(bulletRate(0.15), 0.2);
  assert.equal(bulletRate(0.5), 0.2);
  assert.equal(bulletRate(0.75), 0.2);
  assert.ok(bulletRate(0.9) > 0.2 && bulletRate(0.9) < 1);
  assert.equal(bulletRate(1.05), 1);
  assert.equal(bulletRate(2), 1);
});

test("nextKillAt: next fight/dying end after t, null when none", () => {
  const segs = [{ id: 'idle', t0: 0, t1: 10 }, { id: 'fight', t0: 10, t1: 13 }, { id: 'idle', t0: 13, t1: 20 }, { id: 'dying', t0: 20, t1: 23.2 }];
  assert.equal(nextKillAt(segs, 5), 13);
  assert.equal(nextKillAt(segs, 11), 13);
  assert.equal(nextKillAt(segs, 13), 23.2);
  assert.equal(nextKillAt(segs, 30), null);
  assert.equal(nextKillAt([{ id: 'assist', t0: 0, t1: 5 }], 0), null); // assists are not kill moments
});

test("calmStretchEnd: consecutive x2 only, longer than 20 data s", () => {
  const segs = [{ id: 'running', t0: 0, t1: 15 }, { id: 'idle', t0: 15, t1: 30 }, { id: 'fight', t0: 30, t1: 33 }];
  assert.equal(calmStretchEnd(segs, 0), 30); // 30 s stretch
  assert.equal(calmStretchEnd(segs, 12), null); // 18 s left
  assert.equal(calmStretchEnd(segs, 20), null); // 10 s left
  const short = [{ id: 'idle', t0: 0, t1: 10 }, { id: 'fight', t0: 10, t1: 12 }];
  assert.equal(calmStretchEnd(short, 0), null);
  const gap = [{ id: 'idle', t0: 0, t1: 15 }, { id: 'trading', t0: 15, t1: 18 }, { id: 'idle', t0: 18, t1: 40 }];
  assert.equal(calmStretchEnd(gap, 0), null); // trading breaks the stretch
});
