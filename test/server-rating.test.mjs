// t798u: 🌐 server rating (server-rating.mjs, server-panel.mjs), the server-name alias and the t800u age reset.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { serverAlias, extractServerAliases, serverOfWorld, worldOf, buildServerRating, serverLeader, SERVERS_PC, SERVERS_PS } from "../server-rating.mjs";
import { serverHtml } from "../server-panel.mjs";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

test("alias: whole words, any case, only in their own room; [Osprey] stays an outfit tag", () => {
  assert.equal(serverAlias("OSPREY"), "osprey");
  assert.equal(serverAlias("wainwright"), "wainwright");
  assert.equal(serverAlias("genudine"), null);
  assert.equal(serverAlias("Genudine", true), "genudine");
  assert.equal(serverAlias("osprey", true), null);
  assert.equal(serverAlias("Connery"), null); // merged worlds are not aliases (no shadowing)
  const r = extractServerAliases("Osprey, Sarleyy wainwright");
  assert.deepEqual(r.servers, ["osprey", "wainwright"]);
  assert.match(r.rest, /Sarleyy/);
  assert.doesNotMatch(r.rest, /osprey|wainwright/i);
  assert.deepEqual(extractServerAliases("[Osprey] Wrel").servers, []);
  assert.deepEqual(extractServerAliases("OspreyAce").servers, []);
  assert.equal(extractServerAliases("Wrel").rest, "Wrel");
});

test("world → server: merged worlds map to Osprey / Wainwright", () => {
  assert.equal(serverOfWorld(1), "osprey");
  assert.equal(serverOfWorld("17"), "osprey");
  assert.equal(serverOfWorld(10), "wainwright");
  assert.equal(serverOfWorld(13), "wainwright");
  assert.equal(serverOfWorld(40), null);
  assert.equal(serverOfWorld(19), null);
  assert.equal(worldOf({ world: 10 }, {}), 10);
  assert.equal(worldOf({ cid: "7" }, { 7: 1 }), 1);
  assert.equal(worldOf({ cid: "8" }, { 7: 1 }), null);
});

test("buildServerRating: medians, top share, active first, padders / thin / other worlds left out", () => {
  const now = Date.UTC(2026, 9, 31);
  const recent = now / 1000 - 86400;
  const old = now / 1000 - 400 * 86400;
  const ps = [];
  for (let i = 0; i < 10; i++) ps.push({ slug: "o" + i, name: "O" + i, server: "osprey", adjs: 100 + i * 10, kd: 1, kpm: 0.5, playH: 10, last: recent });
  for (let i = 0; i < 10; i++) ps.push({ slug: "w" + i, name: "W" + i, server: "wainwright", adjs: 50 + i * 10, kd: 1, kpm: 0.5, playH: 10, last: i === 9 ? old : recent });
  ps.push({ slug: "p", name: "P", server: "osprey", adjs: 9999, padder: true });
  ps.push({ slug: "t", name: "T", server: "osprey", adjs: 9999, thin: true });
  ps.push({ slug: "s", name: "S", server: null, world: 40, adjs: 9999 });
  const sr = buildServerRating(ps, { now, topN: 3 });
  assert.equal(sr.rated, 20);
  assert.equal(sr.stats.osprey.n, 10);
  assert.equal(sr.stats.osprey.medIvi, 145);
  assert.equal(sr.stats.wainwright.medIvi, 95);
  assert.deepEqual(sr.left.worlds, { 40: 1 });
  assert.equal(sr.left.padders, 1);
  assert.deepEqual(sr.top.osprey, ["O9", "O8", "O7"]);
  assert.deepEqual(sr.top.wainwright, ["W8", "W7", "W6"]); // W9 inactive → after the active ones
  assert.equal(serverLeader(sr, (d, s) => d.stats[s].medIvi), "osprey");
  const html = serverHtml(sr);
  assert.match(html, /data-server="osprey"/);
  assert.match(html, /sr-load/);
  assert.doesNotMatch(html, /border-radius|cheater/i);
});

test("servers.json is built for both rooms", () => {
  for (const [f, list] of [["data/servers.json", SERVERS_PC], ["data-ps/servers.json", SERVERS_PS]]) {
    assert.ok(existsSync(new URL("../" + f, import.meta.url)), f);
    const d = JSON.parse(read(f));
    assert.deepEqual(d.servers, [...list]);
    for (const s of list) assert.ok(d.stats[s].n > 0 && d.top[s].length > 0, f + " " + s);
  }
  assert.match(read("scripts/build-ranks.mjs"), /servers\.json/);
});

test("wiring: section, Top 50 jumps to the names, alias in the name field, 9 languages", () => {
  const html = read("index.html");
  assert.match(html, /id="serverSection"/);
  const panel = read("server-panel.mjs");
  assert.match(panel, /glideTo\(null, .*"auto"\)/);
  const nf = read("names-field.mjs");
  assert.match(nf, /extractServerAliases/);
  assert.match(nf, /addServers/);
  for (const l of ["en", "ja", "ru", "de", "fr", "zh", "es", "uk", "it"]) {
    const j = JSON.parse(read(`i18n/${l}.json`));
    for (const k of ["srv.title", "srv.lead", "srv.loadTip", "srv.note", "srv.notePs", "srv.aliasTip"]) assert.ok(j[k], `${l} ${k}`);
  }
});

test("t800u: outfit, faction and server fetches reset the age filter to its full range", () => {
  const nf = read("names-field.mjs");
  assert.ok((nf.match(/resetAge\(\)/g) || []).length >= 4, "outfit, fetch-all, faction, server");
  assert.match(nf, /\$\.resetAgeFilter/);
  assert.match(read("outfit-tags.mjs"), /\$\.onFetched/);
  const app = read("app.js");
  assert.match(app, /resetAgeFilter:/);
  assert.match(app, /resetAgeToFull = \(\) => \{\s*applyAge\(ageCeil\(\), true\)/);
});
