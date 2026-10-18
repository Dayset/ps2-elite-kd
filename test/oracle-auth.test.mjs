// Logout-only login (oracle/docs/AUTH_DESIGN.md): challenge rules, the stream
// watcher's matching, tokens that survive a reload (F5 = /auth/me again),
// one active token per character, sign-out, and rate limiting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let sqlite = null;
try { sqlite = await import("node:sqlite"); } catch {}
const skip = !sqlite && "node:sqlite unavailable (needs Node >= 22.5)";
const SCHEMA = readFileSync(new URL("../oracle-worker/schema.sql", import.meta.url), "utf8");

function fakeD1() {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
    _exec() { return db.prepare(sql).run(...args); },
  });
  return { raw: db, prepare: (sql) => stmt(sql), async batch(l) { return l.map((s) => s._exec()); } };
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const CID = "5428010618035323201";

async function setup() {
  const { handleAuth } = await import("../oracle-worker/src/auth.js");
  const { AuthWatcher, matchLogout } = await import("../oracle-worker/src/auth-watcher.js");
  const DB = fakeD1();
  const watched = [];
  const env = { DB, AUTH: { idFromName: () => "auth", get: () => ({ fetch: async (req) => {
    const u = new URL(req.url);
    if (u.pathname === "/watch") { watched.push(await req.json()); return Response.json({ ok: true }); }
    return Response.json({ stream: "idle (connects on demand)", watching: watched.length });
  } }) } };
  const census = async (url) => {
    const u = String(url);
    if (u.includes("first_lower=nosuchguy")) return json({ character_list: [], returned: 0 });
    return json({ character_list: [{ character_id: CID, name: { first: "Maelstrome26" }, faction_id: "1", w: { world_id: "10" }, o: { online_status: "10" } }] });
  };
  const call = async (method, path, now, body, headers = {}) => {
    const url = new URL("https://x" + path);
    const req = new Request(url, { method, headers: { "Content-Type": "application/json", "CF-Connecting-IP": headers.ip || "1.2.3.4", ...headers },
      body: body ? JSON.stringify(body) : undefined });
    const r = await handleAuth(req, env, url, json, now, census);
    return { status: r.status, body: await r.json() };
  };
  return { DB, env, watched, call, AuthWatcher, matchLogout };
}

test("logout-only login: 5 s wait, 60 s window, token survives reload", { skip }, async () => {
  const { DB, watched, call, matchLogout } = await setup();
  const T = 1_792_320_000;
  assert.equal((await call("POST", "/auth/start", T, { name: "x" })).status, 400);
  assert.equal((await call("POST", "/auth/start", T, { name: "nosuchguy" })).status, 404);
  const st = await call("POST", "/auth/start", T, { name: "[DIG] Maelstrome26" });
  assert.equal(st.status, 200);
  assert.deepEqual(st.body.character, { name: "Maelstrome26", faction: "VS", world: 10, online: true });
  const id = st.body.id;

  // ACCEPT is refused for the first 5 seconds.
  const early = await call("POST", "/auth/accept", T + 3, { id });
  assert.equal(early.status, 425);
  assert.equal(early.body.wait_s, 2);
  const acc = await call("POST", "/auth/accept", T + 6, { id });
  assert.equal(acc.status, 200);
  assert.deepEqual(watched[0], { id, cid: CID, from: T + 6, until: T + 66 });
  assert.equal((await call("POST", "/auth/accept", T + 7, { id })).status, 409, "accept only once");

  // The watcher only passes a logout inside the window.
  const w = { [CID]: { id, from: T + 6, until: T + 66 } };
  const logout = (ts, cid = CID) => ({ type: "serviceMessage", payload: { event_name: "PlayerLogout", character_id: cid, timestamp: String(ts) } });
  assert.equal(matchLogout(w, logout(T)), null, "a logout before ACCEPT is stale");
  assert.equal(matchLogout(w, logout(T + 30, "5428010618035300000")), null, "another character");
  assert.equal(matchLogout(w, logout(T + 200)), null, "after the window");
  assert.equal(matchLogout(w, { type: "serviceMessage", payload: { event_name: "Death", character_id: CID, timestamp: String(T + 30) } }), null);
  const hit = matchLogout(w, logout(T + 30));
  assert.equal(hit.id, id);
  DB.raw.prepare("UPDATE challenge SET status='passed', passed_at=? WHERE id=?").run(hit.ts, id);   // what the watcher writes

  assert.equal((await call("GET", `/auth/check?id=${id}`, T + 31)).body.status, "passed");
  const done = await call("POST", "/auth/complete", T + 32, { id });
  assert.equal(done.status, 200);
  assert.equal(done.body.character.name, "Maelstrome26");
  const token = done.body.token;
  assert.equal((await call("POST", "/auth/complete", T + 33, { id })).status, 409, "a challenge yields one token");

  // F5: the page sends the stored token again and is still signed in.
  for (let i = 0; i < 2; i++) {
    const me = await call("GET", "/auth/me", T + 40 + i, null, { Authorization: `Bearer ${token}` });
    assert.equal(me.status, 200);
    assert.equal(me.body.character.cid, CID);
  }
  // A tampered token is refused.
  const bad = token.slice(0, -3) + (token.endsWith("A") ? "BBB" : "AAA");
  assert.equal((await call("GET", "/auth/me", T + 50, null, { Authorization: `Bearer ${bad}` })).status, 401);

  // Verifying again (new device) revokes the old token.
  const st2 = await call("POST", "/auth/start", T + 100, { name: "Maelstrome26" }, { ip: "5.6.7.8" });
  await call("POST", "/auth/accept", T + 106, { id: st2.body.id });
  DB.raw.prepare("UPDATE challenge SET status='passed' WHERE id=?").run(st2.body.id);
  const token2 = (await call("POST", "/auth/complete", T + 110, { id: st2.body.id })).body.token;
  assert.equal((await call("GET", "/auth/me", T + 111, null, { Authorization: `Bearer ${token}` })).status, 401, "old token revoked");
  assert.equal((await call("GET", "/auth/me", T + 111, null, { Authorization: `Bearer ${token2}` })).status, 200);

  // Sign out.
  assert.equal((await call("POST", "/auth/logout", T + 120, {}, { Authorization: `Bearer ${token2}` })).status, 200);
  assert.equal((await call("GET", "/auth/me", T + 121, null, { Authorization: `Bearer ${token2}` })).status, 401);
});

