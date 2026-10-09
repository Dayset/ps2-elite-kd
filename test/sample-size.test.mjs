import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OPPONENT_TOP_N, LEGACY_TOP_N, CENSUS_BATCH, sampleTopN, fetchPlayerCensus } from "../census-fetch.mjs";
import { normalizePlayer, isLegacySample } from "../player-metrics.mjs";
import { staleCandidates, needsUpgrade, CACHE_FORMAT } from "../scripts/refresh-cache.mjs";
import { hiddenList, hiddenKey } from "../hidden.mjs";
import { buildRanks, buildRanksWithGuard, RANK_COLS } from "../scripts/build-ranks.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("opponent sample size (200, older files 50)", () => {
  it("shared constants", () => {
    assert.equal(OPPONENT_TOP_N, 200);
    assert.equal(LEGACY_TOP_N, 50);
    assert.ok(CENSUS_BATCH >= 101 && CENSUS_BATCH <= 250); // player + 200 opponents = 2 batches
  });
  it("sampleTopN: missing → 50, payload or player top wins", () => {
    assert.equal(sampleTopN({ player: {} }), 50);
    assert.equal(sampleTopN({ top: 50, player: {} }), 50);
    assert.equal(sampleTopN({ top: 200, player: {} }), 200);
    assert.equal(sampleTopN({ player: { top: 200 } }), 200);
    assert.equal(normalizePlayer({ top: 200, player: { display: "A", rows: [] } }).top, 200);
    assert.equal(isLegacySample(normalizePlayer({ player: { display: "A", rows: [] } })), true);
    assert.equal(isLegacySample(normalizePlayer({ player: { display: "A", rows: [], top: 200 } })), false);
  });
  it("fetchPlayerCensus uses 200 opponents by default in 2 stat batches", async () => {
    const cid = "5420000000000000001";
    const groups = [];
    for (let i = 0; i < 260; i++) groups.push({ character_id: String(5430000000000000000n + BigInt(i)), table_type: "KILL", count: 300 - i });
    const urls = [];
    const getJson = async (u) => {
      urls.push(u);
      if (u.includes("characters_event_grouped")) return { characters_event_grouped_list: groups };
      const ids = decodeURIComponent(u.match(/character_id=([^&]+)/)[1]).split(",");
      if (u.includes("characters_stat_by_faction")) return { characters_stat_by_faction_list: ids.map((id) => ({ character_id: id, stat_name: "weapon_kills", profile_id: "0", value_forever_vs: 10 })) };
      if (u.includes("characters_stat")) return { characters_stat_list: ids.map((id) => ({ character_id: id, stat_name: "weapon_play_time", profile_id: "0", value_forever: 600 })) };
      return { character_list: ids.map((id) => ({ character_id: id, name: { first: "n" + id.slice(-3) } })) };
    };
    const r = await fetchPlayerCensus(cid, { base: "x/", getJson });
    assert.equal(r.rows.length, 200);
    assert.equal(urls.length, 1 + 2 * 3); // killboard + 2 × (stat, faction, names)
  });
  it("due 50-opponent players go first within the weekly refresh (no forced re-fetch)", () => {
    const D = 24 * 3600 * 1000;
    const NOW = Date.parse("2026-10-20T12:00:00Z");
    const F = CACHE_FORMAT;
    const idx = { players: [
      { name: "Old200", slug: "old200", savedAt: NOW - 10 * D, fmt: F, top: 200 },
      { name: "New50", slug: "new50", savedAt: NOW - 8 * D, fmt: F },
      { name: "Fresh50", slug: "fresh50", savedAt: NOW - 1 * D, fmt: F, top: 50 },
    ] };
    assert.deepEqual(staleCandidates(idx, {}, NOW), ["New50", "Old200"]); // Fresh50 not due: no extra load
    assert.equal(needsUpgrade({}), true);
    assert.equal(needsUpgrade({ top: 200 }), false);
  });
});

describe("🙈 rankings hide list", () => {
  it("matches by tag-less name or character id", () => {
    const h = hiddenList({ players: { "[X] Cheetler": { reason: "r", at: "2026-10-09" }, "5429841912863311665": { reason: "id" } } });
    assert.equal(h.size, 2);
    assert.equal(hiddenKey("[RMBT] lololollala"), "lololollala");
    assert.ok(h.match({ slug: "cheetler" }));
    assert.ok(h.match({ name: "[ABC] cheetler" }));
    assert.equal(h.match({ cid: "5429841912863311665" }).reason, "id");
    assert.equal(h.match({ slug: "shlodog", name: "ShloDog", cid: "1" }), null);
    assert.equal(hiddenList(null).size, 0);
  });
  it("hidden players leave ranks.json but stay in the cache and the outlier-guard population", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hidden-"));
    fs.mkdirSync(path.join(dir, "players"));
    const src = path.join(root, "data", "players");
    const names = ["cheetler", "brackiense", "shlodog"];
    const players = names.map((n) => {
      fs.copyFileSync(path.join(src, n + ".json"), path.join(dir, "players", n + ".json"));
      return { name: n, slug: n, file: `players/${n}.json` };
    });
    fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({ players }));
    fs.writeFileSync(path.join(dir, "hidden.json"), JSON.stringify({ players: { cheetler: { reason: "confirmed cheater", at: "2026-10-09" } } }));
    const r = buildRanks(dir);
    assert.equal(r.count, 2);
    assert.ok(!r.rows.some((row) => row[2] === "cheetler"));
    assert.ok(RANK_COLS.includes("top"));
    const seen = [];
    buildRanks(dir, { onPlayer: (raw, row, o) => seen.push([row[2], o.hidden]) });
    assert.deepEqual(seen.find((s) => s[0] === "cheetler"), ["cheetler", true]);
    const g = buildRanksWithGuard(dir);
    assert.equal(g.hidden.count, 1);
    assert.equal(g.hidden.players[0].slug, "cheetler");
    assert.ok(fs.existsSync(path.join(dir, "players", "cheetler.json")));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
