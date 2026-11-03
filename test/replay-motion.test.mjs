// Pose tests for the #99 motion pass: every new state produces finite numbers and
// keeps its parts attached (bounded offsets). pose() needs no rig or canvas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Soldier } from '../replay/soldier.js';

const D = Math.PI / 180;
const mk = (state, o = {}) => { const s = new Soldier(null, 'tr', { seed: 1.3, rate: 10, ...o }); s.set(state, 0); return s; };
const poseAt = (s, t) => s.pose(t);

test('strafe: ADAD sway flips sign, stays within 20-40 rig px', () => {
  const s = mk('shoot');
  const xs = [];
  for (let tl = 0; tl <= 3; tl += 0.02) xs.push(poseAt(s, tl).dx);
  assert.equal(poseAt(s, 0).dx, 0);
  assert.ok(Math.max(...xs) >= 20 && Math.min(...xs) <= -20, 'both directions reached');
  assert.ok(xs.every((x) => Number.isFinite(x) && Math.abs(x) <= 40.001));
  const other = mk('shoot', { seed: 2.9 });
  const diff = Math.max(...xs.map((x, i) => Math.abs(x - poseAt(other, i * 0.02).dx)));
  assert.ok(diff > 1, 'different seeds strafe differently');
});

test('peek: crouch falls as the soldier rises, aim settles within 0.15-0.3 s', () => {
  const s = mk('peek');
  assert.ok(poseAt(s, 0).bob > poseAt(s, 0.2).bob && poseAt(s, 0.2).bob > poseAt(s, 0.4).bob);
  assert.equal(poseAt(s, 0).aimErr, 1);
  assert.equal(poseAt(s, 0.35).aimErr, 0);
});

test('reload: gun drops, swaps, rises over the real reloadMs', () => {
  const s = mk('reload', { reloadMs: 2000 });
  assert.equal(poseAt(s, 0).gun.dy, 0);
  assert.ok(poseAt(s, 1.0).gun.dy > 20);
  assert.ok(Math.abs(poseAt(s, 2.0).gun.dy) < 0.01);
  const fast = mk('reload', { reloadMs: 1000 });
  assert.ok(Math.abs(poseAt(fast, 1.0).gun.dy) < 0.01);
});

test('idle reload overlay follows reloadMs, not a fixed 1.4 s', () => {
  const s = mk('idle', { reloadAt: 10, reloadMs: 2000 });
  assert.ok(poseAt(s, 10.5).gun.dy > 0);
  assert.equal(poseAt(s, 12.5).gun.dy, 0);
});

test('auto burst rhythm: recoil climbs inside a burst and resets in the pause', () => {
  const s = mk('shoot', { mode: 'auto', rate: 10 });
  const kick0 = Math.abs(poseAt(s, 0.02).gun.dx);
  const kick3 = Math.abs(poseAt(s, 0.32).gun.dx);
  assert.ok(kick3 > kick0, `shot 3 kick ${kick3} should exceed shot 0 kick ${kick0}`);
  assert.equal(poseAt(s, 0.5).flash, 0);
  assert.ok(Math.abs(poseAt(s, 0.5).gun.dx) < 1e-9, 'kick resets in the pause');
  assert.ok(poseAt(s, 0.01).flash > 0);
});

test('semi taps repeat the same kick; bolt chambers after the shot', () => {
  const semi = mk('shoot', { mode: 'semi', rate: 10 });
  assert.ok(Math.abs(Math.abs(poseAt(semi, 0.01).gun.dx) - Math.abs(poseAt(semi, 0.46).gun.dx)) < 1e-9);
  assert.ok(Math.abs(poseAt(semi, 0.3).gun.dx) < 1e-9);
  const bolt = mk('shoot', { mode: 'bolt', rate: 10 });
  assert.ok(poseAt(bolt, 0.01).gun.rot < 0, 'kick back at the shot');
  assert.ok(poseAt(bolt, 0.3).gun.rot > 10 * D, 'chamber lift after the shot');
});

