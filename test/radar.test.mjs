// 🛰️ PS2 Radar second opinion (radar.mjs + scripts/radar-lookup.mjs): daily cap,
// 3-day recheck, 2–3 s spacing, 429/503 + Retry-After backoff, 404 = not stored,
// badge / priority only (never hides or flags), links only on build-log.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RADAR_RULE, RADAR_USER_AGENT, radarProfileUrl, radarApiUrl, radarEntry, radarBadge, radarPriority, pickDue, retryAfterMs } from "../radar.mjs";
import { runPass, lookupOne } from "../scripts/radar-lookup.mjs";
import { reviewStatus } from "../scripts/build-ranks.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DAY = 86400000;
const ok = (player) => ({ status: 200, headers: { get: () => null }, json: async () => ({ api_version: 1, player }) });
const res = (status, ra = null) => ({ status, headers: { get: (k) => (k.toLowerCase() === "retry-after" ? ra : null) }, json: async () => ({ detail: "x" }) });
const P = (slug, cid) => ({ slug, name: slug, cid, lists: ["red"] });

describe("radar.mjs", () => {
  it("links and API urls use the character id", () => {
    assert.equal(radarProfileUrl("5429845372588791105"), "https://ps2radar.com/#/player/5429845372588791105");
    assert.equal(radarProfileUrl(""), "");
    assert.equal(radarProfileUrl("abc"), "");
    assert.equal(radarApiUrl({ cid: "5429845372588791105" }), "https://ps2radar.com/api/v1/players/5429845372588791105");
    assert.equal(radarApiUrl({ name: "[LHEU] Megatake" }), "https://ps2radar.com/api/v1/players/Megatake");
    assert.match(RADAR_USER_AGENT, /ps2-elite-kd/);
  });
  it("entries: tier, sus, moderator mark; 404 = not stored", () => {
    const e = radarEntry({ player: { character_id: "1", name: "manimami", classification: { tier: "confirmed", label: "Confirmed", source: "mark" }, model: { tier: "suspect", blatant: true, sus_score: 100, assessed_at: 5 }, mark: { kind: "confirmed", at: 1791543967 }, server: { name: "Wainwright" } } }, { slug: "manimami" });
    assert.deepEqual([e.stored, e.tier, e.modelTier, e.sus, e.mark, e.server], [true, "confirmed", "suspect", 100, "confirmed", "Wainwright"]);
    assert.equal(radarPriority(e), true);
    assert.equal(radarBadge(e).text, "Confirmed");
    const nf = radarEntry(null, { status: 404, slug: "add1ti0nal", cid: "9" });
    assert.equal(nf.stored, false);
    assert.equal(radarBadge(nf).text, "not stored");
    assert.equal(radarPriority(nf), false);
    const cleared = radarEntry({ player: { mark: { kind: "cleared", at: 1 }, model: { tier: "watch", sus_score: 30 } } });
    assert.equal(radarPriority(cleared), false);
    assert.equal(radarBadge(cleared).text, "Cleared");
    assert.equal(radarBadge(radarEntry({ player: { model: { tier: "watch", sus_score: 32 } } })).text, "watch · Sus 32");
    assert.equal(radarBadge(null), null);
  });
  it("pickDue: never-checked first, skips checks younger than 3 days, respects the cap", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    const review = [P("a", "1"), P("b", "2"), P("c", "3"), P("d", "4")];
    const cache = { players: { a: { checkedAt: new Date(now - 1 * DAY).toISOString() }, b: { checkedAt: new Date(now - 4 * DAY).toISOString() }, c: { checkedAt: new Date(now - 5 * DAY).toISOString() } } };
    assert.deepEqual(pickDue(review, cache, { now }).map((r) => r.slug), ["d", "c", "b"]);
    assert.deepEqual(pickDue(review, cache, { now, left: 2 }).map((r) => r.slug), ["d", "c"]);
    assert.deepEqual(pickDue(review, cache, { now, left: 0 }), []);
  });
  it("Retry-After: seconds or HTTP date", () => {
    assert.equal(retryAfterMs("7"), 7000);
    assert.equal(retryAfterMs(null), null);
    assert.equal(retryAfterMs(new Date(Date.parse("2026-01-01T00:00:10Z")).toUTCString(), Date.parse("2026-01-01T00:00:00Z")), 10000);
  });
});

