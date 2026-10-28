import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { detectScrims, finalWindow, upsertScrims, mirrorRow, scrimRow, compactEvent, eventsUrl, mergeEvents, SCRIM_RULE, EVENT_PAGE } from "../scrims.mjs";
import { visit } from "../scripts/ps-scrims.mjs";

const fx = JSON.parse(fs.readFileSync(new URL("./fixtures/scrim-royaigreenberet.json", import.meta.url), "utf8"));
const GIMME = "5429365615044405249";

test("RoyaIGreenBeret vs GimmeDatAnchor (Census, 2026-10-22) is one 1v1 scrim, 15–14", () => {
  const s = detectScrims(fx.events, fx.cid);
  assert.equal(s.length, 1);
  const [x] = s;
  assert.equal(x.kind, "1v1");
  assert.equal(x.opp.length, 1);
  assert.equal(x.opp[0].id, GIMME);
  assert.equal(x.k, 15);
  assert.equal(x.d, 14);
  assert.equal(x.z, 2); // Indar
  assert.equal(x.myW, 7254); // MSW-R
  assert.equal(x.theirW, 7236); // LA1 Anchor
  assert.equal(x.n, 2); // two other-player events inside the scrim's time
  assert.ok(x.focus > 0.9);
});

test("ordinary fighting with a frequent rival is not a scrim", () => {
  // 12 events with one rival spread over a busy hour full of other kills and deaths.
  const ev = [];
  let t = 1_000_000;
  for (let i = 0; i < 120; i++) {
    t += 30;
    const rival = i % 10 === 0;
    ev.push([t, i % 3 ? 1 : 0, rival ? "777" : String(10_000 + i), 1, 0, 2, 0, 0, 0]);
  }
  assert.deepEqual(detectScrims(ev, "1"), []);
});

test("small-group scrim: two opponents trading with one player", () => {
  const ev = [];
  let t = 2_000_000;
  for (let i = 0; i < 24; i++) { t += 45; ev.push([t, i % 2, i % 3 ? "201" : "202", 5, 0, 6, 0, 0, 0]); }
  ev.push([t + 30, 1, "999", 5, 0, 6, 0, 0, 0]);
  const s = detectScrims(ev, "1");
  assert.equal(s.length, 1);
  assert.equal(s[0].kind, "group");
  assert.deepEqual(s[0].opp.map((o) => o.id).sort(), ["201", "202"]);
});

test("suicides and the player's own id are ignored", () => {
  const ev = fx.events.concat([[1792646000, 0, fx.cid, 0, 0, 2, 0, 0, 0], [1792646001, 0, "0", 0, 0, 2, 0, 0, 0]]);
  const [x] = detectScrims(ev, fx.cid);
  assert.equal(x.k + x.d, 29);
});

test("finalWindow cuts only at silences longer than GAP", () => {
  const G = SCRIM_RULE.GAP;
  const asc = [[0], [100], [100 + G + 1], [200 + G], [300 + 3 * G]].map((x) => [x[0], 1, "2"]);
  assert.deepEqual(finalWindow(asc, { oldOpen: false, newOpen: false }), { lo: 0, hi: 5 });
  assert.deepEqual(finalWindow(asc, { oldOpen: true, newOpen: false }), { lo: 2, hi: 5 });
  assert.deepEqual(finalWindow(asc, { oldOpen: false, newOpen: true }), { lo: 0, hi: 4 });
  assert.deepEqual(finalWindow(asc, { oldOpen: true, newOpen: true }), { lo: 2, hi: 4 });
  assert.equal(finalWindow([[0, 1, "2"], [10, 1, "2"]], { oldOpen: true, newOpen: false }), null);
});

test("upsertScrims keeps one row per scrim (bigger wins, own copy on a tie)", () => {
  const a = { t0: 100, t1: 900, o: [["us-2", "B", 5, 4]], k: 5, d: 4, n: 0, z: 2, w: [1, 2] };
  const list = [];
  assert.equal(upsertScrims(list, [a]), 1);
  const mirrorTie = { ...a, m: 1 };
  assert.equal(upsertScrims(list, [mirrorTie]), 0);
  assert.equal(list[0].m, undefined);
  const bigger = { ...a, t0: 50, k: 6 };
  assert.equal(upsertScrims(list, [bigger]), 1);
  assert.equal(list.length, 1);
  assert.equal(list[0].k, 6);
  assert.equal(upsertScrims(list, [{ ...a, t0: 10_000, t1: 11_000 }]), 1);
  assert.equal(list.length, 2);
  assert.equal(list[0].t0, 10_000);
});

