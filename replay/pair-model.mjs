/**
 * 📊 Pair model (replay #92): pure aggregation of measured rivalries into
 * data/replay/pair-model.json, the shape the duel planner (#96) reads.
 *
 * A per-pair measurement (what scripts/measure-rivalries.mjs stores in the
 * checkpoint, one object per pair) carries:
 *   band, vol (killboard kills+deaths), killsA_kb (killboard kills by A),
 *   complete (1 when the read reached the killboard count or the history end),
 *   fights, killsPerFight[], gaps[] (intra-fight, seconds),
 *   revengeGaps[] (from a kill to the next kill by the other side, seconds),
 *   sameKiller / consecutive (streak counts), oneFights / totalFights,
 *   hsKills / pairKills, lifeHS (kill-weighted lifetime HS ratio 0..1, or null),
 *   vehKills, lifeVeh (kill-weighted lifetime vehicle share 0..1, or null),
 *   mainKills (pair kills with the killer's main weapon),
 *   crowdOther / crowdWindows (pager's other kills+deaths within ±60 s of a
 *   pair kill; windows = pair kills, so crowdPerMin = other / (2 × windows)),
 *   classMatch { "HA vs HA": n, ... } (killer class vs victim class),
 *   shareMeasured / shareKillboard / shareExpected (A's kill share, complete
 *   pairs only — a truncated read's share is a recent window, not all-time).
 *
 * Aggregation rules (documented because #96 reads these numbers):
 *   - fightsPerPair and the share fields use COMPLETE pairs only (a truncated
 *     read undercounts fights and biases the share); everything else uses all
 *     measured pairs (their fights are real fights, just not all of them).
 *   - shares (oneVoneShare, mainWeaponShare) are pooled ratios; factors
 *     (hsFactor, vehFactor) are medians of per-pair ratios; gaps are pooled
 *     lognormal fits (median = exp(mean ln), sigma = sd ln).
 *   - classMatch shares are pooled over kills with both classes known.
 *   - bands with no pairs are omitted; a field is null when its data is absent.
 */
import { classOf } from "../duels.mjs";

/** Sorted ascending copy; quantile with linear interpolation. */
export function quantile(values, q) {
  const s = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export const median = (v) => quantile(v, 0.5);
export const p10 = (v) => quantile(v, 0.1);
export const p90 = (v) => quantile(v, 0.9);

/** Lognormal fit of positive gaps: { median, sigma } (nulls when empty). */
export function lognormalFit(gaps) {
  const xs = gaps.filter((g) => Number.isFinite(g) && g > 0).map(Math.log);
  if (!xs.length) return { median: null, sigma: null };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return { median: Math.exp(mean), sigma: sd };
}

const lowerBound = (ts, t) => { let lo = 0, hi = ts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ts[m] < t) lo = m + 1; else hi = m; } return lo; };
const upperBound = (ts, t) => { let lo = 0, hi = ts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ts[m] <= t) lo = m + 1; else hi = m; } return lo; };

/**
 * One pair's measurements from its pair events (pairEvents output, oldest
 * first), its fights (fightsOf output), the pager's full compact history
 * (st.all: [ts, kill, otherId, weapon, hs, zone, myLoadout, otherLoadout, veh])
 * and per-side lifetime stats { hsr, veh } (0..1 or null) and main weapon ids.
 * A = the canonically-first player; pe entries carry aKill (true = A killed).
 */
