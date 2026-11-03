/**
 * ⚔️ Engagement model (replay #95): one fight between two shooters, pure and
 * seeded. The duel planner (#96) calls engage() per fight; the calibration
 * below is what makes the simulated shots/kill match the shooters' lifetime
 * stats instead of reading as "one miss in three".
 *
 * Health (typical game values, documented as approximate, not measured):
 *   shield 500 + health 500; shield regen starts 3 s after the last damage
 *   at 150/s; a Heavy Assault gains +450 overshield when he commits; a medic
 *   regens health at 25/s after 5 s without damage; a MAX has 2000 health and
 *   no shield. Trade damage never kills: a would-be lethal trade hit leaves
 *   1 HP (the target ducks into cover) and trade damage does not carry into
 *   the commit — the target regens in the lull, so every commit starts at
 *   full HP and takes ~N hits. Only commit shots kill.
 *
 * Per-shot hit chance = base(phase) × moving × strafing × recoil × flinch:
 *   moving 0.9 (shooter moving), strafing 0.9 (target strafing), recoil
 *   1/(1 + 0.05 × shot index in burst, reset each burst), flinch 0.95 (the
 *   shooter took a hit within the last 0.5 s). The base rates are solved
 *   from the shooter's lifetime stats so the EFFECTIVE rates hit the
 *   accounting targets: base = target ÷ E[multipliers], where E uses the
 *   same move/strafe/flinch probabilities the simulation samples.
 *
 * Calibration (per shooter, cached): N = 1000 ÷ average damage per hit
 *   (body damage × pellets, headshots counted at hsMult with the shooter's
 *   HS ratio); pCommitEff = clamp(1.8 × hpk ÷ spk, 0.35, 0.75); commit shots
 *   ≈ N ÷ pCommitEff; the rest of the shots per kill — including shots fired
 *   in engagements he loses or breaks off — are trade shots, pTradeEff =
 *   (hpk − N) ÷ (spk − N ÷ pCommitEff). Trade shots per engagement =
 *   P(win) × (spk − N ÷ pCommitEff), so over a mix of wins, losses and
 *   breaks the simulated shots/kill and hits/kill reproduce spk/hpk exactly
 *   in expectation. HS chance per hit: trade 0.7 × p, commit p, where p is
 *   solved from the shooter's HS ratio — because headshots deal hsMult
 *   damage, the killing blow is disproportionately often a headshot
 *   (damage-weighted share), so p = hsr ÷ (hsMult × (1 − hsr) + hsr) is what
 *   makes the HS KILL share come out at hsr. The same p sets the average
 *   damage per hit, hence N.
 */
export const SHIELD = 500, HEALTH = 500, OVERSHIELD = 450, MAX_HEALTH = 2000;
export const SHIELD_REGEN_DELAY = 3, SHIELD_REGEN_RATE = 150;
export const MEDIC_HEAL_DELAY = 5, MEDIC_HEAL_RATE = 25;
export const BREAK_P = 0.15, THIRD_P = 0.05;
const MOVE_F = 0.9, STRAFE_F = 0.9, FLINCH_F = 0.95, RECOIL_K = 0.05, FLINCH_WINDOW = 0.5;
const P_MOVE = { trade: 0.4, commit: 0.2 }, P_STRAFE = { trade: 0.6, commit: 0.5 }, P_FLINCH = { trade: 0.1, commit: 0.3 };
const BURST_LEN = (mode) => (mode === "auto" ? 4 : mode === "burst" ? 3 : 1);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const meanRecoil = (len, k = RECOIL_K) => { let s = 0; for (let i = 0; i < len; i++) s += 1 / (1 + k * i); return s / len; };
const meanMult = (phase, len, s = 1) => (1 - s * (1 - MOVE_F) * P_MOVE[phase]) * (1 - s * (1 - STRAFE_F) * P_STRAFE[phase]) * meanRecoil(len, s * RECOIL_K) * (1 - s * (1 - FLINCH_F) * P_FLINCH[phase]);
/** Penalty scale s ∈ [0,1] so base = target ÷ E(s) stays ≤ 0.95: extreme-accuracy
 * shooters (vehicle guns, MAXes) suffer less from movement penalties instead
 * of breaking the calibration. s = 1 whenever the full penalties already fit. */
const penaltyScale = (target, phase, len) => {
  if (target / meanMult(phase, len, 1) <= 0.95) return 1;
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (target / meanMult(phase, len, mid) <= 0.95) hi = mid; else lo = mid;
  }
  return hi;
};

