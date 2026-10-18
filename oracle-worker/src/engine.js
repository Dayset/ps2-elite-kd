/**
 * PS2MapOracle odds engine: a faithful JS port of the Python live path
 * (push_live_state.compute_win / second_place / build_state calls+hints,
 * build_winbins_growtree.lookup, live_oracle.max_swing_pp).
 *
 * Pure functions, no I/O. Trees come in pre-split per 5-minute time bin
 * (see build-trees.mjs) so a run only parses the ~20 KB bin it needs.
 * Parity with Python is checked by test/oracle-engine.test.mjs.
 */

export const FACS = ["VS", "NC", "TR"];
export const FAC_ID = { 1: "VS", 2: "NC", 3: "TR" };

export const WORLD_NAMES = { 1: "Osprey", 10: "Wainwright", 25: "Briggs", 40: "SolTech" };
export const ZONE_NAMES = { 2: "Indar", 4: "Hossin", 6: "Amerish", 8: "Esamir", 344: "Oshur" };
// Briggs (25) was merged in 2019; Census returns nothing for it (no map, events or flips since migration).
export const WORLDS = [1, 10, 40];
export const ZONES = [2, 4, 6, 8, 344];

// Territory alert metagame_event_id -> duration (min). Same table as
// push_live_state.TERRITORY_ALERTS (verified there 2026-10-11).
export const TERRITORY_ALERTS = {
  147: 90, 148: 90, 149: 90, 150: 90, 151: 90, 152: 90, 153: 90, 154: 90,
  155: 90, 156: 90, 157: 90, 158: 90, 211: 90, 212: 90, 213: 90, 214: 90,
  176: 45, 177: 45, 178: 45, 179: 45, 186: 45, 187: 45, 188: 45, 189: 45,
  190: 45, 191: 45, 192: 45, 193: 45, 208: 45, 209: 45, 210: 45, 215: 45,
  222: 45, 223: 45, 224: 45, 226: 45,
  248: 30, 249: 30, 250: 30,
};
// 227 is OUTFIT WARS (Census metagame_event, 45 min): not a public alert, never tracked.
// Unstable Meltdown (Census names, verified 2026-10-18). Their final score is not
// whole-map territory (Census ended scores sum to ~30-40%) and the trees were
// trained on 90-min territory alerts only, so odds for these are unvalidated.
export const MELTDOWN = new Set([176, 177, 178, 179, 186, 187, 188, 189, 190, 191, 192, 193, 248, 249, 250]);
export const alertKind = (eventId) => (MELTDOWN.has(+eventId) ? "meltdown" : "territory");
// Kill-based overtime after a territory draw (Census: "Sudden Death", 15 min; 240 is 10 min).
// Matched to the alert by the row's own world+zone, not by event id.
export const SUDDEN_DEATH = { 236: 15, 237: 15, 238: 15, 239: 15, 240: 10 };

// Elimination constants (live_oracle.py; Hossin's 88 facilities are used
// for every continent there too — kept identical for parity).
const N_FAC = 88;
const PP_PER_FAC = 100.0 / N_FAC;
const LANES = 3, MIN_PER_BASE = 3.0;

export function maxSwingPP(t, dur = 90, nFac = N_FAC) {
  const rem = dur - t;
  return rem > 0 ? LANES * Math.floor(rem / MIN_PER_BASE) * (2 * (100.0 / nFac)) : 0;
}

/**
 * Unstable Meltdown alerts are fought on part of the continent only: the rest is
 * locked and shows as neutral ("0") on the Census map, and Census scores each
 * faction as a share of the whole map, so final scores add up to ~31-57 %.
 * The winner is whoever holds most of the live zone. The tree was grown on
 * normal alerts (owned territory ~100 %), so Meltdowns are read on the live zone
 * only: neutral regions are dropped before shares, momentum, elimination and the
 * commander. (Worker-only; the retired Python pipeline never did this.)
 */
export function liveZone(snap) {
  const out = {};
  let total = 0;
  for (const [r, f] of Object.entries(snap || {})) { total++; if (f === "1" || f === "2" || f === "3") out[r] = f; }
  const active = Object.keys(out).length;
  return active >= 3 ? { snap: out, active, total } : { snap: snap || {}, active: total, total };
}

