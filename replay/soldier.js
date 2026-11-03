// Puppet soldier: loads per-faction part PNGs and animates them with simple
// pivot transforms. Layer order (back→front): legL, legR, torso, head, gun.
const D = Math.PI / 180;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
const bell = (x) => (x <= 0 || x >= 1) ? 0 : Math.sin(Math.PI * x) ** 2;
const frac = (x) => x - Math.floor(x);
const hash1 = (s, k) => frac(Math.sin(s * 127.1 + k * 311.7) * 43758.5453); // deterministic per-soldier variation, no Math.random
const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };

// Winner celebration (#107, pure): ~1.2 s of WALL time after a kill, 2–3
// small up-and-down bobs (≤ 6 % of the soldier's height: 31 rig px of the
// 523 px rig) plus a faction-colour glow that fades out. It is a param, not
// a state, so shooting / reload / hurt poses keep working underneath —
// pose() just adds the bob on top. Reduced motion: glow only, no bob.
// elapsed is wall seconds since the kill (player.js passes wallT, because
// the data clock runs at the director's rate, not wall time).
export const CHEER_DUR = 1.2, CHEER_BOBS = 2.5, CHEER_AMP = 31;
export function cheerPose(elapsed, reduced = false) {
  if (!(elapsed >= 0) || elapsed >= CHEER_DUR) return { bob: 0, glow: 0 };
  const glow = 1 - elapsed / CHEER_DUR;
  // one hump of |sin| is one hop (up and back down); CHEER_BOBS humps fit
  // the window, so the sine runs half that many cycles
  const bob = reduced ? 0 : -Math.abs(Math.sin(elapsed * Math.PI * CHEER_BOBS / CHEER_DUR)) * CHEER_AMP || 0;
  return { bob, glow };
}

export const FX = {
  tr: { core: '#fff6c8', glow: 'rgba(255,150,40,', tracer: '#ffcc55', rate: 8, beam: 'rgba(230,60,50,' },
  nc: { core: '#ffffff', glow: 'rgba(255,215,60,', tracer: '#ffe680', rate: 6, beam: 'rgba(60,120,255,' },
  vs: { core: '#e9fffb', glow: 'rgba(80,255,220,', glow2: 'rgba(190,90,255,', tracer: '#7affea', rate: 4.5, plasma: true, beam: 'rgba(170,80,255,' },
};

export async function loadRigs(url = 'rigs.json') {
  const rigs = await (await fetch(url)).json();
  await Promise.all(Object.values(rigs).flatMap(r => r.parts.map(p => new Promise((ok, bad) => {
    p.img = new Image(); p.img.onload = ok; p.img.onerror = bad; p.img.src = p.src;
  }))));
  for (const r of Object.values(rigs)) r.byName = Object.fromEntries(r.parts.map(p => [p.name, p]));
  return rigs;
}

export class Soldier {
  constructor(rig, faction, o = {}) {
    Object.assign(this, { rig, faction, fx: FX[faction], x: o.x ?? 0, y: o.y ?? 600, home: o.x ?? 0,
      scale: o.scale ?? 0.5, facing: o.facing ?? 1, seed: o.seed ?? Math.random() * 10,
      state: 'idle', t0: 0, shots: 0, reloadAt: o.reloadAt ?? 1e9, speed: o.speed ?? 150,
      rate: o.rate ?? FX[faction].rate, aim: 0, flinchAt: o.flinchAt ?? -9, hs: o.hs ?? false, cloak: o.cloak ?? 0, hop: o.hop ?? 0,
      mode: o.mode ?? 'auto', reloadMs: o.reloadMs ?? 2400, hp: o.hp ?? 1, overshield: o.overshield ?? false, healing: o.healing ?? false,
      cheerAt: o.cheerAt ?? null, reducedMotion: o.reducedMotion ?? false });
    this.bounds = o.bounds ?? [this.home - 120, this.home + 120];
  }
  set(state, t) { if (this.state !== state) { this.state = state; this.t0 = t; this.shots = 0; } }

