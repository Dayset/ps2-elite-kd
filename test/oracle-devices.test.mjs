// #82: second-device sign-in by QR link from a signed-in PC, one session per device, and one vote per faction per
// alert across devices (owner 2026-10-28) — races, retries, stale balances and the daily BonusCheque.
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
  const run = (sql, args) => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; };
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { return run(sql, args); },
    _exec() { return run(sql, args); },
  });
  return { raw: db, prepare: (sql) => stmt(sql), async batch(l) { db.exec("BEGIN"); try { const r = l.map((s) => s._exec()); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } } };
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const CID = "5428010618035300777";
const T0 = 1_792_500_000;

async function setup() {
  const auth = await import("../oracle-worker/src/auth.js");
  const { handleVote } = await import("../oracle-worker/src/vote.js");
  const { pruneStatements } = await import("../oracle-worker/src/index.js");
  const DB = fakeD1();
  const env = { DB };
  const req = (method, path, body, token, ip = "1.2.3.4") => {
    const url = new URL("https://x" + path);
    const r = new Request(url, { method, headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { url, r };
  };
  const call = async (method, path, now, body, token, ip) => {
    const { url, r } = req(method, path, body, token, ip);
    const res = path.startsWith("/vote/") ? await handleVote(r, env, url, json, now) : await auth.handleAuth(r, env, url, json, now);
    return { status: res.status, body: await res.json() };
  };
  /** A passed logout challenge completed at `now` -> a verified token (what the in-game logout gives). */
  const verify = async (now, cid = CID, name = "Phoney") => {
    const id = "ch" + now + cid.slice(-4);
    DB.raw.prepare("INSERT INTO challenge (id, cid, name, world, faction, created, status) VALUES (?,?,?,1,'VS',?, 'passed')").run(id, cid, name, now - 30);
    const r = await call("POST", "/auth/complete", now, { id });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.token;
  };
  const codeOf = (url) => url.slice(auth.LINK_URL.length);
  const state = (ts, win) => JSON.stringify({ ts, win: { VS: { pct: win[0] }, NC: { pct: win[1] }, TR: { pct: win[2] } } });
  DB.raw.prepare("INSERT INTO alert (key, world, zone, instance_id, event_id, start_ts, dur, status, state, updated) VALUES ('1-4-9',1,4,9,153,?,90,'live',?,0)").run(T0, state(T0 + 600, [50, 30, 20]));
  return { DB, call, verify, codeOf, auth, pruneStatements };
}

test("PC mints a QR link, the phone claims it: one character, one wallet, one vote per faction", { skip }, async () => {
  const { DB, call, verify, codeOf, auth } = await setup();
  const now = T0 + 620;
  const pc = await verify(now);
  assert.equal((await call("GET", "/auth/me", now, null, pc)).body.devices, 1);

  assert.equal((await call("POST", "/auth/link", now, {})).status, 401, "only a signed-in device can mint");
  const mint = await call("POST", "/auth/link", now, {}, pc);
  assert.equal(mint.status, 200);
  assert.ok(mint.body.url.startsWith("https://dayset.github.io/ps2-elite-kd/oracle/#link="), "a #fragment link: the code never reaches server logs");
  assert.equal(mint.body.expires_in_s, auth.LINK_TTL_S);
  const code = codeOf(mint.body.url);
  assert.ok(code.length >= 43, "256-bit code");
  const row = DB.raw.prepare("SELECT * FROM link").get();
  assert.ok(!Object.values(row).includes(code), "D1 stores only the code's hash");
  assert.equal((await call("GET", `/auth/link/status?id=${mint.body.id}`, now + 1, null, pc)).body.status, "waiting");

  const claim = await call("POST", "/auth/link/claim", now + 5, { code }, null, "9.9.9.9");
  assert.equal(claim.status, 200, JSON.stringify(claim.body));
  assert.equal(claim.body.character.cid, CID, "same character");
  const phone = claim.body.token;
  assert.notEqual(phone, pc, "its own session token");
  const st = await call("GET", `/auth/link/status?id=${mint.body.id}`, now + 6, null, pc);
  assert.equal(st.body.status, "linked");
  assert.equal(st.body.devices, 2);
  assert.equal((await call("POST", "/auth/link/claim", now + 7, { code }, null, "8.8.8.8")).body.error, "link_used", "single use");
  const meP = await call("GET", "/auth/me", now + 8, null, phone);
  assert.equal(meP.body.session.kind, "linked");
  assert.equal((await call("GET", "/auth/me", now + 8, null, pc)).body.session.kind, "verified", "the PC keeps working");

  // Votes: the PC backs VS; the phone sees it and can't back VS again, but can back NC.
  assert.equal((await call("POST", "/vote/place", now + 10, { key: "1-4-9", outcome: "VS", amount: 100, seen_pct: 50 }, pc)).status, 200);
  const seen = await call("GET", "/vote/me", now + 11, null, phone);
  assert.equal(seen.body.balance, 900);
  assert.deepEqual(seen.body.votes.map((v) => v.outcome), ["VS"]);
  assert.equal(seen.body.server_ts, now + 11, "server time is the truth");
  const dup = await call("POST", "/vote/place", now + 12, { key: "1-4-9", outcome: "VS", amount: 50 }, phone);
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error, "already_voted");
  assert.equal(dup.body.vote.amount, 100, "shows the vote the other device made");
  assert.equal(dup.body.balance, 900);
  assert.equal((await call("POST", "/vote/place", now + 13, { key: "1-4-9", outcome: "NC", amount: 50 }, phone)).status, 200);
  assert.equal((await call("GET", "/vote/me", now + 14, null, pc)).body.balance, 850, "one wallet");

  // The daily BonusCheque: claimed on the PC, refused on the phone (with the real balance).
  assert.equal((await call("POST", "/vote/bonus", now + 20, {}, pc)).body.balance, 875);
  const b2 = await call("POST", "/vote/bonus", now + 21, {}, phone);
  assert.equal(b2.status, 409);
  assert.equal(b2.body.error, "already_claimed_today");
  assert.equal(b2.body.balance, 875);
  assert.equal(b2.body.bonus_available, false);
});

test("QR link: expires, wrong or malformed codes, one live code per device, mint and claim rate limits", { skip }, async () => {
  const { call, verify, codeOf, auth } = await setup();
  const now = T0 + 620;
  const pc = await verify(now);
  const m1 = await call("POST", "/auth/link", now, {}, pc);
  assert.equal((await call("POST", "/auth/link/claim", now + auth.LINK_TTL_S + 1, { code: codeOf(m1.body.url) })).body.error, "link_expired");
  assert.equal((await call("GET", `/auth/link/status?id=${m1.body.id}`, now + auth.LINK_TTL_S + 1, null, pc)).body.status, "expired");

  const m2 = await call("POST", "/auth/link", now + 200, {}, pc);
  const m3 = await call("POST", "/auth/link", now + 201, {}, pc);
  assert.equal((await call("POST", "/auth/link/claim", now + 202, { code: codeOf(m2.body.url) })).body.error, "link_expired", "a new code cancels this device's previous one");
  const flipped = codeOf(m3.body.url).replace(/^./, (c) => (c === "A" ? "B" : "A"));
  assert.equal((await call("POST", "/auth/link/claim", now + 203, { code: flipped })).status, 404, "wrong code");
  assert.equal((await call("POST", "/auth/link/claim", now + 203, { code: "short" })).status, 404, "malformed code");
  assert.equal((await call("POST", "/auth/link/claim", now + 204, { code: codeOf(m3.body.url) })).status, 200);

  // Mints: 5 per character per 10 minutes (m1–m3 count).
  assert.equal((await call("POST", "/auth/link", now + 205, {}, pc)).status, 200);
  assert.equal((await call("POST", "/auth/link", now + 206, {}, pc)).status, 200);
  const many = await call("POST", "/auth/link", now + 207, {}, pc);
  assert.equal(many.status, 429);
  assert.equal(many.body.error, "too_many_links");
  assert.equal((await call("POST", "/auth/link", now + 900, {}, pc)).status, 200, "allowed again after 10 minutes");

  // Claims: LINK_CLAIMS_PER_IP_10MIN attempts per IP (keyed hash), then 429 — other IPs unaffected.
  const later = now + 2000;
  for (let i = 0; i < auth.LINK_CLAIMS_PER_IP_10MIN; i++) await call("POST", "/auth/link/claim", later, { code: "x".repeat(43) }, null, "6.6.6.6");
  assert.equal((await call("POST", "/auth/link/claim", later, { code: "x".repeat(43) }, null, "6.6.6.6")).status, 429);
  assert.equal((await call("POST", "/auth/link/claim", later, { code: "x".repeat(43) }, null, "7.7.7.7")).status, 404);
});

test("revocation: phone logout keeps the PC, sign out everywhere, a new in-game verification revokes all", { skip }, async () => {
  const { call, verify, codeOf } = await setup();
  const now = T0 + 620;
  const link = async (t, from) => { const m = await call("POST", "/auth/link", t, {}, from); return (await call("POST", "/auth/link/claim", t + 1, { code: codeOf(m.body.url) })).body.token; };
  const pc = await verify(now);
  const phone = await link(now, pc);
  assert.equal((await call("POST", "/auth/logout", now + 10, {}, phone)).status, 200);
  assert.equal((await call("GET", "/auth/me", now + 11, null, phone)).status, 401, "the phone is out");
  assert.equal((await call("GET", "/auth/me", now + 11, null, pc)).status, 200, "the PC stays in");

  const phone2 = await link(now + 20, pc);
  const tablet = await link(now + 30, phone2); // a linked device may link another
  assert.equal((await call("GET", "/auth/me", now + 40, null, tablet)).body.devices, 3);
  assert.equal((await call("POST", "/auth/logout", now + 41, { all: true }, tablet)).status, 200);
  for (const t of [pc, phone2, tablet]) assert.equal((await call("GET", "/auth/me", now + 42, null, t)).status, 401, "signed out everywhere");

  const pc2 = await verify(now + 100);
  const phone3 = await link(now + 110, pc2);
  const pending = await call("POST", "/auth/link", now + 120, {}, pc2);
  await verify(now + 130); // the in-game logout again (e.g. a QR was misused)
  assert.equal((await call("GET", "/auth/me", now + 131, null, pc2)).status, 401);
  assert.equal((await call("GET", "/auth/me", now + 131, null, phone3)).status, 401);
  assert.equal((await call("POST", "/auth/link/claim", now + 132, { code: codeOf(pending.body.url) })).status, 404, "open links die with it");

  // A link whose minting device signed out can't be claimed (10 min later: 5 mints per 10 min per character).
  const t = now + 1000;
  const pc4 = await verify(t);
  const other = await link(t + 1, pc4);
  const m = await call("POST", "/auth/link", t + 2, {}, pc4);
  await call("POST", "/auth/logout", t + 3, {}, pc4);
  assert.equal((await call("POST", "/auth/link/claim", t + 4, { code: codeOf(m.body.url) })).status, 404, "logout cancels that device's codes");
  assert.equal((await call("GET", "/auth/me", t + 5, null, other)).status, 200);
});

test("at most MAX_SESSIONS per character: the least recently seen linked device goes, the verified one stays", { skip }, async () => {
  const { DB, call, verify, codeOf, auth } = await setup();
  let now = T0 + 620;
  const pc = await verify(now);
  const tokens = [];
  for (let i = 0; i < auth.MAX_SESSIONS + 1; i++) {
    now += 10;
    const m = await call("POST", "/auth/link", now + i * 700, {}, pc); // spread past the mint limit
    tokens.push((await call("POST", "/auth/link/claim", now + i * 700 + 1, { code: codeOf(m.body.url) }, null, `10.0.0.${i}`)).body.token);
  }
  assert.equal(DB.raw.prepare("SELECT COUNT(*) n FROM session WHERE cid=?").get(CID).n, auth.MAX_SESSIONS);
  const late = now + 20000;
  assert.equal((await call("GET", "/auth/me", late, null, pc)).status, 200, "the verified PC is never dropped");
  assert.equal((await call("GET", "/auth/me", late, null, tokens[0])).status, 401, "the oldest linked device was dropped");
  assert.equal((await call("GET", "/auth/me", late, null, tokens.at(-1))).status, 200);
});

test("a token issued before #82 keeps working and becomes the verified session", { skip }, async () => {
  const { DB, call, auth } = await setup();
  const secret = await auth.authSecret(DB);
  DB.raw.prepare("INSERT INTO account (cid, name, world, faction, token_id, created, updated) VALUES (?,?,1,'VS','oldtok',0,5)").run(CID, "Oldie");
  const old = await auth.signToken(secret, CID, "oldtok");
  const me = await call("GET", "/auth/me", T0, null, old);
  assert.equal(me.status, 200);
  assert.equal(me.body.session.kind, "verified");
  assert.equal(DB.raw.prepare("SELECT token_id FROM account WHERE cid=?").get(CID).token_id, null, "moved to the session table");
  assert.equal((await call("GET", "/auth/me", T0 + 1, null, old)).status, 200, "still signed in after the move");
  assert.equal((await call("POST", "/auth/link", T0 + 2, {}, old)).status, 200, "and can link a phone");
  assert.equal((await call("POST", "/auth/logout", T0 + 3, {}, old)).status, 200);
  assert.equal((await call("GET", "/auth/me", T0 + 4, null, old)).status, 401);
});

test("two devices at once: the same faction lands once, a retried click lands once, a tight balance pays once", { skip }, async () => {
  const { DB, call, verify, codeOf } = await setup();
  const now = T0 + 620;
  const pc = await verify(now);
  const m = await call("POST", "/auth/link", now, {}, pc);
  const phone = (await call("POST", "/auth/link/claim", now + 1, { code: codeOf(m.body.url) })).body.token;

  // Same faction, both devices in the same instant.
  const [a, b] = await Promise.all([pc, phone].map((t) => call("POST", "/vote/place", now + 5, { key: "1-4-9", outcome: "VS", amount: 100 }, t)));
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal((a.status === 409 ? a : b).body.error, "already_voted");
  assert.equal(DB.raw.prepare("SELECT COUNT(*) n FROM vote WHERE cid=? AND outcome='VS'").get(CID).n, 1);
  assert.equal(DB.raw.prepare("SELECT balance FROM wallet WHERE cid=?").get(CID).balance, 900, "debited once");

  // The same click sent twice (double tap / retry after a timeout): one vote, one debit, the second is a replay.
  const vid = "click-" + "a".repeat(20);
  const first = await call("POST", "/vote/place", now + 6, { key: "1-4-9", outcome: "NC", amount: 50, vote_id: vid }, phone);
  const retry = await call("POST", "/vote/place", now + 7, { key: "1-4-9", outcome: "NC", amount: 50, vote_id: vid }, pc);
  assert.equal(first.status, 200);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.replayed, true);
  assert.equal(retry.body.vote.id, vid);
  assert.equal(retry.body.balance, 850);
  assert.equal((await call("POST", "/vote/place", now + 8, { key: "1-4-9", outcome: "TR", amount: 25, vote_id: "bad id!" }, pc)).status, 400);

  // A vote id belongs to its character.
  const other = await verify(now + 9, "5428010618035300888", "Other");
  assert.equal((await call("POST", "/vote/place", now + 10, { key: "1-4-9", outcome: "NC", amount: 25, vote_id: vid }, other)).body.error, "bad_vote_id");

  // Tight balance: both devices vote different factions at once with room for only one.
  DB.raw.prepare("UPDATE wallet SET balance=60 WHERE cid=?").run(CID);
  DB.raw.prepare("INSERT INTO alert (key, world, zone, instance_id, event_id, start_ts, dur, status, state, updated) SELECT '1-6-2',1,6,2,153,start_ts,dur,status,state,0 FROM alert WHERE key='1-4-9'").run();
  const [x, y] = await Promise.all([[pc, "VS"], [phone, "NC"]].map(([t, f]) => call("POST", "/vote/place", now + 11, { key: "1-6-2", outcome: f, amount: 50 }, t)));
  assert.deepEqual([x.status, y.status].sort(), [200, 409]);
  const lost = x.status === 409 ? x : y;
  assert.equal(lost.body.error, "insufficient_balance");
  assert.equal(lost.body.balance, 10, "the refusal carries the real balance");
  assert.equal(DB.raw.prepare("SELECT balance FROM wallet WHERE cid=?").get(CID).balance, 10);
});