export function measurePair(pe, fights, all, pagerCid, qid, lifeA, lifeB, mainA, mainB) {
  const kills = pe || [];
  const killsA = kills.filter((e) => e.aKill).length;
  const killsB = kills.length - killsA;
  const gaps = [];
  for (let i = 1; i < kills.length; i++) {
    const g = kills[i].t - kills[i - 1].t;
    if (g <= 600) gaps.push(g);
  }
  const revengeGaps = [];
  for (let i = 0; i < kills.length; i++) {
    for (let j = i + 1; j < kills.length; j++) {
      if (kills[j].aKill !== kills[i].aKill) { revengeGaps.push(kills[j].t - kills[i].t); break; }
    }
  }
  let sameKiller = 0;
  for (let i = 1; i < kills.length; i++) if (kills[i].aKill === kills[i - 1].aKill) sameKiller++;
  const classMatch = {};
  for (const e of kills) {
    const kc = classOf(e.aKill ? e.aL : e.bL), vc = classOf(e.aKill ? e.bL : e.aL);
    if (!kc || !vc) continue;
    const k = `${kc} vs ${vc}`;
    classMatch[k] = (classMatch[k] || 0) + 1;
  }
  // Crowding, pager side only (the read covers one player's history): the
  // pager's other kills+deaths within ±60 s of each pair kill.
  const me = String(pagerCid), q = String(qid);
  const otherTs = (all || [])
    .filter((x) => x && x[2] && x[2] !== "0" && x[2] !== me && x[2] !== q)
    .map((x) => x[0]).sort((a, b) => a - b);
  let crowdOther = 0;
  for (const e of kills) crowdOther += upperBound(otherTs, e.t + 60) - lowerBound(otherTs, e.t - 60);
  const lifeHS = (lifeA.hsr != null && lifeB.hsr != null && kills.length)
    ? (killsA * lifeA.hsr + killsB * lifeB.hsr) / kills.length : null;
  const lifeVeh = (lifeA.veh != null && lifeB.veh != null && kills.length)
    ? (killsA * lifeA.veh + killsB * lifeB.veh) / kills.length : null;
  const mainKills = kills.filter((e) => {
    const m = e.aKill ? mainA : mainB;
    return m != null && String(e.w) === String(m);
  }).length;
  const fs = fights || [];
  return {
    fights: fs.length,
    killsPerFight: fs.map((f) => f.ev.length),
    gaps, revengeGaps, sameKiller, consecutive: Math.max(0, kills.length - 1),
    oneFights: fs.filter((f) => f.one).length, totalFights: fs.length,
    hsKills: kills.filter((e) => e.hs).length, pairKills: kills.length, lifeHS,
    vehKills: kills.filter((e) => e.veh !== 0).length, lifeVeh, mainKills,
    crowdOther, crowdWindows: kills.length, classMatch,
    shareMeasured: kills.length ? killsA / kills.length : null,
  };
}

function bandStats(list) {
  const complete = list.filter((m) => m.complete);
  const gapFit = lognormalFit(list.flatMap((m) => m.gaps));
  const revMed = median(list.flatMap((m) => m.revengeGaps));
  const kpf = list.flatMap((m) => m.killsPerFight);
  const same = list.reduce((a, m) => a + m.sameKiller, 0);
  const cons = list.reduce((a, m) => a + m.consecutive, 0);
  const one = list.reduce((a, m) => a + m.oneFights, 0);
  const tf = list.reduce((a, m) => a + m.totalFights, 0);
  const hsF = median(list.filter((m) => m.lifeHS != null && m.lifeHS > 0 && m.pairKills)
    .map((m) => (m.hsKills / m.pairKills) / m.lifeHS));
  const vehF = median(list.filter((m) => m.lifeVeh != null && m.lifeVeh > 0 && m.pairKills)
    .map((m) => (m.vehKills / m.pairKills) / m.lifeVeh));
  const mainN = list.reduce((a, m) => a + m.mainKills, 0);
  const pkN = list.reduce((a, m) => a + m.pairKills, 0);
  const crowdN = list.reduce((a, m) => a + m.crowdOther, 0);
  const crowdW = list.reduce((a, m) => a + m.crowdWindows, 0);
  const cm = {};
  for (const m of list) for (const [k, n] of Object.entries(m.classMatch || {})) cm[k] = (cm[k] || 0) + n;
  const cmTotal = Object.values(cm).reduce((a, b) => a + b, 0);
  const classMatch = {};
  if (cmTotal) for (const [k, n] of Object.entries(cm)) classMatch[k] = n / cmTotal;
  const out = {
    pairs: list.length,
    fightsPerPair: complete.length ? [p10(complete.map((m) => m.fights)), median(complete.map((m) => m.fights)), p90(complete.map((m) => m.fights))] : null,
    killsPerFight: kpf.length ? [p10(kpf), median(kpf), p90(kpf)] : null,
    gapMedianS: gapFit.median, gapSigma: gapFit.sigma, revengeMedianS: revMed,
    streakP: cons ? same / cons : null,
    oneVoneShare: tf ? one / tf : null,
    hsFactor: hsF, vehFactor: vehF,
    mainWeaponShare: pkN ? mainN / pkN : null,
    crowdPerMin: crowdW ? crowdN / (2 * crowdW) : null,
    classMatch,
  };
  if (complete.length) {
    out.shareMeasured = median(complete.map((m) => m.shareMeasured).filter((v) => v != null));
    out.shareKillboard = median(complete.map((m) => m.shareKillboard).filter((v) => v != null));
    out.shareExpected = median(complete.map((m) => m.shareExpected).filter((v) => v != null));
    out.shareAbsErrExpected = median(complete.filter((m) => m.shareMeasured != null && m.shareExpected != null)
      .map((m) => Math.abs(m.shareMeasured - m.shareExpected)));
    out.shareAbsErrKillboard = median(complete.filter((m) => m.shareMeasured != null && m.shareKillboard != null)
      .map((m) => Math.abs(m.shareMeasured - m.shareKillboard)));
  }
  return out;
}

