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
export const WORLDS = [1, 10, 25, 40];
export const ZONES = [2, 4, 6, 8, 344];

// Territory alert metagame_event_id -> duration (min). Same table as
// push_live_state.TERRITORY_ALERTS (verified there 2026-10-11).
export const TERRITORY_ALERTS = {
  147: 90, 148: 90, 149: 90, 150: 90, 151: 90, 152: 90, 153: 90, 154: 90,
  155: 90, 156: 90, 157: 90, 158: 90, 211: 90, 212: 90, 213: 90, 214: 90,
  176: 45, 177: 45, 178: 45, 179: 45, 186: 45, 187: 45, 188: 45, 189: 45,
  190: 45, 191: 45, 192: 45, 193: 45, 208: 45, 209: 45, 210: 45, 215: 45,
  222: 45, 223: 45, 224: 45, 226: 45, 227: 45,
  248: 30, 249: 30, 250: 30,
};
// Kill-based 15-min overtime after a territory draw: Indar..Oshur.
export const SUDDEN_DEATH = { 236: 2, 237: 4, 238: 6, 239: 8, 240: 344 };

// Elimination constants (live_oracle.py; Hossin's 88 facilities are used
// for every continent there too — kept identical for parity).
const N_FAC = 88;
const PP_PER_FAC = 100.0 / N_FAC;
const LANES = 3, MIN_PER_BASE = 3.0;

export function maxSwingPP(t, dur = 90) {
  const rem = dur - t;
  return rem > 0 ? LANES * Math.floor(rem / MIN_PER_BASE) * (2 * PP_PER_FAC) : 0;
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
export function computeWin(getBin, terr, mom, t, dur = 90) {
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
    if (f !== leader && maxSwingPP(t, dur) < terr[leader] - terr[f]) win[f].pct = 0;
  }
  if (FACS.filter((f) => f !== leader).every((f) => win[f].pct === 0)) win[leader].pct = 100;
  const tot = FACS.reduce((s, f) => s + win[f].pct, 0);
  if (tot > 0) for (const f of FACS) win[f].pct = round1((100 * win[f].pct) / tot);
  return { win, raw, trunkv };
}

/** push_live_state.second_place: odds between the two non-winners once the winner is locked. */
export function secondPlace(terr, raw, trunkv, t, dur = 90) {
  const leader = argmax(terr);
  const swing = maxSwingPP(t, dur);
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
export function callsAndHints(terr, mom, win, t, dur = 90) {
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
    if (f !== leader && win[f].pct === 0 && maxSwingPP(t, dur) < terr[leader] - terr[f]) {
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
export function buildState({ getBin, world, zone, eventId, instanceId, startTs, dur, now, snapNow, snap15, regionMap }) {
  const t = (now - startTs) / 60;
  const terr = territory(snapNow);
  const terr15 = snap15 ? territory(snap15) : terr;
  const mom = {};
  for (const f of FACS) mom[f] = terr[f] - terr15[f];
  const { win, raw, trunkv } = computeWin(getBin, terr, mom, t, dur);
  const { leader, calls, hints } = callsAndHints(terr, mom, win, t, dur);
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
    alert: { world, zone, event_id: eventId, instance_id: instanceId, start_ts: startTs, duration_min: dur },
    territory: Object.fromEntries(FACS.map((f) => [f, round1(terr[f])])),
    momentum: Object.fromEntries(FACS.map((f) => [f, round1(mom[f])])),
    kd: { VS: 1.0, NC: 1.0, TR: 1.0 },
    pop: { VS: 0, NC: 0, TR: 0 },
    outliers: [],
    win,
    win_popadj: null,
    leader,
    calls,
    hints,
    owners,
  };
  const sp = secondPlace(terr, raw, trunkv, t, dur);
  if (sp) state.second = sp;
  return state;
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
