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
} from "./math.mjs?v=20261010-type1";
import { splitFarm } from "./padding.mjs?v=20261010-type1";
import { OPPONENT_TOP_N, LEGACY_TOP_N, sampleTopN } from "./census-fetch.mjs?v=20261010-type1";
import { cleanTimes } from "./flairs.mjs?v=20261010-type1";

/**
 * Older shared-cache files were scored on the top 50 opponents; new fetches use
 * OPPONENT_TOP_N (200). Mixed until the weekly refresh reaches everyone, so a
 * subtle "◦" after the name says so (ranks.html + stats table).
 */
export const LEGACY_SAMPLE_MARK = "◦";
export const LEGACY_SAMPLE_TIP =
  `Based on the top ${LEGACY_TOP_N} opponents (older sample); upgrading to ${OPPONENT_TOP_N} on its next refresh`;

/** True when a normalized player (or raw file) uses fewer opponents than OPPONENT_TOP_N. */
export function isLegacySample(p) {
  if (!p) return false;
  const t = +p.top;
  return (Number.isFinite(t) && t > 0 ? t : sampleTopN(p)) < OPPONENT_TOP_N;
}

/**
 * Minimum fights before the opponent-sample metrics (THIN_METRICS: 🏃 Activity,
 * 🦁 Brave, ⚔️ iVi, …) are shown. The user's bar is "about an hour of play"
 * (2026-10-09: "a proper account is at least 100 kills"). That was first coded
 * as 100 KILLS, which also blanked big-sample low-skill players (e.g. 66 kills /
 * 221 deaths): their sample is large, they just die a lot. So the size test is
 * now FIGHTS = kills + deaths (an hour of play for anyone), plus a floor on
 * each side: DEATHS stops a 100+ kill / 1-death sample from blowing up K/D
 * (add1ti0nal 75/2, geiloVS 172/1, 1stFanOfAhorn 98/1 stay blank), KILLS keeps a
 * 0-kill sample from posing as a measurement. Counted over the same opponent
 * rows Activity is built from (rfIf kills / deaths).
 * Display only: red flags (red-flags.mjs) and 🌱 sprouts still read the raw
 * metric values (m.pvs, m.adjs, …), so they work exactly as before.
 */
export const MIN_FIGHTS = Object.freeze({ FIGHTS: 100, KILLS: 5, DEATHS: 5 });

/** The rule in words (column hints, notes). */
export const MIN_FIGHTS_RULE =
  `at least ${MIN_FIGHTS.FIGHTS} kills + deaths combined, with ${MIN_FIGHTS.KILLS}+ kills and ${MIN_FIGHTS.DEATHS}+ deaths`;

/** Hover text for a blanked cell. */
export const MIN_FIGHTS_TIP = `Too few fights to measure (needs ${MIN_FIGHTS_RULE})`;

/** Summary of the collapsed note under ✨ Adjusted (icon only, t283u). */
export const THIN_MARK = "⚠️";

/** First line of that note, then one thinPlayerLine per player. */
export const THIN_NOTE_HEAD =
  `Too few fights to measure (needs ${MIN_FIGHTS.FIGHTS}+ fights and ${MIN_FIGHTS.KILLS}+ kills and deaths):`;

/** "tupapacu: 22 kills / 60 deaths" or "xMasterBobx: no fights on record". */
export function thinPlayerLine(name, kills, deaths) {
  const k = +kills || 0;
  const d = +deaths || 0;
  const counts = !k && !d
    ? "no fights on record"
    : `${k} kill${k === 1 ? "" : "s"} / ${d} death${d === 1 ? "" : "s"}`;
  return `${name}: ${counts}`;
}

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
  const k = +kills || 0;
  const d = +deaths || 0;
  return k + d >= min.FIGHTS && k >= min.KILLS && d >= min.DEATHS;
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
    // Opponents in the sample (missing in older files → 50).
    top: sampleTopN(raw),
    honu: p.honu || (p.cid ? `https://wt.honu.pw/c/${p.cid}/killboard` : ""),
    // Census account times (flairs.mjs): { created, last } in seconds, or null.
    times: cleanTimes(p.times),
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
