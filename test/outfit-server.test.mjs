// 🌍 Owner: a member with no server of their own takes the outfit's (one outfit = one server); own world wins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { localSrv, mergeFreshRows } from "../rank-row.mjs";
import { addPcServerColumn } from "../scripts/build-ranks.mjs";
import { WORLD_NAMES, outfitServer } from "../outfit-tags.mjs";

test("localSrv: own world first (Connery / Emerald → Osprey), else the outfit's, PS by server", () => {
  assert.deepEqual(localSrv({ world: 1 }, "a"), { srv: "osprey", by: null });
  assert.deepEqual(localSrv({ world: 17 }, "a", { a: 10 }), { srv: "osprey", by: null }, "own world beats the outfit");
  assert.deepEqual(localSrv({}, "a", { a: 10 }), { srv: "wainwright", by: "o" });
  assert.deepEqual(localSrv({ world: 40 }, "a"), { srv: null, by: null }, "SolTech: no PC server rank");
  assert.deepEqual(localSrv({}, "a"), { srv: null, by: null });
  assert.deepEqual(localSrv({ room: "ps", server: "Ceres" }, "a"), { srv: "eu", by: null });
});

test("NA pre-merge worlds read as Osprey in the outfit note; EU names unchanged", () => {
  assert.equal(WORLD_NAMES[1], "Osprey");
  assert.equal(WORLD_NAMES[17], "Osprey");
  assert.equal(WORLD_NAMES[10], "Miller");
  assert.equal(outfitServer({ leader: { world_id: "1" } }), "Osprey");
});

test("addPcServerColumn: srvBy 'o' only when a row's world came from its outfit", () => {
  const mk = () => ({ cols: ["name", "query", "slug"], rows: [["a", "a", "a"], ["b", "b", "b"]] });
  const r1 = addPcServerColumn(mk(), new Map([["a", 1], ["b", 10]]), new Set(["b"]));
  assert.deepEqual(r1.cols, ["name", "query", "slug", "srv", "srvBy"]);
  assert.deepEqual(r1.rows.map((r) => r.slice(3)), [["osprey", null], ["wainwright", "o"]]);
  const r2 = addPcServerColumn(mk(), new Map([["a", 1]]), new Set());
  assert.deepEqual(r2.cols, ["name", "query", "slug", "srv"], "no srvBy column when nothing was inferred");
});

test("i18n: rk.srvFromOutfit in every language", () => {
  for (const f of readdirSync(new URL("../i18n/", import.meta.url)).filter((f) => /^[a-z]{2}\.json$/.test(f))) {
    const j = JSON.parse(readFileSync(new URL(`../i18n/${f}`, import.meta.url), "utf8"));
    assert.ok(j["rk.srvFromOutfit"], f);
  }
});

test("player files: an outfit world is flagged and never written over an own world", () => {
  const dir = new URL("../data/players/", import.meta.url);
  let n = 0;
  for (const f of readdirSync(dir)) {
    const s = readFileSync(new URL(f, dir), "utf8");
    if (!s.includes('"worldSource":"outfit"')) continue;
    const p = JSON.parse(s).player;
    assert.ok(Number.isInteger(p.world) && p.worldOutfit, f);
    n++;
  }
  assert.ok(n > 0);
});

// 🌍 Owner 2026-11-01: last fallback = the server nearly all of a player's opponents are on (opponent-server.mjs).
import { serverFromOpponents, OPP_MIN_N, OPP_MIN_SHARE } from "../opponent-server.mjs";

