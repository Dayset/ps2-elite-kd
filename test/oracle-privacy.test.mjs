// Self-service removal (#61): oracle /privacy/* endpoints and the bots' sync into opt-out.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyRemovals, syncRemovals } from "../scripts/sync-removals.mjs";
import { removedList } from "../opt-out.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
    async run() { db.prepare(sql).run(...args); return { meta: {} }; },
  });
  return { raw: db, prepare: (sql) => stmt(sql) };
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

async function signedIn(DB, ident, name) {
  const { authSecret, signToken } = await import("../oracle-worker/src/auth.js");
  DB.raw.prepare("INSERT INTO account (cid, name, world, faction, token_id, created, updated) VALUES (?,?,?,?,?,?,?)").run(ident, name, 1000, "VS", "t1", 1, 1);
  return signToken(await authSecret(DB), ident, "t1");
}

test("oracle /privacy: proven player removes and restores; bots list it with the key", { skip }, async () => {
  const { handlePrivacy } = await import("../oracle-worker/src/privacy.js");
  const DB = fakeD1();
  const env = { DB, ORACLE_KEY: "k" };
  const authed = (req) => req.headers.get("X-Oracle-Key") === "k";
  const call = async (method, p, now, headers = {}) => {
    const url = new URL("https://x" + p);
    const r = await handlePrivacy(new Request(url, { method, headers }), env, url, json, now, authed);
    return { status: r.status, body: await r.json() };
  };
  assert.equal((await call("POST", "/privacy/remove", 100)).status, 401, "no sign-in, no removal");
  const tok = await signedIn(DB, "us-5429000000000000002", "Bar");
  const H = { Authorization: `Bearer ${tok}` };
  assert.equal((await call("GET", "/privacy/me", 100, H)).body.status, "shown");
  const rm = await call("POST", "/privacy/remove", 1_792_800_000, H);
  assert.equal(rm.status, 200);
  assert.equal(rm.body.character.platform, "us");
  assert.equal((await call("GET", "/privacy/me", 101, H)).body.status, "removed");
  assert.equal((await call("GET", "/privacy/list", 102)).status, 401, "list needs the key");
  const list = (await call("GET", "/privacy/list", 102, { "X-Oracle-Key": "k" })).body.removals;
  assert.equal(list.length, 1);
  assert.equal(list[0].ident, "us-5429000000000000002");
  assert.match(list[0].proof, /in-game logout \(Genudine\)/);
  await call("POST", "/privacy/restore", 1_792_800_100, H);
  assert.equal((await call("GET", "/privacy/me", 103, H)).body.status, "shown");
});

test("PlayStation sign-ins cannot vote (the oracle is PC)", { skip }, async () => {
  const { handleVote } = await import("../oracle-worker/src/vote.js");
  const DB = fakeD1();
  const tok = await signedIn(DB, "eu-5429000000000000004", "Baz");
  const url = new URL("https://x/vote/me");
  const r = await handleVote(new Request(url, { headers: { Authorization: `Bearer ${tok}` } }), { DB }, url, json, 100);
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error, "pc_only");
});

test("applyRemovals: each room gets its own rows, with proof; 'shown' takes them off", () => {
  const rows = [
    { ident: "5428000000000000001", name: "Foo", status: "removed", at: 1_792_800_000, proof: "sign-in by in-game logout (PC), 2026-10-23" },
    { ident: "us-5429000000000000002", name: "Bar", status: "removed", at: 1_792_800_000, proof: "sign-in by in-game logout (Genudine), 2026-10-23" },
    { ident: "eu-5429000000000000004", name: "Baz", status: "shown", at: 1_792_800_000, proof: "x" },
    { ident: "nonsense", status: "removed" },
  ];
  const pc = applyRemovals({ _about: "kept", players: { "5428999999999999999": { name: "Owner", at: "2026-10-01", proof: "owner" } } }, rows, "pc");
  assert.deepEqual(pc.added, ["5428000000000000001"]);
  assert.equal(pc.json._about, "kept");
  assert.ok(pc.json.players["5428999999999999999"], "owner entries untouched");
  assert.ok(removedList(pc.json).match({ cid: "5428000000000000001" }), "proof recorded, so the entry counts");
  const ps = applyRemovals({ players: { "eu-5429000000000000004": { name: "Baz", at: "2026-10-20", proof: "x" } } }, rows, "ps");
  assert.deepEqual(ps.added, ["us-5429000000000000002"]);
  assert.deepEqual(ps.restored, ["eu-5429000000000000004"]);
  const again = applyRemovals(ps.json, rows, "ps");
  assert.deepEqual([again.added, again.restored], [[], []], "idempotent");
});

test("syncRemovals writes opt-out.json from the oracle and never throws", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-rm-"));
  fs.writeFileSync(path.join(dir, "opt-out.json"), JSON.stringify({ players: {} }));
  const fetchImpl = async (url, opts) => {
    assert.match(String(url), /\/privacy\/list$/);
    assert.equal(opts.headers["X-Oracle-Key"], "k");
    return new Response(JSON.stringify({ removals: [{ ident: "5428000000000000001", name: "Foo", status: "removed", at: 1_792_800_000, proof: "p" }] }));
  };
  const r = await syncRemovals({ dataDir: dir, room: "pc", key: "k", fetchImpl, log: () => {} });
  assert.deepEqual(r.added, ["5428000000000000001"]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "opt-out.json"), "utf8")).players["5428000000000000001"].source, "self-service");
  assert.equal((await syncRemovals({ dataDir: dir, key: "", log: () => {} })).skipped, true);
  assert.equal((await syncRemovals({ dataDir: dir, key: "k", fetchImpl: async () => { throw new Error("down"); }, log: () => {} })).skipped, true);
});
