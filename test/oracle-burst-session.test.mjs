// #81: Oracle burst-tier rows link the Honu session itself (oracle-honu job resolves it).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pickSession, runHonuJob } from "../oracle-worker/honu-job.mjs";

const iso = (t) => new Date(t * 1000).toISOString();

test("pickSession: the session overlapping the alert window, most kills first; none → null", () => {
  const from = 1_800_000_000, to = from + 5400;
  const list = [
    { id: 1, start: iso(from - 90_000), end: iso(from - 80_000), kills: 900 },         // days before
    { id: 2, start: iso(from - 600), end: iso(from + 1200), kills: 40 },                // overlaps
    { id: 3, start: iso(from + 1500).replace("Z", ""), end: null, kills: 120 },          // no Z, still running
    { id: 4, start: iso(to + 3600), end: iso(to + 7200), kills: 999 },                  // after
  ];
  assert.equal(pickSession(list, from, to, to + 100), "3");
  assert.equal(pickSession(list.slice(0, 2), from, to), "2");
  assert.equal(pickSession([list[0], list[3]], from, to), null);
  assert.equal(pickSession(null, from, to), null);
});

test("runHonuJob: burst outliers get .session from character/{cid}/sessions; other tiers don't", async () => {
  const START = 1_800_000_000, END = START + 5400;
  let ingested = null;
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    seen.push(u);
    if (u === "https://oracle/honu/queue") return new Response(JSON.stringify({ pop: [], reports: [{ key: "1-2-5", world: 1, zone: 2, instance_id: 5, start_ts: START, end_ts: END, dur: 90 }] }));
    if (u.includes("/alerts/time/block")) return new Response(JSON.stringify([{ id: 9, worldID: 1, zoneID: 2, instanceID: 5, timestamp: iso(START) }]));
    if (u.includes("/alerts/9/participants")) return new Response(JSON.stringify({
      entries: [{ characterID: "5428000000000000001", kills: 30, deaths: 2, secondsOnline: 300 },   // burst: KPM 6 in 5 min
        { characterID: "5428000000000000002", kills: 300, deaths: 20, secondsOnline: 4500 }],       // confirmed
      characters: [{ id: "5428000000000000001", name: "Zap", factionID: 1 }, { id: "5428000000000000002", name: "Ace", factionID: 2 }],
    }));
    if (u.includes("/character/5428000000000000001/sessions")) return new Response(JSON.stringify([{ id: 77, start: iso(START + 60), end: iso(START + 700), kills: 60 }]));
    if (u.startsWith("https://oracle/honu/radar")) return new Response(JSON.stringify({ radar: {}, looked_today: 99 }));
    if (u === "https://oracle/honu/ingest") { ingested = JSON.parse(init.body); return new Response("{}"); }
    throw new Error("unexpected " + u);
  };
  await runHonuJob({ api: "https://oracle", key: "k", fetchImpl, log: () => {}, gapMs: { honu: 0, radar: 0 } });
  const outs = ingested.reports[0].report.outliers;
  const zap = outs.find((o) => o.name === "Zap"), ace = outs.find((o) => o.name === "Ace");
  assert.equal(zap.severity, "burst");
  assert.equal(zap.session, "77");
  assert.equal(ace.session, undefined);
  assert.equal(seen.filter((u) => u.includes("/sessions")).length, 1, "only burst rows cost a sessions call");
});

test("build-log: the Worker-resolved session wins over the stored match and the profile", () => {
  const html = readFileSync(new URL("../build-log.html", import.meta.url), "utf8");
  assert.match(html, /const m = o\.session \? \{ session: o\.session \} : matchBurstSession\(stored, o\.cid,/);
});
