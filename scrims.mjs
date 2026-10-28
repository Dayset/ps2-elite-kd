/**
 * 🥊 PlayStation scrims: compact KILL / DEATH events and the Census URL that pages them.
 * The detector lives here too (added after the probe measurement). Pure module: browser + Node.
 */

/** Census characters_event page size (Census caps it at 1000). */
export const EVENT_PAGE = 1000;

/**
 * One Census URL for a page of a player's KILL + DEATH events, newest first.
 * base ends with "/get/<ns>:v2/". before / after are unix seconds (Census: timestamp < before, > after).
 */
export function eventsUrl(base, cid, { before = 0, after = 0, limit = EVENT_PAGE } = {}) {
  return `${base}characters_event/?character_id=${encodeURIComponent(cid)}&type=KILL,DEATH&c:limit=${limit}` +
    (before ? `&before=${Math.floor(before)}` : "") + (after ? `&after=${Math.floor(after)}` : "");
}

const n = (v) => Number(v) || 0;

/**
 * Census row → compact event [ts, kill(1|0), otherId, weaponId, headshot(1|0), zoneId, myLoadout, otherLoadout, vehicleId].
 * weaponId / vehicleId are the attacker's (mine on a kill, theirs on a death). Suicides keep otherId = own id.
 */
export function compactEvent(e, cid) {
  if (!e) return null;
  const me = String(cid);
  const kill = e.table_type === "kills" ? 1 : e.table_type === "deaths" ? 0 : String(e.attacker_character_id) === me ? 1 : 0;
  const other = String((kill ? e.character_id : e.attacker_character_id) || "0");
  return [
    n(e.timestamp), kill, other, n(e.attacker_weapon_id),
    e.is_headshot === "1" || e.is_headshot === 1 || e.is_headshot === true ? 1 : 0,
    n(e.zone_id),
    n(kill ? e.attacker_loadout_id : e.character_loadout_id),
    n(kill ? e.character_loadout_id : e.attacker_loadout_id),
    n(e.attacker_vehicle_id),
  ];
}

/** Dedupe key of a compact event (page edges overlap by one second). */
export const eventKey = (x) => `${x[0]}|${x[1]}|${x[2]}|${x[3]}|${x[6]}|${x[7]}`;

/** Merge compact event lists, drop duplicates, newest first. */
export function mergeEvents(...lists) {
  const seen = new Set();
  const out = [];
  for (const l of lists) for (const x of l || []) {
    if (!x) continue;
    const k = eventKey(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  out.sort((a, b) => b[0] - a[0]);
  return out;
}