/** Tiny seeded PRNG (same family as the replay's mulberry, kept local so this module stays dependency-free). */
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const poisson = (lambda, rng) => {
  if (!(lambda > 0)) return 0;
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > L && k < 1000);
  return k - 1;
};

/** Calibrated shooter params from a weapon profile + lifetime stats. Cached per shooter. */
const cache = new Map();
export function shooter(profile, stats) {
  const key = JSON.stringify([profile, stats]);
  if (cache.has(key)) return cache.get(key);
  if (cache.size >= 500) cache.clear();
  const spk = Number.isFinite(stats.spk) && stats.spk > 0 ? stats.spk : 39.5;
  const hpk = Number.isFinite(stats.hpk) && stats.hpk > 0 ? stats.hpk : 10.4;
  let hsr = Number.isFinite(stats.hsr) ? stats.hsr : 0.1826;
  if (hsr > 1) hsr /= 100;
  hsr = clamp(hsr, 0, 1);
  const p = profile || {};
  const dmg = (p.dmgMax || 143) * (p.pellets || 1);
  const hsMult = p.hsMult || 2;
  // Per-hit headshot probability solved from the HS kill share: the killing
  // blow is damage-weighted toward headshots, so p < hsr whenever hsMult > 1.
  const pHS = hsr / (hsMult * (1 - hsr) + hsr);
  const N = 1000 / (dmg * (1 + (hsMult - 1) * pHS));
  const pCommitEff = clamp(1.8 * (hpk / spk), 0.35, 0.75);
  const commitShots = N / pCommitEff;
  const tradeShots = spk - commitShots;
  const pTradeEff = tradeShots > 1 ? clamp((hpk - N) / tradeShots, 0.01, 0.9) : 0.1;
  const len = BURST_LEN(p.mode || "auto");
  const sCommit = penaltyScale(pCommitEff, "commit", len);
  const sTrade = penaltyScale(pTradeEff, "trade", len);
  const out = {
    profile: p, cls: stats.cls || null, spk, hpk, hsr, kd: stats.kd || null,
    N, rate: (p.rpm || 600) / 60, burstLen: len,
    pCommit: clamp(pCommitEff / meanMult("commit", len, sCommit), 0.05, 0.95),
    pTrade: clamp(pTradeEff / meanMult("trade", len, sTrade), 0.01, 0.95),
    pCommitEff, pTradeEff, sCommit, sTrade,
    hsP: { trade: clamp(0.7 * pHS, 0, 1), commit: pHS },
    minHits: Math.ceil(1000 / (dmg * hsMult)), // all-headshot floor: no kill takes fewer hits
  };
  cache.set(key, out);
  return out;
}

function makeHp(cls) {
  return cls === "max" ? { shield: 0, health: MAX_HEALTH, over: 0 } : { shield: SHIELD, health: HEALTH, over: 0 };
}
const hpTotal = (h) => h.shield + h.health + h.over;

/** Apply regen up to time t (shield after 3 s, medic health after 5 s). */
function regen(h, cls, st, t) {
  if (t > st.lastDmg + SHIELD_REGEN_DELAY && h.shield < SHIELD && cls !== "max") {
    const from = Math.max(st.lastRegen, st.lastDmg + SHIELD_REGEN_DELAY);
    if (t > from) h.shield = Math.min(SHIELD, h.shield + SHIELD_REGEN_RATE * (t - from));
    st.lastRegen = Math.max(st.lastRegen, t);
  }
  if (cls === "med" && t > st.lastDmg + MEDIC_HEAL_DELAY && h.health < HEALTH) {
    const from = Math.max(st.lastHeal, st.lastDmg + MEDIC_HEAL_DELAY);
    if (t > from) h.health = Math.min(HEALTH, h.health + MEDIC_HEAL_RATE * (t - from));
    st.lastHeal = Math.max(st.lastHeal, t);
  }
}
/** Deal damage (shield, then overshield, then health); trade hits never kill. */
function damage(h, st, dmg, t, trade) {
  let left = dmg, dealt = 0;
  for (const k of ["shield", "over", "health"]) {
    if (left <= 0) break;
    const take = Math.min(h[k], left);
    h[k] -= take; left -= take; dealt += take;
  }
  if (trade && hpTotal(h) <= 0) { // trade never kills: leave 1 HP
    h.health += 1; dealt -= 1;
  }
  if (dealt > 0) st.lastDmg = t;
  return dealt;
}

