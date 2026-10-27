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
    // Last online (t723u): last minute we saw the world up; before we ever did (deploy during
    // a shutdown), the newest base capture on it is the last real sign of life.
    s.last_up = !down ? now : p.last_up || (lastFlip && lastFlip[w] && lastFlip[w] <= now ? lastFlip[w] : null);
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
  for (const [w, s] of Object.entries(servers)) out[w] = { down: !!s.down, since: s.since || null, last_ok: s.last_ok || null, last_up: s.last_up || null };
  return out;
}

// ---------------------------------------------------------------- announced schedule (t723u)
// Daybreak posts every patch on Steam a few hours ahead ("All servers will be down for the
// scheduled maintenance at 6am pdt ... There will be a 3hr downtime window"). Steam's public
// news API (no key) is the only machine-readable place it shows up: Census has no
// maintenance fields, Honu/fisu don't publish one, X needs a paid API. We read that text
// carefully and only keep a schedule when date, start time + zone and length are all
// there; anything less = no schedule (never a guess).
export const STEAM_APP = 218230;
export const STEAM_NEWS_URL = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${STEAM_APP}&count=6&maxlength=1200&feeds=steam_community_announcements`;
export const SCHED_EVERY_S = 30 * 60;       // normal check: twice an hour
export const SCHED_EVERY_DOWN_S = 10 * 60;  // while a server is down
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** UTC offset (hours) of America/Los_Angeles at a moment. */
function laOffsetH(ms) {
  try {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "shortOffset" }).formatToParts(new Date(ms));
    const m = /GMT([+-]\d+)/.exec((f.find((x) => x.type === "timeZoneName") || {}).value || "");
    if (m) return +m[1];
  } catch { /* fall through */ }
  return null;
}
/** Y/M/D of a Unix ts in Los Angeles. */
function laDate(ts) {
  const off = laOffsetH(ts * 1000) ?? -8;
  const d = new Date((ts + off * 3600) * 1000);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

/** One Steam news item -> { start, end, hours, url, title } or null. */
export function parseSchedule(item) {
  if (!item || !item.contents) return null;
  const text = String(item.contents).replace(/\s+/g, " ").toLowerCase();
  const title = String(item.title || "");
  if (/no (?:server |maintenance )?downtime/.test(text)) return null;
  if (!/(servers?|game) [^.]{0,40}\bdown\b|downtime/.test(text)) return null;
  const sentence = (m) => { const a = Math.max(0, text.lastIndexOf(". ", m.index) + 1, m.index - 120), e = text.indexOf(". ", m.index + m[0].length); return text.slice(a, e < 0 ? m.index + 120 : Math.min(e, m.index + 120)); };
  // Only numbers in the same sentence as the downtime wording count (not "Double XP for 48 hours").
  const near = (re, ok = () => true) => { for (const m of text.matchAll(re)) if (ok(m) && /downtime|maintenance|\bdown\b/.test(sentence(m))) return m; return null; };
  const tm = near(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\.?\s*(pdt|pst|pt)\b/g);
  const du = near(/\b(\d{1,2}(?:\.\d)?)\s*-?\s*(?:hrs?|hours?)\b/g, (m) => +m[1] >= 0.5 && +m[1] <= 12);
  if (!tm || !du) return null;
  const hours = +du[1];
  if (!(hours >= 0.5 && hours <= 12)) return null;
  let ymd = null;
  const md = /\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/.exec(text);
  if (md) ymd = [md[3].length === 2 ? 2000 + +md[3] : +md[3], +md[1], +md[2]];
  else if (item.date && /\btomorrow\b/.test(text)) { const d = laDate(+item.date); const n = new Date(Date.UTC(d[0], d[1] - 1, d[2] + 1)); ymd = [n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate()]; }
  else if (item.date && /\btoday\b/.test(text)) ymd = laDate(+item.date);
  else {
    const tt = new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{1,2}),?\\s+(\\d{4})`, "i").exec(title);
    if (tt) ymd = [+tt[3], MONTHS.indexOf(tt[1].toLowerCase()) + 1, +tt[2]];
  }
  if (!ymd || !(ymd[1] >= 1 && ymd[1] <= 12 && ymd[2] >= 1 && ymd[2] <= 31)) return null;
  let h = +tm[1] % 12; if (tm[3] === "pm") h += 12;
  const local = Date.UTC(ymd[0], ymd[1] - 1, ymd[2], h, +(tm[2] || 0)) / 1000;
  const off = tm[4] === "pdt" ? -7 : tm[4] === "pst" ? -8 : laOffsetH(local * 1000);
  if (off == null) return null;
  const start = local - off * 3600;
  return { start, end: Math.round(start + hours * 3600), hours, url: item.gid ? `https://store.steampowered.com/news/app/${STEAM_APP}/view/${item.gid}` : item.url || null, title: title.slice(0, 120) };
}

/** Steam news JSON -> the newest announced window near now (from 18 h ago to 36 h ahead), or null. */
export function pickSchedule(j, now) {
  const items = (j && j.appnews && j.appnews.newsitems) || [];
  let best = null;
  for (const it of items) {
    const s = parseSchedule(it);
    if (s && s.start >= now - 18 * 3600 && s.start <= now + 36 * 3600 && (!best || s.start > best.start)) best = s;
  }
  return best;
}

/** Due for a Steam check? (polite: every 30 min, every 10 min while a server is down). */
export function schedDue(meta, servers, now) {
  const anyDown = servers && Object.values(servers).some((s) => s && s.down);
  return !meta || !meta.checked || now - meta.checked >= (anyDown ? SCHED_EVERY_DOWN_S : SCHED_EVERY_S);
}

/** What the page gets: the window only from 24 h before it until 12 h after its planned end. */
export function schedHint(meta, now) {
  const s = meta && meta.sched;
  if (!s || now < s.start - 24 * 3600 || now > s.end + 12 * 3600) return null;
  return { start: s.start, end: s.end, hours: s.hours, url: s.url, src: "Daybreak" };
}
