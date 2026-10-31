// t795u: 🏳️ faction rating (faction-rating.mjs, faction-panel.mjs) and the NC / TR / VS / NS name-box alias.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { factionAlias, extractFactionAliases, factionOf, buildFactionRating, FACTIONS, FACTION_TOP_N } from "../faction-rating.mjs";
import { factionHtml, addFactionPlayers } from "../faction-panel.mjs";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

test("alias: whole words only, any case; [NC] stays an outfit tag", () => {
  assert.equal(factionAlias("nc"), "nc");
  assert.equal(factionAlias("Vs"), "vs");
  assert.equal(factionAlias("NS"), "nso");
  assert.equal(factionAlias("nso"), "nso");
  assert.equal(factionAlias("NCx"), null);
  const r = extractFactionAliases("nc Wrel, TR");
  assert.deepEqual(r.factions, ["nc", "tr"]);
  assert.match(r.rest, /Wrel/);
  assert.doesNotMatch(r.rest, /\bnc\b|\bTR\b/);
  assert.deepEqual(extractFactionAliases("[NC] Wrel").factions, []);
  assert.deepEqual(extractFactionAliases("NCSniper").factions, []);
});

test("factionOf: player file first, then the Census backfill", () => {
  assert.equal(factionOf({ faction: "tr" }, {}), "tr");
  assert.equal(factionOf({ cid: "5" }, { 5: "vs" }), "vs");
  assert.equal(factionOf({ cid: "6" }, { 5: "vs" }), null);
});

test("buildFactionRating: medians, top lists, family head-to-head", () => {
  const players = [];
  const day = 864e5, now = Date.parse("2026-10-31");
  for (const f of FACTIONS) for (let k = 0; k < 30; k++) players.push({ slug: `${f}${k}`, name: `${f}${k}`, faction: f, adjs: (f === "vs" ? 400 : 250) + k, kd: 1, kpm: 0.3, playH: 100 + k, last: (now - (k % 3) * day) / 1000 });
  // one family: the same person on nc (weaker) and vs (stronger)
  players.push({ slug: "fa", name: "fA", faction: "nc", adjs: 100, kd: 1, kpm: 0.3, playH: 200, last: now / 1000 });
  players.push({ slug: "fb", name: "fB", faction: "vs", adjs: 300, kd: 1, kpm: 0.3, playH: 200, last: now / 1000 });
  players.push({ slug: "pad", name: "Pad", faction: "tr", adjs: 9999, padder: true, playH: 50 });
  const fr = buildFactionRating(players, { fa: "F1", fb: "F1" }, { now, topN: FACTION_TOP_N });
  assert.equal(fr.left.padders, 1);
  assert.ok(!fr.top.tr.includes("Pad"));
  assert.ok(fr.factions.vs.medIvi > fr.factions.nc.medIvi);
  assert.equal(fr.families.n, 1);
  assert.equal(fr.families.h2h.vs.w, 1);
  assert.equal(fr.families.h2h.nc.w, 0);
  assert.ok(fr.top.vs.length <= FACTION_TOP_N && fr.top.vs.length > 0);
  const html = factionHtml(fr, "vs");
  assert.match(html, /fr-chart/);
  assert.match(html, /data-faction="nc"/);
  assert.doesNotMatch(html, /transition|animation/);
});

test("alias adds up to the outfit cap, then says so", async () => {
  const names = Array.from({ length: 60 }, (_, k) => "p" + k);
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ factions: {}, top: { nc: names } }) });
  const field = []; let note = "";
  const r = await addFactionPlayers(["nc"], { addNameToField: (n) => (field.push(n), true), outfitRoom: () => 50 - field.length, note: (h) => (note = h), isPs: false });
  assert.equal(r[0].added, 50);
  assert.equal(r[0].noRoom, 10);
  assert.match(note, /fr-jump/);
  const ps = await addFactionPlayers(["nc"], { addNameToField: () => true, outfitRoom: () => 50, note: (h) => (note = h), isPs: true });
  assert.equal(ps[0].added, 0);
});

test("wired: name field, Analyze waits, section in index.html, 9 languages", () => {
  const nf = read("names-field.mjs");
  assert.match(nf, /extractFactionAliases\(/);
  assert.match(nf, /outfits: pending/);
  assert.match(read("index.html"), /id="factionSection"/);
  assert.match(read("app.js"), /initFactionPanel\(/);
  const en = JSON.parse(read("i18n/en.json"));
  const keys = Object.keys(en).filter((k) => k.startsWith("fr."));
  assert.ok(keys.length >= 30);
  const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const l of ["ja", "ru", "de", "fr", "zh", "es", "uk", "it"]) {
    const t = JSON.parse(read(`i18n/${l}.json`));
    for (const k of keys) { assert.ok(t[k], `${l} ${k}`); assert.equal(ph(t[k]), ph(en[k]), `${l} ${k}`); }
  }
  for (const k of keys) assert.doesNotMatch(en[k], /cheat|track|locat/i);
});