describe("radar-lookup pass", () => {
  it("≤ 50/day, 2–3 s apart, identifying UA, one pass per UTC day", async () => {
    let t = Date.parse("2026-10-10T12:00:00Z");
    const waits = [], calls = [];
    const review = Array.from({ length: 70 }, (_, i) => P("p" + i, String(10000 + i)));
    const fetchImpl = async (url, opts) => { calls.push({ url, ua: opts.headers["User-Agent"] }); return ok({ character_id: url.split("/").pop(), model: { tier: "watch", sus_score: 10 } }); };
    const cache = { players: {} };
    const st = await runPass(review, cache, { now: () => t, fetchImpl, wait: async (ms) => { waits.push(ms); t += ms; }, log: () => {}, budgetMs: 1e9 });
    assert.equal(calls.length, RADAR_RULE.DAILY_CAP);
    assert.ok(calls.every((c) => c.ua === RADAR_USER_AGENT));
    assert.ok(waits.every((w) => w >= 2000 && w <= 3000), "spacing 2–3 s");
    assert.equal(waits.length, RADAR_RULE.DAILY_CAP - 1);
    assert.equal(cache.dayCount, 50);
    assert.equal(cache.passDone, true);
    assert.equal(st.ok, 50);
    // Same day: nothing more.
    const again = await runPass(review, cache, { now: () => t, fetchImpl, wait: async () => {}, log: () => {} });
    assert.equal(again.skipped, true);
    assert.equal(calls.length, 50);
    // Next day: the 20 never-checked ones only (rest are < 3 days old).
    t += DAY;
    await runPass(review, cache, { now: () => t, fetchImpl, wait: async () => {}, log: () => {} });
    assert.equal(calls.length, 70);
    t += DAY;
    const third = await runPass(review, cache, { now: () => t, fetchImpl, wait: async () => {}, log: () => {} });
    assert.equal(third.looked, 0, "all checked within 3 days");
  });
  it("404 → not stored is cached; 429 honours Retry-After then succeeds", async () => {
    const waits = [];
    let n = 0;
    const fetchImpl = async () => (++n === 1 ? res(429, "12") : ok({ character_id: "1", model: { tier: "watch" } }));
    const r = await lookupOne({ slug: "x", cid: "12345" }, { fetchImpl, wait: async (ms) => waits.push(ms) });
    assert.equal(r.status, 200);
    assert.equal(waits[0], 12000);
    const cache = { players: {} };
    await runPass([P("gone", "55555")], cache, { fetchImpl: async () => ({ status: 404, headers: { get: () => null }, json: async () => ({ detail: "Player not stored." }) }), wait: async () => {}, log: () => {} });
    assert.equal(cache.players.gone.stored, false);
  });
  it("stops the day's pass when the radar stays busy (no hammering), continues next run", async () => {
    let calls = 0;
    const cache = { players: {} };
    const st = await runPass([P("a", "11111"), P("b", "22222"), P("c", "33333")], cache, { fetchImpl: async () => { calls++; return res(503); }, wait: async () => {}, log: () => {} });
    assert.equal(st.stopped, "radar busy (429/503)");
    assert.equal(calls, 2 * (RADAR_RULE.MAX_RETRIES + 1));
    assert.equal(cache.passDone, true, "skipped for the rest of the day");
    assert.ok(cache.unavailableSince);
    assert.equal(Object.keys(cache.players).length, 0);
  });
  it("API gone (network error / bare 404 / HTML): skipped quietly, cached answers kept as a record", async () => {
    const old = { slug: "manimami", stored: true, mark: "confirmed", checkedAt: "2026-10-01T00:00:00.000Z" };
    for (const fetchImpl of [
      async () => { throw new TypeError("fetch failed"); },
      async () => ({ status: 404, headers: { get: () => null }, json: async () => { throw new SyntaxError("html"); } }),
      async () => ({ status: 200, headers: { get: () => null }, json: async () => ({ hello: 1 }) }),
    ]) {
      const cache = { players: { manimami: { ...old } } };
      const t = Date.parse("2026-10-10T12:00:00Z");
      const st = await runPass([P("a", "11111"), P("b", "22222"), P("c", "33333")], cache, { now: () => t, fetchImpl, wait: async () => {}, log: () => {} });
      assert.ok(st.stopped.startsWith("radar unavailable"), st.stopped);
      assert.equal(st.looked, 2);
      assert.equal(cache.passDone, true);
      assert.equal(cache.unavailableSince, "2026-10-10T12:00:00.000Z");
      assert.deepEqual(cache.players.manimami, old);
      // Keeps the first failure date; a later success clears it.
      cache.day = "2026-10-09";
      await runPass([P("a", "11111"), P("b", "22222")], cache, { now: () => t + 86400000, fetchImpl, wait: async () => {}, log: () => {} });
      assert.equal(cache.unavailableSince, "2026-10-10T12:00:00.000Z");
      cache.day = "x";
      await runPass([P("a", "11111")], cache, { now: () => t + 2 * 86400000, fetchImpl: async () => ok({ model: { tier: "watch" } }), wait: async () => {}, log: () => {} });
      assert.equal(cache.unavailableSince, undefined);
    }
  });
  it("nothing but build-log reads radar.json / radar.mjs (flags, hide list, review, rankings never depend on it)", () => {
    const files = ["app.js", "index.html", "ranks.html", "misc.html", "red-flags.mjs", "bins.mjs", "padding.mjs", "hidden.mjs", "outlier-guard.mjs", "session-forensics.mjs", "player-metrics.mjs", "scripts/build-ranks.mjs", "scripts/refresh-cache.mjs", "scripts/discovery.mjs"];
    for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(root, f), "utf8"), /radar\.json|radar\.mjs|ps2radar/i, f);
  });
});

