import { test } from "node:test";
import assert from "node:assert/strict";
import { commitHash, merkleRoot, merklePath, verifyPath, otsFile, sha256hex, placedValues } from "../oracle-worker/src/votelog.js";

const leaves = [];
for (let i = 0; i < 7; i++) leaves.push(await sha256hex(`vote ${i}`));

test("votelog: every commitment's Merkle path reproduces the day's root (odd counts too)", async () => {
  for (const n of [1, 2, 3, 7, 8]) {
    const set = leaves.slice(0, n);
    const root = await merkleRoot(set);
    for (const leaf of set) assert.ok(await verifyPath(leaf, await merklePath(set, leaf), root), `n=${n}`);
  }
});

test("votelog: a changed leaf, or a wrong path, no longer matches the root", async () => {
  const root = await merkleRoot(leaves);
  const path = await merklePath(leaves, leaves[2]);
  assert.equal(await verifyPath(await sha256hex("rewritten vote"), path, root), false);
  assert.equal(await verifyPath(leaves[2], await merklePath(leaves, leaves[3]), root), false);
});

test("votelog: the commit covers every placed field and is salted", async () => {
  const v = { id: "v1", cid: "5428", key: "10-4-46717", outcome: "TR", amount: 10, fee: 0.5, net: 9.5, potential: 14, pct: 40.2, progress: 0.1, placed_ts: 1794586073 };
  const h = await commitHash("placed", placedValues(v), "aa");
  assert.notEqual(h, await commitHash("placed", placedValues({ ...v, outcome: "NC" }), "aa"), "outcome is covered");
  assert.notEqual(h, await commitHash("placed", placedValues({ ...v, cid: "5429" }), "aa"), "cid is covered");
  assert.notEqual(h, await commitHash("placed", placedValues(v), "bb"), "salt changes the hash");
  assert.notEqual(h, await commitHash("settled", placedValues(v), "aa"), "kind is covered");
});

test("votelog: .ots file = magic + version 1 + sha256 tag + root + calendar body", async () => {
  const root = leaves[0];
  const f = otsFile(root, Uint8Array.from([0xde, 0xad]).buffer);
  const magic = [0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00, 0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94];
  assert.deepEqual([...f.slice(0, 31)], magic);
  assert.equal(f[31], 0x01); assert.equal(f[32], 0x08);
  assert.equal(Buffer.from(f.slice(33, 65)).toString("hex"), root);
  assert.deepEqual([...f.slice(65)], [0xde, 0xad]);
});

// ---- end to end on an in-memory D1 stand-in (same shape as test/oracle-fights.test.mjs) ----
import * as sqlite from "node:sqlite";
import { readFileSync } from "node:fs";
import { commitMissing, commitPlaced, commitsFor, rootDays, handleVotelog, commitHash as ch, placedValues as pv, settledValues as sv } from "../oracle-worker/src/votelog.js";
const SCHEMA = readFileSync(new URL("../oracle-worker/schema.sql", import.meta.url), "utf8");
function fakeD1() {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
  });
  return { raw: db, prepare: (sql) => stmt(sql) };
}
const T0 = 1794586073; // 2026-11-13 ~ 06:21 UTC
test("votelog end to end: commit, settle, root, stamp, proof, and a rewritten vote fails", async () => {
  const DB = fakeD1();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(Uint8Array.from([0xaa, 0xbb, 0xcc]));
  try {
    DB.raw.prepare("INSERT INTO vote (id, cid, key, outcome, amount, fee, net, potential, pct, progress, placed_ts, status, reward, credited) VALUES ('v1','5428','10-4-46717','TR',10,0.5,9.5,14,40.2,0.1,?,'open',0,0)").run(T0);
    DB.raw.prepare("INSERT INTO vote (id, cid, key, outcome, amount, fee, net, potential, pct, progress, placed_ts, status, reward, credited) VALUES ('v2','5429','10-4-46717','NC',5,0,5,8,30,0.2,?,'open',0,0)").run(T0 + 60);
    await commitMissing(DB, T0 + 60);
    const row = DB.raw.prepare("SELECT * FROM vote WHERE id='v1'").get();
    const placed = DB.raw.prepare("SELECT salt, hash FROM vote_commit WHERE vote_id='v1' AND kind='placed'").get();
    assert.equal(placed.hash, await ch("placed", pv({ ...row, cid: "5428" }), placed.salt), "committed hash matches the stored vote");

    DB.raw.prepare("UPDATE vote SET status='won', reward=14, settled_ts=? WHERE id='v1'").run(T0 + 3000);
    DB.raw.prepare("UPDATE vote SET status='lost', reward=0, settled_ts=? WHERE id='v2'").run(T0 + 3000);
    await commitMissing(DB, T0 + 3000);
    const s = DB.raw.prepare("SELECT hash FROM vote_commit WHERE vote_id='v1' AND kind='settled'").get();
    assert.equal(s.hash, await ch("settled", sv({ id: "v1", status: "won", reward: 14, settled_ts: T0 + 3000 }), placed.salt));

    const later = T0 + 86400 + 1200; // next day, past the 10 min margin
    assert.equal((await rootDays(DB, later)).stamped, 1, "the finished day is stamped");
    const root = DB.raw.prepare("SELECT root, ots_status FROM vote_root").get();
    assert.equal(root.ots_status, "pending");
    const mine = (await commitsFor(DB, ["v1"])).v1;
    assert.equal(mine.placed.day, mine.settled.day, "same day (commits made before the day closed)");
    assert.ok(await verifyPath(mine.placed.hash, mine.placed.path, root.root), "voter's path reproduces the anchored root");

    const proof = await (await handleVotelog(new Request("https://x/votelog/proof?hash=" + placed.hash), { DB }, new URL("https://x/votelog/proof?hash=" + placed.hash))).json();
    assert.equal(proof.rooted, true);
    assert.ok(await verifyPath(placed.hash, proof.path, proof.root));
    const ots = await handleVotelog(new Request("https://x/votelog/" + mine.placed.day + ".ots"), { DB }, new URL("https://x/votelog/" + mine.placed.day + ".ots"));
    const bytes = new Uint8Array(await ots.arrayBuffer());
    assert.equal(bytes[31], 0x01); assert.equal(bytes[32], 0x08);

    // Rewriting the vote after commitment: the recomputed hash no longer matches what was published.
    DB.raw.prepare("UPDATE vote SET amount=99 WHERE id='v1'").run();
    const rewritten = DB.raw.prepare("SELECT * FROM vote WHERE id='v1'").get();
    assert.notEqual(await ch("placed", pv({ ...rewritten, cid: "5428" }), placed.salt), placed.hash);
  } finally {
    globalThis.fetch = realFetch;
  }
});
