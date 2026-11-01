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