test("mirrorRow flips the score and weapons for the opponent's file", () => {
  const [s] = detectScrims(fx.events, fx.cid);
  const row = scrimRow(s, (id) => ({ key: `us-${id}`, name: id === GIMME ? "[LA1a] GimmeDatAnchor" : "" }));
  const m = mirrorRow(row, { key: "us-" + fx.cid, name: "[NO1R] RoyaIGreenBeret" });
  assert.deepEqual([m.k, m.d], [14, 15]);
  assert.deepEqual(m.w, [7236, 7254]);
  assert.deepEqual(m.o, [["us-" + fx.cid, "[NO1R] RoyaIGreenBeret", 14, 15]]);
  assert.equal(m.m, 1);
});

test("compactEvent and eventsUrl", () => {
  const k = compactEvent({ timestamp: "5", table_type: "kills", character_id: "9", attacker_character_id: "1", attacker_weapon_id: "7254", is_headshot: "1", zone_id: "2", attacker_loadout_id: "12", character_loadout_id: "6", attacker_vehicle_id: "0" }, "1");
  assert.deepEqual(k, [5, 1, "9", 7254, 1, 2, 12, 6, 0]);
  const d = compactEvent({ timestamp: "6", table_type: "deaths", character_id: "1", attacker_character_id: "9", attacker_weapon_id: "7236", is_headshot: "0", zone_id: "2", attacker_loadout_id: "21", character_loadout_id: "12" }, "1");
  assert.deepEqual(d, [6, 0, "9", 7236, 0, 2, 12, 21, 0]);
  assert.equal(eventsUrl("B/", "1", { before: 99 }), `B/characters_event/?character_id=1&type=KILL,DEATH&c:limit=${EVENT_PAGE}&before=99`);
  assert.equal(mergeEvents([k, d], [d]).length, 2);
});

/* Pipeline rounds against a fake Census: no scrim may be split, double counted or lost. */
function fakeHistory() {
  const ev = [];
  let t = 1_600_000_000;
  let id = 50_000;
  const scrims = [];
  for (let s = 0; s < 30; s++) {
    // a busy session: 150–300 events against many players, then sometimes a scrim, then a silence
    const n = 150 + (s * 37) % 150;
    for (let i = 0; i < n; i++) { t += 20 + (i % 7) * 5; ev.push({ timestamp: String(t), table_type: i % 2 ? "kills" : "deaths", character_id: i % 2 ? String(id++) : "1", attacker_character_id: i % 2 ? "1" : String(id++), attacker_weapon_id: "80" }); }
    if (s % 3 === 0) {
      const opp = String(900 + s), len = 20 + s;
      let k = 0;
      for (let i = 0; i < len; i++) {
        t += 50;
        const kill = (i * 7 + s) % 3 !== 0;
        if (kill) k++;
        ev.push({ timestamp: String(t), table_type: kill ? "kills" : "deaths", character_id: kill ? opp : "1", attacker_character_id: kill ? "1" : opp, attacker_weapon_id: "7254", zone_id: "2" });
      }
      scrims.push({ opp, k, d: len - k });
    }
    t += 3600 * (1 + (s % 5)); // silence
  }
  ev.sort((a, b) => +b.timestamp - +a.timestamp);
  const get = async (url) => {
    const before = +(/before=(\d+)/.exec(url)?.[1] || Infinity);
    return { characters_event_list: ev.filter((e) => +e.timestamp < before).slice(0, EVENT_PAGE) };
  };
  return { ev, get, scrims, end: t };
}

test("pipeline rounds: first visit, then older history, then new events — every scrim once, whole", async () => {
  const h = fakeHistory();
  const st = {};
  const found = [];
  const add = (r) => found.push(...r.scrims);
  add(await visit(st, { base: "B/", cid: "1", mode: "first", now: h.end, get: h.get, pages: 1 }));
  assert.ok(st.old > 0 && st.fwd > 0 && !st.done);
  let guard = 0;
  while (!st.done && guard++ < 50) add(await visit(st, { base: "B/", cid: "1", mode: "back", now: h.end, get: h.get, pages: 1 }));
  assert.ok(st.done);
  const want = h.scrims.map((s) => `${s.opp} ${s.k}-${s.d}`).sort();
  const got = found.map((s) => `${s.opp[0].id} ${s.k}-${s.d}`).sort();
  assert.deepEqual(got, want);
  // A new visit with nothing new finds nothing again.
  const again = await visit(st, { base: "B/", cid: "1", mode: "new", now: h.end + 99_999, get: h.get });
  assert.equal(again.scrims.length, 0);
});