  // ADAD sway while shooting: direction flips every 0.3-0.8 s (seeded), amplitude
  // 20-40 rig px, eased over 0.08 s at each flip so the soldier never pops
  strafeDx(tl) {
    const s = this.seed, amp = 20 + 20 * hash1(s, 0);
    const dir0 = hash1(s, 99) < 0.5 ? 1 : -1;
    let t = 0, k = 0, from = 0, to = dir0 * amp;
    for (;;) {
      const dur = 0.3 + 0.5 * hash1(s, k + 1);
      if (tl < t + dur) return from + (to - from) * smooth((tl - t) / Math.min(0.08, dur));
      t += dur; from = to; k++; to = -from;
    }
  }

  // ---- pose: all numbers in rig-local px (pre-scale), angles in radians
  // wallT is the wall clock (for the cheer); it defaults to t so existing
  // callers that only pass the data clock still pose identically.
  pose(t, wallT = t) {
    const tl = t - this.t0, s = this.seed;
    const P = { rootRot: 0, rootPiv: [0, 0], bob: 0, alpha: 1, bright: 1, dx: 0, aimErr: 0, shield: 0, heal: 0, cheer: 0,
      torso: { rot: 0, sy: 1 }, head: { rot: 0, dy: 0 }, gun: { dx: 0, dy: 0, rot: 0 },
      legL: { rot: 0, dy: 0 }, legR: { rot: 0, dy: 0 }, flash: 0, beam: 0, squash: 1, shake: 0 };
    const breath = Math.sin((t + s) * 2 * Math.PI / 2.6);
    P.torso.sy = 1 + 0.014 * breath;
    P.head.rot = 2 * D * Math.sin((t + s) * 0.9);
    P.gun.rot = 0.8 * D * breath;
    switch (this.state) {
      case 'idle': {
        P.head.rot = (5 * Math.sin((t + s) * 2 * Math.PI / 5.5) + 1.5 * Math.sin((t + s) * 3.1)) * D;
        const r = (t - this.reloadAt) / (this.reloadMs / 1000);   // reload: gun dips, head looks at it, over the real reloadMs
        if (r > 0 && r < 1) { const b = bell(r); P.gun.rot += 10 * D * b; P.gun.dy += 3 * b; P.gun.mid = true; P.head.rot += 7 * D * b; }
        break;
      }
      case 'run': {
        const cad = 2.4 * (0.65 + 0.35 * clamp(this.hp, 0, 1)); // hurt soldiers stride slower; seed phases the cycle
        const f = (tl + s * 0.37) * 2 * Math.PI * cad, sn = Math.sin(f);
        P.legL.dy = -Math.max(0, sn) * 30; P.legR.dy = -Math.max(0, -sn) * 30;
        P.legL.rot = 10 * D * sn; P.legR.rot = 10 * D * sn;
        P.bob = -Math.abs(Math.sin(f)) * 12;
        P.torso.rot = 7 * D * ease(tl * 3); P.head.rot = -3 * D + 2 * D * Math.sin(2 * f);
        P.gun.rot = 3 * D * Math.sin(2 * f); P.gun.dy = 3 * Math.sin(2 * f);
        P.torso.sy = 1;
        break;
      }
      case 'shoot': {
        // burst rhythm by fire mode; recoil climbs inside a burst and resets between bursts
        let firing = true, p = 0, shotIdx = 0, totalShots = 0, chamberRot = 0, chamberDy = 0;
        if (this.mode === 'semi') {
          const cyc = tl % 0.45;
          p = cyc * this.rate; firing = p < 1; totalShots = Math.floor(tl / 0.45);
        } else if (this.mode === 'bolt') {
          const cyc = tl % 1.2;
          p = cyc * this.rate; firing = p < 1; totalShots = Math.floor(tl / 1.2);
          const ch = clamp((cyc - 1 / this.rate) / 0.4); // chambering after the shot
          if (ch > 0 && ch < 1) { const b = bell(ch); chamberRot = 12 * D * b; chamberDy = -4 * b; }
        } else { // auto: bursts of 4 with a 0.35 s pause
          const burstLen = 4, cycleT = burstLen / this.rate + 0.35;
          const cyc = tl % cycleT;
          firing = cyc < burstLen / this.rate;
          shotIdx = firing ? Math.floor(cyc * this.rate) : 0;
          p = firing ? cyc * this.rate - shotIdx : 0;
          totalShots = Math.floor(tl / cycleT) * burstLen + (firing ? shotIdx : burstLen);
        }
        const k = firing ? Math.exp(-p * 5) * (1 + 0.15 * shotIdx) : 0;
        P.gun.dx = -10 * k; P.gun.rot = -4 * D * k + chamberRot; P.gun.dy += chamberDy; P.gun.mid = true; P.torso.rot = -1.6 * D * k; P.head.rot = -2 * D * k;
        P.flash = firing && p < 0.35 ? 1 - p / 0.35 : 0; P.flashSeed = totalShots;
        P.bob = 5; P.legL.rot = -3 * D; P.legR.rot = 3 * D; // braced stance
        P.gun.rot += this.aim; P.head.rot += this.aim * 0.4;
        P.dx += this.strafeDx(tl); // ADAD sway while shooting
        break;
      }
      case 'peek': { // duck behind cover, rise to fire; aim settles over 0.15-0.3 s
        const rise = ease(clamp(tl / 0.4));
        P.bob = 80 * (1 - rise) + 10; P.gun.dy = 20 * (1 - rise);
        P.torso.rot = 6 * D * (1 - rise); P.head.rot = 4 * D * (1 - rise);
        const settle = 0.15 + 0.15 * hash1(s, 7);
        P.aimErr = clamp(1 - tl / settle);
        const dir = hash1(s, 8) < 0.5 ? 1 : -1;
        P.gun.rot += P.aimErr * 6 * D * dir; P.head.rot += P.aimErr * 3 * D * dir;
        P.legL.rot = -6 * D * (1 - rise); P.legR.rot = 6 * D * (1 - rise);
        break;
      }
      case 'reload': { // gun drops, magazine swap, gun rises — over the real reloadMs
        const r = clamp(tl / (this.reloadMs / 1000));
        const drop = r < 0.25 ? ease(r / 0.25) : r < 0.6 ? 1 : 1 - ease((r - 0.6) / 0.4);
        P.gun.dy = 26 * drop; P.gun.rot = 14 * D * drop; P.gun.mid = true;
        P.head.rot = 10 * D * drop; // looks down at the gun
        if (r >= 0.25 && r < 0.6) P.gun.dy += 4 * Math.sin((r - 0.25) / 0.35 * Math.PI); // mag out and in
        break;
      }
      case 'hop': { // LA jet hop: a 0.7 s arc, legs dangle, then back on the ground
        const a = Math.sin(clamp(tl / 0.7) * Math.PI);
        P.bob = -60 * a; P.torso.rot = -6 * D * a;
        P.legL.rot = 8 * D * a; P.legR.rot = -8 * D * a;
        break;
      }
      case 'search': { // head and gun scan while no target is in sight
        const x = Math.sin((t + s) * 2 * Math.PI / 2.8);
        const sw = Math.sign(x) * Math.pow(Math.abs(x), 0.6) * 25 * D; // flattened extremes = dwell
        P.head.rot = sw; P.gun.rot = 0.5 * sw; P.bob = 4 * Math.sin((t + s) * 0.7);
        break;
      }
      case 'die': {
        const fall = ease((tl - 0.14) / 0.5);
        P.shake = tl < 0.14 ? 1 : 0; P.bright = tl < 0.14 ? 2.2 : 1;
        P.rootPiv = [-95, 0];
        const bounce = tl > 0.64 ? Math.sin(clamp((tl - 0.64) / 0.25) * Math.PI) * 4 * D : 0;
        P.rootRot = -(84 * D) * fall + bounce;
        P.gun.rot = 6 * D * fall; P.gun.dy = 3 * fall; P.head.rot = -14 * D * fall;
        P.legL.rot = -4 * D * fall; P.legR.rot = 5 * D * fall;
        P.alpha = 1 - clamp((tl - 1.1) / 0.6);
        P.torso.sy = 1;
        if (this.hs) P.head.rot -= 26 * D * Math.sin(clamp(tl / 0.35) * Math.PI / 2) * (1 - 0.4 * fall); // helmet ding: head snaps back
        break;
      }
      // #100: a duelist's body stays a moment after death — visible while
      // the corpse window runs (set by the duel pump), then gone until
      // respawn. Crowd corpses keep today's rule (downKeep only).
      case 'dead': { const corpse = this.corpseUntil != null && t < this.corpseUntil;
        P.alpha = (this.downKeep || corpse) ? 1 : 0;
        if (this.downKeep || corpse) { P.rootPiv = [-95, 0]; P.rootRot = -84 * D; P.head.rot = -14 * D; } break; }
      case 'revive': { // reverse of the fall, picked up by a teammate
        const r = ease(tl / 0.8); P.rootPiv = [-95, 0]; P.rootRot = -84 * D * (1 - r); P.head.rot = -14 * D * (1 - r);
        P.bright = 1 + 0.8 * (1 - r); P.torso.sy = 1; break;
      }
      case 'respawn': {
        const r = tl / 0.9;
        P.beam = 1 - clamp((r - 0.55) / 0.45);
        P.alpha = clamp((r - 0.15) / 0.45);
        P.bright = 1 + 1.6 * (1 - clamp((r - 0.2) / 0.6));
        P.squash = 1 + 0.12 * (1 - ease((r - 0.2) / 0.6));
        P.bob = -40 * (1 - ease((r - 0.15) / 0.55));
        break;
      }
    }
    const fl = t - this.flinchAt;
    if (fl >= 0 && fl < 0.22 && this.state !== 'die' && this.state !== 'dead') { const k = Math.sin(fl / 0.22 * Math.PI); P.torso.rot -= 5 * D * k; P.head.rot -= 8 * D * k; P.flinch = k; P.dx += 4 * Math.sin(fl / 0.22 * Math.PI * 2); } // stagger on hits
    if (this.hp < 0.5 && this.state !== 'die' && this.state !== 'dead') { // hurt: hunched, slightly crouched
      const h = (0.5 - this.hp) / 0.5;
      P.torso.rot += 8 * D * h; P.head.rot += 6 * D * h; P.bob += 6 * h;
    }
    if (this.overshield) { P.shield = 1; P.bright *= 1.15; }
    if (this.healing) { P.heal = 1; P.bright *= 1.1; }
    if (this.hop > 0) P.bob -= this.hop;
    if (this.cloak > 0) P.alpha *= 1 - 0.7 * this.cloak;
    // celebration: a param on top of whatever pose the soldier is in, never
    // a state of its own (a killer mid-reload still reloads, just bouncier)
    if (this.cheerAt != null) {
      const ch = cheerPose(wallT - this.cheerAt, this.reducedMotion);
      P.bob += ch.bob; P.cheer = ch.glow;
    }
    return P;
  }

