// One-tap vote check (oracle/js/vote.js verifyVoteCheck): the browser re-derives
// each vote's fingerprint from the vote's own details + salt and walks the
// stored Merkle path to the day's seal — the same rule the Worker commits with.
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyVoteCheck, voteCheckHtml, voteListHtml, placedVoteValues, settledVoteValues } from "../oracle/js/vote.js";
import { commitHash, merkleRoot, merklePath, placedValues, settledValues } from "../oracle-worker/src/votelog.js";

const SALT = "5f0c2e7a9b1d4c63a8e2f1b07d9c4e52";
const vote = { id: "v1", cid: "5428", key: "10-4-46717", outcome: "TR", amount: 10, fee: 0.5, net: 9.5,
  potential: 14, pct: 40.2, progress: 0.1, placed_ts: 1794586073, status: "won", reward: 14, settled_ts: 1794589000 };
const placedHash = await commitHash("placed", placedVoteValues(vote), SALT);
const settledHash = await commitHash("settled", settledVoteValues(vote), SALT);
const leaves = [placedHash, settledHash, await commitHash("placed", ["other"], "00")];
const root = await merkleRoot(leaves);
const sealed = { ...vote, commits: {
  placed: { hash: placedHash, salt: SALT, day: "2026-11-13", root, ots_status: "confirmed", btc_height: 975729, btc_time: 1794589000, btc_block: "a".repeat(64), path: await merklePath(leaves, placedHash) },
  settled: { hash: settledHash, salt: SALT, day: "2026-11-13", root, ots_status: "confirmed", btc_height: 975729, btc_time: 1794589000, btc_block: "a".repeat(64), path: await merklePath(leaves, settledHash) },
} };

test("frontend and worker agree on the committed field order", () => {
  assert.deepEqual(placedVoteValues(vote), placedValues(vote));
  assert.deepEqual(settledVoteValues(vote), settledValues(vote));
});

test("placed + settled verify ok against a real Merkle root", async () => {
  const r = await verifyVoteCheck(sealed);
  assert.equal(r.status, "ok");
  assert.equal(r.kinds.length, 2);
  assert.ok(r.kinds.every((k) => k.match === true && k.rootOk === true));
  assert.equal(r.kinds[0].day, "2026-11-13");
});

test("a rewritten amount no longer matches its fingerprint", async () => {
  const r = await verifyVoteCheck({ ...sealed, amount: 99 });
  assert.equal(r.status, "mismatch");
  assert.equal(r.kinds.find((k) => k.kind === "placed").match, false);
});

test("a wrong path no longer reaches the seal", async () => {
  const wrong = { ...sealed, commits: { ...sealed.commits, placed: { ...sealed.commits.placed, path: await merklePath(leaves, settledHash) } } };
  const r = await verifyVoteCheck(wrong);
  assert.equal(r.status, "mismatch");
  assert.equal(r.kinds.find((k) => k.kind === "placed").rootOk, false);
});

test("day not sealed yet: details match, no root to walk to", async () => {
  const unrooted = { ...sealed, commits: {
    placed: { hash: placedHash, salt: SALT, day: "2026-11-15", root: null, path: null },
  } };
  const r = await verifyVoteCheck(unrooted);
  assert.equal(r.status, "not-rooted");
  assert.equal(r.kinds[0].match, true);
  assert.equal(r.kinds[0].rootOk, null);
});

test("old Worker reply without cid: fingerprint still proves inclusion", async () => {
  const { cid, settled_ts, ...oldVote } = sealed;
  const r = await verifyVoteCheck(oldVote);
  assert.equal(r.status, "in-seal-only");
  assert.equal(r.kinds[0].match, null, "details could not be re-derived");
  assert.equal(r.kinds[0].rootOk, true, "but the stored fingerprint is in the sealed record");
});

test("no commits: nothing to check", async () => {
  assert.equal((await verifyVoteCheck(vote)).status, "no-commit");
});

test("voteCheckHtml renders the verdict, salt and copy button", async () => {
  const r = await verifyVoteCheck(sealed);
  const h = voteCheckHtml(sealed, r);
  assert.match(h, /Matches the sealed record for 2026-11-13/);
  assert.match(h, new RegExp(SALT));
  assert.match(h, new RegExp(placedHash));
  assert.match(h, new RegExp(settledHash));
  assert.match(h, /Bitcoin block 975729/);
  assert.match(h, new RegExp(`href="https://mempool\\.space/block/${"a".repeat(64)}"`), "link carries the block hash, not /undefined");
  assert.match(h, /data-vcopy="v1"/);
  assert.match(h, /Keep the salt private/);
  assert.match(voteCheckHtml(sealed, { status: "checking", kinds: [] }), /Checking…/);
});

test("voteCheckHtml: a confirmed height without a block hash shows plain text, never /undefined", async () => {
  const noHash = { ...sealed, commits: {
    placed: { ...sealed.commits.placed, btc_block: undefined },
    settled: { ...sealed.commits.settled, btc_block: undefined },
  } };
  const r = await verifyVoteCheck(noHash);
  assert.equal(r.status, "ok");
  const h = voteCheckHtml(noHash, r);
  assert.match(h, /Bitcoin block 975729/);
  assert.doesNotMatch(h, /mempool\.space\/block\//, "no link without a hash to point at");
  assert.doesNotMatch(h, /undefined/);
});

test("voteListHtml: a sealed vote gets a Check button, an unsealed one does not", () => {
  const h = voteListHtml([sealed, { ...vote, id: "v2", commits: null }]);
  assert.match(h, /data-vcheck="v1"/);
  assert.doesNotMatch(h, /data-vcheck="v2"/);
  assert.match(h, /Fingerprint not ready yet/);
});
