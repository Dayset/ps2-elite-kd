/**
 * Census-only per-player fetch: killboard builder (same as Honu's
 * KillboardCollection), batched stat lookups, pacing.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildKillboard,
  censusBase,
  fetchCharacterInfo,
  fetchPlayerCensus,
  paceFromTotals,
  statUrls,
  killboardUrl,
  tokenBucket,
  totalsByCharacter,
  defaultCensusRate,
  CENSUS_BATCH,
  classifyCensus,
  backoffDelay,
  censusRequest,
  limitConcurrency,
  CensusError,
} from "../census-fetch.mjs";

const ME = "5428000000000000001";
const id = (n) => String(5428000000000000100n + BigInt(n));

describe("censusBase", () => {
  it("defaults to s:example and accepts ids with or without s:", () => {
    assert.equal(censusBase(), "https://census.daybreakgames.com/s:example/get/ps2:v2/");
    assert.equal(censusBase(""), "https://census.daybreakgames.com/s:example/get/ps2:v2/");
    assert.equal(censusBase("s:myid"), "https://census.daybreakgames.com/s:myid/get/ps2:v2/");
    assert.equal(censusBase("myid"), "https://census.daybreakgames.com/s:myid/get/ps2:v2/");
  });
  it("killboard URL has NO c:limit (Census then returns every row, like Honu)", () => {
    assert.equal(killboardUrl(censusBase(), ME), `https://census.daybreakgames.com/s:example/get/ps2:v2/characters_event_grouped?character_id=${ME}`);
  });
});

describe("buildKillboard (Honu KillboardCollection semantics)", () => {
  const groups = [
    { table_type: "DEATH", count: "50", character_id: ME }, // self: dropped
    { table_type: "DEATH", count: "9", character_id: id(1) },
    { table_type: "DEATH", count: "4", character_id: id(2) },
    { table_type: "DEATH", count: "3", character_id: "0" },
    { table_type: "KILL", count: "7", character_id: id(2) },
    { table_type: "KILL", count: "1", character_id: id(1) },
    { table_type: "KILL", count: "2", character_id: id(3) },
    { table_type: "OTHER", count: "99", character_id: id(3) }, // ignored
  ];
  it("sums KILL/DEATH per opponent, drops self, sorts by kills+deaths", () => {
    assert.deepEqual(buildKillboard(groups, ME), [
      { sourceCharacterID: ME, otherCharacterID: id(2), kills: 7, deaths: 4 },
      { sourceCharacterID: ME, otherCharacterID: id(1), kills: 1, deaths: 9 },
      { sourceCharacterID: ME, otherCharacterID: "0", kills: 0, deaths: 3 },
      { sourceCharacterID: ME, otherCharacterID: id(3), kills: 2, deaths: 0 },
    ]);
  });
  it("ties keep Census order (stable sort) and the list is capped at 200", () => {
    const many = [];
    for (let i = 0; i < 250; i++) many.push({ table_type: "KILL", count: "1", character_id: id(i) });
    const b = buildKillboard(many, ME);
    assert.equal(b.length, 200);
    assert.deepEqual(b.slice(0, 3).map((e) => e.otherCharacterID), [id(0), id(1), id(2)]);
  });
});

describe("stat batching", () => {
  it("totals: characters_stat value_forever + by_faction VS+NC+TR, profile 0 only", () => {
    const t = totalsByCharacter(
      [
        { character_id: ME, stat_name: "weapon_play_time", profile_id: "0", value_forever: "6000" },
        { character_id: ME, stat_name: "weapon_fire_count", profile_id: "0", value_forever: "1000" },
        { character_id: ME, stat_name: "weapon_hit_count", profile_id: "0", value_forever: "250" },
        { character_id: ME, stat_name: "weapon_play_time", profile_id: "5", value_forever: "999999" },
      ],
      [
        { character_id: ME, stat_name: "weapon_kills", profile_id: "0", value_forever_vs: "100", value_forever_nc: "50", value_forever_tr: "0" },
        { character_id: ME, stat_name: "weapon_headshots", profile_id: "0", value_forever_vs: "30", value_forever_nc: "0", value_forever_tr: "15" },
      ]
    ).get(ME);
    const pace = paceFromTotals(t);
    assert.equal(pace.wk, 150);
    assert.equal(pace.kpm, 1.5); // 150 kills / 100 min
    assert.equal(pace.acc, 25);
    assert.equal(pace.hsr, 30);
    assert.equal(pace.ivi, 750);
  });
  it("one stat + one faction + one name call per batch of ids", async () => {
    const ids = Array.from({ length: CENSUS_BATCH + 5 }, (_, i) => id(i));
    const urls = [];
    const getJson = async (u) => {
      urls.push(u);
      const q = new URL(u).searchParams.get("character_id").split(",");
      if (u.includes("/characters_stat_by_faction?")) {
        return { characters_stat_by_faction_list: q.map((c) => ({ character_id: c, stat_name: "weapon_kills", profile_id: "0", value_forever_vs: "60", value_forever_nc: "0", value_forever_tr: "0" })) };
      }
      if (u.includes("/characters_stat?")) {
        return { characters_stat_list: q.filter((c) => c !== id(3)).map((c) => ({ character_id: c, stat_name: "weapon_play_time", profile_id: "0", value_forever: "3600" })) };
      }
      return { character_list: q.map((c) => ({ character_id: c, name: { first: `N${c.slice(-3)}` }, outfit: c === id(1) ? { alias: "TAG" } : undefined })) };
    };
    const info = await fetchCharacterInfo([...ids, ids[0], "0", "junk"], { base: censusBase(), getJson });
    assert.equal(urls.length, 6); // 2 batches x (stat, faction, names)
    assert.equal(info.size, ids.length);
    assert.equal(info.get(id(0)).pace.kpm, 1);
    assert.equal(info.get(id(1)).outfitTag, "TAG");
    assert.equal(info.get(id(3)).pace.kpm, 0); // kills but no play time -> 0, still counted as found
    const u = statUrls(censusBase(), [ME, id(1)]);
    assert.match(u.stat, /characters_stat\?character_id=5428000000000000001,5428000000000000101&stat_name=weapon_deaths,weapon_play_time,weapon_fire_count,weapon_hit_count/);
    assert.match(u.faction, /stat_name=weapon_kills,weapon_headshots/);
  });
  it("a batch that keeps failing marks its ids failed (partial result) instead of throwing", async () => {
    const info = await fetchCharacterInfo([id(1), id(2)], { base: censusBase(), getJson: async () => ({ error: "service_unavailable" }) });
    assert.deepEqual(info.get(id(1)), { pace: null, failed: true, name: "", outfitTag: "" });
    assert.equal(info.get(id(2)).failed, true);
  });
  it("a failing names call only loses names (ids shown), stats still used", async () => {
    const getJson = async (u) => {
      if (u.includes("/character?")) throw new Error("busy");
      if (u.includes("_by_faction")) return { characters_stat_by_faction_list: [{ character_id: id(1), stat_name: "weapon_kills", profile_id: "0", value_forever_vs: "60" }] };
      return { characters_stat_list: [{ character_id: id(1), stat_name: "weapon_play_time", profile_id: "0", value_forever: "3600" }] };
    };
    const info = await fetchCharacterInfo([id(1)], { base: censusBase(), getJson });
    assert.equal(info.get(id(1)).pace.kpm, 1);
    assert.equal(info.get(id(1)).name, "");
  });
});

describe("fetchPlayerCensus", () => {
  function fakeCensus({ missing = new Set() } = {}) {
    const calls = [];
    const getJson = async (u) => {
      calls.push(u);
      if (u.includes("characters_event_grouped")) {
        const g = [];
        for (let i = 0; i < 60; i++) g.push({ table_type: "KILL", count: String(100 - i), character_id: id(i) });
        g.push({ table_type: "DEATH", count: "500", character_id: "0" });
        return { characters_event_grouped_list: g };
      }
      const q = new URL(u).searchParams.get("character_id").split(",").filter((c) => !missing.has(c));
      if (u.includes("_by_faction")) return { characters_stat_by_faction_list: q.map((c) => ({ character_id: c, stat_name: "weapon_kills", profile_id: "0", value_forever_vs: "120", value_forever_nc: "0", value_forever_tr: "0" })) };
      if (u.includes("characters_stat?")) return { characters_stat_list: q.map((c) => ({ character_id: c, stat_name: "weapon_play_time", profile_id: "0", value_forever: "3600" })) };
      return { character_list: q.map((c) => ({ character_id: c, name: { first: `P${c.slice(-2)}` } })) };
    };
    return { calls, getJson };
  }
  it("~4 calls after resolve: killboard + batched stat/faction/names for self + top 50", async () => {
    const f = fakeCensus({ missing: new Set([id(5)]) });
    const memo = new Map();
    const r = await fetchPlayerCensus(ME, { base: censusBase(), getJson: f.getJson, topN: 50, memo });
    assert.equal(f.calls.length, 4);
    assert.equal(r.rows.length, 50);
    assert.deepEqual(r.rows[0], { name: "0", kills: 0, deaths: 500, kpm: 0 }); // environment row
    assert.deepEqual(r.rows[1], { name: "P00", kills: 100, deaths: 0, kpm: 2 });
    assert.equal(r.own.kpm, 2);
    assert.equal(r.lookups, 49);
    assert.equal(r.paceFails, 1); // id(5) unknown to Census
    // second player with the same opponents: only killboard + self lookups
    const r2 = await fetchPlayerCensus(id(70), { base: censusBase(), getJson: f.getJson, topN: 50, memo });
    assert.equal(r2.rows.length, 50);
    assert.equal(f.calls.length, 4 + 4); // misses are not memoized (id(5)) -> still one batch
  });
});

describe("tokenBucket", () => {
  it("bursts up to capacity, then waits for refill; pause() blocks everyone", async () => {
    let t = 0;
    const waits = [];
    const b = tokenBucket({ capacity: 2, perMinute: 6, now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; } });
    await b.take();
    await b.take();
    assert.equal(waits.length, 0);
    await b.take(); // needs 1 token at 6/min -> 10 s
    assert.deepEqual(waits, [10000]);
    b.pause(60000);
    await b.take();
    assert.equal(waits[1], 60000);
  });
  it("s:example is paced under its 10 req/min limit", () => {
    assert.ok(defaultCensusRate("example").perMinute < 10);
    assert.ok(defaultCensusRate("s:example").perMinute < 10);
    assert.ok(defaultCensusRate("daysetps2legends").perMinute > 10 && defaultCensusRate("daysetps2legends").perMinute <= 60);
  });
});

describe("fetchPlayerCensus partial results", () => {
  it("opponents whose batch failed are skipped (no fake 0-KPM rows); the player still loads", async () => {
    let statCalls = 0;
    const getJson = async (u) => {
      if (u.includes("characters_event_grouped")) {
        return { characters_event_grouped_list: Array.from({ length: 70 }, (_, i) => ({ table_type: "KILL", count: String(200 - i), character_id: id(i) })) };
      }
      const q = new URL(u).searchParams.get("character_id").split(",");
      if (u.includes("characters_stat?")) {
        statCalls++;
        return { characters_stat_list: q.map((c) => ({ character_id: c, stat_name: "weapon_play_time", profile_id: "0", value_forever: "60" })) };
      }
      if (u.includes("_by_faction")) return { characters_stat_by_faction_list: q.map((c) => ({ character_id: c, stat_name: "weapon_kills", profile_id: "0", value_forever_vs: "1" })) };
      return { character_list: [] };
    };
    const r = await fetchPlayerCensus(ME, { base: censusBase(), getJson, topN: 50, batch: 60 });
    assert.equal(r.rows.length, 50);
    assert.equal(r.skipped, 0);
    const failing = async (u) => (u.includes("characters_stat") ? { error: "service_unavailable" } : getJson(u));
    const r2 = await fetchPlayerCensus(ME, { base: censusBase(), getJson: failing, topN: 50 });
    assert.equal(r2.rows.length, 0);
    assert.equal(r2.skipped, 50);
    assert.equal(r2.ownFailed, true);
  });
});

describe("classifyCensus (error classification)", () => {
  it("ok lists; retry on 429/5xx/network/timeout/error JSON/empty bodies; fail on other 4xx", () => {
    assert.equal(classifyCensus({ body: { character_list: [{}], returned: 1 } }).action, "ok");
    assert.equal(classifyCensus({ body: { character_list: [], returned: 0 } }).action, "ok"); // genuine "not found"
    assert.equal(classifyCensus({ body: { character_list: [], returned: 0 }, expectData: true }).action, "retry");
    assert.equal(classifyCensus({ status: 429 }).action, "retry");
    assert.equal(classifyCensus({ status: 503 }).action, "retry");
    assert.equal(classifyCensus({ status: 404 }).action, "fail");
    assert.equal(classifyCensus({ body: { error: "service_unavailable" } }).action, "retry");
    assert.equal(classifyCensus({ body: { errorCode: "SERVER_ERROR", errorMessage: "x" } }).action, "retry");
    assert.equal(classifyCensus({ body: {} }).action, "retry");
    assert.equal(classifyCensus({ body: null }).action, "retry");
    assert.equal(classifyCensus({ error: new TypeError("Failed to fetch") }).reason, "network");
    assert.equal(classifyCensus({ error: { name: "TimeoutError" } }).reason, "timeout");
    assert.equal(classifyCensus({ error: { name: "AbortError" } }).action, "fail");
  });
});

describe("backoffDelay (exponential + jitter)", () => {
  it("doubles per attempt within [50%, 100%], capped, Retry-After wins", () => {
    assert.equal(backoffDelay(0, { random: () => 1 }), 1000);
    assert.equal(backoffDelay(0, { random: () => 0 }), 500);
    assert.equal(backoffDelay(3, { random: () => 1 }), 8000);
    assert.equal(backoffDelay(10, { random: () => 1 }), 20000);
    assert.equal(backoffDelay(0, { random: () => 1, retryAfter: "30" }), 30000);
    assert.equal(backoffDelay(0, { random: () => 1, retryAfter: "999" }), 40000);
    const vals = new Set(Array.from({ length: 20 }, () => backoffDelay(2)));
    assert.ok(vals.size > 1); // jitter
  });
});

describe("censusRequest (retries)", () => {
  const ok = { character_list: [{ character_id: "1" }], returned: 1 };
  const res = (status, body, headers = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
  });
  function seq(...answers) {
    let i = 0;
    const calls = [];
    return {
      calls,
      fetchImpl: async (url) => {
        calls.push(url);
        const a = answers[Math.min(i++, answers.length - 1)];
        if (a instanceof Error) throw a;
        return a;
      },
    };
  }
  const fast = { sleep: async () => {}, random: () => 1 };
  it("retries 503 / error JSON / network errors / bad JSON, then succeeds", async () => {
    const f = seq(res(503, {}), res(200, { error: "service_unavailable" }), new TypeError("Failed to fetch"), res(200, "{not json"), res(200, ok));
    const retries = [];
    const body = await censusRequest("u", { ...fast, fetchImpl: f.fetchImpl, onRetry: (r) => retries.push(r.reason) });
    assert.deepEqual(body, ok);
    assert.equal(f.calls.length, 5);
    assert.deepEqual(retries, ["HTTP 503", "service_unavailable", "network", "bad JSON"]);
  });
  it("honors Retry-After on 429 and pauses the shared bucket", async () => {
    const f = seq(res(429, {}, { "retry-after": "7" }), res(200, ok));
    const waits = [];
    const paused = [];
    const bucket = { take: async () => {}, pause: (ms) => paused.push(ms) };
    await censusRequest("u", { fetchImpl: f.fetchImpl, bucket, random: () => 1, sleep: async (ms) => waits.push(ms) });
    assert.deepEqual(waits, [7000]);
    assert.deepEqual(paused, [7000]);
  });
  it("gives up with CensusError kind census-busy after the retry budget", async () => {
    const f = seq(res(200, { error: "service_unavailable" }));
    await assert.rejects(
      censusRequest("u", { ...fast, fetchImpl: f.fetchImpl, retries: 2 }),
      (e) => e instanceof CensusError && e.kind === "census-busy" && /busy or down/.test(e.message)
    );
    assert.equal(f.calls.length, 3);
  });
  it("non-retryable 4xx fails at once", async () => {
    const f = seq(res(400, {}));
    await assert.rejects(censusRequest("u", { ...fast, fetchImpl: f.fetchImpl }), (e) => e.fatal === true);
    assert.equal(f.calls.length, 1);
  });
  it("expectData: an empty list is retried once, then accepted as genuinely empty", async () => {
    const empty = { characters_event_grouped_list: [], returned: 0 };
    const f = seq(res(200, empty), res(200, empty));
    assert.deepEqual(await censusRequest("u", { ...fast, fetchImpl: f.fetchImpl, expectData: true }), empty);
    assert.equal(f.calls.length, 2);
  });
  it("per-request timeout counts as a retryable failure", async () => {
    let n = 0;
    const fetchImpl = (url, { signal }) => new Promise((resolve, reject) => {
      if (n++ === 0) signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      else resolve(res(200, ok));
    });
    const reasons = [];
    const body = await censusRequest("u", { ...fast, fetchImpl, timeoutMs: 20, onRetry: (r) => reasons.push(r.reason) });
    assert.deepEqual(body, ok);
    assert.deepEqual(reasons, ["timeout"]);
  });
  it("a user abort stops immediately (no retries)", async () => {
    const ctl = new AbortController();
    ctl.abort();
    await assert.rejects(censusRequest("u", { ...fast, signal: ctl.signal, fetchImpl: async () => res(200, ok) }), (e) => e.name === "AbortError");
  });
});

describe("limitConcurrency", () => {
  it("never runs more than n tasks at once", async () => {
    const limit = limitConcurrency(2);
    let active = 0;
    let peak = 0;
    const task = () => limit(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return 1;
    });
    const out = await Promise.all(Array.from({ length: 7 }, task));
    assert.equal(out.length, 7);
    assert.equal(peak, 2);
  });
});