test("serverFromOpponents: needs enough votes and a clear majority; own key and repeats never vote", () => {
  const srvOf = (k) => (k.startsWith("o") ? "osprey" : k.startsWith("w") ? "wainwright" : null);
  const rows = (o, w) => [...Array(o)].map((_, i) => ({ name: `[T] o${i}` })).concat([...Array(w)].map((_, i) => ({ name: `w${i}` })));
  assert.equal(serverFromOpponents(rows(OPP_MIN_N, 0), srvOf).srv, "osprey");
  assert.equal(serverFromOpponents(rows(OPP_MIN_N - 1, 0), srvOf).srv, null, "too few votes");
  assert.equal(serverFromOpponents(rows(18, 2), srvOf).srv, "osprey", "90% is enough");
  assert.equal(serverFromOpponents(rows(17, 3), srvOf).srv, null, "85% is split");
  assert.equal(serverFromOpponents([...rows(9, 0), { name: "o1" }, { name: "x" }], srvOf).n, 9, "repeats / unknown servers don't vote");
  assert.equal(serverFromOpponents(rows(10, 0), srvOf, "o3").n, 9, "the player is not their own opponent");
  assert.ok(OPP_MIN_SHARE >= 0.9);
});

test("localSrv: own world > outfit > opponents ('e')", () => {
  const opp = (k) => (k ? "wainwright" : null);
  const p = { rows: [...Array(12)].map((_, i) => ({ name: `foe${i}` })) };
  assert.deepEqual(localSrv(p, "a", null, opp), { srv: "wainwright", by: "e" });
  assert.deepEqual(localSrv(p, "a", { a: 1 }, opp), { srv: "osprey", by: "o" });
  assert.deepEqual(localSrv({ ...p, world: 1 }, "a", null, opp), { srv: "osprey", by: null });
  assert.deepEqual(localSrv({ rows: p.rows.slice(0, 3) }, "a", null, opp), { srv: null, by: null });
});

test("mergeFreshRows: a local-only row with no own / outfit world takes its opponents' server (own servers only vote)", () => {
  const cols = ["name", "query", "slug", "savedAt", "srv", "srvBy"];
  const ranked = [...Array(12)].map((_, i) => [`[T] Foe${i}`, `foe${i}`, `foe${i}`, 1, "wainwright", null]);
  ranked.push(["Odd", "odd", "odd", 1, "osprey", "e"]);
  const player = { display: "Newbie", cid: "1", rows: [...ranked.map((r) => ({ name: r[0], kills: 3, deaths: 2, kpm: 1 }))], curve: [] };
  const store = { newbie: { player, savedAt: Date.now(), fetchedAt: Date.now() } };
  const m = mergeFreshRows({ cols, rows: ranked }, store, { extra: ["Newbie"] });
  const row = m.rows.find((r) => r[2] === "newbie");
  assert.ok(row, "local-only row added");
  assert.deepEqual(row.slice(4), ["wainwright", "e"]);
});

test("addPcServerColumn: srvBy 'e' for an opponents' server; outfit 'o' wins", () => {
  const r = addPcServerColumn({ cols: ["name", "query", "slug"], rows: [["a", "a", "a"], ["b", "b", "b"], ["c", "c", "c"]] }, new Map([["a", 1], ["b", 10], ["c", 40]]), new Set(["b"]), new Set(["a", "b", "c"]));
  assert.deepEqual(r.rows.map((x) => x.slice(3)), [["osprey", "e"], ["wainwright", "o"], [null, null]]);
});

test("i18n: rk.srvFromOpponents in every language; opponent-flagged player files carry their votes", () => {
  for (const f of readdirSync(new URL("../i18n/", import.meta.url)).filter((f) => /^[a-z]{2}\.json$/.test(f))) {
    assert.ok(JSON.parse(readFileSync(new URL(`../i18n/${f}`, import.meta.url), "utf8"))["rk.srvFromOpponents"], f);
  }
  const dir = new URL("../data/players/", import.meta.url);
  let n = 0;
  for (const f of readdirSync(dir)) {
    const s = readFileSync(new URL(f, dir), "utf8");
    if (!s.includes('"worldSource":"opponents"')) continue;
    const p = JSON.parse(s).player;
    const [a, b] = String(p.worldVotes).split("/").map(Number);
    assert.ok((p.world === 1 || p.world === 10) && b >= OPP_MIN_N && a / b >= OPP_MIN_SHARE, f);
    n++;
  }
  assert.ok(n > 0);
});