test("a window with no logout expires; nothing to complete", { skip }, async () => {
  const { call } = await setup();
  const T = 1_792_330_000;
  const { body } = await call("POST", "/auth/start", T, { name: "Maelstrome26" });
  await call("POST", "/auth/accept", T + 5, { id: body.id });
  assert.equal((await call("GET", `/auth/check?id=${body.id}`, T + 40)).body.status, "accepted");
  assert.equal((await call("GET", `/auth/check?id=${body.id}`, T + 80)).body.status, "expired");
  assert.equal((await call("POST", "/auth/complete", T + 81, { id: body.id })).status, 409);
});

test("starts are rate limited per IP", { skip }, async () => {
  const { call } = await setup();
  const T = 1_792_340_000;
  for (let i = 0; i < 6; i++) assert.equal((await call("POST", "/auth/start", T + i, { name: "Maelstrome26" })).status, 200);
  assert.equal((await call("POST", "/auth/start", T + 7, { name: "Maelstrome26" })).status, 429);
  assert.equal((await call("POST", "/auth/start", T + 8, { name: "Maelstrome26" }, { ip: "9.9.9.9" })).status, 200);
});

test("AuthWatcher passes the challenge in D1 and expires stale windows", { skip }, async () => {
  const { DB, AuthWatcher } = await setup();
  const store = new Map();
  let alarm = null;
  const ctx = { storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); }, getAlarm: async () => alarm, setAlarm: async (t) => { alarm = t; } } };
  const w = new AuthWatcher(ctx, { DB });
  w.ensure = async () => {}; // no real stream in tests
  const now = Math.floor(Date.now() / 1000);
  DB.raw.prepare("INSERT INTO challenge (id, cid, name, created, accepted, window_end, status) VALUES ('a', ?, 'X', ?, ?, ?, 'accepted')").run(CID, now - 10, now - 5, now + 55);
  DB.raw.prepare("INSERT INTO challenge (id, cid, name, created, accepted, window_end, status) VALUES ('b', '5428010618035300009', 'Y', ?, ?, ?, 'accepted')").run(now - 200, now - 190, now - 130);
  await w.fetch(new Request("https://auth/watch", { method: "POST", body: JSON.stringify({ id: "a", cid: CID, from: now - 5, until: now + 55 }) }));
  await w.fetch(new Request("https://auth/watch", { method: "POST", body: JSON.stringify({ id: "b", cid: "5428010618035300009", from: now - 190, until: now - 130 }) }));
  await w.onMessage(JSON.stringify({ type: "serviceMessage", payload: { event_name: "PlayerLogout", character_id: CID, timestamp: String(now) } }));
  assert.equal(DB.raw.prepare("SELECT status FROM challenge WHERE id='a'").get().status, "passed");
  await w.alarm();
  assert.equal(DB.raw.prepare("SELECT status FROM challenge WHERE id='b'").get().status, "expired");
  assert.deepEqual(store.get("watches"), {});
  const st = await (await w.fetch(new Request("https://auth/status"))).json();
  assert.equal(st.watching, 0);
});

test("CORS preflight for sign-in requests is a bodyless 204", async () => {
  const { default: worker } = await import("../oracle-worker/src/index.js");
  const r = await worker.fetch(new Request("https://x/auth/start", { method: "OPTIONS" }), {});
  assert.equal(r.status, 204);
  assert.match(r.headers.get("Access-Control-Allow-Headers"), /Authorization/);
  assert.match(r.headers.get("Access-Control-Allow-Methods"), /POST/);
});
