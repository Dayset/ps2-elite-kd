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

// ---- one-tap confirmation: upgrade a pending day against the calendar + Bitcoin ----
import { parseOtsFile, parseOtsTimestamp, upgradeDays } from "../oracle-worker/src/votelog.js";
import { createHash } from "node:crypto";
// The real 2026-11-13 .ots (272 bytes) and the calendar's upgrade response for its
// pending attestation (1000 bytes), fetched live 2026-11-15. Immutable fixtures.
const NOV13_OTS_B64 = "AE9wZW5UaW1lc3RhbXBzAABQcm9vZgC/ieLohOiSlAEIbFQ+CpY/eqKo08Rdry5GmdbuUIeic5SqfSKi3vEwo8jwCMBXV46PG0siCPEgL0su0bfT+ENRfbfvSH8geMMB+sBHBHOU1cMj565fXnUI8BC2l/qWHn09+BOpIgy5pdFxCPAgSL+dWdxcaZxC5XO9n6TWeYqcicW64B6aahICWZuIkAYI8SBWUWqgRqF/AbGyEniIxVkb6s41sBlVcYHtmBCaX2jfPQjxBGr3pwPwCKiUKgecUNawAIPf4w0u+QyOLi1odHRwczovL2FsaWNlLmJ0Yy5jYWxlbmRhci5vcGVudGltZXN0YW1wcy5vcmc=";
const NOV13_UPGRADE_B64 = "CPAgOUYfLQ7rHnrrGJsQk6BvMSzOA2h8h3Bs7KASQdZSKYII8CCOK3IP+z0W/hAQhgGxGJJz88noq2bvYliIvIkNONy3igjxIH22mbPHH69S6mH5N8uKrPFTnma/olen37FJi3izcZ6/CPAgu1r8HJ9Qs87gl1E9XYuqsbKrg7urqk7Sf3vS/sdL52UI8SChN18q8PE3v0oyNFk/PbGvlFka2zLADjpNkAcSdyggXgjwIPqPIRXnzGqZ3V/11UmJ0GIF/VAIpGlIFZ5bN5hyEY5gCPAg24SmkIJ0s3Am1CbTIUe+clMGx89GDt1Ee7zxe4l0xOkI8CDcEx2hgae6j6DA/pyOB9Cm4QUIl1hIcvpc20hGBU8kOAjwIMRO7yTVjaL79cqR6hwJKvRbXcRkhCLPBYKBTgjHxq88CPAgNHFT53HsSpjxdWsljwEF3J4k9YwXc8cTaDVqweBwSbcI8CDa9b/SbgSfgofdRuH1uAtr5Y0MYuLvPrYbBNBeYXLmZgjwIA6bjRssRCfMpBrQnrmLWF3U+2X+W11PP5J06rsPONpnCPEgSMA4XW12CMr2dJc/59nFsqq0UB1QH2ab4Zif60ozz2QI8VkBAAAAASKx7ciyy4/Ohr7EM/gisCXUQ8ZG8UWz5j68t5u10qklAAAAAAD+////AnekAAAAAAAAFgAUERZtBP6RdeSh2K1hXePToCEl3f4AAAAAAAAAACJqIPAEcOMOAAgI8SCUi0o6WuVEjQae+2webO0738oOoLBKdb2LcvsHVH9wxwgI8SA3FamxIV6msXo2pmdsZFN/tyjxsKwIOv926aU4c3Z/ZAgI8CByBXip20Z3k9abYngDncXYLZS9grP/0R41jP/fKngHJwgI8SBIbKxn/pJqwXc/Vi3gmK+6YsCOYGujq9nbzGKUB5pVFAgI8SAPGvnyGUFJC+Bfl+P1+oZ2BxGK7GRqZwWMrkztdeHDvQgI8SCHGbKf7xmMCPbfmAsLzXsjT+c9S/LC2vWSXKXwpiq5mwgI8SDmNXkhItpK+RRoIJ5acP015/RO5upH4U/SZes2HMmKRggI8SAtXz6j/2zNu1m7VUPwxkpt+qpRtoqA9Kgbq6CR8o2MWwgI8CB/x0QtCSJeBkHHgOC0wHCvyx9xxFFBmQVxzCoIHrYDLAgI8CAahKKNdc1DWi1UbfeZhdFC52oQFOj1LmThfNcLQIy1zggI8SCKja5l1CRJXqIjqRSUn73w+X1AVcZuzTzO1sXK+KAzuQgI8CBOL9q/HiXwFwkzq6sMHFn/EkeGKocOV/6t3D56W9jNZwgIAAWIlg1z1xkBA/HGOw==";

test("votelog: the parser reads the real Nov 13 .ots and its calendar upgrade", async () => {
  const ots = Uint8Array.from(Buffer.from(NOV13_OTS_B64, "base64"));
  const file = await parseOtsFile(ots);
  assert.equal(file.digest, "6c543e0a963f7aa2a8d3c45daf2e4699d6ee5087a27394aa7d22a2def130a3c8", "the day's seal");
  assert.equal(file.attestations.length, 1);
  assert.equal(file.attestations[0].kind, "pending");
  assert.equal(file.attestations[0].uri, "https://alice.btc.calendar.opentimestamps.org");
  assert.equal(file.attestations[0].msg, "6af7a703538340deaad5cfccf32b94ed79001cf0eba39dbb1bd49c43648e8ada2f35485ca8942a079c50d6b0");
  const up = Uint8Array.from(Buffer.from(NOV13_UPGRADE_B64, "base64"));
  const upgraded = await parseOtsTimestamp(up, file.attestations[0].msg);
  assert.equal(upgraded.end, 1000, "parses the whole response");
  assert.equal(upgraded.attestations.length, 1);
  assert.equal(upgraded.attestations[0].kind, "bitcoin");
  assert.equal(upgraded.attestations[0].height, 975729);
  // The attested message is the header merkle root of block 975729 (verified live).
  assert.equal(upgraded.attestations[0].msg, "cd7ff276ebd39be7dea0e594bc94dfe181f412230854a8273bc3cd16c0303f28");
  await assert.rejects(parseOtsFile(Uint8Array.from([1, 2, 3])), /not a sha256/);
});

