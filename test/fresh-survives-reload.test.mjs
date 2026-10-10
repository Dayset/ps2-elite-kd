// t300u: after "Fetch fresh", F5 showed the older shared file again because the
// shared data/ copy always beat the browser cache. Now the newest copy wins.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { entryFetchedAt, pickNewest, writeWithEviction } from "../cache-pick.mjs";

const shared = (fetchedAt, top = 50) => ({ player: { id: "s" }, fetchedAt, top, kind: "shared" });
const local = (fetchedAt, top = 200) => ({ player: { id: "l" }, fetchedAt, top, kind: "local" });

describe("newest stored copy wins (t300u)", () => {
  it("a newer local fresh fetch beats an older shared file", () => {
    assert.equal(pickNewest([shared(1000), local(2000)]).kind, "local");
  });
  it("a newer shared file (weekly refresh) beats an older local copy", () => {
    assert.equal(pickNewest([shared(3000, 200), local(2000)]).kind, "shared");
  });
  it("same time: bigger opponent sample wins, then shared", () => {
    assert.equal(pickNewest([shared(1000, 50), local(1000, 200)]).kind, "local");
    assert.equal(pickNewest([local(1000, 200), shared(1000, 200)]).kind, "shared");
  });
  it("one or no copy", () => {
    assert.equal(pickNewest([null, local(5)]).kind, "local");
    assert.equal(pickNewest([shared(5), null]).kind, "shared");
    assert.equal(pickNewest([null, null]), null);
  });
  it("older cache entries without fetchedAt fall back to savedAt", () => {
    assert.equal(entryFetchedAt({ savedAt: 42 }), 42);
    assert.equal(entryFetchedAt({ savedAt: 42, fetchedAt: 7 }), 7);
    assert.equal(entryFetchedAt(null), 0);
  });
  it("quota full: evicts oldest entries, never the new one", () => {
    const store = { a: { savedAt: 1 }, b: { savedAt: 3 }, c: { savedAt: 2 }, n: { savedAt: 9 } };
    const ok = writeWithEviction(store, "n", (st) => Object.keys(st).length <= 2);
    assert.ok(ok);
    assert.deepEqual(Object.keys(store).sort(), ["b", "n"]);
  });
  it("app.js: normal loads pick the newest copy; live + cache copies carry fetchedAt", () => {
    const src = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
    assert.match(src, /async function loadStoredNewest\(/);
    assert.match(src, /const stored = await loadStoredNewest\(name, signal, errors\)/);
    assert.match(src, /np\.fetchedAt = Date\.now\(\);/);
    assert.match(src, /fetchedAt: \+player\.fetchedAt > 0/);
    assert.match(src, /np\.fetchedAt = \+data\.savedAt/);
  });
});
