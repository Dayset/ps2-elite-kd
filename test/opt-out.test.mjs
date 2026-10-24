/**
 * 🚫 Removal list (#61): opt-out.mjs matching, scripts/purge-removed.mjs on
 * temp PC and PS data folders, and the real list files of both rooms.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { removedList, removedKey, serverKey, REMOVED_NAME } from "../opt-out.mjs";
import { purgeRemoved, scrubDeep } from "../scripts/purge-removed.mjs";
import { FAIL_REASONS } from "../analyze-run.mjs";
import { appSource } from "./app-source.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CID_A = "5428000000000000001";
const CID_B = "5429000000000000002";

test("removedKey / serverKey", () => {
  assert.equal(removedKey("[ABC] Foo_Bar"), "foobar");
  assert.equal(serverKey("Genudine"), "us");
  assert.equal(serverKey("ps2ps4eu"), "eu");
  assert.equal(serverKey("Osprey"), "");
});

test("match: PC id, name, and a later namesake with another id", () => {
  const L = removedList({ players: { [CID_A]: { name: "[ABC] Foo", proof: "test" }, OnlyName: { proof: "test" } } });
  assert.equal(L.size, 2);
  assert.ok(L.match({ cid: CID_A }));
  assert.ok(L.match({ slug: "foo" }));
  assert.ok(L.match({ name: "[XYZ] Foo", proof: "test" }), "outfit tag does not matter");
  assert.equal(L.match({ cid: "5428000000000000009", name: "Foo" }), null, "an id decides: new namesake is not removed");
  assert.ok(L.match({ name: "onlyname", proof: "test" }), "a name-only entry matches by name");
  assert.equal(L.match({ name: "Bar", proof: "test" }), null);
  assert.equal(removedList(null).match({ name: "Foo", proof: "test" }), null);
});

test("match: PS entries need the right server", () => {
  const L = removedList({ players: { [`us-${CID_B}`]: { name: "Bar", proof: "test" } } });
  assert.ok(L.match({ cid: CID_B, server: "ps2ps4us" }));
  assert.ok(L.match({ cid: CID_B, server: "Genudine" }));
  assert.equal(L.match({ cid: CID_B, server: "Ceres" }), null);
  assert.equal(L.match({ name: "Bar", proof: "test" }), null, "no server known: a PS entry never matches by name");
  assert.ok(L.match({ name: "Bar", server: "us" }));
});

test("blankOpponents: only matching names, same server on PS", () => {
  const L = removedList({ players: { [CID_A]: { name: "Foo", proof: "test" }, [`eu-${CID_B}`]: { name: "Bar", proof: "test" } } });
  const rows = [{ name: "[T] Foo", kills: 3 }, { name: "Bar", kills: 1 }, { name: "Baz", kills: 2 }];
  assert.equal(L.blankOpponents(rows), 1);
  assert.deepEqual(rows.map((r) => r.name), [REMOVED_NAME, "Bar", "Baz"]);
  assert.equal(rows[0].kills, 3, "numbers stay");
  const us = [{ name: "Bar", proof: "test" }];
  assert.equal(L.blankOpponents(us, "us"), 0, "the Genudine namesake is somebody else");
  const eu = [{ name: "Bar", proof: "test" }];
  assert.equal(L.blankOpponents(eu, "Ceres"), 1);
});

test("scrubDeep never deletes a map key that only looks like a removed slug", () => {
  const gone = { slugs: new Set(["burst"]), keys: new Set(), cids: new Set([CID_A]), names: new Set(["burst"]), strict: new Set(["burst"]) };
  const status = { burst: { rule: "x" }, list: [{ slug: "burst" }, { slug: "other" }], byId: { [CID_A]: 1, other: 2 } };
  scrubDeep(status, gone);
  assert.deepEqual(status, { burst: { rule: "x" }, list: [{ slug: "other" }], byId: { other: 2 } });
});

const w = (dir, rel, v) => {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof v === "string" ? v : JSON.stringify(v, null, 1) + "\n");
};
const r = (dir, rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), "utf8"));
const player = (display, cid, rows) => ({ query: display, player: { display, cid, rows } });

test("purge (PC): file, records and opponent names go; owner files only reported; second run is a no-op", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "optout-pc-"));
  w(dir, "players/foo.json", JSON.stringify(player("[ABC] Foo", CID_A, [{ name: "Bar", kills: 1 }])) + "\n");
  w(dir, "players/bar.json", JSON.stringify(player("Bar", "5428000000000000003", [{ name: "[ABC] Foo", kills: 9 }, { name: "Baz", kills: 2 }])) + "\n");
  w(dir, "index.json", { updatedAt: "x", players: [{ name: "[ABC] Foo", slug: "foo", file: "players/foo.json" }, { name: "Bar", slug: "bar", file: "players/bar.json" }] });
  w(dir, "names.json", { v: 1, count: 2, players: [["[ABC] Foo", 1], ["Bar", 2]] });
  w(dir, "refresh-state.json", { players: { foo: { fails: 0 }, bar: { fails: 0 } } });
  w(dir, "requested.json", { requested: { foo: 1, bar: 2 }, checked: { foo: 1 } });
  w(dir, "fetch-counts.json", { counts: { foo: 3 } });
  w(dir, "forensics.json", { players: { foo: {}, bar: { worst: { victims: { top: [{ name: "[ABC] Foo", kills: 5 }, { name: "Baz", kills: 1 }] } } } } });
  w(dir, "status.json", { burst: { n: 1 }, lastRun: { updated: ["[ABC] Foo", "Bar"], batch: [{ name: "[ABC] Foo", status: "done" }] } });
  w(dir, "descriptions/f.json", { players: { foo: { text: "x" }, fizz: { text: "y" } } });
  w(dir, "xp/foo.json", { slug: "foo" });
  w(dir, "watchlist.txt", "# names\n[ABC] Foo\nBar\n");
  w(dir, "hidden.json", { players: { foo: { reason: "owner note" } } });
  w(dir, "opt-out.json", { players: { [CID_A]: { name: "[ABC] Foo", at: "2026-10-23", proof: "test" } } });
  const logs = [];
  const rep = purgeRemoved({ dataDir: dir, log: (m) => logs.push(m) });

  assert.equal(fs.existsSync(path.join(dir, "players/foo.json")), false);
  assert.deepEqual(r(dir, "players/bar.json").player.rows.map((x) => x.name), [REMOVED_NAME, "Baz"]);
  assert.deepEqual(r(dir, "index.json").players.map((p) => p.slug), ["bar"]);
  assert.deepEqual(r(dir, "names.json").players, [["Bar", 2]]);
  assert.equal(r(dir, "names.json").count, 1);
  assert.deepEqual(Object.keys(r(dir, "refresh-state.json").players), ["bar"]);
  assert.deepEqual(r(dir, "requested.json"), { requested: { bar: 2 }, checked: {} });
  assert.deepEqual(r(dir, "fetch-counts.json").counts, {});
  assert.deepEqual(Object.keys(r(dir, "forensics.json").players), ["bar"]);
  assert.deepEqual(r(dir, "forensics.json").players.bar.worst.victims.top.map((v) => v.name), ["Baz"]);
  const st = r(dir, "status.json");
  assert.deepEqual(st.burst, { n: 1 });
  assert.deepEqual(st.lastRun, { updated: ["Bar"], batch: [] });
  assert.deepEqual(Object.keys(r(dir, "descriptions/f.json").players), ["fizz"]);
  assert.equal(fs.existsSync(path.join(dir, "xp/foo.json")), false);
  assert.equal(fs.readFileSync(path.join(dir, "watchlist.txt"), "utf8"), "# names\nBar\n");
  assert.deepEqual(r(dir, "hidden.json"), { players: { foo: { reason: "owner note" } } }, "owner file untouched");
  assert.deepEqual(rep.owner, [{ file: "hidden.json", key: "foo" }]);
  assert.equal(rep.removed.length, 1);
  assert.equal(r(dir, "opt-out-state.json").removedFiles, 1);
  assert.ok(logs.some((m) => /1 cached file\(s\) deleted, 1 opponent name\(s\) blanked/.test(m)));

  const again = purgeRemoved({ dataDir: dir, log: () => {} });
  assert.equal(again.skipped, true);
});

test("purge (PS): removes the right server's file and keeps the other server's namesake", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "optout-ps-"));
  const us = `us-${CID_B}`;
  const eu = "eu-5429000000000000004";
  const usOther = "us-5429000000000000005";
  w(dir, `players/${us}.json`, JSON.stringify({ server: "Genudine", key: us, player: { display: "Bar", cid: CID_B, room: "ps", server: "Genudine", rows: [] } }) + "\n");
  w(dir, `players/${eu}.json`, JSON.stringify({ server: "Ceres", key: eu, player: { display: "Bar", cid: "5429000000000000004", room: "ps", server: "Ceres", rows: [{ name: "Bar", kills: 1 }] } }) + "\n");
  w(dir, `players/${usOther}.json`, JSON.stringify({ server: "Genudine", key: usOther, player: { display: "Qux", cid: "5429000000000000005", room: "ps", server: "Genudine", rows: [{ name: "Bar", kills: 4 }] } }) + "\n");
  w(dir, "index.json", { players: [{ name: "Bar", key: us, file: `players/${us}.json` }, { name: "Bar", key: eu, file: `players/${eu}.json` }, { name: "Qux", key: usOther, file: `players/${usOther}.json` }] });
  w(dir, "names.json", { v: 1, count: 3, players: [["Bar", 1, `players/${us}.json`, "bar-us"], ["Bar", 1, `players/${eu}.json`, "bar-eu"], ["Qux", 1, `players/${usOther}.json`, "qux"]] });
  w(dir, "refresh-state.json", { players: { [us]: {}, [eu]: {}, [usOther]: {} } });
  w(dir, "opt-out.json", { players: { [us]: { name: "Bar", proof: "test" } } });
  purgeRemoved({ dataDir: dir, room: "ps", log: () => {} });

  assert.equal(fs.existsSync(path.join(dir, `players/${us}.json`)), false);
  assert.equal(fs.existsSync(path.join(dir, `players/${eu}.json`)), true, "Ceres namesake stays");
  assert.deepEqual(r(dir, `players/${eu}.json`).player.rows.map((x) => x.name), ["Bar"], "Ceres opponent named Bar is somebody else");
  assert.deepEqual(r(dir, `players/${usOther}.json`).player.rows.map((x) => x.name), [REMOVED_NAME]);
  assert.deepEqual(r(dir, "index.json").players.map((p) => p.key), [eu, usOther]);
  assert.deepEqual(r(dir, "names.json").players.map((x) => x[3]), ["bar-eu", "qux"]);
  assert.deepEqual(Object.keys(r(dir, "refresh-state.json").players).sort(), [eu, usOther].sort());
});

test("the real removal lists parse and use valid ids", () => {
  for (const d of ["data", "data-ps"]) {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, d, "opt-out.json"), "utf8"));
    assert.equal(typeof j.players, "object", `${d}/opt-out.json has a players map`);
    for (const [k, v] of Object.entries(j.players)) {
      const ok = d === "data-ps" ? /^(us|eu)-\d{5,25}$/.test(k) || !/^\d+$/.test(k) : !/^(us|eu)-/.test(k);
      assert.ok(ok, `${d}/opt-out.json: ${k} is not a valid id for this room`);
      assert.ok(v && typeof v.name === "string" && v.name, `${d}/opt-out.json: ${k} needs a name`);
      assert.match(String(v.at || ""), /^\d{4}-\d{2}-\d{2}$/, `${d}/opt-out.json: ${k} needs an "at" date`);
      assert.ok(String(v.proof || "").trim(), `${d}/opt-out.json: ${k} needs "proof" (how ownership was proven); no proof, no removal`);
    }
  }
});

test("the page checks the removal list and says why", () => {
  const app = appSource();
  assert.match(app, /from "\.\/opt-out\.mjs\?v=/);
  assert.match(app, /removed\.match\(\{ cid: p\.cid/, "post-load check by character id");
  assert.ok(FAIL_REASONS.removed);
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, "i18n/en.json"), "utf8"));
  assert.ok(en["fail.reason.removed"], "fail.reason.removed is translatable");
});

test("a removed name is not called a typo in the skipped-names line", async () => {
  const { summarizeFailures } = await import("../analyze-run.mjs");
  const only = summarizeFailures([{ name: "Foo", kind: "removed" }], 1);
  assert.match(only.text, /Foo \(removed at the player's request\)\. Showing the rest\.$/);
  assert.doesNotMatch(only.text, /misspelled/);
  const all = summarizeFailures([{ name: "Foo", kind: "removed" }], 0);
  assert.doesNotMatch(all.text, /misspelled/);
  const mixed = summarizeFailures([{ name: "Foo", kind: "removed" }, { name: "Typo", kind: "not-found" }], 1);
  assert.match(mixed.text, /not a real character\. Showing the rest\.$/, "one typo: singular");
});

test("no proof, no removal: entries without a recorded proof are ignored", () => {
  const L = removedList({ players: { [CID_A]: { name: "Foo", at: "2026-10-23" }, Bar: { name: "Bar", proof: "  " } } });
  assert.equal(L.size, 0);
  assert.equal(L.match({ cid: CID_A }), null);
  const rows = [{ name: "Foo" }];
  assert.equal(L.blankOpponents(rows), 0);
});