test('hurt: low health hunches and strides slower', () => {
  const healthy = mk('idle', { hp: 1 });
  const hurt = mk('idle', { hp: 0.2 });
  assert.ok(poseAt(hurt, 5).torso.rot > poseAt(healthy, 5).torso.rot);
  const firstStride = (hp) => {
    const s = mk('run', { seed: 0, hp });
    for (let tl = 0; tl <= 2; tl += 0.005) if (poseAt(s, tl).legL.dy < -25) return tl;
    return Infinity;
  };
  assert.ok(firstStride(0.2) > firstStride(1), 'hurt stride takes longer to peak');
});

test('flinch staggers sideways during the 0.22 s window only', () => {
  const s = mk('idle', { flinchAt: 10 });
  assert.ok(Math.abs(poseAt(s, 10.055).dx) >= 3);
  assert.equal(poseAt(s, 10.5).dx, 0);
});

test('hop: a 0.7 s arc that lands back on the ground', () => {
  const s = mk('hop');
  assert.ok(Math.abs(poseAt(s, 0).bob) < 1e-9);
  assert.ok(poseAt(s, 0.35).bob < -50);
  assert.ok(Math.abs(poseAt(s, 0.8).bob) < 0.01);
});

test('search: head sweeps both ways, gun follows at half', () => {
  const s = mk('search');
  let lo = 0, hi = 0;
  for (let t = 0; t <= 5.6; t += 0.05) {
    const p = poseAt(s, t);
    lo = Math.min(lo, p.head.rot); hi = Math.max(hi, p.head.rot);
    assert.ok(Math.abs(p.gun.rot - 0.5 * p.head.rot) < 1e-9);
  }
  assert.ok(lo < -20 * D && hi > 20 * D);
});

test('overshield and self-heal set their glow flags', () => {
  const s = mk('idle', { overshield: true, healing: true });
  const p = poseAt(s, 5);
  assert.equal(p.shield, 1); assert.equal(p.heal, 1); assert.ok(p.bright > 1);
});

test('de-sync: two seeds breathe and run out of phase at the same instant', () => {
  const a = mk('idle', { seed: 0.3 }), b = mk('idle', { seed: 1.7 });
  assert.ok(Math.abs(poseAt(a, 10).torso.sy - poseAt(b, 10).torso.sy) > 0.001);
  const ar = mk('run', { seed: 0.3 }), br = mk('run', { seed: 1.7 });
  assert.ok(Math.abs(poseAt(ar, 3).legL.dy - poseAt(br, 3).legL.dy) > 0.1);
});

test('defaults: auto mode, 2.4 s reload fallback, full health', () => {
  const s = new Soldier(null, 'tr', {});
  assert.equal(s.mode, 'auto'); assert.equal(s.reloadMs, 2400); assert.equal(s.hp, 1);
});

test('parts stay attached: every state, sampled across its timeline, stays finite and bounded', () => {
  const states = ['idle', 'run', 'shoot', 'peek', 'reload', 'hop', 'search', 'die', 'dead', 'revive', 'respawn'];
  for (const st of states) {
    for (const mode of st === 'shoot' ? ['auto', 'semi', 'bolt'] : ['auto']) {
      const s = mk(st, { mode, hs: true, hp: 0.2, flinchAt: 0.1 });
      for (let tl = 0; tl <= 3; tl += 0.15) {
        const p = poseAt(s, tl);
        const nums = [p.rootRot, p.bob, p.alpha, p.bright, p.dx, p.torso.rot, p.torso.sy, p.head.rot, p.head.dy,
          p.gun.dx, p.gun.dy, p.gun.rot, p.legL.rot, p.legL.dy, p.legR.rot, p.legR.dy, p.flash, p.squash, p.shake];
        assert.ok(nums.every(Number.isFinite), `${st}/${mode} tl=${tl} has a non-finite pose value`);
        assert.ok(Math.abs(p.gun.dx) <= 60 && Math.abs(p.gun.dy) <= 100 && Math.abs(p.head.dy) <= 80);
        assert.ok(Math.abs(p.bob) <= 150 && Math.abs(p.rootRot) <= 1.8);
        assert.ok(Math.abs(p.legL.rot) <= 0.6 && Math.abs(p.legR.rot) <= 0.6);
        assert.ok(Math.abs(p.torso.rot) <= 0.6 && Math.abs(p.head.rot) <= 0.8);
      }
    }
  }
});