// Minimal synthetic timestamps (same wire format as the calendar).
const unhexT = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
const vu = (n) => { const out = []; do { let b = n & 0x7f; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b); } while (n); return out; };
const pendingTs = (uri) => {
  const u = [...new TextEncoder().encode(uri)];
  const payload = [...vu(u.length), ...u];
  return Uint8Array.from([0x00, ...unhexT("83dfe30d2ef90c8e"), ...vu(payload.length), ...payload]);
};
const bitcoinTs = (height) => {
  const payload = vu(height);
  return Uint8Array.from([0x00, ...unhexT("0588960d73d71901"), ...vu(payload.length), ...payload]);
};
const ALICE = "https://alice.btc.calendar.opentimestamps.org";

test("votelog end to end: upgradeDays confirms a pending day and leaves an unconfirmed day pending", async () => {
  const DB = fakeD1();
  const realFetch = globalThis.fetch;
  const HEIGHT = 975729;
  const BLOCK_TIME = 1794617662;
  // Block header whose merkle root is the day-1 root, so the attestation verifies.
  const u32le = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
  let root1 = null;
  let blockHash = null;
  let cachedHeaderHex = null;
  const ensureHeader = () => {
    if (!cachedHeaderHex) {
      const header = new Uint8Array([...u32le(1), ...new Uint8Array(32), ...unhexT(root1), ...u32le(BLOCK_TIME), ...u32le(0x1d00ffff), ...u32le(0)]);
      blockHash = Buffer.from(createHash("sha256").update(createHash("sha256").update(header).digest()).digest()).reverse().toString("hex");
      cachedHeaderHex = Buffer.from(header).toString("hex");
    }
    return cachedHeaderHex;
  };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith("/digest")) return new Response(pendingTs(ALICE));
    if (u.includes("/timestamp/")) {
      // Day 1's root is confirmed; any other root is still pending.
      return new Response(u.endsWith("/timestamp/" + root1) ? bitcoinTs(HEIGHT) : pendingTs(ALICE));
    }
    if (u.includes("/block-height/")) return new Response(ensureHeader() && blockHash, { headers: { "Content-Type": "text/plain" } });
    if (u.includes("/block/") && u.endsWith("/header")) return new Response(ensureHeader(), { headers: { "Content-Type": "text/plain" } });
    return new Response("not found", { status: 404 });
  };
  try {
    DB.raw.prepare("INSERT INTO vote (id, cid, key, outcome, amount, fee, net, potential, pct, progress, placed_ts, status, reward, credited) VALUES ('v1','5428','10-4-46717','TR',10,0.5,9.5,14,40.2,0.1,?,'open',0,0)").run(T0);
    await commitMissing(DB, T0 + 60); // v1's commit lands on Nov 13 (commit day = commit time, not placed_ts)
    DB.raw.prepare("INSERT INTO vote (id, cid, key, outcome, amount, fee, net, potential, pct, progress, placed_ts, status, reward, credited) VALUES ('v2','5429','10-4-46717','NC',5,0,5,8,30,0.2,?,'open',0,0)").run(T0 + 86400);
    await commitMissing(DB, T0 + 86400); // v2's commit lands on Nov 14
    const later = T0 + 2 * 86400 + 1200; // both days finished
    assert.equal((await rootDays(DB, later)).stamped, 2, "both days stamped");
    root1 = DB.raw.prepare("SELECT root FROM vote_root ORDER BY day ASC LIMIT 1").get().root;
    const before = DB.raw.prepare("SELECT day, ots_status FROM vote_root ORDER BY day ASC").all();
    assert.deepEqual(before.map((r) => r.ots_status), ["pending", "pending"]);

    const res = await upgradeDays(DB, later + 1800 + 60);
    assert.deepEqual(res, { checked: 2, confirmed: 1 });
    const after = DB.raw.prepare("SELECT day, ots_status, btc_height, btc_time, btc_block FROM vote_root ORDER BY day ASC").all();
    assert.equal(after[0].ots_status, "confirmed");
    assert.equal(after[0].btc_height, HEIGHT);
    assert.equal(after[0].btc_time, BLOCK_TIME);
    assert.equal(after[0].btc_block, blockHash);
    assert.equal(after[1].ots_status, "pending", "no Bitcoin attestation yet: stays pending");
    assert.equal(after[1].btc_height, null);

    // The public list and the voter's commits carry the confirmation.
    const list = await (await handleVotelog(new Request("https://x/votelog"), { DB }, new URL("https://x/votelog"))).json();
    const day1 = list.days.find((d) => d.day === after[0].day);
    assert.equal(day1.ots_status, "confirmed");
    assert.equal(day1.btc_height, HEIGHT);
    assert.equal(day1.btc_time, BLOCK_TIME);
    assert.equal(day1.btc_block, blockHash);
    const mine = (await commitsFor(DB, ["v1"])).v1;
    assert.equal(mine.placed.btc_height, HEIGHT);
    assert.equal(mine.placed.btc_time, BLOCK_TIME);
  } finally {
    globalThis.fetch = realFetch;
  }
});
