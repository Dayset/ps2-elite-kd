/**
 * Player normalization + per-player table metrics, shared by the main page
 * (app.js stats tables) and build-log.html (red-flag review) so numbers match.
 * DOM-free; Node tests import it too.
 */
import {
  isFiniteNum,
  kpmCurve,
  rfIf,
  adjustedIvi,
  speedAdjustedIvi,
  combatOutput,
  projectedMech,
  curveSlope,
  pressureVolume,
  resolveIvi,
  deathMixLite,
} from "./math.mjs?v=20261009-buildlog";
import { splitFarm } from "./padding.mjs?v=20261009-buildlog";

/**
 * Minimum fights before the opponent-sample metrics (THIN_METRICS: 🏃 Activity,
 * 🦁 Brave, ⚔️ iVi, …) are shown (user, 2026-10-09:
 * "a proper account is at least 100 kills", about an hour of play). The death
 * floor stops a 100+ kill / 1-death sample from blowing up K/D. Counted over
 * the same opponent rows Activity is built from (rfIf kills / deaths).
 * Display only: red flags (red-flags.mjs) and 🌱 sprouts still read the raw
 * metric values (m.pvs, m.adjs, …), so they work exactly as before.
 */
export const MIN_FIGHTS = Object.freeze({ KILLS: 100, DEATHS: 5 });

/** Hover text for a blanked cell. */
export const MIN_FIGHTS_TIP =
  `Too few fights to measure (needs ${MIN_FIGHTS.KILLS}+ kills and ${MIN_FIGHTS.DEATHS}+ deaths)`;

/**
 * Metrics built from the opponent sample (K/D against the cached rows): all
 * blow up on tiny samples (a 75-kill / 2-death account showed 🦁 Brave 6094,
 * 🛡️ Resist 21, ☠️ K/D 37, ⚔️ iVi 4343). Shown as "—" below MIN_FIGHTS on the
 * main table and ranks.html. Public Census numbers (KD, KPM, Acc, HSR, IvI)
 * are lifetime values and stay as reported.
 */
export const THIN_METRICS = Object.freeze(["adjs", "adj", "rf", "act", "pvs", "rkd", "mech", "coi", "slope", "inflation"]);
const THIN_SET = new Set(THIN_METRICS);

/** Value as shown on the page: NaN for THIN_METRICS when the sample is below MIN_FIGHTS. */
export function shownValue(m, id) {
  if (!m) return NaN;
  if (m.thin && THIN_SET.has(id)) return NaN;
  return m[id];
}

/** True when the sample is big enough for the THIN_METRICS. */
export function enoughFights(kills, deaths, min = MIN_FIGHTS) {
  return (+kills || 0) >= min.KILLS && (+deaths || 0) >= min.DEATHS;
}

/** Raw cache / live / shared player JSON → the shape the charts & tables use. */
export function normalizePlayer(raw) {
  const p = raw.player || raw;
  const rows = (p.rows || []).map((r) => ({
    name: r.name || "",
    kills: +r.kills || 0,
    deaths: +r.deaths || 0,
    kpm: +r.kpm || 0,
  }));
  const normCurve = (c) =>
    c.map((pt) => ({
      kpm: +pt.kpm,
      kd: pt.kd == null || pt.kd !== pt.kd ? NaN : +pt.kd,
      kills: +pt.kills || 0,
      deaths: +pt.deaths || 0,
      n: +pt.n || 0,
    }));
  let rawCurve = p.curve;
  if (!rawCurve || !rawCurve.length) rawCurve = kpmCurve(rows);
  rawCurve = normCurve(rawCurve);
  // Farm victims (padding.mjs) leave the opponent sample for everyone: graph
  // lines and every opponent-based metric use the kept rows only. rawRows /
  // rawCurve keep the original sample (red-flag rules, browser cache).
  const farm = splitFarm(rows);
  const hasFarm = farm.victims.length > 0;
  const keptRows = hasFarm ? farm.kept : rows;
  const curve = hasFarm ? normCurve(kpmCurve(keptRows)) : rawCurve;
  return {
    display: p.display || p.name || "?",
    cid: p.cid || "",
    global_kd: +p.global_kd || 0,
    global_kpm: +p.global_kpm || 0,
    own_kpm: +p.own_kpm || +p.global_kpm || 0,
    acc: p.acc != null ? +p.acc : null,
    hsr: p.hsr != null ? +p.hsr : null,
    ivi: p.ivi != null ? +p.ivi : null,
    rows: keptRows,
    curve,
    rawRows: rows,
    rawCurve,
    farm: { victims: farm.victims, kills: farm.kills, deaths: farm.deaths, share: farm.share },
    honu: p.honu || (p.cid ? `https://wt.honu.pw/c/${p.cid}/killboard` : ""),
    source: raw._source || "local",
  };
}

/** The same player with the ORIGINAL opponent sample (farm victims kept). */
export function rawSampleView(p) {
  if (!p || !p.farm || !p.farm.victims || !p.farm.victims.length) return p;
  return { ...p, rows: p.rawRows, curve: p.rawCurve, farm: { victims: [], kills: 0, deaths: 0, share: 0 } };
}

/**
 * One stats-table row (public + adjusted columns) for a normalized player.
 * Numbers use the sample without farm victims. m.raw = the same row on the
 * original sample (only differs when farm victims were excluded): the older
 * red-flag rules and 🌱 sprouts read it so their results don't shift.
 */
export function playerMetrics(p) {
  const m = metricsRow(p);
  const rawP = rawSampleView(p);
  m.raw = rawP === p ? m : metricsRow(rawP);
  return m;
}

function metricsRow(p) {
  const m = rfIf(p);
  const ivi = resolveIvi(p);
  const rf = m && isFiniteNum(m.rf) ? m.rf : NaN;
  const act = m && isFiniteNum(m.ifactor) ? m.ifactor : NaN;
  const rkd = m && isFiniteNum(m.rkd) ? m.rkd : NaN;
  const ekpm = m && isFiniteNum(m.avg_opp) ? m.avg_opp : NaN;
  const own = m && isFiniteNum(m.own) ? m.own : (+p.own_kpm || +p.global_kpm || NaN);
  const slope = curveSlope(p);
  const dm = deathMixLite(p);
  const adj = adjustedIvi(ivi, rf);
  const ownKpm = p.own_kpm || p.global_kpm;
  const sampleKills = m && isFiniteNum(m.kills) ? m.kills : 0;
  const sampleDeaths = m && isFiniteNum(m.deaths) ? m.deaths : 0;
  const thin = !enoughFights(sampleKills, sampleDeaths);
  const pvs = pressureVolume(act, slope);
  return {
    p,
    m,
    kd: p.global_kd,
    kpm: p.global_kpm,
    ownKpm,
    acc: p.acc,
    hsr: p.hsr,
    ivi,
    rkd,
    ekpm,
    own,
    rf,
    act,
    coi: combatOutput(rf),
    mech: projectedMech(rf),
    slope,
    // Unblanked values (build-log shows them; red-flag rules read m.raw).
    pvs,
    // Sample size; below MIN_FIGHTS the page shows THIN_METRICS as "—" (shownValue).
    sampleKills,
    sampleDeaths,
    thin,
    adj,
    // ⚡ ivi: 🎯🎈 ivi adjusted for own kill speed (slow, safe KD counts for less).
    adjs: speedAdjustedIvi(adj, ownKpm),
    kd05: dm.kd05,
    // Farm victims taken out of this sample (padding.mjs); empty for most players.
    farm: p.farm || { victims: [], kills: 0, deaths: 0, share: 0 },
    inflation: dm.inflation,
  };
}