test("pipeline: a player still playing keeps the open session for the next visit", async () => {
  const h = fakeHistory();
  const last = +h.ev[0].timestamp;
  const st = {};
  const r = await visit(st, { base: "B/", cid: "1", mode: "first", now: last + 60, get: h.get, pages: 2 });
  assert.ok(st.fwd < last, "the session still running is not final yet");
  const later = await visit(st, { base: "B/", cid: "1", mode: "new", now: last + 99_999, get: h.get });
  const all = [...r.scrims, ...later.scrims].map((s) => s.opp[0].id);
  assert.equal(new Set(all).size, all.length, "no scrim twice");
  assert.ok(all.includes(h.scrims[h.scrims.length - 1].opp), "the newest scrim is found once the player is done");
});

/* UI: the Latest 100 folds a scrim into one row; the Scrims tab reads the live page the same way. */
import { groupFeedScrims, scrimChunkHtml, summarizeKillFeed } from "../kill-feed.mjs";
import { liveScrims, scrimTotals, zoneName } from "../scrims-panel.mjs";

const feedRows = () => fx.events.map((x) => ({
  at: x[0] * 1000, kill: !!x[1], suicide: x[2] === fx.cid, teamkill: false, headshot: !!x[4],
  otherId: x[2], name: x[2] === GIMME ? "GimmeDatAnchor" : x[2] === fx.cid ? "" : "P" + x[2].slice(-4), tag: x[2] === GIMME ? "LA1a" : "", fac: "nc", weapon: "", vehicle: "",
})).sort((a, b) => b.at - a.at);

test("Latest 100 (PS): the scrim is one folded row at its newest kill, other players stay outside", () => {
  const rows = feedRows();
  const g = groupFeedScrims(rows, fx.cid);
  assert.equal(g.scrims.length, 1);
  assert.equal(g.inScrim, 29);
  const chunks = g.items.filter((it) => it.scrim);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].rows.length, 29);
  assert.equal(g.items.length, rows.length - 29 + 1);
  assert.equal(g.items[0].r.otherId, "5428406084400988449", "the newer death to someone else stays first");
  assert.ok(g.items[1].scrim, "the scrim row comes right after it");
  const html = scrimChunkHtml(chunks[0], fx.events[0][0] * 1000 + 60_000, null, "2", 0);
  assert.match(html, /^<tr class="kf-scr-row kf-scr-won" data-scr="0"><td class="rk-num"><button type="button" class="kf-caret" aria-expanded="false"/);
  assert.match(html, /🥊 Scrim/);
  assert.match(html, /data-name="GimmeDatAnchor"/);
  assert.match(html, /scr-won">Won<\/span> 15–14 · 36 min/);
  assert.equal((html.match(/<tr data-of="0" class="kf-row[^"]* kf-sub-row" hidden>/g) || []).length, 29, "the 29 rows follow it, hidden until ▸");
  assert.equal((html.match(/<td/g) || []).length, 30 * 6, "every row has the table's 6 cells");
  // Summary numbers leave the scrim out.
  const inScrim = new Set(chunks[0].rows);
  const rest = rows.filter((r) => !inScrim.has(r));
  assert.equal(rest.length, rows.length - 29);
  const all = summarizeKillFeed(rows), s = summarizeKillFeed(rest);
  assert.deepEqual([all.kills - s.kills, all.deaths - s.deaths], [15, 14]);
});

test("Latest 100 without a scrim is unchanged", () => {
  const rows = feedRows().filter((r) => r.otherId !== GIMME);
  const g = groupFeedScrims(rows, fx.cid);
  assert.equal(g.scrims.length, 0);
  assert.equal(g.items.length, rows.length);
});

test("Scrims tab: live page → stored-row shape with names; totals; continent names", () => {
  const list = fx.events.map((x) => ({ timestamp: String(x[0]), table_type: x[1] ? "kills" : "deaths", character_id: x[1] ? x[2] : fx.cid, attacker_character_id: x[1] ? fx.cid : x[2], attacker_weapon_id: String(x[3]), zone_id: String(x[5]) }));
  const r = liveScrims({ characters_event_list: list }, fx.cid, "us", (k) => (k === "us-" + GIMME ? "[LA1a] GimmeDatAnchor" : ""));
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.rows[0].o, [["us-" + GIMME, "[LA1a] GimmeDatAnchor", 15, 14]]);
  assert.deepEqual([r.rows[0].k, r.rows[0].d, r.rows[0].z], [15, 14, 2]);
  assert.deepEqual(r.ids, [GIMME]);
  assert.deepEqual(scrimTotals([{ k: 15, d: 14 }, { k: 3, d: 9 }, { k: 5, d: 5 }]), { n: 3, won: 1, lost: 1, draw: 1 });
  assert.equal(zoneName(2), "Indar");
  assert.equal(zoneName((7 << 16) | 344), "Oshur");
  assert.equal(zoneName(96), "–");
});

