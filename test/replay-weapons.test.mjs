import test from "node:test";
import assert from "node:assert/strict";
import { FALLBACK, toProfile, profileOf, shotsPerSec, hitsToKill, burstStyle } from "../replay/weapons.mjs";

const ANCHOR = [600, 50, 3370, 167, 125, 10, 75, 2.0, 1, "auto"];
const MSWR = [750, 50, 3045, 143, 112, 10, 65, 2.0, 1, "auto"];

test("fallback: every infantry category has a valid profile", () => {
  for (const cat of ['Pistol', 'LMG', 'Assault Rifle', 'SMG', 'Carbine', 'Sniper Rifle', 'Scout Rifle',
    'Shotgun', 'Heavy Weapon', 'Battle Rifle', 'Crossbow', 'Infantry Weapons', 'Hybrid Rifle']) {
    const p = profileOf(1, cat, {});
    assert.ok(p, cat);
    assert.equal(toProfile(FALLBACK[cat])?.mode, p.mode, cat);
  }
  assert.equal(profileOf(1, "Knife", {}), null);
  assert.equal(profileOf(1, null, {}), null);
});

test("real profile wins over the fallback; malformed tuples fall back", () => {
  const p = profileOf(7236, "LMG", { 7236: ANCHOR });
  assert.equal(p.mag, 50); // LMG fallback would be 75
  assert.equal(p.rpm, 600);
  assert.equal(profileOf(7236, "LMG", { 7236: [600, 50] })?.mag, 75); // malformed -> fallback
  assert.equal(profileOf(7236, "LMG", { 7236: [600, 50, 3370, 167, 125, 10, 75, 2.0, 1, "charge"] })?.mag, 75);
});

test("shots per second from rpm", () => {
  assert.equal(shotsPerSec(toProfile(ANCHOR)), 10);
  assert.equal(shotsPerSec(toProfile(MSWR)), 12.5);
});

test("hits to kill 1000 (500 shield + 500 health), near and far, body and head", () => {
  const a = toProfile(ANCHOR), m = toProfile(MSWR);
  assert.deepEqual([hitsToKill(a), hitsToKill(a, { far: true }), hitsToKill(a, { head: true }), hitsToKill(a, { head: true, far: true })], [6, 8, 3, 4]);
  assert.deepEqual([hitsToKill(m), hitsToKill(m, { far: true }), hitsToKill(m, { head: true }), hitsToKill(m, { head: true, far: true })], [7, 9, 4, 5]);
  const sg = profileOf(1, "Shotgun", {});
  assert.equal(hitsToKill(sg), 2); // 125 x 7 pellets = 875 per shot, all pellets landing
  assert.equal(hitsToKill(sg, { head: true }), 1);
});

test("burst style by mode", () => {
  assert.deepEqual(burstStyle(toProfile(ANCHOR)), { kind: "auto", close: "full", far: [3, 6] });
  assert.deepEqual(burstStyle(profileOf(1, "Pistol", {})), { kind: "semi", shots: 1 });
  assert.deepEqual(burstStyle(profileOf(1, "Sniper Rifle", {})), { kind: "bolt", shots: 1 });
  assert.deepEqual(burstStyle(toProfile([700, 30, 2000, 143, 112, 10, 65, 2.0, 1, "burst"])), { kind: "burst", shots: 3 });
});

test("flat falloff (ranges 0, Census records no falloff): far equals near", () => {
  const jh = toProfile([225, 6, 2700, 112, 112, 0, 0, 1.5, 5, "semi"]);
  assert.ok(jh);
  assert.equal(hitsToKill(jh), hitsToKill(jh, { far: true }));
  assert.equal(hitsToKill(jh), 2); // 112 x 5 pellets = 560 per shot
  assert.equal(toProfile([225, 6, 2700, 112, 112, -1, 0, 1.5, 5, "semi"]), null);
});
