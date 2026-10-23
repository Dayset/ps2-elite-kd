/**
 * Alert outlier report from Honu's per-player alert data
 * (GET wt.honu.pw/api/alerts/{world}/{instance}/participants, available once the
 * alert has ended). Pure functions, no I/O.
 *
 * Rule:
 *   KD >= 6 and KPM >= 3  -> "early"      ⚠️
 *   KD >= 6 and KPM >= 4  -> "confirmed"  ☠️
 * Sample floor (added here so a lucky 5-minute spawn camp is not flagged):
 *   at least MIN_MINUTES online and MIN_KILLS kills.
 * Burst tier (#21), for short blatant sessions the floor lets through, no KD or
 * 10-minute requirement:
 *   KPM >= BURST_KPM and kills >= BURST_KILLS and minutes >= BURST_MIN_MINUTES -> "burst" ☠️
 *   (counted in `confirmed` like the ☠️ tier; a session that meets the normal tiers keeps them).
 * A flag is a statistical outlier, never an accusation; PS2 Radar is shown as a
 * second opinion only. Players on the VOUCHED list are never flagged.
 */
export const OUTLIER_RULE = Object.freeze({ KD: 6, KPM_EARLY: 3, KPM_CONFIRMED: 4, MIN_MINUTES: 10, MIN_KILLS: 25, MAX_LISTED: 10,
  BURST_KPM: 5, BURST_KILLS: 15, BURST_MIN_MINUTES: 2 });

/**
 * Players the owner knows as legit top-level players: never flagged. Names are matched
 * case-insensitively; a pattern covers a player's characters on every faction
 * (Fantom220TR / Fantom220NC / Fantom220VS). Owner, 2026-10-23.
 */
export const VOUCHED = Object.freeze([/^puritync$/i, /^fantom220(vs|nc|tr)?$/i]);
export const isVouched = (name) => !!name && VOUCHED.some((re) => re.test(String(name)));

const FAC = { 1: "VS", 2: "NC", 3: "TR", 4: "NSO" };
const r2 = (x) => Math.round(x * 100) / 100;

/** Honu ExpandedAlertPlayers (camelCase JSON) -> report. */
export function outlierReport(body, rule = OUTLIER_RULE) {
  const entries = (body && (body.entries || body.Entries)) || [];
  const chars = new Map(((body && (body.characters || body.Characters)) || []).map((c) => [String(c.id ?? c.ID), c]));
  const faction = { VS: { kills: 0, deaths: 0, players: 0 }, NC: { kills: 0, deaths: 0, players: 0 }, TR: { kills: 0, deaths: 0, players: 0 } };
  const flagged = [];
  let players = 0;
  for (const e of entries) {
    const cid = String(e.characterID ?? e.characterId ?? e.CharacterID ?? "");
    if (!cid) continue;
    players++;
    const c = chars.get(cid) || {};
    const fac = FAC[c.factionID ?? c.factionId ?? c.FactionID] || null;
    const kills = +e.kills || 0, deaths = +e.deaths || 0, secs = +e.secondsOnline || 0;
    if (fac && faction[fac]) { faction[fac].kills += kills; faction[fac].deaths += deaths; faction[fac].players++; }
    const minutes = secs / 60;
    if (!(minutes > 0)) continue;
    const kd = kills / Math.max(deaths, 1);
    const kpm = kills / minutes;
    let severity = null;
    if (minutes >= rule.MIN_MINUTES && kills >= rule.MIN_KILLS && kd >= rule.KD && kpm >= rule.KPM_EARLY) severity = kpm >= rule.KPM_CONFIRMED ? "confirmed" : "early";
    else if (minutes >= rule.BURST_MIN_MINUTES && kills >= rule.BURST_KILLS && kpm >= rule.BURST_KPM) severity = "burst";
    if (!severity || isVouched(c.name)) continue;
    flagged.push({
      cid, name: c.name || null, outfit: c.outfitTag || null, faction: fac,
      kills, deaths, minutes: minutes < rule.MIN_MINUTES ? Math.round(minutes * 10) / 10 : Math.round(minutes), kd: r2(kd), kpm: r2(kpm),
      severity,
    });
  }
  const skull = (f) => f.severity === "confirmed" || f.severity === "burst";
  flagged.sort((a, b) => skull(b) - skull(a) || b.kpm - a.kpm);
  for (const f of Object.values(faction)) f.kd = f.deaths ? r2(f.kills / f.deaths) : null;
  return {
    players, faction,
    flagged: flagged.length,
    confirmed: flagged.filter(skull).length,
    burst: flagged.filter((f) => f.severity === "burst").length,
    outliers: flagged.slice(0, rule.MAX_LISTED),
  };
}
