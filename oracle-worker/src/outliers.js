/**
 * Alert outlier report from Honu's per-player alert data
 * (GET wt.honu.pw/api/alerts/{world}/{instance}/participants, available once the
 * alert has ended). Pure functions, no I/O.
 *
 * Rule (old pipeline's tiers, oracle/README "outlier flags"):
 *   KD >= 5 and KPM >= 2  -> "early"      ⚠️
 *   KD >= 5 and KPM >= 3  -> "confirmed"  ☠️
 * Sample floor (added here so a lucky 5-minute spawn camp is not flagged):
 *   at least MIN_MINUTES online and MIN_KILLS kills.
 * A flag is a statistical outlier, never an accusation; PS2 Radar is shown as a
 * second opinion only.
 */
export const OUTLIER_RULE = Object.freeze({ KD: 5, KPM_EARLY: 2, KPM_CONFIRMED: 3, MIN_MINUTES: 10, MIN_KILLS: 25, MAX_LISTED: 10 });

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
    if (minutes < rule.MIN_MINUTES || kills < rule.MIN_KILLS) continue;
    const kd = kills / Math.max(deaths, 1);
    const kpm = kills / minutes;
    if (kd < rule.KD || kpm < rule.KPM_EARLY) continue;
    flagged.push({
      cid, name: c.name || null, outfit: c.outfitTag || null, faction: fac,
      kills, deaths, minutes: Math.round(minutes), kd: r2(kd), kpm: r2(kpm),
      severity: kpm >= rule.KPM_CONFIRMED ? "confirmed" : "early",
    });
  }
  flagged.sort((a, b) => (b.severity === "confirmed") - (a.severity === "confirmed") || b.kpm - a.kpm);
  for (const f of Object.values(faction)) f.kd = f.deaths ? r2(f.kills / f.deaths) : null;
  return {
    players, faction,
    flagged: flagged.length,
    confirmed: flagged.filter((f) => f.severity === "confirmed").length,
    outliers: flagged.slice(0, rule.MAX_LISTED),
  };
}

/**
 * Honu GET /api/realtime-alert (mini: team totals, no events) -> live faction KD
 * for one world/zone, or null when Honu has no entry for it.
 */
export function liveKd(list, world, zone) {
  if (!Array.isArray(list)) return null;
  const a = list.find((x) => +(x.worldID ?? x.worldId) === +world && ((+(x.zoneID ?? x.zoneId)) & 0xffff) === +zone);
  if (!a) return null;
  const kd = {};
  for (const [k, f] of [["vs", "VS"], ["nc", "NC"], ["tr", "TR"]]) {
    const t = a[k] || a[f];
    if (!t || !(+t.deaths > 0)) return null;
    kd[f] = Math.round((+t.kills / +t.deaths) * 1000) / 1000;
  }
  return kd;
}
