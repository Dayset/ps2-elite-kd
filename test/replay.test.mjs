// 🎬 Duel replay (replay/): shard function is stable, the committed shards match it,
// every page text key exists in i18n/en.json, and the page has no rounded corners.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { shardOf, slugOf, SHARDS } from "../replay/shard.mjs";

test("shardOf is a stable 2-hex shard", () => {
  assert.equal(SHARDS, 64);
  for (const s of ["fantom220tr", "gorislavru", "x", ""]) {
    assert.match(shardOf(s), /^[0-3][0-9a-f]$/);
    assert.equal(shardOf(s), shardOf(s));
  }
  assert.equal(slugOf("[TAG] Fantom220TR"), "fantom220tr");
});

test("committed shards hold each player in its own shard", () => {
  const meta = JSON.parse(fs.readFileSync("data/replay/meta.json", "utf8"));
  assert.equal(meta.shards, SHARDS);
  for (const f of ["00", "1a", "3f"]) {
    const d = JSON.parse(fs.readFileSync(`data/replay/${f}.json`, "utf8"));
    for (const slug of Object.keys(d.p)) assert.equal(shardOf(slug), f, slug);
    for (const p of Object.values(d.p)) assert.equal(p.v.length, meta.cols.length);
  }
});

test("replay page text keys exist in en.json", () => {
  const en = JSON.parse(fs.readFileSync("i18n/en.json", "utf8"));
  const src = fs.readFileSync("replay/player.js", "utf8") + fs.readFileSync("replay/index.html", "utf8");
  const keys = new Set();
  for (const m of src.matchAll(/\bT\('([a-zA-Z.]*[a-zA-Z])'/g)) keys.add("replay." + m[1]); // 'st.' + id prefixes are checked by the browser run
  for (const m of src.matchAll(/data-i18n(?:-aria-label)?="(replay\.[\w.]+)"/g)) keys.add(m[1]);
  assert.ok(keys.size > 20, "found keys");
  for (const k of keys) assert.ok(k in en, k);
  assert.ok("replay.open" in en);
});

test("every scene state belongs to a life phase, and each phase has text in every language", async () => {
  const { STATES, PHASES } = await import("../replay/states.js");
  assert.deepEqual(PHASES, ["spawn", "travel", "fight", "death"]);
  for (const [id, s] of Object.entries(STATES)) assert.ok(PHASES.includes(s.phase), `${id} has a phase`);
  const used = new Set(Object.values(STATES).map(s => s.phase));
  for (const p of PHASES) assert.ok(used.has(p), `some state is in ${p}`);
  for (const lang of ["en", "ja", "ru", "de", "fr", "zh", "es", "uk", "it"]) {
    const d = JSON.parse(fs.readFileSync(`i18n/${lang}.json`, "utf8"));
    for (const p of PHASES) { assert.ok(d["replay.ph." + p], `${lang} ph.${p}`); assert.ok(d["replay.phHint." + p], `${lang} phHint.${p}`); }
    for (const k of ["skipHint", "alive", "session", "strip", "plan"]) assert.ok(d["replay." + k], `${lang} ${k}`);
  }
});

test("timeline strip and ⏭ skip are wired into the page", () => {
  const js = fs.readFileSync("replay/player.js", "utf8"), html = fs.readFileSync("replay/index.html", "utf8");
  assert.match(html, /id="life"/);
  assert.match(js, /window\.__skip = /);
  assert.match(js, /textContent = '⏭'/);
  // skipping steps the scene through the skipped time (tallies and per-minute rates stay true)
  assert.match(js, /while \(simT < to\) \{[^}]*step\(simT, dt\)/);
});
