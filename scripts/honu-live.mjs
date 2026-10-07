/**
 * "Who is good and playing right now": Honu's realtime world data.
 *
 * Honu has no REST endpoint for this; its realtime page uses the SignalR hub
 * /ws/data (SubscribeToWorld(worldID, useShort) -> UpdateData(WorldData)).
 * We speak the SignalR JSON protocol over long polling with plain fetch:
 * negotiate, handshake, subscribe, poll until UpdateData, close. That is ~5
 * HTTP requests per world, and Honu answers from its cached world snapshot.
 * We use the 120-minute window (useShort=false), the one Honu keeps warm.
 */
const HUB = "https://wt.honu.pw/ws/data";
const RS = "\x1e";

/** PC worlds tracked by Honu. */
export const PC_WORLDS = [
  { id: 1, name: "Connery" },
  { id: 10, name: "Miller" },
  { id: 13, name: "Cobalt" },
  { id: 17, name: "Emerald" },
  { id: 19, name: "Jaeger" },
  { id: 40, name: "SolTech" },
];

/**
 * @param {number} worldID
 * @param {{ userAgent?: string, timeoutMs?: number, beforeRequest?: () => Promise<void> }} [opts]
 * @returns {Promise<{ worldID:number, timestamp:string|null, onlineCount:number,
 *   killers: { id:string, name:string, factionID:number, kills:number, deaths:number, secondsOnline:number, online:boolean }[] }>}
 */
export async function worldTopKillers(worldID, opts = {}) {
  const headers = { "User-Agent": opts.userAgent || "ps2-elite-kd-cache-bot" };
  const timeoutMs = opts.timeoutMs || 45_000;
  const pace = opts.beforeRequest || (async () => {});
  const t0 = Date.now();
  await pace();
  const negRes = await fetch(`${HUB}/negotiate?negotiateVersion=1`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!negRes.ok) throw new Error(`Honu hub negotiate HTTP ${negRes.status}`);
  const neg = await negRes.json();
  const id = encodeURIComponent(neg.connectionToken || neg.connectionId);
  const url = `${HUB}?id=${id}`;
  const send = async (obj) => {
    await pace();
    const r = await fetch(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(obj) + RS,
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`Honu hub send HTTP ${r.status}`);
  };
  let data = null;
  try {
    await send({ protocol: "json", version: 1 });
    let subscribed = false;
    while (!data && Date.now() - t0 < timeoutMs) {
      await pace();
      const res = await fetch(`${url}&_=${Date.now()}`, {
        headers,
        signal: AbortSignal.timeout(Math.max(5_000, timeoutMs - (Date.now() - t0) + 5_000)),
      });
      if (res.status === 204) break; // connection closed by server
      if (!res.ok) throw new Error(`Honu hub poll HTTP ${res.status}`);
      const txt = await res.text();
      for (const part of txt.split(RS)) {
        if (!part.trim()) continue;
        let m;
        try {
          m = JSON.parse(part);
        } catch {
          continue;
        }
        if (m.error) throw new Error(`Honu hub error: ${String(m.error).slice(0, 100)}`);
        if (m.type === 1 && m.target === "UpdateData" && Array.isArray(m.arguments)) {
          data = m.arguments[0];
        } else if (m.type === 7) {
          throw new Error("Honu hub closed the connection");
        } else if (m.type === undefined && !subscribed) {
          subscribed = true; // handshake ack
          await send({ type: 1, invocationId: "0", target: "SubscribeToWorld", arguments: [worldID, false] });
        }
      }
    }
  } finally {
    fetch(url, { method: "DELETE", headers, signal: AbortSignal.timeout(5_000) }).catch(() => {});
  }
  if (!data) throw new Error(`Honu hub: no world data for ${worldID} within ${Math.round(timeoutMs / 1000)}s`);
  const killers = [];
  for (const key of ["vs", "nc", "tr"]) {
    const f = data[key] || {};
    for (const e of (f.playerKills && f.playerKills.entries) || []) {
      if (!e || !e.name || !e.id) continue;
      killers.push({
        id: String(e.id),
        name: String(e.name).replace(/^\[\]\s*/, "").trim(),
        factionID: +e.factionID || 0,
        kills: +e.kills || 0,
        deaths: +e.deaths || 0,
        secondsOnline: +e.secondsOnline || 0,
        online: !!e.online,
      });
    }
  }
  return { worldID, timestamp: data.timestamp || null, onlineCount: +data.onlineCount || 0, killers };
}
