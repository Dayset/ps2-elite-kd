// Voting (BonusCheques, no cash value): LMSR quotes seeded from the oracle odds, fee ladder, wallet rules,
// placement guards and automatic settlement (credited exactly once).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { quote, feeRate, VOTE } from "../oracle-worker/src/vote.js";

let sqlite = null;
try { sqlite = await import("node:sqlite"); } catch {}
const skip = !sqlite && "node:sqlite unavailable (needs Node >= 22.5)";
const SCHEMA = readFileSync(new URL("../oracle-worker/schema.sql", import.meta.url), "utf8");

test("quotes: small votes return about the oracle %, big votes move the odds", () => {
  const q25 = quote(25, 50, 0.1);
  assert.equal(q25.fee, 0);
  assert.ok(Math.abs(q25.odds - 0.5) < 0.005, JSON.stringify(q25));
  const q200 = quote(200, 50, 0.1);
  assert.ok(q200.odds > 0.52 && q200.odds < 0.53, JSON.stringify(q200));   // ~4.8 % impact at b = 2000
  assert.ok(quote(25, 10, 0.1).reward < 250 && quote(25, 10, 0.1).reward > 235);
});

test("fee ladder: 0 / 5 / 15 / 30 % by progress, +10 % above 75 %", () => {
  assert.equal(feeRate(0.2, 50), 0);
  assert.equal(feeRate(0.5, 50), 0.05);
  assert.equal(feeRate(0.85, 50), 0.15);
  assert.equal(feeRate(0.92, 50), 0.3);
  assert.equal(feeRate(0.2, 80), 0.1);
  assert.equal(quote(100, 60, 0.85).fee, 15);
});

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
const VS_CID = "5428010618035300101", NC_CID = "5428010618035300102";

