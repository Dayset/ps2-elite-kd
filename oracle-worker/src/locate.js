/**
 * 📍 Locate one character (owner 2026-11-12, field hidden in the Oracle page's ⓘ About).
 *
 *   GET /locate?name=<name> → { v: 1, name, cid, platform, faction, world, online, stream, loc }
 *
 * Name → Census (PC, then PlayStation US, then EU — first hit wins; lookupCharacter
 * in auth.js) → the cache Worker's /live/locate through the CACHE service binding,
 * with X-Proxy-Key = env.ORACLE_KEY (the deploy workflow sets ORACLE_KEY from the same
 * CENSUS_PROXY_KEY secret the cache Worker checks, so no new secret is needed).
 * Players on the removal list (#61) are never located: the cache Worker filters them
 * and an empty players map reads as "not seen", exactly like an idle player.
 *
 * No storage, no logging of the name: the answer comes from the KillMonitor's in-memory
 * live map (worker/src/live-map.js) and is forgotten within the hour. A player doing
 * nothing has no events, so there is nothing to place — loc is null. "exact" = capture,
 * defence or vehicle kill at the base; "near" = placed by one Death hop from someone
 * placed exactly (a "near" position never places anyone else).
 */
import { lookupCharacter, PLATFORMS } from "./auth.js";

/** Same shape as auth.js NAME_RE (kept local: that one is module-private). */
export const LOCATE_NAME_RE = /^[A-Za-z0-9]{3,32}$/;
export const LOCATE_PER_IP_10MIN = 60;
const locateHits = new Map(); // best-effort per-isolate limit, like liveRoute's liveHits

/** True when this IP already spent its lookups in the last 10 minutes. */
export function locateRateLimited(ip, now = Date.now()) {
  const key = ip || "unknown";
  const h = locateHits.get(key);
  if (!h || now - h[1] > 10 * 60e3) { locateHits.set(key, [1, now]); return false; }
  if (++h[0] > LOCATE_PER_IP_10MIN) return true;
  return false;
}
export function _resetLocateHits() { locateHits.clear(); }

/**
 * Resolve the name and ask the live map where the character is.
 * env: { CENSUS_SERVICE_ID?, CACHE?, ORACLE_KEY? }. Returns { error } or the payload.
 * When the locate leg cannot run (no binding / no key / cache error) the Census identity
 * is still returned, with stream null and loc null — the page says positions are unavailable.
 */
export async function locatePlayer(env, name, { fetchImpl = fetch, now = Date.now() } = {}) {
  const clean = String(name || "").trim().replace(/^\[[^\]]*\]\s*/, "");
  if (!LOCATE_NAME_RE.test(clean)) return { error: "invalid_name" };
  const sid = (env.CENSUS_SERVICE_ID || "daysetps2legends").replace(/^s:/, "");
  let found = null, platform = null, censusFailed = false;
  for (const [plat, { ns }] of Object.entries(PLATFORMS)) {
    try {
      const ch = await lookupCharacter(sid, clean, fetchImpl, ns);
      if (ch) { found = ch; platform = plat; break; }
    } catch { censusFailed = true; }
  }
  if (!found) return { error: censusFailed ? "census_error" : "unknown_name" };
  const out = { v: 1, name: found.name, cid: found.cid, platform, faction: found.faction,
    world: found.world, online: found.online, stream: null, loc: null };
  const key = typeof env.ORACLE_KEY === "string" ? env.ORACLE_KEY : "";
  if (!env.CACHE || typeof env.CACHE.fetch !== "function" || !key) return out;
  const ns = PLATFORMS[platform].ns;
  try {
    const r = await env.CACHE.fetch(new Request(`https://cache/live/locate?ns=${ns}&ids=${found.cid}`,
      { headers: { "X-Proxy-Key": key }, signal: AbortSignal.timeout(5000) }));
    if (!r.ok) return out;
    const j = await r.json();
    out.stream = j.stream === true;
    const loc = j.players && j.players[found.cid];
    if (loc && typeof loc === "object") out.loc = loc;
  } catch { /* identity-only: positions unavailable */ }
  return out;
}

/** GET /locate?name=<name> — public read, rate-limited, never stored. */
export async function handleLocate(request, env, url, json, now = Math.floor(Date.now() / 1000), fetchImpl = fetch) {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, { "Cache-Control": "no-store" });
  const ip = request.headers.get("CF-Connecting-IP") || "";
  if (locateRateLimited(ip, now * 1000)) return json({ error: "rate_limited" }, 429, { "Cache-Control": "no-store" });
  const res = await locatePlayer(env, url.searchParams.get("name") || "", { fetchImpl, now: now * 1000 });
  if (res.error === "invalid_name") return json({ error: "invalid_name" }, 400, { "Cache-Control": "no-store" });
  if (res.error === "unknown_name") return json({ error: "unknown_name" }, 404, { "Cache-Control": "no-store" });
  if (res.error === "census_error") return json({ error: "census_error" }, 502, { "Cache-Control": "no-store" });
  return json(res, 200, { "Cache-Control": "no-store" });
}
