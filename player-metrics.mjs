/**
 * Player normalization + per-player table metrics, shared by the main page
 * (app.js stats tables) and status.html (red-flag review) so numbers match.
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
} from "./math.mjs?v=20261007-speedmult";

/** Raw cache / live / shared player JSON → the shape the charts & tables use. */
export function normalizePlayer(raw) {
  const p = raw.player || raw;
  const rows = (p.rows || []).map((r) => ({
    name: r.name || "",
    kills: +r.kills || 0,
    deaths: +r.deaths || 0,
    kpm: +r.kpm || 0,
  }));
  let curve = p.curve;
  if (!curve || !curve.length) curve = kpmCurve(rows);
  curve = curve.map((pt) => ({
    kpm: +pt.kpm,
    kd: pt.kd == null || pt.kd !== pt.kd ? NaN : +pt.kd,
    kills: +pt.kills || 0,
    deaths: +pt.deaths || 0,
    n: +pt.n || 0,
  }));
  return {
    display: p.display || p.name || "?",
    cid: p.cid || "",
    global_kd: +p.global_kd || 0,
    global_kpm: +p.global_kpm || 0,
    own_kpm: +p.own_kpm || +p.global_kpm || 0,
    acc: p.acc != null ? +p.acc : null,
    hsr: p.hsr != null ? +p.hsr : null,
    ivi: p.ivi != null ? +p.ivi : null,
    rows,
    curve,
    honu: p.honu || (p.cid ? `https://wt.honu.pw/c/${p.cid}/killboard` : ""),
    source: raw._source || "local",
  };
}

/** One stats-table row (public + adjusted columns) for a normalized player. */
export function playerMetrics(p) {
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
    pvs: pressureVolume(act, slope),
    adj,
    // ⚡ ivi: 🎯🎈 ivi adjusted for own kill speed (slow, safe KD counts for less).
    adjs: speedAdjustedIvi(adj, ownKpm),
    kd05: dm.kd05,
    inflation: dm.inflation,
  };
}
