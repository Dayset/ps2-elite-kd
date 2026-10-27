// Game-server maintenance (owner t721u). When Daybreak takes servers down (patch days,
// e.g. 2026-10-27 Hotfix #4), Census reports the world as "locked", map calls for it hang
// or answer SERVER_ERROR, or answer with the map frozen at shutdown. None of that is our
// data being late, so the page shows a calm info notice instead of a "data delayed" warning,
// keeps the last good data on screen, and the cycle never ends or voids an alert on a
// world that is down (or came back less than BACK_GRACE_S ago).
//
// Signals (one extra Census call per minute, no Honu calls: Honu is not reachable from
// Cloudflare's network):
//   1. Census world state: anything but "online" (e.g. "locked") = down.
//   2. Proof of life overrides a stale "locked": a base capture on that world in the last
//      FLIP_ALIVE_S seconds means the server is up.
//   3. State call failed this minute: keep last minute's verdict (no guessing from map errors,
//      which also happen on a healthy server when Census is just slow).

export const BACK_GRACE_S = 15 * 60;   // after a world returns, Census may post late ended rows
export const FLIP_ALIVE_S = 5 * 60;

/** Census world/ list -> { worldId: "online" | "locked" | ... } (lower-case). */
export function parseWorldStates(j) {
  const out = {};
  for (const w of (j && j.world_list) || []) if (w.world_id != null && w.state) out[+w.world_id] = String(w.state).toLowerCase();
  return out;
}

/**
 * One cycle's server verdict per world.
 *  prev: last cycle's servers ({ [w]: { down, since, back, last_ok } }) or null
 *  states: parseWorldStates() result, or null when the call failed
 *  mapOk: { [w]: true } for worlds whose map call succeeded this minute
 *  lastFlip: { [w]: ts of the newest base capture seen on that world }
 * Returns { [w]: { down, state, since (went down), back + down_from (came back; when it had gone down), last_ok (last good map) } }.
 */
export function serverStatus(worlds, prev, states, mapOk, lastFlip, now) {
  const out = {};
  for (const w of worlds) {
    const p = (prev && prev[w]) || {};
    const st = states ? states[w] || null : null;
    const alive = lastFlip && lastFlip[w] && now - lastFlip[w] <= FLIP_ALIVE_S;
    let down;
    if (st) down = st !== "online" && !alive;
    else down = !!p.down && !alive;
    const s = { down, state: st || p.state || null };
    if (down) s.since = p.down ? p.since : now;
    else if (p.down) { s.back = now; s.down_from = p.since || null; }
    else if (p.back && now - p.back < BACK_GRACE_S) { s.back = p.back; s.down_from = p.down_from || null; }
    s.last_ok = !down && mapOk && mapOk[w] ? now : p.last_ok || null;
    out[w] = s;
  }
  return out;
}

/** True while alerts on this world must not be ended, settled or voided. */
export function holdFinals(servers, world, now) {
  const s = servers && servers[world];
  if (!s) return false;
  return !!s.down || (!!s.back && now - s.back < BACK_GRACE_S);
}

/** Compact form for the page's /live cycle hint. */
export function serversHint(servers) {
  if (!servers) return null;
  const out = {};
  for (const [w, s] of Object.entries(servers)) out[w] = { down: !!s.down, since: s.since || null, last_ok: s.last_ok || null };
  return out;
}