/**
 * One engagement. a, b: shooter() outputs. rng: () => [0,1).
 * opts: { outcome: 'a'|'b'|'break'|'third', wA: P(A wins | decisive), victim: 'a'|'b' (third only, else sampled) }.
 * The trade count uses the MIX win probabilities (wA × decisive share), so a
 * forced outcome conditions the fight without breaking the averages.
 * → { shots: [{t, from, hit, hs, dmg, phase}], hp: {a: [[t, shield, health, over]], b: [...]}, result }
 */
export function engage(a, b, rng, opts = {}) {
  const wA = opts.wA ?? 0.5, decisive = 1 - BREAK_P - THIRD_P;
  const pWinA = wA * decisive, pWinB = (1 - wA) * decisive;
  let result = opts.outcome;
  if (!result) {
    const r = rng();
    result = r < pWinA ? "a" : r < pWinA + pWinB ? "b" : r < pWinA + pWinB + BREAK_P ? "break" : "third";
  }
  const win = result === "a" ? "a" : result === "b" ? "b" : null;
  const W = win === "a" ? a : b, L = win === "a" ? b : a;
  const wName = win, lName = win === "a" ? "b" : "a";
  const shots = [], hpA = [], hpB = [];
  const hp = { a: makeHp(a.cls), b: makeHp(b.cls) };
  const st = { a: { lastDmg: -1e9, lastRegen: -1e9, lastHeal: -1e9, lastHit: -1e9 }, b: { lastDmg: -1e9, lastRegen: -1e9, lastHeal: -1e9, lastHit: -1e9 } };
  const snap = (t) => {
    hpA.push([t, hp.a.shield, hp.a.health, hp.a.over]);
    hpB.push([t, hp.b.shield, hp.b.health, hp.b.over]);
  };
  const roll = (sh, from, phase, t, burstIdx, flinchTimes = null) => {
    const s = phase === "commit" ? sh.sCommit : sh.sTrade;
    let m = phase === "commit" ? sh.pCommit : sh.pTrade;
    if (rng() < P_MOVE[phase]) m *= 1 - s * (1 - MOVE_F);
    if (rng() < P_STRAFE[phase]) m *= 1 - s * (1 - STRAFE_F);
    m *= 1 / (1 + s * RECOIL_K * burstIdx);
    const flinched = flinchTimes
      ? flinchTimes.some((ht) => ht < t && t - ht < FLINCH_WINDOW)
      : t - st[from].lastHit < FLINCH_WINDOW;
    if (flinched) m *= 1 - s * (1 - FLINCH_F);
    const hit = rng() < m;
    return { hit, hs: hit && rng() < sh.hsP[phase] };
  };
  const fire = (sh, target, from, phase, t, burstIdx) => {
    const r = roll(sh, from, phase, t, burstIdx);
    let dmg = 0;
    if (r.hit) {
      const raw = (sh.profile.dmgMax || 143) * (sh.profile.pellets || 1) * (r.hs ? (sh.profile.hsMult || 2) : 1);
      regen(hp[target], (target === "a" ? a : b).cls, st[target], t);
      dmg = damage(hp[target], st[target], raw, t, phase === "trade");
      st[target].lastHit = t;
    }
    shots.push({ t, from, hit: r.hit, hs: r.hs, dmg, phase });
    snap(t);
    return r.hit;
  };
  // ---- trade phase: both fire their trade shots (Poisson around the calibrated mean)
  const tradeMean = (sh, pWin) => Math.max(0, pWin * (sh.spk - sh.N / sh.pCommitEff));
  const nTrade = { a: poisson(tradeMean(a, pWinA), rng), b: poisson(tradeMean(b, pWinB), rng) };
  const tradeShots = { a: [], b: [] };
  for (const side of ["a", "b"]) {
    const sh = side === "a" ? a : b;
    let t = 0;
    for (let i = 0; i < nTrade[side]; i++) {
      if (i % sh.burstLen === 0 && i > 0) t += 0.3 + rng() * 0.7; // pause between bursts (kept short: long trades would otherwise stretch duel gaps past the lognormal)
      tradeShots[side].push(t);
      t += 1 / sh.rate;
    }
  }
  const tradeEnd = Math.max(0, ...tradeShots.a, ...tradeShots.b);
  // Loser's return fire during the commit window comes out of the same trade
  // budget: half the loser's trade shots fire in trade, the rest in commit.
  const splitAt = win ? Math.ceil(nTrade[lName] / 2) : nTrade[lName];
  const merged = [];
  for (const side of ["a", "b"]) {
    const times = tradeShots[side];
    const cut = side === lName ? splitAt : times.length;
    times.slice(0, cut).forEach((t) => merged.push({ t, side, phase: "trade" }));
    if (side === lName) times.slice(cut).forEach((t, i) => merged.push({ t: null, side, phase: "trade", defer: i })); // placed in commit below
  }
  merged.sort((x, y) => (x.t ?? 1e9) - (y.t ?? 1e9));
  let bi = { a: 0, b: 0 };
  for (const s of merged) {
    if (s.t == null) continue;
    const sh = s.side === "a" ? a : b, tgt = s.side === "a" ? "b" : "a";
    fire(sh, tgt, s.side, "trade", s.t, bi[s.side]++ % sh.burstLen);
  }
  if (!win) {
    if (result === "third") {
      const victim = opts.victim ?? (rng() < 0.5 ? "a" : "b");
      const t = tradeEnd + 0.1;
      regen(hp[victim], (victim === "a" ? a : b).cls, st[victim], t);
      const dealt = damage(hp[victim], st[victim], hpTotal(hp[victim]), t, false);
      shots.push({ t, from: "third", hit: true, hs: false, dmg: dealt, phase: "trade" });
      snap(t);
    }
    return { shots, hp: { a: hpA, b: hpB }, result };
  }
  // ---- commit phase: roll the winner's shots first (damage to the loser
  // depends only on them), place the loser's return fire in the window, then
  // apply everything in time order so the HP trace is consistent. Winner
  // flinch uses trade-phase hits only (return fire lands after his rolls);
  // the effect is ~1.5% and inside Monte Carlo tolerance.
  hp.a = makeHp(a.cls); hp.b = makeHp(b.cls);
  st.a = { lastDmg: -1e9, lastRegen: -1e9, lastHeal: -1e9, lastHit: -1e9 };
  st.b = { lastDmg: -1e9, lastRegen: -1e9, lastHeal: -1e9, lastHit: -1e9 };
  if (W.cls === "ha") hp[wName].over = OVERSHIELD;
  const commitStart = tradeEnd + 0.5; // the lull: both regen to full
  snap(commitStart);
  const loserTotal = hpTotal(hp[lName]);
  const wRolls = [];
  let t = commitStart, idx = 0, dealt = 0, killAt = null;
  while (dealt < loserTotal && wRolls.length < 1000) {
    const r = roll(W, wName, "commit", t, idx++ % W.burstLen);
    wRolls.push({ t, ...r });
    if (r.hit) dealt += (W.profile.dmgMax || 143) * (W.profile.pellets || 1) * (r.hs ? (W.profile.hsMult || 2) : 1);
    if (dealt >= loserTotal) { killAt = t; break; }
    t += 1 / W.rate;
  }
  const deferred = merged.filter((s) => s.t == null);
  const lRolls = [];
  if (deferred.length && killAt != null) {
    const span = killAt - commitStart;
    const wHitTimes = wRolls.filter((r) => r.hit).map((r) => r.t);
    deferred.forEach((s, i) => {
      const tt = commitStart + (span * (i + 1)) / (deferred.length + 1);
      lRolls.push({ t: tt, ...roll(L, lName, "trade", tt, bi[lName]++ % L.burstLen, wHitTimes) });
    });
  }
  const commitEvents = [
    ...wRolls.map((r) => ({ ...r, side: wName, phase: "commit", first: 0 })),
    ...lRolls.map((r) => ({ ...r, side: lName, phase: "trade", first: 1 })),
  ].sort((x, y) => x.t - y.t || x.first - y.first);
  for (const e of commitEvents) {
    const sh = e.side === "a" ? a : b, tgt = e.side === "a" ? "b" : "a";
    let dmg = 0;
    if (e.hit) {
      const raw = (sh.profile.dmgMax || 143) * (sh.profile.pellets || 1) * (e.hs ? (sh.profile.hsMult || 2) : 1);
      regen(hp[tgt], (tgt === "a" ? a : b).cls, st[tgt], e.t);
      dmg = damage(hp[tgt], st[tgt], raw, e.t, e.phase === "trade");
      st[tgt].lastHit = e.t;
    }
    shots.push({ t: e.t, from: e.side, hit: e.hit, hs: e.hs, dmg, phase: e.phase });
    snap(e.t);
  }
  return { shots, hp: { a: hpA, b: hpB }, result, killAt };
}