test("Scrims tab: PS only, one player, inside the tracker tabs, data from data-ps/scrims/", () => {
  const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(index, /<details id="scrimsSection" class="dist-section scr-section" hidden>/);
  const a = index.indexOf('id="killFeedSection"'), b = index.indexOf('id="scrimsSection"'), c = index.indexOf('id="weaponsSection"');
  assert.ok(a < b && b < c);
  assert.match(index.slice(b, c), /class="ranks-table scr-table"/);
  const st = fs.readFileSync(new URL("../stats-table.mjs", import.meta.url), "utf8");
  assert.match(st, /scrimsPanel\.setPlayers\(\$\.IS_PS && !\$\.LIVE_MODE \? shownList : null\)/);
  assert.match(st, /scrims: \(\) => \$\.IS_PS/);
  const panel = fs.readFileSync(new URL("../scrims-panel.mjs", import.meta.url), "utf8");
  assert.match(panel, /\$\{dataDir\}scrims\/\$\{key\}\.json/);
  assert.doesNotMatch(panel + fs.readFileSync(new URL("../kill-feed.mjs", import.meta.url), "utf8"), /cheat|padd/i);
});

/* 🥊 Room-wide top list (no single player on the page). */
import { buildTopScrims } from "../scripts/ps-scrims.mjs";

test("room list: each scrim once (both players' copies), told by the winner, all kept, biggest first", () => {
  const A = { v: 1, key: "us-1", name: "Alpha", from: 1, done: true, scrims: [
    { t0: 100, t1: 900, o: [["us-2", "Bravo", 14, 15]], k: 14, d: 15, n: 0, z: 2, w: [7, 8] },
    { t0: 5000, t1: 6000, o: [["us-3", "Farm", 300, 0]], k: 300, d: 0, n: 0, z: 2, w: [7, 0] },
    { t0: 9000, t1: 9900, o: [["us-4", "C", 20, 10], ["us-5", "D", 15, 15]], k: 35, d: 25, n: 1, z: 6, w: [7, 9] },
  ] };
  const B = { v: 1, key: "us-2", name: "Bravo", from: 1, done: false, scrims: [
    { t0: 100, t1: 900, o: [["us-1", "Alpha", 15, 14]], k: 15, d: 14, n: 3, z: 2, w: [8, 7] },
  ] };
  const top = buildTopScrims([A, B]);
  assert.equal(top.total, 3);
  assert.equal(top.rows[0].k, 300, "one-sided farms are listed too");
  assert.deepEqual([top.players, top.done], [2, 1]);
  assert.equal(top.rows[1].o.length, 2, "the 60-kill group scrim is bigger than the 29-kill 1v1");
  const duel = top.rows[2];
  assert.deepEqual(duel.p, ["us-2", "Bravo"], "1v1 told from the winner's side");
  assert.deepEqual([duel.k, duel.d, duel.w], [15, 14, [8, 7]]);
});

test("Scrims tab shows the room's top list when not exactly one PS player is on the page", () => {
  const panel = fs.readFileSync(new URL("../scrims-panel.mjs", import.meta.url), "utf8");
  assert.match(panel, /\$\{dataDir\}scrims-top\.json/);
  assert.match(panel, /const one = list\.length === 1 && list\[0\] && list\[0\]\.cid \? list\[0\] : TOP;/);
  const st = fs.readFileSync(new URL("../stats-table.mjs", import.meta.url), "utf8");
  assert.match(st, /scrimsPanel\.setPlayers\(\$\.IS_PS && !\$\.LIVE_MODE \? shownList : null\)/);
});
