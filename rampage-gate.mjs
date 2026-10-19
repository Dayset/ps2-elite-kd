/**
 * 🚨 Rampage gate (owner rule 2026-10-19): a 💥 burst session (KPM ≥ 5, ≥ 15 kills, ≥ 2 min)
 * that is ALSO sustained hipfire headshot spraying = confirmed cheater, automatically.
 *
 *   ≥ 50 infantry kills in the session (on foot, not vehicle weapons)
 *   hipfire ≥ 90% of those kills   (Honu kill event fireGroupToFireMode.fireModeIndex 0 = hip, 1 = ADS)
 *   headshots ≥ 55% of those kills
 *
 * Model case: VanuBestFaction2, session 77443917: 177 kills in 23.5 min, Orion LMG, 100% hipfire,
 * 69% headshots. Backtest 2026-10-19 (11 stored burst sessions + 134 high-KPM sessions of 74
 * reviewed / top / legit players): catches 7 sessions of 6 hidden cheaters + VanuBestFaction2,
 * no legit player (legit max: hipfire ≥ 90% only with ≤ 21% HS; HS ≥ 55% only with ≤ 28% hipfire).
 *
 * Source: Honu GET /api/kills/session/{id} (one call per burst session, ever; summaries are kept
 * in data/rampage.json). DOM-free; used by scripts/rampage-gate.mjs and scripts/build-ranks.mjs.
 * Human override wins: data/reviewed.json "burst": "cleared" (or decision "cleared") un-hides.
 */
export const RAMPAGE_RULE = Object.freeze({ MIN_KILLS: 50, HIP: 0.9, HSR: 0.55 });
export const RAMPAGE_REASON_PREFIX = "confirmed cheater — auto: rampage gate";
export const rampageRuleText = (r = RAMPAGE_RULE) =>
  `💥 burst session (KPM ≥ 5, ≥ 15 kills, ≥ 2 min) with ≥ ${r.MIN_KILLS} infantry kills, hipfire ≥ ${Math.round(r.HIP * 100)}% and headshots ≥ ${Math.round(r.HSR * 100)}% of them`;

/** Honu /api/kills/session/{id} rows → { kills, inf, hs, hip, ads } for the session's character. */
export function summarizeSessionKills(rows, cid) {
  const me = String(cid);
  let kills = 0, inf = 0, hs = 0, hip = 0, ads = 0;
  for (const x of rows || []) {
    const e = x && x.event;
    if (!e || String(e.attackerCharacterID) !== me || String(e.killedCharacterID) === me) continue;
    if (e.attackerTeamID != null && e.attackerTeamID === e.killedTeamID) continue; // team kills
    kills++;
    const item = x.item || {};
    if (!e.weaponID || e.attackerVehicleID || item.isVehicleWeapon) continue;
    inf++;
    if (e.isHeadshot) hs++;
    const fmi = x.fireGroupToFireMode ? x.fireGroupToFireMode.fireModeIndex : null;
    if (fmi === 0) hip++;
    else if (fmi === 1) ads++;
  }
  return { kills, inf, hs, hip, ads };
}

/** True when a session summary is a rampage (burst-ness is checked by the caller). */
export function isRampage(s, r = RAMPAGE_RULE) {
  return !!s && s.inf >= r.MIN_KILLS && s.hip / s.inf >= r.HIP && s.hs / s.inf >= r.HSR;
}

/** Evidence line for hidden.json / build-log. */
export function rampageEvidence(s) {
  const pc = (a, b) => Math.round((100 * a) / b);
  return `session ${s.session}: ${s.inf} infantry kills in ${s.minutes} min (KPM ${s.kpm}), ${s.hs} headshots (${pc(s.hs, s.inf)}%), hipfire ${pc(s.hip, s.inf)}%, ADS ${s.ads}`;
}

/** Owner cleared this player (reviewed.json "burst": "cleared" or decision "cleared"). */
export function rampageCleared(reviewedJson, slug) {
  const e = reviewedJson && reviewedJson.players && reviewedJson.players[slug];
  return !!e && (e.burst === "cleared" || e.decision === "cleared");
}
