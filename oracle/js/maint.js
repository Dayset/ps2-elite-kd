// Game-server maintenance notice (owner t721u). The Worker's /live cycle hint carries
// servers: { [world]: { down, since, last_ok } }. When servers are down for maintenance the
// page shows a calm info line (not the "data delayed" warning) and keeps the last data.

/** -> null, or { all, names: [..], lastOk: ts|null } (lastOk = newest good data among the down worlds). */
export function maintNotice(servers, worldNames = {}) {
  if (!servers) return null;
  const ids = Object.keys(servers);
  const down = ids.filter((w) => servers[w] && servers[w].down);
  if (!down.length) return null;
  const oks = down.map((w) => servers[w].last_ok).filter(Boolean);
  return {
    all: down.length === ids.length,
    names: down.map((w) => worldNames[w] || `#${w}`),
    lastOk: oks.length ? Math.max(...oks) : null,
  };
}

/** Local clock time "HH:MM" for a Unix ts (the reader's own zone). */
export function clock(ts, lang) {
  try { return new Date(ts * 1000).toLocaleTimeString(lang || undefined, { hour: "2-digit", minute: "2-digit" }); }
  catch { return new Date(ts * 1000).toISOString().slice(11, 16); }
}