async function setup() {
  const { handleVote, settleStatements } = await import("../oracle-worker/src/vote.js");
  const { signToken, authSecret } = await import("../oracle-worker/src/auth.js");
  const DB = fakeD1();
  const secret = await authSecret(DB);
  const tokens = {};
  for (const [cid, name, fac] of [[VS_CID, "Vee", "VS"], [NC_CID, "Enn", "NC"]]) {
    DB.raw.prepare("INSERT INTO account (cid, name, world, faction, token_id, created, updated) VALUES (?,?,1,?,?,0,0)").run(cid, name, fac, "t" + cid);
    tokens[fac] = await signToken(secret, cid, "t" + cid);
  }
  const T0 = 1_792_400_000;
  const state = (ts, win) => JSON.stringify({ ts, win: { VS: { pct: win[0] }, NC: { pct: win[1] }, TR: { pct: win[2] } } });
  DB.raw.prepare("INSERT INTO alert (key, world, zone, instance_id, event_id, start_ts, dur, status, state, updated) VALUES ('1-4-1',1,4,1,153,?,90,'live',?,0)").run(T0, state(T0 + 600, [50, 30, 20]));
  const env = { DB };
  const call = async (method, path, now, body, fac) => {
    const url = new URL("https://x" + path);
    const req = new Request(url, { method, headers: { "Content-Type": "application/json", ...(fac ? { Authorization: `Bearer ${tokens[fac]}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const r = await handleVote(req, env, url, json, now);
    return { status: r.status, body: await r.json() };
  };
  const setState = (ts, win, status = "live") => DB.raw.prepare("UPDATE alert SET state=?, status=? WHERE key='1-4-1'").run(state(ts, win), status);
  return { DB, call, settleStatements, T0, setState };
}

test("place, guard, settle and pay out exactly once", { skip }, async () => {
  const { DB, call, settleStatements, T0, setState } = await setup();
  const now = T0 + 620;
  assert.equal((await call("POST", "/vote/place", now, { key: "1-4-1", outcome: "VS", amount: 100 })).status, 401, "sign in first");
  const me0 = await call("GET", "/vote/me", now, null, "VS");
  assert.equal(me0.body.balance, VOTE.START_BALANCE);
  assert.equal(me0.body.own_faction, "VS");

  const qt = await call("GET", "/vote/quote?key=1-4-1", now);
  assert.equal(qt.body.open, true);
  assert.equal(qt.body.quotes.VS["100"].fee, 0);

  assert.equal(VOTE.OWN_FACTION_ONLY, false, "owner 2026-10-23: any faction");
  assert.equal(qt.body.own_faction_only, false);
  const other = await call("POST", "/vote/place", now, { key: "1-4-1", outcome: "NC", amount: 100, seen_pct: 1 }, "VS");
  assert.notEqual(other.body.error, "own_faction_only", "a VS character may vote NC");
  assert.equal(other.body.error, "odds_changed", "reaches the odds check (nothing placed)");
  assert.equal((await call("POST", "/vote/place", now, { key: "1-4-1", outcome: "VS", amount: 30 }, "VS")).status, 400, "fixed amounts");
  assert.equal((await call("POST", "/vote/place", now, { key: "1-4-1", outcome: "VS", amount: 100, seen_pct: 40 }, "VS")).body.error, "odds_changed");
  const ok = await call("POST", "/vote/place", now, { key: "1-4-1", outcome: "VS", amount: 100, seen_pct: 50 }, "VS");
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.balance, 900);
  const back = ok.body.vote.reward;
  const nc = await call("POST", "/vote/place", now, { key: "1-4-1", outcome: "NC", amount: 200 }, "NC");
  assert.equal(nc.status, 200);

  // Spend the VS wallet down: 900 left -> four more 200 votes, then refused.
  for (let i = 0; i < 4; i++) assert.equal((await call("POST", "/vote/place", now + i, { key: "1-4-1", outcome: "VS", amount: 200 }, "VS")).status, 200);
  const broke = await call("POST", "/vote/place", now + 5, { key: "1-4-1", outcome: "VS", amount: 200 }, "VS");
  assert.equal(broke.body.error, "insufficient_balance");
  assert.equal(DB.raw.prepare("SELECT COUNT(*) n FROM vote WHERE cid=?").get(VS_CID).n, 5, "no vote row without a debit");

  // Late in the alert: fee applies; past 95 % voting is closed; stale odds close it too.
  setState(T0 + 75 * 60, [70, 20, 10]);                          // 83 % in
  assert.equal((await call("GET", "/vote/quote?key=1-4-1", T0 + 75 * 60 + 10)).body.fee_rate.VS, 0.15);
  setState(T0 + 86 * 60, [80, 15, 5]);
  assert.equal((await call("POST", "/vote/place", T0 + 86 * 60 + 5, { key: "1-4-1", outcome: "NC", amount: 25 }, "NC")).body.error, "closed");
  setState(T0 + 60 * 60, [80, 15, 5]);
  assert.equal((await call("POST", "/vote/place", T0 + 70 * 60, { key: "1-4-1", outcome: "NC", amount: 25 }, "NC")).body.error, "odds_stale");

  // Settlement: VS wins; credited once even if the settle step runs twice.
  DB.raw.prepare("UPDATE alert SET status='settled', winner='VS' WHERE key='1-4-1'").run();
  const alerts = [{ key: "1-4-1", status: "settled", winner: "VS" }];
  await DB.batch(settleStatements(DB, alerts, T0 + 6000));
  await DB.batch(settleStatements(DB, [], T0 + 6060));
  const me = await call("GET", "/vote/me", T0 + 6100, null, "VS");
  // 100 cheques were never voted (1000 - 100 - 4 x 200), plus every winning vote.
  const expected = Math.round((100 + DB.raw.prepare("SELECT SUM(potential) s FROM vote WHERE cid=?").get(VS_CID).s) * 100) / 100;
  assert.equal(me.body.balance, expected);
  assert.ok(me.body.balance > 1000, "VS backed the winner");
  assert.ok(back > 190 && back < 200);
  const meNc = await call("GET", "/vote/me", T0 + 6100, null, "NC");
  assert.equal(meNc.body.balance, 800);
  assert.equal(meNc.body.votes[0].status, "lost");
  const lb = await call("GET", "/vote/leaderboard", T0 + 6100);
  assert.equal(lb.body.leaders[0].name, "Vee");
});

test("a draw or cancellation gives the full amount back, fee included", { skip }, async () => {
  const { DB, call, settleStatements, T0, setState } = await setup();
  setState(T0 + 46 * 60, [40, 40, 20]);                  // 51 % in: 5 % fee
  const b = await call("POST", "/vote/place", T0 + 46 * 60 + 5, { key: "1-4-1", outcome: "NC", amount: 100 }, "NC");
  assert.equal(b.body.vote.fee, 5);
  DB.raw.prepare("UPDATE alert SET status='settled', winner='draw' WHERE key='1-4-1'").run();
  await DB.batch(settleStatements(DB, [{ key: "1-4-1", status: "settled", winner: "draw" }], T0 + 6000));
  assert.equal((await call("GET", "/vote/me", T0 + 6100, null, "NC")).body.balance, 1000);
});

test("BonusCheques: +25 once per UTC day; automatic +5/h only below 20, capped at 20", { skip }, async () => {
  const { DB, call, T0 } = await setup();
  await call("GET", "/vote/me", T0, null, "VS");
  assert.equal((await call("POST", "/vote/bonus", T0 + 10, {}, "VS")).body.balance, 1025);
  assert.equal((await call("POST", "/vote/bonus", T0 + 20, {}, "VS")).status, 409);
  DB.raw.prepare("UPDATE wallet SET balance=3, last_auto_at=? WHERE cid=?").run(T0, VS_CID);
  assert.equal((await call("GET", "/vote/me", T0 + 2 * 3600 + 5, null, "VS")).body.balance, 13);
  assert.equal((await call("GET", "/vote/me", T0 + 30 * 3600, null, "VS")).body.balance, 20);
});
