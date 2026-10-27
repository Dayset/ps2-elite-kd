// Game-server maintenance notice (owner t721u, wording + last online + schedule t723u).
// The Worker's /live cycle hint carries
//   servers: { [world]: { down, since, last_ok, last_up } }   (last_up = last seen online)
//   sched:   { start, end, hours, url, src } | null            (Daybreak's announced window,
//            read from their Steam post; null when nothing reliable was announced)
// When servers are down the page shows a calm info line (not "data delayed") and keeps the
// last data. Times are shown in the reader's own clock.

/** -> null, or { all, names: [..], down: [{ name, lastUp }], lastOk: ts|null }. */
export function maintNotice(servers, worldNames = {}) {
  if (!servers) return null;
  const ids = Object.keys(servers);
  const down = ids.filter((w) => servers[w] && servers[w].down);
  if (!down.length) return null;
  const oks = down.map((w) => servers[w].last_ok).filter(Boolean);
  return {
    all: down.length === ids.length,
    names: down.map((w) => worldNames[w] || `#${w}`),
    down: down.map((w) => ({ name: worldNames[w] || `#${w}`, lastUp: servers[w].last_up || null })),
    lastOk: oks.length ? Math.max(...oks) : null,
  };
}

/** Local clock time "HH:MM" for a Unix ts (the reader's own zone). */
export function clock(ts, lang) {
  try { return new Date(ts * 1000).toLocaleTimeString(lang || undefined, { hour: "2-digit", minute: "2-digit" }); }
  catch { return new Date(ts * 1000).toISOString().slice(11, 16); }
}

/** "HH:MM", with the short weekday in front when it is not today (reader's zone). */
export function when(ts, lang, now = Date.now() / 1000) {
  const a = new Date(ts * 1000), b = new Date(now * 1000);
  if (a.toDateString() === b.toDateString()) return clock(ts, lang);
  try { return a.toLocaleDateString(lang || undefined, { weekday: "short" }) + " " + clock(ts, lang); }
  catch { return clock(ts, lang); }
}

/** Daybreak's official game server status page (t724u; planetside2.com/server-status only redirects). */
export const STATUS_URL = "https://www.daybreakgames.com/status";

const SAFE_SRC = /^https:\/\/store\.steampowered\.com\//;

/**
 * Which schedule sentence fits right now, or null.
 *  down: a server is down -> "eta" (inside the announced window) or "late" (past its end)
 *  none down -> "soon" (announced, not started yet)
 * Returns { key, start, end, hours, url } (url only when it is Daybreak's Steam post).
 */
export function schedState(sched, mt, now) {
  if (!sched || !(sched.start > 0) || !(sched.end > sched.start)) return null;
  const url = SAFE_SRC.test(sched.url || "") ? sched.url : null;
  const base = { start: sched.start, end: sched.end, hours: sched.hours, url };
  if (mt) {
    if (now < sched.start - 3600) return null;   // down well before the announced start: not this window
    return { ...base, key: now <= sched.end ? "eta" : "late" };
  }
  if (now < sched.start) return { ...base, key: "soon" };
  return null;
}

/** "Last online" part: one time when the down servers went within 5 min of each other, else per server. */
export function lastOnline(mt) {
  const ts = mt.down.map((d) => d.lastUp).filter(Boolean);
  if (!ts.length) return null;
  if (ts.length === mt.down.length && Math.max(...ts) - Math.min(...ts) <= 300) return { one: Math.max(...ts) };
  return { each: mt.down.filter((d) => d.lastUp) };
}
