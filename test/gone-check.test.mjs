// 🪦→🚫 Mirror rule (#61): characters deleted in the game leave our cache too, safely.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readIdAnswer, nextStrike, goneCheck, goneEntry, GONE_GAP_MS } from "../scripts/gone-check.mjs";
import { removedList } from "../opt-out.mjs";

const CID = "5428000000000000001";

test("readIdAnswer: only a normal empty answer means gone", () => {
  assert.equal(readIdAnswer({ character_list: [], returned: 0 }, CID), "gone");
  assert.equal(readIdAnswer({ error: "Service Unavailable" }, CID), null, "errors never count");
  assert.equal(readIdAnswer({ errorCode: "SERVER_ERROR" }, CID), null);
  assert.equal(readIdAnswer(null, CID), null);
  assert.equal(readIdAnswer({ returned: 0 }, CID), null, "no list = no verdict");
  assert.equal(readIdAnswer({ character_list: [], returned: 1 }, CID), null, "inconsistent answer = no verdict");
  assert.equal(readIdAnswer({ character_list: [{ character_id: CID, name: { first: "Foo" } }] }, CID, "[TAG] Foo"), "exists");
  assert.deepEqual(readIdAnswer({ character_list: [{ character_id: CID, name: { first: "NewName" } }] }, CID, "Foo"), { renamed: "NewName" });
});

test("nextStrike: needs two empty answers at least 20 h apart", () => {
  const t0 = 1_792_800_000_000;
  assert.equal(nextStrike([], t0).confirmed, false);
  assert.equal(nextStrike([t0], t0 + 3600e3).confirmed, false, "1 h later is not enough");
  assert.equal(nextStrike([t0], t0 + GONE_GAP_MS).confirmed, true);
});

test("goneCheck: confirms on the second strike, never on errors; renames are reported", async () => {
  const t0 = 1_792_800_000_000;
  const answers = { a: { character_list: [], returned: 0 }, b: { error: "down" }, c: { character_list: [{ character_id: "3", name: { first: "Renamed" } }] } };
  const getJson = async (u) => answers[{ 1: "a", 2: "b", 3: "c" }[/character_id=(\d)/.exec(u)[1]]];
  const cands = () => [
    { key: "a", cid: "1", name: "Alpha", state: st.a },
    { key: "b", cid: "2", name: "Beta", state: st.b },
    { key: "c", cid: "3", name: "Gamma", state: st.c },
  ];
  const st = { a: {}, b: {}, c: {} };
  const r1 = await goneCheck(cands(), { base: "x/", getJson, now: t0 });
  assert.deepEqual(r1.gone, []);
  assert.deepEqual(r1.renamed.map((x) => x.to), ["Renamed"]);
  const r2 = await goneCheck(cands(), { base: "x/", getJson, now: t0 + GONE_GAP_MS });
  assert.deepEqual(r2.gone.map((g) => g.key), ["a"]);
  assert.equal(st.b.goneStrikes, undefined, "an outage never counts as a strike");
  const e = goneEntry(r2.gone[0]);
  assert.equal(e.source, "deleted-in-game");
  assert.ok(removedList({ players: { [CID]: e } }).match({ cid: CID }), "the entry carries proof, so the purge applies it");
});
