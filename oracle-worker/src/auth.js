/**
 * Logout-only character verification (oracle/docs/AUTH_DESIGN.md).
 *
 *   POST /auth/start   {name}  -> Census lookup, challenge {id, accept_after}
 *   POST /auth/accept  {id}    -> only >= 5 s after start; opens the 60 s window
 *                                 and asks the AuthWatcher to watch the character
 *   GET  /auth/check?id=       -> created | accepted | passed | expired | completed
 *   POST /auth/complete {id}   -> passed challenge -> token (one active per character)
 *   GET  /auth/me              -> Authorization: Bearer <token> -> character
 *   POST /auth/logout          -> revokes the token
 *   GET  /auth/health          -> stream watcher state
 *
 * Token = base64url("<cid>.<tokenId>.<hmac>"), HMAC-SHA256 with a random server
 * secret created once and kept in D1 (meta "auth_secret"). The account row holds
 * the current tokenId, so a new verification revokes the old token.
 */
export const ACCEPT_WAIT_S = 5;
export const WINDOW_S = 60;
const CHALLENGE_TTL_S = 15 * 60;
const STARTS_PER_IP_10MIN = 6;
const NAME_RE = /^[A-Za-z0-9]{3,32}$/;
const FAC = { 1: "VS", 2: "NC", 3: "TR", 4: "NSO" };

const enc = new TextEncoder();
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const randomId = (n = 16) => b64u(crypto.getRandomValues(new Uint8Array(n)));

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", fromB64u(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function authSecret(db) {
  const r = await db.prepare("SELECT v FROM meta WHERE k='auth_secret'").first();
  if (r) return JSON.parse(r.v);
  const s = randomId(32);
  await db.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('auth_secret', ?)").bind(JSON.stringify(s)).run();
  const again = await db.prepare("SELECT v FROM meta WHERE k='auth_secret'").first();
  return JSON.parse(again.v); // another request may have won the race
}

