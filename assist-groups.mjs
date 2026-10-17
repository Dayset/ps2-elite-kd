/**
 * 🤝 Assist groups experiment (build-log.html only; user t378u). Assists are
 * Groups are build-log only (assists per kill itself is a public 🤝 column since t382u). Uses the 🧪 session metrics s_apk (assists / kill) and s_share
 * (assist damage share) with public K/D / iVi to find three groups. For now
 * every player counts as infantry (vehicle / air not separated yet; later:
 * infantry.mjs tags). Only measured players (≥ SESSION_MIN.MIN_KILLS kills in
 * counted sessions) with both values; hidden players are skipped. DOM-free.
 */
export const ASSIST_GROUP_RULE = Object.freeze({
  /** "High K/D" = top quarter of K/D among measured players. */
  KD_PCT: 0.75,
  /** Carries fights: damage share in the top quarter; finishers: bottom quarter. */
  SHARE_HI: 0.75, SHARE_LO: 0.25,
  /** Hidden support: assists / kill in the top 10% … */
  APK_PCT: 0.9,
  /** … and iVi in the middle half (25th–75th percentile). */
  IVI_LO: 0.25, IVI_HI: 0.75,
  TOP: 8,
  /** Tagged players needed per side before the vehicle-threshold test runs. */
  MIN_TAG: 20,
});

const fin = (v) => typeof v === "number" && Number.isFinite(v);
function q(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
const r3 = (v) => (fin(v) ? Math.round(v * 1000) / 1000 : null);

/** players: [{ slug, name, hidden, flagged, session: sessionMetrics(), values: { kd, kpm, ivi } }] */
export function assistGroups(players, rule = ASSIST_GROUP_RULE) {
  const all = players.filter((p) => !p.hidden);
  const withSess = all.filter((p) => p.session);
  const pool = withSess.filter((p) => p.session.measured && fin(p.session.values.s_apk) && fin(p.session.values.s_share) && fin(p.values.kd));
  const sorted = (f) => pool.map(f).filter(fin).sort((a, b) => a - b);
  const kdS = sorted((p) => p.values.kd), shS = sorted((p) => p.session.values.s_share), apS = sorted((p) => p.session.values.s_apk), ivS = sorted((p) => p.values.ivi);
  const cut = {
    kd: q(kdS, rule.KD_PCT), shareHi: q(shS, rule.SHARE_HI), shareLo: q(shS, rule.SHARE_LO),
    apk: q(apS, rule.APK_PCT), iviLo: q(ivS, rule.IVI_LO), iviHi: q(ivS, rule.IVI_HI),
    medApk: q(apS, 0.5), medShare: q(shS, 0.5),
  };
  const row = (p) => ({ slug: p.slug, name: p.name, kd: r3(p.values.kd), kpm: r3(p.values.kpm), ivi: r3(p.values.ivi), apk: r3(p.session.values.s_apk), share: r3(p.session.values.s_share), kills: p.session.kills, flagged: !!p.flagged });
  const hiKd = pool.filter((p) => p.values.kd >= cut.kd);
  const carries = hiKd.filter((p) => p.session.values.s_share >= cut.shareHi).sort((a, b) => b.values.kd * b.session.values.s_share - a.values.kd * a.session.values.s_share);
  const finishers = hiKd.filter((p) => p.session.values.s_share <= cut.shareLo).sort((a, b) => b.values.kd - a.values.kd);
  const support = pool.filter((p) => p.session.values.s_apk >= cut.apk && fin(p.values.ivi) && p.values.ivi >= cut.iviLo && p.values.ivi <= cut.iviHi).sort((a, b) => b.session.values.s_apk - a.session.values.s_apk);
  const g = (list) => ({ count: list.length, top: list.slice(0, rule.TOP).map(row) });
  const pct = (n) => (all.length ? Math.round((n / all.length) * 1000) / 10 : 0);
  // Per infantry.mjs tag (filled in as players refresh): counts / medians, and
  // the best single threshold separating vehicle from infantry (if enough tags).
  const med = (xs) => { const s = xs.filter(fin).sort((a, b) => a - b); return r3(q(s, 0.5)); };
  const byTag = {};
  for (const t of ["infantry", "mixed", "vehicle", "untagged"]) {
    const l = pool.filter((p) => (p.infTag || "untagged") === t);
    byTag[t] = { count: l.length, medApk: med(l.map((p) => p.session.values.s_apk)), medShare: med(l.map((p) => p.session.values.s_share)) };
  }
  const veh = pool.filter((p) => p.infTag === "vehicle"), inf = pool.filter((p) => p.infTag === "infantry");
  const predict = {};
  if (veh.length >= rule.MIN_TAG && inf.length >= rule.MIN_TAG) {
    for (const [id, key] of [["apk", "s_apk"], ["share", "s_share"]]) {
      let best = null;
      const vals = [...new Set([...veh, ...inf].map((p) => p.session.values[key]))].sort((a, b) => a - b);
      for (const t of vals) for (const dir of [1, -1]) {
        const tpr = veh.filter((p) => dir * (p.session.values[key] - t) >= 0).length / veh.length;
        const tnr = inf.filter((p) => dir * (p.session.values[key] - t) < 0).length / inf.length;
        const bal = (tpr + tnr) / 2;
        if (!best || bal > best.balanced) best = { threshold: r3(t), dir: dir > 0 ? ">=" : "<=", vehicleCaught: r3(tpr), infantryCleared: r3(tnr), balanced: r3(bal) };
      }
      predict[id] = best;
    }
  }
  return {
    byTag, predict, tagMin: rule.MIN_TAG,
    checkedAt: new Date().toISOString(),
    coverage: { players: all.length, withSessions: withSess.length, measured: pool.length, measuredPct: pct(pool.length) },
    cuts: Object.fromEntries(Object.entries(cut).map(([k, v]) => [k, r3(v)])),
    rule,
    groups: { carries: g(carries), finishers: g(finishers), support: g(support) },
  };
}