test("the unique index backs the rule even if two rows get past the debit guard", { skip }, async () => {
  const { DB } = await setup();
  const ins = DB.raw.prepare("INSERT INTO vote (id, cid, key, outcome, amount, fee, net, potential, pct, progress, placed_ts, status) VALUES (?,?, '1-4-9','VS',25,0,25,50,50,0.1,0,'open')");
  ins.run("v1", CID);
  assert.throws(() => ins.run("v2", CID), /UNIQUE/);
  ins.run("v3", "5428010618035300888"); // another character: fine
});

test("a PlayStation identity linked to a phone stays PC-only for voting", { skip }, async () => {
  const { call, verify, codeOf } = await setup();
  const now = T0 + 620;
  const ps = await verify(now, "us-5428010618035300999", "Console");
  const m = await call("POST", "/auth/link", now, {}, ps);
  const claim = await call("POST", "/auth/link/claim", now + 1, { code: codeOf(m.body.url) });
  assert.equal(claim.body.character.platform, "us");
  assert.equal((await call("GET", "/vote/me", now + 2, null, claim.body.token)).body.error, "pc_only");
});

test("daily prune drops links and claim attempts after a day", { skip }, async () => {
  const { DB, call, verify, pruneStatements } = await setup();
  const now = T0 + 620;
  const pc = await verify(now);
  await call("POST", "/auth/link", now, {}, pc);
  await call("POST", "/auth/link/claim", now, { code: "y".repeat(43) });
  await DB.batch(pruneStatements(DB, now + 3600));
  assert.equal(DB.raw.prepare("SELECT COUNT(*) n FROM link").get().n, 1, "kept within the day");
  await DB.batch(pruneStatements(DB, now + 86400 + 1));
  assert.equal(DB.raw.prepare("SELECT COUNT(*) n FROM link").get().n, 0);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) n FROM link_try").get().n, 0);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) n FROM session").get().n, 1, "sessions are not pruned (like tokens)");
});

