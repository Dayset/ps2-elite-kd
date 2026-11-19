// 🪦 suppression (live-online, 2026-11-18): the loader's resolveCensus must
// append the characters_online_status join on both URL branches and pass the
// joined `o` through, so a live-online player whose Census times are frozen
// (MissPiss: last_save 2023-11-12) arrives with online_status "1" for
// flairsFor/autoMarksHtml to suppress 🪦. Network is stubbed here; the join
// itself was verified live (MissPiss + AshHalo both return o.online_status "1").
import test from "node:test";
import assert from "node:assert/strict";
import { createLoader } from "../loader.mjs";

const MISSPISS = {
  character_id: "5428341349685132417",
  name: { first: "MissPiss" },
  faction_id: "2",
  times: { creation: 1699000000, last_login: 1699766116, last_save: 1699766370 },
  o: { online_status: "1" },
};

function makeLoader(seen) {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ character_list: [MISSPISS], returned: 1 }),
    };
  };
  const $ = {
    CENSUS: "https://census.daybreakgames.com/s:daysetps2legends/get/ps2:v2/",
    IS_PS: false,
    censusLimit: (fn) => fn(),
    censusBucket: null,
    CENSUS_TIMEOUT_MS: 5000,
    CENSUS_BOARD_TIMEOUT_MS: 5000,
    els: { status: { innerHTML: "" } },
    setStatus: () => {},
  };
  const loader = createLoader($);
  return { loader, restore: () => { globalThis.fetch = origFetch; } };
}

test("resolveCensus by name: join appended, joined online_status passes through", async () => {
  const seen = [];
  const { loader, restore } = makeLoader(seen);
  try {
    const c = await loader.resolveCensus("MissPiss", null);
    assert.equal(seen.length, 1);
    assert.ok(seen[0].includes("characters_online_status^inject_at:o^show:online_status"), seen[0]);
    assert.ok(seen[0].includes("name.first_lower=misspiss"), seen[0]);
    assert.equal(c.character_id, "5428341349685132417");
    assert.equal(c.o.online_status, "1"); // online right now
    assert.equal(c.times.last_save, 1699766370); // frozen 2023-11-12: would show 🪦 without the join
  } finally { restore(); }
});

test("resolveCensus by id: same join on the id branch", async () => {
  const seen = [];
  const { loader, restore } = makeLoader(seen);
  try {
    const c = await loader.resolveCensus("5428341349685132417", null);
    assert.ok(seen[0].includes("character_id=5428341349685132417"), seen[0]);
    assert.ok(seen[0].includes("characters_online_status^inject_at:o^show:online_status"), seen[0]);
    assert.equal(c.o.online_status, "1");
  } finally { restore(); }
});
