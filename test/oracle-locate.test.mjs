// 📍 Locate one character (owner 2026-11-12, hidden in the Oracle page's ⓘ About):
// GET /locate?name= → Census identity + the live map's continent/base, from the same
// event stream as ⚔️ Live fights. No storage, no logging of the name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { locatePlayer, handleLocate, _resetLocateHits } from "../oracle-worker/src/locate.js";

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...extra } });

const CID = "5428713425544958353";
const charList = (c) => ({ character_list: c ? [c] : [], returned: c ? 1 : 0 });
const enzakPC = { character_id: CID, name: { first: "ENZAK" }, faction_id: "1",
  w: { world_id: "10" }, o: { online_status: "1" } };

/** Census stub: answers per namespace from a map ns → character (or null). */
function censusStub(byNs, { fail = false } = {}) {
  return async (url) => {
    if (fail) throw new Error("census down");
    const m = String(url).match(/\/get\/([^:]+):v2\/character/);
    const ns = m ? m[1] : "ps2";
    return { ok: true, json: async () => charList(byNs[ns] || null) };
  };
}
/** CACHE stub: records the request, answers with the given players map. */
function cacheStub(players, { stream = true } = {}) {
  const seen = [];
  return { seen,
    fetch: async (req) => {
      seen.push({ url: req.url, key: req.headers.get("X-Proxy-Key") });
      return new Response(JSON.stringify({ v: 1, ns: "ps2", at: 1_792_300_060, stream, players }));
    } };
}

const envBase = (cache) => ({ CENSUS_SERVICE_ID: "daysetps2legends", ORACLE_KEY: "proxy-key", CACHE: cache });

test("locatePlayer: PC exact hit — identity plus base, continent, how", async () => {
  const cache = cacheStub({ [CID]: { w: 10, z: 4, zn: "Hossin", ago: 20, on: true, fac: "VS", f: 261000, fn: "Sharpe's Run", fago: 45, how: "exact" } });
  const out = await locatePlayer(envBase(cache), "ENZAK", { fetchImpl: censusStub({ ps2: enzakPC }) });
  assert.equal(out.error, undefined);
  assert.equal(out.name, "ENZAK");
  assert.equal(out.cid, CID);
  assert.equal(out.platform, "pc");
  assert.equal(out.faction, "VS");
  assert.equal(out.world, 10);
  assert.equal(out.online, true);
  assert.equal(out.stream, true);
  assert.deepEqual(out.loc, { w: 10, z: 4, zn: "Hossin", ago: 20, on: true, fac: "VS", f: 261000, fn: "Sharpe's Run", fago: 45, how: "exact" });
  assert.equal(cache.seen.length, 1);
  assert.match(cache.seen[0].url, /\/live\/locate\?ns=ps2&ids=5428713425544958353/);
  assert.equal(cache.seen[0].key, "proxy-key", "the proxy key rides the service-binding call, never the page");
});

test("locatePlayer: near hit, no activity, and PS fallback", async () => {
  const near = cacheStub({ [CID]: { w: 1, z: 2, zn: "Indar", ago: 130, on: true, fac: "VS", f: 201, fn: "The Crown", fago: 130, how: "near" } });
  const n = await locatePlayer(envBase(near), "ENZAK", { fetchImpl: censusStub({ ps2: enzakPC }) });
  assert.equal(n.loc.how, "near");
  assert.equal(n.loc.fn, "The Crown");

  const idle = cacheStub({});
  const q = await locatePlayer(envBase(idle), "ENZAK", { fetchImpl: censusStub({ ps2: enzakPC }) });
  assert.equal(q.loc, null, "a player doing nothing has no position");
  assert.equal(q.stream, true);
  assert.equal(q.online, true, "identity (incl. Census online) still answers");

  const euChar = { character_id: "5429000000000000001", name: { first: "ENZAK" }, faction_id: "2", w: { world_id: "2000" }, o: { online_status: "0" } };
  const euCache = cacheStub({});
  const e = await locatePlayer(envBase(euCache), "ENZAK", { fetchImpl: censusStub({ ps2ps4eu: euChar }) });
  assert.equal(e.platform, "eu");
  assert.equal(e.world, 2000);
  assert.equal(e.online, false);
  assert.match(euCache.seen[0].url, /ns=ps2ps4eu/);
});

test("locatePlayer: identity-only when the locate leg cannot run", async () => {
  const noKey = await locatePlayer({ CENSUS_SERVICE_ID: "x", CACHE: cacheStub({}) }, "ENZAK", { fetchImpl: censusStub({ ps2: enzakPC }) });
  assert.equal(noKey.loc, null);
  assert.equal(noKey.stream, null);
  assert.equal(noKey.name, "ENZAK", "Census facts still answer without the key");
  const noCache = await locatePlayer({ CENSUS_SERVICE_ID: "x", ORACLE_KEY: "proxy-key" }, "ENZAK", { fetchImpl: censusStub({ ps2: enzakPC }) });
  assert.equal(noCache.loc, null);
  assert.equal(noCache.stream, null);
});

test("handleLocate: unknown / invalid / Census-down / rate limit", async () => {
  _resetLocateHits();
  const req = (name, ip = "1.2.3.4") => new Request(`https://oracle/locate?name=${encodeURIComponent(name)}`, { headers: { "CF-Connecting-IP": ip } });
  const env = envBase(cacheStub({}));
  const stub = censusStub({ ps2: enzakPC });
  const none = censusStub({});

  let r = await handleLocate(req("NobodyHere"), env, new URL("https://oracle/locate?name=NobodyHere"), json, 1_792_300_060, none);
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error, "unknown_name");

  r = await handleLocate(req("a b"), env, new URL("https://oracle/locate?name=a%20b"), json, 1_792_300_060, stub);
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, "invalid_name");

  r = await handleLocate(req("ENZAK"), env, new URL("https://oracle/locate?name=ENZAK"), json, 1_792_300_060, stub);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).name, "ENZAK");

  const failOut = await locatePlayer(env, "ENZAK", { fetchImpl: censusStub({}, { fail: true }) });
  assert.equal(failOut.error, "census_error");

  _resetLocateHits();
  let last = null;
  for (let i = 0; i < 61; i++) last = await handleLocate(req("ENZAK", "9.9.9.9"), env, new URL("https://oracle/locate?name=ENZAK"), json, 1_792_300_060, stub);
  assert.equal(last.status, 429);
  assert.equal((await last.json()).error, "rate_limited");
  _resetLocateHits();
});