/** Per-pair measurements (checkpoint values) → the pair-model.json object. */
export function aggregate(measurements, at = new Date().toISOString()) {
  const list = (measurements || []).filter((m) => m && m.pairKills > 0);
  const bands = {};
  for (const m of list) {
    if (!m.band) continue;
    (bands[m.band] ||= []).push(m);
  }
  const bandOut = {};
  for (const [k, v] of Object.entries(bands)) bandOut[k] = bandStats(v);
  const all = bandStats(list);
  const { shareMeasured, shareKillboard, shareExpected, shareAbsErrExpected, shareAbsErrKillboard, fightsPerPair, pairs, ...rest } = all;
  return { v: 1, at, pairs: list.length, bands: bandOut, defaults: rest };
}

/** Shape + plausible-range check of a pair-model.json object → error strings. */
export function validateModel(model) {
  const errs = [];
  if (!model || model.v !== 1) errs.push("v must be 1");
  if (!model || typeof model.at !== "string") errs.push("at must be an ISO string");
  if (!model || !Number.isInteger(model.pairs) || model.pairs < 0) errs.push("pairs must be a non-negative integer");
  if (!model || typeof model.bands !== "object") errs.push("bands must be an object");
  if (!model || typeof model.defaults !== "object") errs.push("defaults must be an object");
  const range = (v, lo, hi, name) => {
    if (v == null) return;
    if (!Number.isFinite(v) || v < lo || v > hi) errs.push(`${name} out of range: ${v}`);
  };
  const check = (d, where) => {
    if (!d) return;
    range(d.gapMedianS, 0, 600, `${where}.gapMedianS`);
    range(d.gapSigma, 0, 3, `${where}.gapSigma`);
    range(d.revengeMedianS, 0, 10 * 365 * 24 * 3600, `${where}.revengeMedianS`); // sparse pairs revenge across years; the bound catches ms-vs-s unit errors, not real gaps
    if (d.killsPerFight != null) {
      const k = d.killsPerFight;
      if (!Array.isArray(k) || k.length !== 3 || !(k[0] <= k[1] && k[1] <= k[2]) || k.some((x) => !Number.isFinite(x) || x < 1 || x > 100))
        errs.push(`${where}.killsPerFight must be [p10, p50, p90] in 1..100`);
    }
    range(d.streakP, 0, 1, `${where}.streakP`);
    range(d.oneVoneShare, 0, 1, `${where}.oneVoneShare`);
    range(d.hsFactor, 0, 5, `${where}.hsFactor`);
    range(d.vehFactor, 0, 5, `${where}.vehFactor`);
    range(d.mainWeaponShare, 0, 1, `${where}.mainWeaponShare`);
    range(d.crowdPerMin, 0, 100, `${where}.crowdPerMin`);
    if (d.classMatch && typeof d.classMatch === "object") {
      const sum = Object.values(d.classMatch).reduce((a, b) => a + b, 0);
      if (Object.keys(d.classMatch).length && Math.abs(sum - 1) > 0.01) errs.push(`${where}.classMatch shares must sum to 1`);
      for (const [k, v] of Object.entries(d.classMatch)) {
        if (!/^(inf|la|med|eng|ha|max) vs (inf|la|med|eng|ha|max)$/.test(k)) errs.push(`${where}.classMatch bad key: ${k}`);
        range(v, 0, 1, `${where}.classMatch[${k}]`);
      }
    }
  };
  check(model && model.defaults, "defaults");
  if (model && model.bands) for (const [k, d] of Object.entries(model.bands)) check(d, `bands.${k}`);
  return errs;
}