/** Meltdown odds are pulled toward even until live data validates them (leave-one-out fit on past Meltdowns, 2026-10-18). */
export const MELTDOWN_SHRINK = 0.6;

/** Mix even odds into every faction that is not mathematically out; renormalise. */
export function shrinkToEven(win, alpha) {
  const out = {};
  const alive = FACS.filter((f) => win[f].pct > 0);
  if (alive.length <= 1) { for (const f of FACS) out[f] = { ...win[f] }; return out; }
  const even = 100 / alive.length;
  let tot = 0;
  for (const f of FACS) { const p = win[f].pct > 0 ? (1 - alpha) * win[f].pct + alpha * even : 0; out[f] = { ...win[f], pct: p }; tot += p; }
  for (const f of FACS) out[f].pct = round1((100 * out[f].pct) / tot);
  return out;
}

/** Python round(x, n): round-half-even on the decimal value, close enough for display. */
export function round1(x) {
  const r = Math.round(x * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
}

/** max(d, key=d.get) over keys in FACS order (first max wins, like Python). */
function argmax(d, keys = FACS) {
  let best = null;
  for (const k of keys) if (best === null || d[k] > d[best]) best = k;
  return best;
}

export function territory(facilities) {
  const c = { 1: 0, 2: 0, 3: 0 };
  let total = 0;
  for (const v of Object.values(facilities)) {
    const f = parseInt(v, 10);
    total += 1;
    if (f in c) c[f] += 1;
  }
  total = total || 1;
  return { VS: (100 * c[1]) / total, NC: (100 * c[2]) / total, TR: (100 * c[3]) / total };
}

const momBucket = (m) => (m >= 3 ? "up" : m <= -3 ? "down" : "flat");
const margBucket = (g) => (g < 0 ? "behind" : g < 10 ? "close" : g < 20 ? "clear" : "dominant");
function magBucket(mb, m) {
  if (mb === "up") return m >= 8 ? "hot" : "warm";
  if (mb === "down") return m <= -8 ? "cold" : "cool";
  return null;
}

/**
 * build_winbins_growtree.lookup. `bin` = {trunk,branch,twig,shoot,leaf} for
 * one time bin; `xbin` = xtrunk cells for that bin. Returns [pct, level, n].
 */
export function lookup(bin, xbin, b, fac, terr, mom, marg, rival) {
  const tb = Math.min(Math.floor(terr / 5), 20);
  const mb = momBucket(mom);
  const gb = margBucket(marg);
  const magb = magBucket(mb, mom);
  const names = ["trunk", "branch", "twig", "shoot", "leaf"];
  const keys = [`${b},${fac},${tb}`, `${b},${fac},${tb},${mb}`, `${b},${fac},${tb},${mb},${gb}`];
  if (magb) {
    keys.push(`${b},${fac},${tb},${mb},${gb},${magb}`);
    keys.push(`${b},${fac},${tb},${mb},${gb},${magb},${rival}`);
  }
  for (let i = keys.length - 1; i >= 0; i--) {
    const cell = (bin[names[i]] || {})[keys[i]];
    if (cell) return [(100 * cell[0]) / cell[1], names[i], cell[1]];
  }
  if (xbin) {
    const cell = xbin[`${b},${fac},${tb}`];
    if (cell) return [(100 * cell[0]) / cell[1], "xtrunk", cell[1]];
  }
  return [null, "none", 0];
}

/** Time bin index for minute t of an alert of length dur (duration-aware rescale). */
export function timeBin(t, dur = 90) {
  const tEff = dur ? (t * 90) / dur : t;
  return Math.min(Math.floor(Math.max(0, Math.trunc(tEff)) / 5), 18);
}

/**
 * push_live_state.compute_win. getBin(b) -> {bin, xbin}.
 * Returns {win, raw, trunkv}.
 */
export function computeWin(getBin, terr, mom, t, dur = 90, nFac = N_FAC) {
  const b = timeBin(t, dur);
  const { bin, xbin } = getBin(b);
  const win = {}, raw = {}, trunkv = {};
  for (const f of FACS) {
    const others = FACS.filter((k) => k !== f);
    const marg = terr[f] - Math.max(...others.map((k) => terr[k]));
    const rival = argmax(terr, others);
    let [p, level, n] = lookup(bin, xbin, b, f, terr[f], mom[f], marg, rival);
    if (p === null) { p = 0; level = "trunk"; n = 0; }
    raw[f] = p;
    const tb = Math.min(Math.floor(Math.trunc(terr[f]) / 5), 20);
    const cell = (bin.trunk || {})[`${b},${f},${tb}`];
    const trunk = cell ? (100 * cell[0]) / cell[1] : p;
    trunkv[f] = trunk;
    win[f] = { pct: round1(p), level, n, trunk: round1(trunk) };
  }
  const leader = argmax(terr);
  for (const f of FACS) {
    if (f !== leader && maxSwingPP(t, dur, nFac) < terr[leader] - terr[f]) win[f].pct = 0;
  }
  if (FACS.filter((f) => f !== leader).every((f) => win[f].pct === 0)) win[leader].pct = 100;
  const tot = FACS.reduce((s, f) => s + win[f].pct, 0);
  if (tot > 0) for (const f of FACS) win[f].pct = round1((100 * win[f].pct) / tot);
  return { win, raw, trunkv };
}

/** push_live_state.second_place: odds between the two non-winners once the winner is locked. */
export function secondPlace(terr, raw, trunkv, t, dur = 90, nFac = N_FAC) {
  const leader = argmax(terr);
  const swing = maxSwingPP(t, dur, nFac);
  if (!FACS.filter((f) => f !== leader).every((f) => swing < terr[leader] - terr[f])) return null;
  const [B, C] = FACS.filter((f) => f !== leader);
  if (swing < Math.abs(terr[B] - terr[C])) {
    const w2 = terr[B] > terr[C] ? B : C;
    const l2 = w2 === B ? C : B;
    return { odds: { [w2]: 100, [l2]: 0 }, locked: true, basis: "locked" };
  }
  let qb, qc, basis;
  if (Math.max(raw[B], raw[C]) >= 5) { qb = raw[B]; qc = raw[C]; basis = "scenario"; }
  else { qb = trunkv[B]; qc = trunkv[C]; basis = "trunk"; }
  if (qb + qc <= 0) { qb = 50; qc = 50; basis = "even"; }
  const tot = qb + qc;
  return { odds: { [B]: round1((100 * qb) / tot), [C]: round1((100 * qc) / tot) }, locked: false, basis };
}

/** build_state calls/hints (momentum as relative %, never pp). */
export function callsAndHints(terr, mom, win, t, dur = 90, nFac = N_FAC) {
  const leader = argmax(terr);
  const momPct = (f) => {
    const base = terr[f] || 0;
    const v = base < 1 ? mom[f] : (100 * mom[f]) / base;
    return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%/15min`;
  };
  const calls = [], hints = [];
  for (const f of FACS) {
    if (f !== leader && mom[f] <= -5) {
      const c = `collapse pattern forming for ${f} (${momPct(f)})`;
      calls.push(c); hints.push(c);
    }
    if (f !== leader && win[f].pct === 0 && maxSwingPP(t, dur, nFac) < terr[leader] - terr[f]) {
      calls.push(`${f} mathematically eliminated`);
    }
  }
  if (mom[leader] >= 5) calls.push(`${leader} extending (${momPct(leader)})`);
  if (mom[leader] <= -5) calls.push(`${leader} collapsing (${momPct(leader)})`);
  return { leader, calls, hints };
}

/**
 * Full live state in the push_live contract (FRONTEND_SPEC §4).
 * snapNow/snap15: {region: faction} maps for this zone; regionMap: region -> facility.
 */
/**
 * Win odds for one moment, Meltdown-aware. Territory alerts: unchanged engine.
 * Meltdowns: live-zone shares, live-zone elimination, then shrinkToEven.
 * Returns {terr, mom, win, raw, trunkv, nFac, zone?, winRaw?, winV0?}.
 */
export function forecast({ getBin, kind, snapNow, snap15, t, dur, zeroMomentum = false }) {
  const momOf = (a, b) => Object.fromEntries(FACS.map((f) => [f, zeroMomentum ? 0 : a[f] - b[f]]));
  if (kind !== "meltdown") {
    const terr = territory(snapNow);
    const mom = momOf(terr, snap15 ? territory(snap15) : terr);
    return { terr, mom, nFac: N_FAC, ...computeWin(getBin, terr, mom, t, dur) };
  }
  const z = liveZone(snapNow);
  const z15 = snap15 ? liveZone(snap15) : z;
  const terr = territory(z.snap);
  const mom = momOf(terr, territory(z15.snap));
  const { win: winRaw, raw, trunkv } = computeWin(getBin, terr, mom, t, dur, z.active);
  // What the engine said before 2026-10-18 (whole-map shares), logged for comparison.
  const terrAll = territory(snapNow);
  const winV0 = computeWin(getBin, terrAll, momOf(terrAll, snap15 ? territory(snap15) : terrAll), t, dur).win;
  return { terr, mom, raw, trunkv, nFac: z.active, winRaw, winV0, win: shrinkToEven(winRaw, MELTDOWN_SHRINK),
    zone: { active: z.active, total: z.total, share: round1((100 * z.active) / (z.total || 1)) } };
}

export function buildState({ getBin, world, zone, eventId, instanceId, startTs, dur, now, snapNow, snap15, regionMap }) {
  const t = (now - startTs) / 60;
  const kind = alertKind(eventId);
  const f0 = forecast({ getBin, kind, snapNow, snap15, t, dur });
  const { terr, mom, win, raw, trunkv, nFac } = f0;
  const { leader, calls, hints } = callsAndHints(terr, mom, win, t, dur, nFac);
  const owners = {};
  if (regionMap) {
    for (const [region, fac] of Object.entries(snapNow)) {
      const fid = regionMap[String(region)];
      if (fid && (fac === "1" || fac === "2" || fac === "3")) owners[fid] = FAC_ID[fac];
    }
  }
  const state = {
    ts: Math.trunc(now),
    t: Math.trunc(t),
    live: true,
    alert: { world, zone, event_id: eventId, instance_id: instanceId, start_ts: startTs, duration_min: dur, kind },
    territory: Object.fromEntries(FACS.map((f) => [f, round1(terr[f])])),
    momentum: Object.fromEntries(FACS.map((f) => [f, round1(mom[f])])),
    pop: { VS: 0, NC: 0, TR: 0 },
    outliers: [],
    win,
    win_popadj: null,
    leader,
    calls,
    hints,
    owners,
  };
  if (f0.zone) { state.zone = f0.zone; state.win_raw = f0.winRaw; state.win_v0 = f0.winV0; }
  const sp = secondPlace(terr, raw, trunkv, t, dur, nFac);
  if (sp) state.second = sp;
  return state;
}

/**
 * push_live_state's experimental time-weighted population blend:
 * w = 1 at t0 falling to 0 at t60; adj = (1-w)·tree + w·pop share, renormalised.
 * Returns {VS:{pct},...} or null when there is no population or w = 0.
 */
export function popAdjusted(win, pop, t) {
  const total = FACS.reduce((s, f) => s + (pop[f] || 0), 0);
  if (!(total > 0)) return null;
  const w = Math.max(0, 1 - t / 60);
  if (w <= 0) return null;
  const adj = {};
  for (const f of FACS) adj[f] = (1 - w) * (win[f].pct / 100) + w * ((pop[f] || 0) / total);
  const sum = FACS.reduce((s, f) => s + adj[f], 0);
  return Object.fromEntries(FACS.map((f) => [f, { pct: round1((100 * adj[f]) / sum) }]));
}

/** Benchmark slice minutes per alert length: t0 + two in-alert checkpoints. */
export function sliceMinutes(dur) {
  if (dur >= 90) return { t0: 0, t30: 30, t60: 60 };
  if (dur >= 45) return { t0: 0, t15: 15, t30: 30 };
  return { t0: 0, t10: 10, t20: 20 };
}

/** Brier = Σ(p − o)² / 3 (uniform = 0.2222). */
export function brier(probs, winner) {
  return FACS.reduce((s, f) => s + (probs[f] - (f === winner ? 1 : 0)) ** 2, 0) / 3;
}

/** Winner from a {VS,NC,TR} score object; "draw" when the top two are equal. */
export function scoreWinner(sc) {
  const order = [...FACS].sort((a, b) => sc[b] - sc[a]);
  if (Math.abs(sc[order[0]] - sc[order[1]]) < 1e-6) return "draw";
  return order[0];
}