describe("review list + build-log wiring", () => {
  it("reviewStatus collects every review list with ids, in priority order", () => {
    const players = [
      { slug: "pad", name: "Pad", cid: "3", patterns: ["padding"] },
      { slug: "hid", name: "Hid", cid: "4", patterns: [], hidden: true },
      { slug: "aim", name: "Aim", cid: "1", patterns: ["aim"] },
      { slug: "out", name: "Out", cid: "2", patterns: [] },
      { slug: "fine", name: "Fine", cid: "9", patterns: [] },
    ];
    const r = reviewStatus(players, { players: [{ slug: "out" }] }, { players: {} }, [{ slug: "bot", name: "Bot", cid: "5" }]);
    assert.deepEqual(r.players.map((p) => p.slug), ["aim", "out", "bot", "pad", "hid"]);
    assert.deepEqual(r.players.find((p) => p.slug === "bot").lists, ["farm"]);
  });
  it("PS2 Radar links only on build-log, never on public pages", () => {
    const bl = fs.readFileSync(path.join(root, "build-log.html"), "utf8");
    assert.match(bl, /radarCell\(r\.slug, r\.cid\)/);
    for (const f of ["index.html", "ranks.html", "misc.html", "app.js"]) assert.doesNotMatch(fs.readFileSync(path.join(root, f), "utf8"), /ps2radar|radar\.mjs/i, f);
  });
  it("the workflow runs the lookup outside on-demand runs and keeps radar.json", () => {
    const wf = fs.readFileSync(path.join(root, ".github/workflows/refresh-cache.yml"), "utf8");
    assert.match(wf, /node scripts\/radar-lookup\.mjs/);
    assert.match(wf, /keep="[^"]*radar\.json/);
  });
});