  // world position of a rig-local point drawn under the current transform
  static apply(m, x, y) { return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]; }

  draw(ctx, t, out = {}, wallT = t) {
    const P = this.pose(t, wallT), R = this.rig, B = R.byName, pv = R.pivots;
    this.lastPose = P; // #107: headless checks read the bob/glow after a kill
    // ground shadow
    if (P.alpha > 0) {
      ctx.save(); ctx.globalAlpha = 0.35 * P.alpha;
      ctx.fillStyle = '#000'; ctx.beginPath();
      const sw = this.state === 'die' ? 1.6 : (1 + P.bob / 200);
      ctx.ellipse(this.x + P.dx * this.scale * this.facing, this.y + 2, 120 * this.scale * sw, 16 * this.scale, 0, 0, 2 * Math.PI); ctx.fill(); ctx.restore();
    }
    if (this.state === 'run') { // dust puffs kicked up behind the feet
      const tl = t - this.t0;
      ctx.save();
      for (let i = 0; i < 4; i++) {
        const age = ((tl * 2.4 + i / 4) % 1), px = this.x - this.facing * (40 + age * 90) * this.scale * 2;
        ctx.globalAlpha = 0.35 * (1 - age); ctx.fillStyle = '#c9c2a8';
        ctx.beginPath(); ctx.arc(px, this.y - age * 30 * this.scale * 2, (8 + age * 18) * this.scale * 2, 0, 2 * Math.PI); ctx.fill();
      }
      ctx.restore();
    }
    if (P.beam > 0) {
      ctx.save(); const w = 150 * this.scale, top = this.y - 900 * this.scale;
      const g = ctx.createLinearGradient(this.x - w, 0, this.x + w, 0);
      g.addColorStop(0, this.fx.beam + '0)'); g.addColorStop(0.5, this.fx.beam + (0.75 * P.beam) + ')'); g.addColorStop(1, this.fx.beam + '0)');
      ctx.fillStyle = g; ctx.fillRect(this.x - w, top, 2 * w, this.y - top + 6);
      ctx.fillStyle = `rgba(255,255,255,${0.55 * P.beam})`; ctx.fillRect(this.x - w * 0.12, top, w * 0.24, this.y - top);
      ctx.restore();
    }
    if (P.alpha <= 0) return P;
    ctx.save();
    ctx.globalAlpha = P.alpha * (this.dim ? 0.9 : 1);
    if (this.dim) ctx.filter = `brightness(${(P.bright * 0.62).toFixed(3)}) saturate(0.6)`;   // crowd: pushed back
    else if (P.bright !== 1) ctx.filter = `brightness(${P.bright})`;
    const sh = P.shake ? Math.sin(t * 90) * 4 : 0;
    ctx.translate(this.x + sh + P.dx * this.scale * this.facing, this.y);
    ctx.scale(this.facing * this.scale, this.scale);
    ctx.translate(P.rootPiv[0], P.rootPiv[1]); ctx.rotate(P.rootRot); ctx.translate(-P.rootPiv[0], -P.rootPiv[1]);
    if (P.squash !== 1) ctx.scale(1 / P.squash, P.squash); // tall-thin stretch on respawn
    ctx.translate(0, P.bob * 0.35);
    const part = (n, dx = 0, dy = 0) => { const p = B[n]; ctx.drawImage(p.img, p.x + dx, p.y + dy, p.w, p.h); };
    const rotAt = (piv, a) => { ctx.translate(piv[0], piv[1]); ctx.rotate(a); ctx.translate(-piv[0], -piv[1]); };
    for (const n of ['legL', 'legR']) { ctx.save(); ctx.translate(0, P[n].dy); rotAt(pv[n], P[n].rot); part(n); ctx.restore(); }
    ctx.translate(0, P.bob * 0.65);
    rotAt(pv.torso, P.torso.rot);
    // breathing: stretch torso up from the hips, carry head and gun with it
    const lift = (P.torso.sy - 1) * (pv.torso[1] - pv.head[1]);
    ctx.save(); ctx.translate(0, pv.torso[1]); ctx.scale(1, P.torso.sy); ctx.translate(0, -pv.torso[1]); part('torso'); ctx.restore();
    ctx.save(); ctx.translate(0, -lift + P.head.dy); rotAt(pv.head, P.head.rot); part('head'); ctx.restore();
    out.head = Soldier.apply(ctx.getTransform(), pv.head[0], pv.head[1] - 90);
    ctx.save(); ctx.translate(P.gun.dx, -lift * 0.6 + P.gun.dy); rotAt(P.gun.mid ? [pv.torso[0] + 20, pv.gun[1]] : pv.gun, P.gun.rot); part('gun');
    const mz = R.points.muzzle, m = ctx.getTransform();
    out.muzzle = Soldier.apply(m, mz[0], mz[1]);
    out.muzzleAhead = Soldier.apply(m, mz[0] + 100, mz[1]);
    if (P.flash > 0) this.drawFlash(ctx, mz, P.flash, P.flashSeed);
    ctx.restore();
    if (P.shield > 0 || P.heal > 0 || P.cheer > 0) { // overshield ring / self-heal glow / win glow (square corners n/a: ellipses, no roundRect)
      ctx.save(); ctx.filter = 'none'; ctx.globalCompositeOperation = 'lighter';
      if (P.shield > 0) { ctx.globalAlpha = 0.55 * P.shield; ctx.strokeStyle = this.fx.glow + '0.9)'; ctx.lineWidth = 7; ctx.beginPath(); ctx.ellipse(0, -200, 175, 265, 0, 0, 2 * Math.PI); ctx.stroke(); }
      if (P.heal > 0) { const g = ctx.createRadialGradient(0, -200, 0, 0, -200, 280); g.addColorStop(0, 'rgba(80,255,140,0.35)'); g.addColorStop(1, 'rgba(80,255,140,0)'); ctx.globalAlpha = P.heal; ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, -200, 200, 280, 0, 0, 2 * Math.PI); ctx.fill(); }
      if (P.cheer > 0) { const g = ctx.createRadialGradient(0, -200, 0, 0, -200, 280); g.addColorStop(0, this.fx.glow + (0.45 * P.cheer) + ')'); g.addColorStop(1, this.fx.glow + '0)'); ctx.globalAlpha = P.cheer; ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, -200, 200, 280, 0, 0, 2 * Math.PI); ctx.fill(); }
      ctx.restore();
    }
    ctx.restore();
    return P;
  }

  drawFlash(ctx, [mx, my], k, seed) {
    const fx = this.fx; ctx.save(); ctx.filter = 'none'; ctx.translate(mx + 6, my);
    ctx.globalCompositeOperation = 'lighter';
    const r = (fx.plasma ? 110 : 95) * (0.6 + 0.4 * k);
    let g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, fx.core); g.addColorStop(0.3, fx.glow + (0.9 * k) + ')'); g.addColorStop(1, fx.glow + '0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, 2 * Math.PI); ctx.fill();
    if (fx.plasma) {
      g = ctx.createRadialGradient(10, 0, 0, 10, 0, r * 1.3);
      g.addColorStop(0, fx.glow2 + (0.7 * k) + ')'); g.addColorStop(1, fx.glow2 + '0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(18, 0, r * 1.3, r * 0.75, 0, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = fx.core; ctx.beginPath(); ctx.ellipse(26, 0, 44 * k + 8, 15 * k + 4, 0, 0, 2 * Math.PI); ctx.fill();
    } else {
      // spiky star, varies per shot
      const n = 7, rot = (seed * 1.7) % 1;
      ctx.fillStyle = fx.core; ctx.beginPath();
      for (let i = 0; i <= 2 * n; i++) {
        const a = (i / (2 * n)) * 2 * Math.PI + rot, len = i % 2 ? 10 : (i === 0 || i === 2 * n ? 110 : 44 + 22 * ((seed * 7 + i) % 3) / 2);
        ctx.lineTo(Math.cos(a) * len * k + (i === 0 || i === 2 * n ? 10 : 0), Math.sin(a) * len * k * 0.7);
      }
      ctx.fill();
    }
    ctx.restore();
  }
}
