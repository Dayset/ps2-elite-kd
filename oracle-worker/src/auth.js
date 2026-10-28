/**
 * Logout-only character verification (oracle/docs/AUTH_DESIGN.md).
 *
 *   POST /auth/start   {name}  -> Census lookup, challenge {id, accept_after}
 *   POST /auth/accept  {id}    -> only >= 5 s after start; opens the 60 s window
 *                                 and asks the AuthWatcher to watch the character
 *   GET  /auth/check?id=       -> created | accepted | passed | expired | completed
 *   POST /auth/complete {id}   -> passed challenge -> token (one active per character)
 *   GET  /auth/me              -> Authorization: Bearer <token> -> character (+ devices signed in)
 *   POST /auth/logout {all?}   -> revokes this device's session (all: every session of the character)
 *   POST /auth/link            -> signed in: one-time QR link for a second device (#82), 3 min
 *   GET  /auth/link/status?id= -> signed in: waiting | linked | expired (the PC dialog polls it)
 *   POST /auth/link/claim {code} -> the second device: new session for the same character
 *   GET  /auth/health          -> stream watcher state
 *
 * Token = base64url("<cid>.<sessionId>.<hmac>"), HMAC-SHA256 with a random server
 * secret created once and kept in D1 (meta "auth_secret"). #82: one session row per
 * device (table session, at most MAX_SESSIONS per character). A new in-game logout
 * verification revokes every session of the character (the old "verifying on another
 * device signs this one out" rule, and the way to cut off a misused QR link). Tokens
 * issued before #82 (account.token_id) become a "verified" session on first use.
 * Link codes: 256 random bits, only their SHA-256 is stored, single use, LINK_TTL_S.
 */
export const ACCEPT_WAIT_S = 5;
export const WINDOW_S = 60;
const CHALLENGE_TTL_S = 15 * 60;
const STARTS_PER_IP_10MIN = 6;
const NAME_RE = /^[A-Za-z0-9]{3,32}$/;
const FAC = { 1: "VS", 2: "NC", 3: "TR", 4: "NSO" };

/**
 * Platforms (#61): PC = Census "ps2"; PlayStation Genudine / Ceres = "ps2ps4us" /
 * "ps2ps4eu". PS character ids are per server, so a PS identity is "us-<cid>" /
 * "eu-<cid>"; a PC identity is the bare cid (unchanged).
 */
export const PLATFORMS = Object.freeze({
  pc: { ns: "ps2", prefix: "" },
  us: { ns: "ps2ps4us", prefix: "us-" },
  eu: { ns: "ps2ps4eu", prefix: "eu-" },
});
export const IDENT_RE = /^(?:(us|eu)-)?(\d{5,25})$/;
/** "us-5428…" -> { platform: "us", ns: "ps2ps4us", cid: "5428…" }; "5428…" -> PC. */
export function parseIdent(ident) {
  const m = IDENT_RE.exec(String(ident || ""));
  if (!m) return null;
  const platform = m[1] || "pc";
  return { platform, ns: PLATFORMS[platform].ns, cid: m[2] };
}

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
    if (!IDENT_RE.test(cid) || !tokenId || !sig) return null;
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64u(sig), enc.encode(`${cid}.${tokenId}`));
    return ok ? { cid, tokenId } : null;
  } catch { return null; }
}

/**
 * Sign-in rate-limit key for a visitor IP (#61): HMAC with the server secret,
 * never the raw address and not reversible by hashing every IPv4 address.
 * Challenge rows (and with them this hash) are pruned after a day.
 */
export async function ipHash(db, ip) {
  const key = await hmacKey(await authSecret(db));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode("ip|" + String(ip || "unknown"))));
  return b64u(sig.slice(0, 12));
}

/** Sign-in challenges are only needed for minutes; kept a day for the rate limit, then deleted. */
export const CHALLENGE_KEEP_S = 86400;

/** #82 second-device sign-in: link lifetime, limits, sessions per character, last_seen write interval. */
export const LINK_TTL_S = 180;
export const LINK_MINTS_PER_10MIN = 5;
export const LINK_CLAIMS_PER_IP_10MIN = 20;
export const MAX_SESSIONS = 5;
const SEEN_EVERY_S = 3600;
export const LINK_URL = "https://dayset.github.io/ps2-elite-kd/oracle/#link=";
const CODE_RE = /^[A-Za-z0-9_-]{40,48}$/;