export async function signToken(secret, cid, tokenId) {
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${cid}.${tokenId}`)));
  return b64u(enc.encode(`${cid}.${tokenId}.${b64u(sig)}`));
}

/** -> {cid, tokenId} when the signature is valid, else null (does not check revocation). */
export async function readToken(secret, token) {
  try {
    const [cid, tokenId, sig] = new TextDecoder().decode(fromB64u(String(token))).split(".");
    if (!/^\d{5,25}$/.test(cid) || !tokenId || !sig) return null;
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64u(sig), enc.encode(`${cid}.${tokenId}`));
    return ok ? { cid, tokenId } : null;
  } catch { return null; }
}

async function sha256Hex(s) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Census: character by exact name -> {cid, name, faction, world, online} or null. */
export async function lookupCharacter(sid, name, fetchImpl = fetch) {
  const base = `https://census.daybreakgames.com/s:${sid}/get/ps2:v2`;
  const r = await fetchImpl(`${base}/character/?name.first_lower=${encodeURIComponent(name.toLowerCase())}&c:show=character_id,name,faction_id&c:join=characters_world^inject_at:w^show:world_id&c:join=characters_online_status^inject_at:o^show:online_status`,
    { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`census ${r.status}`);
  const j = await r.json();
  if (j.error || j.errorCode) throw new Error(`census ${j.error || j.errorCode}`);
  const c = (j.character_list || [])[0];
  if (!c) return null;
  const online = c.o && c.o.online_status !== undefined ? c.o.online_status !== "0" : null;
  return { cid: String(c.character_id), name: (c.name && c.name.first) || name, faction: FAC[+c.faction_id] || null,
    world: c.w ? +c.w.world_id : null, online };
}

const watcher = (env) => env.AUTH && env.AUTH.get(env.AUTH.idFromName("auth"));

/** Expire accepted challenges whose window has passed (the watcher also does this). */
async function expireOld(db, now) {
  await db.prepare("UPDATE challenge SET status='expired' WHERE status='accepted' AND window_end < ?").bind(now - 10).run();
}

export async function handleAuth(request, env, url, json, now = Math.floor(Date.now() / 1000), fetchImpl = fetch) {
  const db = env.DB;
  const p = url.pathname;
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};

  if (p === "/auth/start" && request.method === "POST") {
    const name = String(body.name || "").trim().replace(/^\[[^\]]*\]\s*/, "");
    if (!NAME_RE.test(name)) return json({ error: "invalid_name" }, 400);
    const ipHash = await sha256Hex("ip|" + (request.headers.get("CF-Connecting-IP") || "unknown"));
    const recent = await db.prepare("SELECT COUNT(*) AS n FROM challenge WHERE ip_hash=? AND created > ?").bind(ipHash, now - 600).first();
    if (recent && recent.n >= STARTS_PER_IP_10MIN) return json({ error: "too_many_attempts", retry_after_s: 600 }, 429);
    let ch;
    try { ch = await lookupCharacter((env.CENSUS_SERVICE_ID || "daysetps2legends").replace(/^s:/, ""), name, fetchImpl); }
    catch { return json({ error: "census_unavailable" }, 503); }
    if (!ch) return json({ error: "character_not_found" }, 404);
    const id = randomId(12);
    await db.prepare("INSERT INTO challenge (id, cid, name, world, faction, created, status, ip_hash) VALUES (?,?,?,?,?,?,'created',?)")
      .bind(id, ch.cid, ch.name, ch.world, ch.faction, now, ipHash).run();
    return json({ id, character: { name: ch.name, faction: ch.faction, world: ch.world, online: ch.online },
      accept_after_s: ACCEPT_WAIT_S, window_s: WINDOW_S }, 200, { "Cache-Control": "no-store" });
  }

  if (p === "/auth/accept" && request.method === "POST") {
    const c = await db.prepare("SELECT * FROM challenge WHERE id=?").bind(String(body.id || "")).first();
    if (!c || now - c.created > CHALLENGE_TTL_S) return json({ error: "unknown_challenge" }, 404);
    if (c.status !== "created") return json({ error: "already_" + c.status }, 409);
    if (now < c.created + ACCEPT_WAIT_S) return json({ error: "too_early", wait_s: c.created + ACCEPT_WAIT_S - now }, 425);
    const end = now + WINDOW_S;
    await db.prepare("UPDATE challenge SET status='accepted', accepted=?, window_end=? WHERE id=? AND status='created'").bind(now, end, c.id).run();
    const w = watcher(env);
    if (w) {
      try { await w.fetch(new Request("https://auth/watch", { method: "POST", body: JSON.stringify({ id: c.id, cid: c.cid, from: now, until: end }) })); }
      catch { /* the check endpoint reports stream health */ }
    }
    return json({ ok: true, window_end: end, window_s: WINDOW_S }, 200, { "Cache-Control": "no-store" });
  }

  if (p === "/auth/check") {
    await expireOld(db, now);
    const c = await db.prepare("SELECT id, status, created, accepted, window_end, name FROM challenge WHERE id=?").bind(url.searchParams.get("id") || "").first();
    if (!c) return json({ error: "unknown_challenge" }, 404);
    return json({ status: c.status, name: c.name, accept_in_s: Math.max(0, c.created + ACCEPT_WAIT_S - now),
      left_s: c.window_end ? Math.max(0, c.window_end - now) : null }, 200, { "Cache-Control": "no-store" });
  }

  if (p === "/auth/complete" && request.method === "POST") {
    const c = await db.prepare("SELECT * FROM challenge WHERE id=?").bind(String(body.id || "")).first();
    if (!c) return json({ error: "unknown_challenge" }, 404);
    if (c.status !== "passed") return json({ error: "not_passed", status: c.status }, 409);
    const tokenId = randomId(16);
    const secret = await authSecret(db);
    const token = await signToken(secret, c.cid, tokenId);
    await db.batch([
      db.prepare(`INSERT INTO account (cid, name, world, faction, token_id, created, updated) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(cid) DO UPDATE SET name=excluded.name, world=excluded.world, faction=excluded.faction, token_id=excluded.token_id, updated=excluded.updated`)
        .bind(c.cid, c.name, c.world, c.faction, tokenId, now, now),
      db.prepare("UPDATE challenge SET status='completed' WHERE id=? AND status='passed'").bind(c.id),
    ]);
    return json({ token, character: { cid: c.cid, name: c.name, faction: c.faction, world: c.world } }, 200, { "Cache-Control": "no-store" });
  }

  if (p === "/auth/me" || (p === "/auth/logout" && request.method === "POST")) {
    const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const t = token && (await readToken(await authSecret(db), token));
    const a = t && (await db.prepare("SELECT cid, name, world, faction, token_id, created FROM account WHERE cid=?").bind(t.cid).first());
    if (!a || a.token_id !== t.tokenId) return json({ error: "not_signed_in" }, 401, { "Cache-Control": "no-store" });
    if (p === "/auth/logout") {
      await db.prepare("UPDATE account SET token_id=NULL, updated=? WHERE cid=? AND token_id=?").bind(now, a.cid, t.tokenId).run();
      return json({ ok: true }, 200, { "Cache-Control": "no-store" });
    }
    return json({ character: { cid: a.cid, name: a.name, faction: a.faction, world: a.world, since: a.created } }, 200, { "Cache-Control": "no-store" });
  }

  if (p === "/auth/health") {
    const w = watcher(env);
    if (!w) return json({ stream: "unbound" }, 200, { "Cache-Control": "no-store" });
    const r = await w.fetch(new Request("https://auth/status"));
    return json(await r.json(), 200, { "Cache-Control": "no-store" });
  }

  return json({ error: "not_found" }, 404);
}

/** Bearer token -> account row (for the voting endpoints), or null. */
export async function accountFromRequest(request, db) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const t = await readToken(await authSecret(db), token);
  if (!t) return null;
  const a = await db.prepare("SELECT * FROM account WHERE cid=?").bind(t.cid).first();
  return a && a.token_id === t.tokenId ? a : null;
}
