// t300u follow-up: "Fetch fresh" in the browser → Worker priority list (names
// only) → next background run refreshes those shared files first (<= 5/run).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { freshPriority, FRESH_PRIORITY_MAX } from "../scripts/refresh-cache.mjs";

const H = 3600 * 1000;
const now = 1000 * H;
const index = { players: [
  { name: "JustV6me", slug: "justv6me", savedAt: now - 30 * H },
  { name: "YEEZY", slug: "yeezy", savedAt: now - 10 * 60 * 1000 }, // refreshed 10 min ago
  { name: "Saitama", slug: "saitama", savedAt: now - 5 * H },
] };

describe("fresh-fetch priority (refresh-cache.mjs)", () => {
  it("cached players with a shared file older than 1 h, newest request first", () => {
    const fresh = [
      { slug: "justv6me", at: now - 2 * H },
      { slug: "saitama", at: now - 1 * H },
      { slug: "yeezy", at: now - 3 * H },
      { slug: "notcached", at: now },
    ];
    assert.deepEqual(freshPriority(fresh, index, now), ["Saitama", "JustV6me"]);
  });
  it("skips players whose shared file is already newer than the request", () => {
    assert.deepEqual(freshPriority([{ slug: "saitama", at: now - 6 * H }], index, now), []);
  });
  it("caps per run, tolerates junk", () => {
    const players = Array.from({ length: 20 }, (_, i) => ({ name: `P${i}`, slug: `p${i}`, savedAt: 1 }));
    const fresh = players.map((p, i) => ({ slug: p.slug, at: now - i }));
    assert.equal(freshPriority(fresh, { players }, now).length, FRESH_PRIORITY_MAX);
    assert.deepEqual(freshPriority(null, index, now), []);
    assert.deepEqual(freshPriority([null, { slug: 5 }], index, now), []);
  });
  it("site sends names only, fresh runs only, live + cached players only", () => {
    const src = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
    assert.match(src, /if \(fresh\) markFresh\(result\.loaded\)/);
    const fn = src.slice(src.indexOf("function markFresh("), src.indexOf("/** Small, self-dismissing note"));
    assert.match(fn, /JSON\.stringify\(\{ names, fresh: true \}\)/);
    assert.match(fn, /startsWith\("live:"\)/);
    assert.match(fn, /findSharedEntry\(name\)/);
    assert.doesNotMatch(fn, /rows|curve|trimForCache/);
  });
});
