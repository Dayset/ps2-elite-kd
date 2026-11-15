// Rankings table shows real negative ⚔️ iVi (owner 2026-11-08: less 0 in All players).
// The stats table, live page, kill feed and tiers keep their own floors/labels;
// the distribution graph keeps its floor: 0 + underflow bin (only the dot tooltip
// and the underflow label now use the real value).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../rankings.mjs", import.meta.url), "utf8");

test("rankings ⚔️ iVi has no floor: negative values render as-is", () => {
  assert.doesNotMatch(src, /floorZero/, "no floor flag left in rankings.mjs");
  assert.doesNotMatch(src, /below-scale/, "no below-scale cell left in rankings.mjs");
  assert.doesNotMatch(src, /Below the rating scale/, "no below-scale tooltip left in rankings.mjs");
  assert.doesNotMatch(src, /dist\.zeroBelow|dist\.below0/, "no floored distribution labels left in rankings.mjs");
  const def = src.slice(src.indexOf('{ id: "adjs"'), src.indexOf("},", src.indexOf('{ id: "adjs"')));
  assert.match(def, /digits: 0/);
  assert.doesNotMatch(def, /floorZero/);
});

test("server switch re-ranks the main table: # is the rank within the selected server (2026-11-15)", () => {
  // The # column is the anchor for finding a player by rank + server, so a
  // selected server must re-rank instead of keeping the global numbers
  // (TheDarkEmpress: #1,305 on Wainwright vs #2,376 globally).
  assert.match(src, /const sig = sortKey \+ ":" \+ sortDir \+ ":" \+ serverFilter;/, "rank cache key includes the server filter");
  assert.match(src, /const pool = serverFilter === "all" \? data\.rows : data\.rows\.filter\(\(r\) => r\.srvKey === serverFilter\);/, "assignRanks ranks over the server pool");
  assert.match(src, /assignRanks\(\) already ordered the server pool for the current sort/, "filtered view keeps the server rank numbers");
});