/** #82 tables, created lazily like removal (privacy.js): schema.sql is not applied on deploy. */
export const AUTH_TABLES = [
  `CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY,        -- token's session id
    cid TEXT NOT NULL,
    kind TEXT NOT NULL,         -- verified (in-game logout) | linked (QR from a signed-in device)
    created INTEGER NOT NULL,
    last_seen INTEGER NOT NULL, -- written at most once an hour
    linked_from TEXT            -- session id that minted the link
  )`,
  "CREATE INDEX IF NOT EXISTS session_cid ON session (cid, last_seen)",
  `CREATE TABLE IF NOT EXISTS link (
    hash TEXT PRIMARY KEY,      -- SHA-256 of the one-time code (the code itself is never stored)
    cid TEXT NOT NULL,
    session_id TEXT NOT NULL,   -- minting session
    created INTEGER NOT NULL,
    expires INTEGER NOT NULL,
    used_at INTEGER,
    used_session TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS link_cid ON link (cid, created)",
  "CREATE TABLE IF NOT EXISTS link_try (ip_hash TEXT NOT NULL, ts INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS link_try_ip ON link_try (ip_hash, ts)",
];
const tablesReady = new WeakSet();
export async function ensureAuthTables(db) {
  if (tablesReady.has(db)) return;
  for (const sql of AUTH_TABLES) await db.prepare(sql).run();
  tablesReady.add(db);
}
const sha256 = async (s) => b64u(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))));
const bearer = (request) => (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
const platformOf = (cid) => (parseIdent(cid) || {}).platform || "pc";
const characterOf = (a) => ({ cid: a.cid, name: a.name, faction: a.faction, world: a.world, since: a.created, platform: platformOf(a.cid) });

/** Census: character by exact name -> {cid, name, faction, world, online} or null. */
export async function lookupCharacter(sid, name, fetchImpl = fetch, ns = "ps2") {
  const base = `https://census.daybreakgames.com/s:${sid}/get/${ns}:v2`;
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
  const ns = { "Cache-Control": "no-store" };
  await ensureAuthTables(db);

  if (p === "/auth/start" && request.method === "POST") {
    const name = String(body.name || "").trim().replace(/^\[[^\]]*\]\s*/, "");
    if (!NAME_RE.test(name)) return json({ error: "invalid_name" }, 400);
    const ipKey = await ipHash(db, request.headers.get("CF-Connecting-IP"));
    const recent = await db.prepare("SELECT COUNT(*) AS n FROM challenge WHERE ip_hash=? AND created > ?").bind(ipKey, now - 600).first();
    if (recent && recent.n >= STARTS_PER_IP_10MIN) return json({ error: "too_many_attempts", retry_after_s: 600 }, 429);
    const platform = Object.prototype.hasOwnProperty.call(PLATFORMS, body.platform) ? body.platform : "pc";
    let ch;
    try { ch = await lookupCharacter((env.CENSUS_SERVICE_ID || "daysetps2legends").replace(/^s:/, ""), name, fetchImpl, PLATFORMS[platform].ns); }
    catch { return json({ error: "census_unavailable" }, 503); }
    if (!ch) return json({ error: "character_not_found" }, 404);
    ch.cid = PLATFORMS[platform].prefix + ch.cid; // identity: bare cid on PC, us-/eu-<cid> on PlayStation
    const id = randomId(12);
    await db.prepare("INSERT INTO challenge (id, cid, name, world, faction, created, status, ip_hash) VALUES (?,?,?,?,?,?,'created',?)")
      .bind(id, ch.cid, ch.name, ch.world, ch.faction, now, ipKey).run();
    return json({ id, character: { name: ch.name, faction: ch.faction, world: ch.world, online: ch.online, platform },
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
    // #82: a fresh in-game verification revokes every session (and open link) of the character.
    await db.batch([
      db.prepare(`INSERT INTO account (cid, name, world, faction, token_id, created, updated) VALUES (?,?,?,?,NULL,?,?)
        ON CONFLICT(cid) DO UPDATE SET name=excluded.name, world=excluded.world, faction=excluded.faction, token_id=NULL, updated=excluded.updated`)
        .bind(c.cid, c.name, c.world, c.faction, now, now),
      db.prepare("DELETE FROM session WHERE cid=?").bind(c.cid),
      db.prepare("DELETE FROM link WHERE cid=? AND used_at IS NULL").bind(c.cid),
      db.prepare("INSERT INTO session (id, cid, kind, created, last_seen) VALUES (?,?,'verified',?,?)").bind(tokenId, c.cid, now, now),
      db.prepare("UPDATE challenge SET status='completed' WHERE id=? AND status='passed'").bind(c.id),
    ]);
    return json({ token, character: { cid: c.cid, name: c.name, faction: c.faction, world: c.world, platform: (parseIdent(c.cid) || {}).platform || "pc" } }, 200, { "Cache-Control": "no-store" });
  }

  if (p === "/auth/link/claim" && request.method === "POST") {
    const ipKey = await ipHash(db, request.headers.get("CF-Connecting-IP"));
    const tries = await db.prepare("SELECT COUNT(*) AS n FROM link_try WHERE ip_hash=? AND ts > ?").bind(ipKey, now - 600).first();
    if (tries && tries.n >= LINK_CLAIMS_PER_IP_10MIN) return json({ error: "too_many_attempts", retry_after_s: 600 }, 429, ns);
    await db.prepare("INSERT INTO link_try (ip_hash, ts) VALUES (?,?)").bind(ipKey, now).run();
    const code = String(body.code || "");
    const l = CODE_RE.test(code) ? await db.prepare("SELECT * FROM link WHERE hash=?").bind(await sha256(code)).first() : null;
    if (!l) return json({ error: "unknown_link" }, 404, ns);
    if (l.used_at) return json({ error: "link_used" }, 409, ns);
    if (l.expires < now) return json({ error: "link_expired" }, 409, ns);
    const from = await db.prepare("SELECT id FROM session WHERE id=? AND cid=?").bind(l.session_id, l.cid).first();
    const a = await db.prepare("SELECT * FROM account WHERE cid=?").bind(l.cid).first();
    if (!from || !a) return json({ error: "link_expired" }, 409, ns); // the PC signed out or was revoked since
    const sid = randomId(16);
    const [claim] = await db.batch([
      db.prepare("UPDATE link SET used_at=?, used_session=? WHERE hash=? AND used_at IS NULL AND expires >= ?").bind(now, sid, l.hash, now),
      db.prepare("INSERT INTO session (id, cid, kind, created, last_seen, linked_from) SELECT ?,?,'linked',?,?,? WHERE changes() = 1").bind(sid, l.cid, now, now, l.session_id),
    ]);
    if (!claim.meta || !claim.meta.changes) return json({ error: "link_used" }, 409, ns); // another device won the race
    // At most MAX_SESSIONS per character: drop the least recently seen linked ones (never the verified one, never this one).
    const n = await db.prepare("SELECT COUNT(*) AS n FROM session WHERE cid=?").bind(l.cid).first();
    if (n && n.n > MAX_SESSIONS) {
      await db.prepare("DELETE FROM session WHERE id IN (SELECT id FROM session WHERE cid=? AND kind='linked' AND id != ? ORDER BY last_seen ASC, created ASC LIMIT ?)")
        .bind(l.cid, sid, n.n - MAX_SESSIONS).run();
    }
    const token = await signToken(await authSecret(db), l.cid, sid);
    return json({ token, character: characterOf(a) }, 200, ns);
  }

  if (p === "/auth/me" || p.startsWith("/auth/link") || (p === "/auth/logout" && request.method === "POST")) {
    const me = await sessionFromRequest(request, db, now);
    if (!me) return json({ error: "not_signed_in" }, 401, ns);
    const { account: a, session: sess } = me;
    if (p === "/auth/logout") {
      if (body.all === true) {
        await db.batch([db.prepare("DELETE FROM session WHERE cid=?").bind(a.cid), db.prepare("DELETE FROM link WHERE cid=? AND used_at IS NULL").bind(a.cid)]);
      } else {
        await db.batch([db.prepare("DELETE FROM session WHERE id=?").bind(sess.id), db.prepare("DELETE FROM link WHERE session_id=? AND used_at IS NULL").bind(sess.id)]);
      }
      return json({ ok: true }, 200, ns);
    }
    if (p === "/auth/link" && request.method === "POST") {
      const recent = await db.prepare("SELECT COUNT(*) AS n FROM link WHERE cid=? AND created > ?").bind(a.cid, now - 600).first();
      if (recent && recent.n >= LINK_MINTS_PER_10MIN) return json({ error: "too_many_links", retry_after_s: 600 }, 429, ns);
      const code = randomId(32);
      const hash = await sha256(code);
      await db.batch([
        // One live code per device. Expired, not deleted: superseded codes still count toward the mint limit.
        db.prepare("UPDATE link SET expires=? WHERE session_id=? AND used_at IS NULL AND expires >= ?").bind(now - 1, sess.id, now),
        db.prepare("INSERT INTO link (hash, cid, session_id, created, expires) VALUES (?,?,?,?,?)").bind(hash, a.cid, sess.id, now, now + LINK_TTL_S),
      ]);
      return json({ url: LINK_URL + code, id: hash, expires_in_s: LINK_TTL_S }, 200, ns);
    }
    if (p === "/auth/link/status") {
      const l = await db.prepare("SELECT used_at, expires FROM link WHERE hash=? AND session_id=?").bind(url.searchParams.get("id") || "", sess.id).first();
      const devices = (await db.prepare("SELECT COUNT(*) AS n FROM session WHERE cid=?").bind(a.cid).first()).n;
      const status = !l ? "expired" : l.used_at ? "linked" : l.expires < now ? "expired" : "waiting";
      return json({ status, left_s: l && !l.used_at ? Math.max(0, l.expires - now) : 0, devices }, 200, ns);
    }
    if (p !== "/auth/me") return json({ error: "not_found" }, 404, ns);
    const devices = (await db.prepare("SELECT COUNT(*) AS n FROM session WHERE cid=?").bind(a.cid).first()).n;
    return json({ character: characterOf(a), session: { kind: sess.kind }, devices }, 200, ns);
  }

  if (p === "/auth/health") {
    const w = watcher(env);
    if (!w) return json({ stream: "unbound" }, 200, { "Cache-Control": "no-store" });
    const r = await w.fetch(new Request("https://auth/status"));
    return json(await r.json(), 200, { "Cache-Control": "no-store" });
  }

  return json({ error: "not_found" }, 404);
}

/**
 * Bearer token -> { account, session } or null. A token issued before #82 (account.token_id)
 * becomes the character's "verified" session on first use, so nobody is signed out by the change.
 */
export async function sessionFromRequest(request, db, now = Math.floor(Date.now() / 1000)) {
  const token = bearer(request);
  if (!token) return null;
  const t = await readToken(await authSecret(db), token);
  if (!t) return null;
  await ensureAuthTables(db);
  const a = await db.prepare("SELECT * FROM account WHERE cid=?").bind(t.cid).first();
  if (!a) return null;
  let s = await db.prepare("SELECT * FROM session WHERE id=? AND cid=?").bind(t.tokenId, t.cid).first();
  if (!s && a.token_id && a.token_id === t.tokenId) {
    // Both idempotent, so two first requests at once are harmless.
    await db.prepare("INSERT OR IGNORE INTO session (id, cid, kind, created, last_seen) VALUES (?,?,'verified',?,?)").bind(t.tokenId, t.cid, a.updated || now, now).run();
    await db.prepare("UPDATE account SET token_id=NULL WHERE cid=? AND token_id=?").bind(t.cid, t.tokenId).run();
    s = await db.prepare("SELECT * FROM session WHERE id=? AND cid=?").bind(t.tokenId, t.cid).first();
  }
  if (!s) return null;
  if (now - s.last_seen >= SEEN_EVERY_S) await db.prepare("UPDATE session SET last_seen=? WHERE id=?").bind(now, s.id).run();
  return { account: a, session: s };
}

/** Bearer token -> account row (voting, privacy), or null. */
export async function accountFromRequest(request, db, now = Math.floor(Date.now() / 1000)) {
  const r = await sessionFromRequest(request, db, now);
  return r ? r.account : null;
}
