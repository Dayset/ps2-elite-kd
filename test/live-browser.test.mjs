// test-select-reaches: live.html live.mjs live-sprites.mjs styles.css
// 🎥 live.html in a real (headless) Chromium: Census and the event stream are faked in the page, events are pushed in,
// and the overlay is checked as a viewer would see it — 8 lines, weapon names + headshot marks, plain inf/zerg numbers,
// and (owner 2026-10-24: the overlay used ~25 % of a 9850X3D) no endless animation and no SVG filter left running.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tierLabel } from "../live-model.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const chrome = ["google-chrome", "chromium", "chromium-browser", "google-chrome-stable"].find((b) => {
  try { execFileSync("which", [b], { stdio: "ignore" }); return true; } catch { return false; }
});

// Real cached names, so the emojis have fills and glows.
const ranks = JSON.parse(fs.readFileSync(path.join(root, "data", "ranks.json"), "utf8"));
const ci = (c) => ranks.cols.indexOf(c);
const named = ranks.rows.filter((r) => typeof r[ci("adjs")] === "number").sort((a, b) => b[ci("adjs")] - a[ci("adjs")]);
const pick = Array.from({ length: 8 }, (_, i) => named[Math.floor((i / 8) * named.length * 0.5)][ci("name")]);
const ME = { cid: "5428000000000000001", name: pick[0] };
const OPP = pick.slice(1).map((name, i) => ({ cid: String(5428000000000000100n + BigInt(i)), name }));
// A real sub-0 player from the cache (typical of the bottom quartile, not the extreme tail).
const sub0row = ranks.rows.find((r) => { const a = r[ci("adjs")]; return typeof a === "number" && a < -100 && a > -600; });
const SUB0 = { cid: "5428000000000000200", name: sub0row[ci("name")] };
const adjsOf = (name) => ranks.rows.find((r) => r[ci("name")] === name)[ci("adjs")];
const ME_ADJS = adjsOf(ME.name);
const TEAM = { cid: "5428000000000000999", name: "TeamMate" }; // same faction as ME (stub returns "1" for it)
const SLOW = { cid: "5428000000000000777", name: "Slowpoke" }; // #76: its Census lookup takes 1.5 s
// #80: data/cid-names.json is stubbed. MAPPED = a cached player the map knows with faction: zero Census calls (its Census
// reply is held 5 s, so a name shown sooner came from the map). HALF = in the map without faction: name at once, faction
// from a 1.5 s Census call. NOBODY = in neither: Census finds nothing, the cell must show "?" (never "…" or a raw #id).
const MAPPED = { cid: "5428000000000000555", name: named[Math.floor(named.length * 0.6)][ci("name")] };
const HALF = { cid: "5428000000000000556", name: "HalfMapped" };
const NOBODY = { cid: "5428000000000000404" };

/** Page-side fakes: Census REST (character lookups) and the push stream (window.__fakeWs.emit(payload)). */
const FAKES = `(() => {
  const ME = ${JSON.stringify(ME)}, OPP = ${JSON.stringify(OPP)}, SUB0 = ${JSON.stringify(SUB0)}, TEAM = ${JSON.stringify(TEAM)}, SLOW = ${JSON.stringify(SLOW)};
  const MAPPED = ${JSON.stringify(MAPPED)}, HALF = ${JSON.stringify(HALF)};
  window.__censusCalls = [];
  const byCid = new Map([[ME.cid, ME], [SUB0.cid, SUB0], [TEAM.cid, TEAM], [SLOW.cid, SLOW], ...OPP.map((o) => [o.cid, o])]);
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const u = decodeURIComponent(typeof input === "string" ? input : input.url);
    if (/(^|\\/)data\\/cid-names\\.json/.test(u)) return Promise.resolve(json({ [MAPPED.cid]: [MAPPED.name, "nc"], [HALF.cid]: HALF.name }));
    if (u.includes("census.daybreakgames.com")) {
      if (/character\\?name\\.first_lower=/.test(u)) return Promise.resolve(json({ returned: 1, character_list: [{ character_id: ME.cid, name: { first: ME.name }, faction_id: "1" }] }));
      const m = u.match(/character_id=(\\d+)/);
      if (m) window.__censusCalls.push(m[1]);
      if (m && m[1] === MAPPED.cid) return new Promise((r) => setTimeout(() => r(json({ returned: 1, character_list: [{ character_id: MAPPED.cid, name: { first: MAPPED.name }, faction_id: "2" }] })), 5000));
      if (m && m[1] === HALF.cid) return new Promise((r) => setTimeout(() => r(json({ returned: 1, character_list: [{ character_id: HALF.cid, name: { first: HALF.name }, faction_id: "2" }] })), 1500));
      if (m && m[1] === SLOW.cid) return new Promise((r) => setTimeout(() => r(json({ returned: 1, character_list: [{ character_id: SLOW.cid, name: { first: SLOW.name }, faction_id: "2" }] })), 1500));
      if (m && byCid.has(m[1])) { const p = byCid.get(m[1]); return Promise.resolve(json({ returned: 1, character_list: [{ character_id: p.cid, name: { first: p.name }, faction_id: p.cid === TEAM.cid ? "1" : "2" }] })); }
      return Promise.resolve(json({ returned: 0, character_list: [] }));
    }
    if (/workers\\.dev|honu|ps2radar/.test(u)) return Promise.resolve(new Response("", { status: 404 }));
    return realFetch(input, init);
  };
  class FakeWs {
    constructor() { window.__fakeWs = this; this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 0); }
    send() {}
    close() { this.readyState = 3; this.onclose && this.onclose(); }
    emit(payload) { this.onmessage && this.onmessage({ data: JSON.stringify({ type: "serviceMessage", service: "event", payload }) }); }
  }
  FakeWs.CONNECTING = 0; FakeWs.OPEN = 1; FakeWs.CLOSING = 2; FakeWs.CLOSED = 3;
  window.WebSocket = FakeWs;
})();`;

async function withLive(fn, { width = 1920, height = 1080, query = "" } = {}) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png" };
  const server = http.createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  // no background throttling: a page opened over the debugging pipe counts as hidden, and its timers would slow to a crawl
  const userDir = fs.mkdtempSync("/tmp/live-browser-"); // owner 2026-10-26: removed in finally — without this each test leaked ~14 MB until /tmp hit 100% and file-writing tests died with ENOSPC
  const proc = spawn(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--remote-debugging-pipe", "--user-data-dir=" + userDir, "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  let id = 0, buf = "";
  const pending = new Map();
  const errors = [];
  proc.stdio[4].on("data", (d) => {
    buf += d.toString("utf8");
    let i;
    while ((i = buf.indexOf("\0")) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const m = { id: ++id, method, params };
    if (sessionId) m.sessionId = sessionId;
    pending.set(m.id, (r) => (r.error ? reject(new Error(method + ": " + r.error.message)) : resolve(r.result)));
    proc.stdio[3].write(JSON.stringify(m) + "\0");
  });
  try {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send("Page.enable", {}, sessionId);
    await send("Runtime.enable", {}, sessionId);
    await send("Page.addScriptToEvaluateOnNewDocument", { source: FAKES }, sessionId);
    const ev = async (expr) => {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
      return r.result.value;
    };
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/live.html?names=${encodeURIComponent(ME.name)}${query}` }, sessionId);
    await fn({ ev, errors });
  } finally {
    proc.kill("SIGKILL");
    server.close();
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

const until = (cond, ms = 15000) => `new Promise(async (r) => { const end = Date.now() + ${ms}; while (Date.now() < end) { try { if (${cond}) return r(true); } catch {} await new Promise((q) => setTimeout(q, 50)); } r(false); })`;
/** Frames the ticker drew in one second: style changes inside the overlay arrive in one batch per frame. */
const framesPerSecond = `new Promise((r) => { let n = 0; const mo = new MutationObserver(() => { n++; }); mo.observe(document.getElementById("liveList"), { subtree: true, attributes: true, attributeFilter: ["style"] }); setTimeout(() => { mo.disconnect(); r(n); }, 1000); })`;
const death = (att, vic, weapon, hs) => JSON.stringify({ event_name: "Death", attacker_character_id: att, character_id: vic, attacker_weapon_id: weapon, is_headshot: hs ? "1" : "0", timestamp: "0" });

describe("🎥 live.html in a browser", () => {
  it("4 lines, zerg-only info with 🪳 roaches, weapon under the centre name, nothing that animates forever", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      // 6 kills (weapons: Orion, TRAC-5, NS-11A, Frag Grenade, knife, unknown), then a death by a headshot with C-4's id
      const kills = [["80", true], ["43", false], ["70998", true], ["44505", false], ["1", false], ["0", false]];
      for (const [i, [w, hs]] of kills.entries()) await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[i].cid, w, hs)})`);
      await ev(`window.__fakeWs.emit(${death(OPP[6].cid, ME.cid, "432", true)})`);
      assert.equal(await ev(until(`document.querySelectorAll("#liveList tbody.lv-vic:not(.lv-empty)").length === 2 && document.querySelector("#liveList tbody.lv-atk:not(.lv-empty)")`)), true, "2 victims + the killer on screen");
      assert.equal(await ev(until(`document.querySelector("#liveList tbody.lv-atk .lv-wn").textContent === "C-4"`)), true, "killer weapon shown (catalog loaded)");
      const s = await ev(`(() => {
        const L = document.getElementById("liveList");
        const lines = [...L.querySelectorAll("tbody.lv-ev")];
        const vic = [...L.querySelectorAll("tbody.lv-vic")];
        const atk = L.querySelector("tbody.lv-atk");
        const me = L.querySelector("tbody.lv-me");
        const wnOf = (tb) => { const w = tb.querySelector(".lv-wn"); return w ? w.textContent : null; };
        return {
          lines: lines.length,
          names: vic.map((t) => t.querySelector(".lv-name").textContent),
          victimWn: vic.map(wnOf),
          victimHs: vic.map((t) => !!t.querySelector(".lv-hs2")),
          killerWn: wnOf(atk),
          killerHs: !!atk.querySelector(".lv-hs2"),
          meWn: wnOf(me),
          meHs: !!me.querySelector(".lv-hs2"),
          noIcons: L.querySelectorAll(".lv-wi, .lv-wp, .lv-c-wp").length,
          noEmojis: L.querySelectorAll(".lv-em, .lv-sw, .lv-gl, .lv-c-em").length,
          nmW: Math.round(L.querySelector("tbody.lv-vic .lv-nm").getBoundingClientRect().width),
          svgFilters: document.querySelectorAll("filter").length,
          endless: document.getAnimations().filter((a) => !Number.isFinite(a.effect.getComputedTiming().endTime)).map((a) => a.animationName || (a.effect.target && a.effect.target.className)),
          noStar: !L.querySelector(".lv-g3") || getComputedStyle(L.querySelector(".lv-g3"), "::after").content === "none",
          hsTip: (atk.querySelector(".lv-hs2") || {}).dataset.tip,
        };
      })()`);
      assert.equal(s.lines, 4, "killer + centre + 2 victims");
      assert.deepEqual(s.names, [OPP[5].name, OPP[4].name], "newest 2 on top");
      assert.deepEqual(s.victimWn, [null, null], "no weapon under victim names");
      assert.deepEqual(s.victimHs, [false, false], "headshot mark only on headshots");
      assert.equal(s.killerWn, "C-4");
      assert.equal(s.killerHs, true);
      assert.equal(s.hsTip, "Headshot");
      assert.equal(s.meWn, "Mag-Cutter", "centre weapon line shows the latest known kill weapon (the unknown-weapon kill leaves it)");
      assert.equal(s.meHs, false, "no headshot mark on the centre line");
      assert.equal(s.noIcons, 0, "no weapon icon column left");
      assert.equal(s.noEmojis, 0, "no emoji meters on the lines (parked)");
      assert.ok(s.nmW >= 280, `the name column +50% from halved 2026-10-26: ${s.nmW}px`);
      assert.equal(s.svgFilters, 0, "no SVG filters on the page");
      assert.deepEqual(s.endless, [], "nothing animates forever (CPU)");
      assert.equal(s.noStar, true, "no ✦ star (the gold shine replaced it)");
      // owner 2026-10-25: the meters are parked, so the ticker has nothing to move — no per-frame style mutations
      const fps = await ev(framesPerSecond);
      assert.ok(fps < 5, `the parked ticker stays idle: ${fps}`);
      // ✨ halo switch: left of 🖥️ ⚙️ Settings, off hides halos + shine and is remembered
      const sw = await ev(`(() => { const b = document.getElementById("lvHaloBtn"); const before = b.getAttribute("aria-pressed"); b.click(); const gl = document.querySelector("#liveList .lv-g3 .lv-gl, #liveList .lv-g2 .lv-gl"); return { next: b.nextElementSibling && b.nextElementSibling.id, before, after: b.getAttribute("aria-pressed"), hidden: gl ? getComputedStyle(gl).display : "none", stored: localStorage.getItem("ps2-elite-kd-live-halo") }; })()`);
      assert.deepEqual(sw, { next: "roomBadge", before: "true", after: "false", hidden: "none", stored: "0" });
      assert.deepEqual(errors, [], "no page errors");
    });
  });

  it("?fps=60: the parked ticker stays idle", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      for (let i = 0; i < 6; i++) await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[i].cid, "80", false)})`);
      assert.equal(await ev(until(`document.querySelectorAll("#liveList tbody.lv-vic:not(.lv-empty)").length === 2`)), true, "lines on screen");
      const fps = await ev(framesPerSecond);
      assert.ok(fps < 5, `no per-frame style mutations with the meters parked: ${fps}`);
      assert.deepEqual(errors, [], "no page errors");
    }, { query: "&fps=60" });
  });
});

  it("bounty (owner 2026-10-26): one ⚰️×streak, then one 💰×lives, in the left slot, weapon under the centre name", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      const linesAre = async (arr, why) => assert.equal(await ev(until(`JSON.stringify([...document.querySelectorAll("#liveList tbody.lv-me .lv-wn")].map((w) => w.textContent)) === ${JSON.stringify(JSON.stringify(arr))}`)), true, why); // double-stringify: JSON text vs a quoted literal, never vs an array
      const emAre = async (arr, why) => assert.equal(await ev(until(`JSON.stringify([...document.querySelectorAll("#liveList tbody.lv-me .lv-time .lv-em")].map((w) => w.textContent)) === ${JSON.stringify(JSON.stringify(arr))}`)), true, why);
      await linesAre([""], "weapon line only, before any kill");
      await emAre([], "left slot empty, no bounty, before any kill");
      for (let i = 0; i < 3; i++) await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[i].cid, "80", false)})`);
      await linesAre(["Orion VS54"], "3 kills: weapon under the name");
      await emAre(["⚰️×3"], "3 kills: one coffin ×3 in the left slot");
      await ev(`window.__fakeWs.emit(${death(OPP[0].cid, ME.cid, "432", false)})`);
      await emAre([], "a death below 7 clears the bounty, weapon stays");
      for (let i = 0; i < 7; i++) await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[i].cid, "80", false)})`);
      await emAre(["💰×3"], "the 7th kill flips the coffin to one bag ×3");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
      await emAre(["💰×3"], "a kill while bountied changes nothing");
      await ev(`window.__fakeWs.emit(${death(OPP[0].cid, ME.cid, "432", false)})`);
      await emAre(["💰×2"], "the 1st death removes one life");
      await ev(`window.__fakeWs.emit(${death(OPP[1].cid, ME.cid, "432", false)})`);
      await emAre(["💰×1"], "the 2nd death removes another, one left");
      await ev(`window.__fakeWs.emit(${death(OPP[2].cid, ME.cid, "432", false)})`);
      await emAre([], "the 3rd death clears the bounty, left slot empty again");
      assert.deepEqual(errors, [], "no page errors");
    });
  });

  it("imaginary DPM (owner 2026-10-25): warm-up bumps to 3, then it drains, an assist adds its full share", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      const dps = () => ev(`Number(document.getElementById("liveDpsVal").textContent)`);
      assert.equal(await ev(until(`document.getElementById("liveDpsVal").textContent === "Start at 0/3"`)), true, "meter waits at 0/3");
      assert.equal(await ev(`document.getElementById("liveDpsLabel").textContent`), "", "warm-up explains the wait");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
      assert.equal(await ev(until(`document.getElementById("liveDpsVal").textContent === "Start at 1/3"`)), true, "first kill bumps the count");
      const gain = JSON.stringify({ event_name: "GainExperience", character_id: ME.cid, experience_id: 2, amount: 100, timestamp: "0" });
      await ev(`window.__fakeWs.emit(${gain})`);
      assert.equal(await ev(until(`document.getElementById("liveDpsVal").textContent === "Start at 2/3"`)), true, "an assist bumps the count too");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[1].cid, "80", false)})`);
      const afterKill = await ev(until(`Number(document.getElementById("liveDpsVal").textContent) >= 2000`)) && await dps();
      assert.ok(afterKill >= 2000, `the 3rd chunk starts the meter: ${afterKill}`);
      assert.equal(await ev(`document.getElementById("liveDpsLabel").textContent`), "Damage", "label back to Damage once started");
      await new Promise((r) => setTimeout(r, 2500));
      const drained = await dps();
      assert.ok(drained < afterKill && drained > 2000, `DPM drains down after the start: ${drained}`);
      await ev(`window.__fakeWs.emit(${gain})`);
      const afterAssist = await ev(until(`Number(document.getElementById("liveDpsVal").textContent) > ${drained + 500}`)) && await dps();
      assert.ok(afterAssist > drained + 500, `an assist adds ~1000: ${drained} -> ${afterAssist}`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });

  it("mobile names (owner 2026-10-25): the table fills the phone and the name column takes the leftover", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
      assert.equal(await ev(until(`document.querySelectorAll("#liveList tbody.lv-vic:not(.lv-empty)").length === 1`)), true, "a victim row on screen");
      const s = await ev(`(() => {
        const feed = document.getElementById("liveFeed"), tbl = document.getElementById("liveList");
        const col = document.querySelector("col.lv-c-nm");
        return { feedW: feed.getBoundingClientRect().width, tblW: tbl.getBoundingClientRect().width, nmW: col.getBoundingClientRect().width };
      })()`);
      assert.ok(s.tblW / s.feedW > 0.98, `the table fills the phone: ${Math.round(s.tblW)}/${Math.round(s.feedW)}`);
      assert.ok(s.nmW > 160, `the name column takes the leftover (was 140 at the old 8.78rem): ${Math.round(s.nmW)}`);
      assert.deepEqual(errors, [], "no page errors");
    }, { width: 390, height: 844 });
  });

  it("tau locked (owner 2026-10-26): adjuster hidden, τ stays 60", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      assert.equal(await ev(`getComputedStyle(document.getElementById("liveDpmTau")).display`), "none", "adjuster hidden");
      assert.equal(await ev(`document.getElementById("liveDpmTauVal").value`), "60", "tau locked at 60 s");
      for (let i = 0; i < 3; i++) await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[i].cid, "80", false)})`); // three chunks to start the meter
      const afterKill = await ev(until(`Number(document.getElementById("liveDpsVal").textContent) >= 2000`)) && await ev(`Number(document.getElementById("liveDpsVal").textContent)`);
      assert.ok(afterKill > 2000 && afterKill < 3200, `tau=60 s three kills spike to ~2900: ${afterKill}`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });

  it("teamkill (owner 2026-10-25): own-faction kills farm nothing, own-faction deaths still spend bounty", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      const linesAre = async (arr, why) => assert.equal(await ev(until(`JSON.stringify([...document.querySelectorAll("#liveList tbody.lv-me .lv-wn")].map((w) => w.textContent)) === ${JSON.stringify(JSON.stringify(arr))}`)), true, why); // double-stringify: JSON text vs a quoted literal, never vs an array
      await ev(`window.__fakeWs.emit(${death(ME.cid, TEAM.cid, "80", false)})`);
      // #76: the row lands on arrival and is retracted when the commit proves the same faction
      assert.equal(await ev(until(`document.querySelectorAll("#liveList tbody.lv-vic:not(.lv-empty)").length === 0 && !document.querySelector("#liveList .lv-pend")`)), true, "a teamkill leaves no victim row");
      assert.equal(await ev(`document.getElementById("liveDpsVal").textContent`), "Start at 0/3", "a teamkill adds no DPM chunk");
      const emAre = async (arr, why) => assert.equal(await ev(until(`JSON.stringify([...document.querySelectorAll("#liveList tbody.lv-me .lv-time .lv-em")].map((w) => w.textContent)) === ${JSON.stringify(JSON.stringify(arr))}`)), true, why);
      await linesAre([""], "a teamkill starts no streak");
      await emAre([], "a teamkill starts no bounty in the left slot");
      for (let i = 0; i < 7; i++) await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[i].cid, "80", false)})`);
      await linesAre(["Orion VS54"], "7 enemy kills: weapon under the name");
      await emAre(["💰×3"], "7 enemy kills earn one bag ×3");
      await ev(`window.__fakeWs.emit(${death(TEAM.cid, ME.cid, "432", false)})`);
      await emAre(["💰×2"], "a death to your own faction still spends one life");
      assert.deepEqual(errors, [], "no page errors");
    });
  });

  it("#76 snappy feed: a slow name lookup shows … at once, never holds back later kills, and no row is lost", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      const names = `[...document.querySelectorAll("#liveList tbody.lv-vic:not(.lv-empty) .lv-name")].map((n) => n.textContent)`;
      // an earlier run, ended by a death: its lines must clear when the next run starts
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[5].cid, "80", false)})`);
      await ev(`window.__fakeWs.emit(${death(OPP[6].cid, ME.cid, "432", false)})`);
      assert.equal(await ev(until(`${names}.join("|") === ${JSON.stringify(OPP[5].name)}`)), true, "the old run's line");
      // new run, rapid fire: the slow victim first, then one fast one, all in the same task
      // (owner 2026-10-26: only the last 2 victims show, so the burst is slow + one fast)
      const burst = [SLOW.cid, OPP[0].cid].map((c) => `window.__fakeWs.emit(${death(ME.cid, c, "80", false)});`).join(" ");
      await ev(burst);
      const now = await ev(names);
      assert.equal(now.length, 2, `every row lands on arrival (2 new, the old run's pushed out by the cap): ${now}`);
      assert.equal(now[1], "…", "the slow victim shows … in the name while its lookup runs");
      assert.ok(!now.join("|").includes("#"), "no raw #id on screen");
      // the fast victim's name fills in before the slow lookup lands
      assert.equal(await ev(until(`${names}.join("|") === ${JSON.stringify([OPP[0].name, "…"].join("|"))}`, 1200)), true, "later kills are not held back by the slow lookup");
      // after the slow lookup: both new rows stay, newest on top
      assert.equal(await ev(until(`${names}.join("|") === ${JSON.stringify([OPP[0].name, SLOW.name].join("|"))}`)), true, "both rows of the new run, slow name filled");
      assert.deepEqual(errors, [], "no page errors");
    });
  });

  it("#80 name first: a mapped victim's name shows with zero Census calls, a half-mapped one before Census answers, an unknown one as ?", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      const names = `[...document.querySelectorAll("#liveList tbody.lv-vic:not(.lv-empty) .lv-name")].map((n) => n.textContent)`;
      const callsFor = (cid) => `window.__censusCalls.filter((c) => c === ${JSON.stringify(cid)}).length`;
      await ev(`window.__fakeWs.emit(${death(ME.cid, MAPPED.cid, "80", false)})`);
      assert.equal(await ev(until(`${names}[0] === ${JSON.stringify(MAPPED.name)}`, 600)), true, "mapped name on screen at once (its Census reply would take 5 s)");
      assert.equal(await ev(until(`![...document.querySelectorAll("#liveList tbody.lv-vic .lv-iv")].some((e) => e.textContent === "?")`)), true, "cached iVi ratio filled after (ranks loaded)");
      assert.equal(await ev(callsFor(MAPPED.cid)), 0, "zero Census calls for a mapped, cached victim");
      await ev(`window.__fakeWs.emit(${death(ME.cid, HALF.cid, "80", false)})`);
      assert.equal(await ev(until(`${names}[0] === ${JSON.stringify(HALF.name)}`, 600)), true, "half-mapped name at once, before its 1.5 s Census call answers");
      assert.equal(await ev(callsFor(HALF.cid)), 1, "one Census call for its faction (teamkill check) + stats, in flight");
      await ev(`window.__fakeWs.emit(${death(ME.cid, NOBODY.cid, "80", false)})`);
      assert.equal(await ev(until(`${names}[0] === "?"`)), true, "a lookup that finds nobody shows ?");
      const shown = await ev(names);
      assert.ok(!shown.join("|").includes("#") && !shown.includes("…"), `never a raw #id or a stranded …: ${shown}`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });

  it("cash-out (owner 2026-10-26): victims' iVi averaged next to DPM, live on the tick", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      assert.equal(await ev(until(`document.getElementById("liveCashAvgVal").textContent === "–"`)), true, "cash avg starts empty");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[1].cid, "80", false)})`);
      assert.equal(await ev(until(`document.querySelectorAll("#liveList tbody.lv-vic:not(.lv-empty)").length === 2`)), true, "two victim rows on screen");
      // Owner 2026-10-28: opponent rows show the iVi tier, not
      // the raw iVi — rows are newest-first, so [0] is OPP[1], [1] is OPP[0].
      assert.equal(await ev(until(`![...document.querySelectorAll("#liveList tbody.lv-vic .lv-iv")].some((e) => e.textContent === "?")`)), true, "victim tiers filled (ranks loaded)");
      const cells = await ev(`[...document.querySelectorAll("#liveList tbody.lv-vic .lv-iv")].map((e) => e.textContent)`);
      assert.deepEqual(cells, [tierLabel(ME_ADJS, adjsOf(OPP[1].name)), tierLabel(ME_ADJS, adjsOf(OPP[0].name))], `both victims show their tier: ${cells}`);
      // The pot still boosts the RAW adjs, so the average comes from the
      // fixture values, not the displayed ratios. The main pot shows only
      // the average now (owner 2026-10-26) — the Σ total is hidden from
      // display, not here
      const b = (v) => Math.round(Math.max(0, v) * 1.34);
      const sum = b(adjsOf(OPP[1].name)) + b(adjsOf(OPP[0].name)), avg = (sum / 2).toFixed(1); // rows are newest-first; the average is per victim
      assert.equal(await ev(until(`document.getElementById("liveCashAvgVal").textContent !== "–"`)), true, "pot avg landed");
      const avgText = await ev(`document.getElementById("liveCashAvgVal").textContent`);
      assert.ok(Math.abs(Number(avgText) - Number(avg)) <= 1.0, `cash avg is per victim: ${avgText} vs ${avg}`);
      // the killer does not pay: ME dies, the run is banked and the pot resets for the new run
      await ev(`window.__fakeWs.emit(${death(OPP[2].cid, ME.cid, "432", false)})`);
      assert.equal(await ev(until(`document.getElementById("liveCashAvgVal").textContent === "–"`)), true, "the avg empties with the pot");
      assert.equal(await ev(until(`document.querySelectorAll("#liveCashHist > div").length === 2`)), true, "one banked run in the history");
      const banked = await ev(`document.querySelectorAll("#liveCashHist > div")[1].textContent`);
      const bm = banked.match(/^Enemy avg ivi ([\d.]+)$/);
      assert.ok(bm, `the banked run shows Enemy avg ivi only: ${banked}`);
      assert.ok(Math.abs(Number(bm[1]) - Number(avg)) <= 1.0, `banked avg matches: ${banked} vs ${avg}`);
      assert.notEqual(await ev(`getComputedStyle(document.getElementById("liveCashHist")).backgroundColor`), "rgba(0, 0, 0, 0)", "past cashouts sit on a background, not transparent");
      assert.deepEqual(errors, [], "no page errors");
    });
  });

  it("online pill (owner 2026-10-25): green online, red offline, in the DPM row", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      const pill = () => ev(`(() => { const p = document.getElementById("liveOnline"); return { state: p.dataset.state, text: document.getElementById("liveOnlineText").textContent, inDps: document.getElementById("liveDps").contains(p) }; })()`);
      assert.equal((await pill()).state, "unknown", "grey until the first signal");
      const login = JSON.stringify({ event_name: "PlayerLogin", character_id: ME.cid, timestamp: "0" });
      const logout = JSON.stringify({ event_name: "PlayerLogout", character_id: ME.cid, timestamp: "0" });
      await ev(`window.__fakeWs.emit(${login})`);
      let st = await ev(until(`document.getElementById("liveOnline").dataset.state === "online"`)) && await pill();
      assert.equal(st.text, "Online", "login turns the pill green");
      assert.equal(st.inDps, true, "the pill sits in the DPM row");
      await ev(`window.__fakeWs.emit(${logout})`);
      st = await ev(until(`document.getElementById("liveOnline").dataset.state === "offline"`)) && await pill();
      assert.equal(st.text, "Offline", "logout turns the pill red");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
      st = await ev(until(`document.getElementById("liveOnline").dataset.state === "online"`)) && await pill();
      assert.equal(st.text, "Online", "any Death involving them means online again");
      assert.deepEqual(errors, [], "no page errors");
    });
  });

  it("new run clears the old victims (owner 2026-10-25): names stay through the death, gone at the next streak's first kill", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      const vicCount = () => ev(`document.querySelectorAll("#liveList tbody.lv-vic:not(.lv-empty)").length`);
      const vicTexts = () => ev(`[...document.querySelectorAll("#liveList tbody.lv-vic:not(.lv-empty)")].map((t) => t.textContent)`);
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[1].cid, "80", false)})`);
      assert.equal(await ev(until(`document.querySelectorAll("#liveList tbody.lv-vic:not(.lv-empty)").length === 2`)), true, "two victims mid-run");
      await ev(`window.__fakeWs.emit(${death(OPP[2].cid, ME.cid, "432", false)})`);
      assert.equal(await ev(until(`document.querySelector("#liveList tbody.lv-atk:not(.lv-empty)")`)), true, "killer row shows the death");
      // rows land on arrival with "…" names — wait for the lookups to fill
      // them before asserting anything about the names themselves
      assert.equal(await ev(until(`![...document.querySelectorAll("#liveList tbody.lv-vic:not(.lv-empty)")].some((t) => t.textContent.includes("…"))`)), true, "victim names filled in");
      let texts = await vicTexts();
      assert.equal(texts.length, 2, "old run's names stay through the death");
      assert.ok(texts.join("|").includes(OPP[0].name) && texts.join("|").includes(OPP[1].name), "old names still on screen");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[3].cid, "80", false)})`);
      assert.equal(await ev(until(`document.querySelectorAll("#liveList tbody.lv-vic:not(.lv-empty)").length === 1`)), true, "one victim after the new streak's first kill");
      assert.equal(await ev(until(`![...document.querySelectorAll("#liveList tbody.lv-vic:not(.lv-empty)")].some((t) => t.textContent.includes("…"))`)), true, "new victim name filled in");
      texts = await vicTexts();
      assert.ok(texts[0].includes(OPP[3].name), "the new name lands alone below");
      assert.deepEqual(errors, [], "no page errors");
    });
  });

  it("dim names on death (owner 2026-10-25): killed list + own name at 50% while dead, full again on a kill", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      const op = (sel) => ev(`getComputedStyle(document.querySelector("${sel}")).opacity`);
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
      assert.equal(await ev(until(`document.querySelectorAll("#liveList tbody.lv-vic:not(.lv-empty)").length === 1`)), true, "one victim on screen");
      assert.equal(await ev(until(`getComputedStyle(document.querySelector("#liveList tbody.lv-vic .lv-nm")).opacity === "1"`)), true, "victim name full once its 0.42 s pop-in finishes");
      assert.equal(await op("#liveList tbody.lv-me .lv-nm"), "1", "own name full while alive");
      await ev(`window.__fakeWs.emit(${death(OPP[2].cid, ME.cid, "432", false)})`);
      assert.equal(await ev(until(`getComputedStyle(document.querySelector("#liveList tbody.lv-vic .lv-nm")).opacity === "0.5"`)), true, "victim name dims on death");
      assert.equal(await op("#liveList tbody.lv-me .lv-nm"), "0.5", "own name dims on death");
      assert.equal(await ev(until(`getComputedStyle(document.querySelector("#liveList tbody.lv-atk .lv-nm")).opacity === "1"`)), true, "the killer line stays full once its pop-in finishes");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[1].cid, "80", false)})`);
      assert.equal(await ev(until(`getComputedStyle(document.querySelector("#liveList tbody.lv-me .lv-nm")).opacity === "1"`)), true, "own name re-lights on a kill");
      assert.equal(await ev(until(`getComputedStyle(document.querySelector("#liveList tbody.lv-vic .lv-nm")).opacity === "1"`)), true, "the new run's victim name is full once its pop-in finishes");
      assert.deepEqual(errors, [], "no page errors");
    });
  });

  it("cashed-out runs (owner 2026-10-25): death banks the run, pot resets, history caps at 5 on the page", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      const pot = () => ev(`document.getElementById("liveCashAvgVal").textContent`);
      const histEntries = () => ev(`[...document.querySelectorAll("#liveCashHist > div")].slice(1).map((d) => d.textContent)`);
      const runAvgs = [];
      for (let i = 0; i < 6; i++) {
        await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[i].cid, "80", false)})`);
        assert.equal(await ev(until(`document.querySelector("#liveList tbody.lv-vic .lv-iv") && document.querySelector("#liveList tbody.lv-vic .lv-iv").textContent !== "?"`)), true, `run ${i + 1}: victim ratio on screen`);
        runAvgs.push(adjsOf(OPP[i].name)); // the pot boosts raw adjs, not the displayed ratio
        await ev(`window.__fakeWs.emit(${death(OPP[6].cid, ME.cid, "432", false)})`);
        assert.deepEqual(await ev(until(`document.getElementById("liveCashAvgVal").textContent === "–" && document.querySelectorAll("#liveCashHist > div").length === ${Math.min(i + 2, 6)}`)), true, `run ${i + 1}: banked, pot reset`);
      }
      const entries = await histEntries();
      assert.equal(entries.length, 5, "history caps at 5 runs");
      const b5 = Math.round(Math.max(0, runAvgs[5]) * 1.34), b0 = Math.round(Math.max(0, runAvgs[0]) * 1.34);
      const entryAvg = (e) => Number(e.match(/Enemy avg ivi ([\d.]+)/)?.[1]);
      assert.ok(Math.abs(entryAvg(entries[0]) - b5) <= 1, `newest run first (the pot boosts raw adjs): ${entries[0]} vs ${b5}`);
      assert.ok(!entries.map(entryAvg).some((v) => Math.abs(v - b0) <= 1), "the oldest run dropped off");
      assert.equal(await pot(), "–", "pot empty after the last run ends");
      assert.deepEqual(errors, [], "no page errors");
    });
  });

  it("sub-0 floor (owner 2026-10-25): a negative-iVi victim pays 0, never subtracts", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    // The fixture proof is data-side: SUB0's cached adjs is negative. The
    // feed cell itself shows 0 for them (owner 2026-10-28: the tier branch
    // for opp <= 0 never divides), so the pot must now match that, not go below.
    assert.ok(sub0row[ci("adjs")] < -100, `SUB0 is genuinely sub-0 in the cache: ${sub0row[ci("adjs")]}`);
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      await ev(`window.__fakeWs.emit(${death(ME.cid, SUB0.cid, "80", false)})`);
      assert.equal(await ev(until(`document.querySelector("#liveList tbody.lv-vic .lv-iv") && document.querySelector("#liveList tbody.lv-vic .lv-iv").textContent === "0"`)), true, "the feed already floors their shown iVi at 0");
      assert.equal(await ev(until(`document.getElementById("liveCashAvgVal").textContent === "0.0"`)), true, "a known 0 payout counts in the average (floored, never negative)");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
      assert.equal(await ev(until(`document.querySelectorAll("#liveList tbody.lv-vic:not(.lv-empty)").length === 2`)), true, "two victims on screen");
      // Owner 2026-10-28: rows show tiers now — newest is OPP[0]'s tier,
      // the sub-0 victim still reads 0 (negative adjs is never divided).
      const cells = await ev(`[...document.querySelectorAll("#liveList tbody.lv-vic .lv-iv")].map((e) => e.textContent)`);
      assert.deepEqual(cells, [tierLabel(ME_ADJS, adjsOf(OPP[0].name)), "0"], `newest victim tier, sub-0 victim floored: ${cells}`);
      const bp = Math.round(Math.max(0, adjsOf(OPP[0].name)) * 1.34);
      // ±1 tolerance (same rounding-boundary note as the cash-out test):
      // the page boosts the raw adj, the test only sees the rounded display
      // the main pot shows only the average now (owner 2026-10-26): the floored 0
      // adds nothing to the numerator, so the average is the boosted part alone over 2
      assert.equal(await ev(until(`document.getElementById("liveCashAvgVal").textContent !== "–"`)), true, "the pot avg landed");
      const avgText = await ev(`document.getElementById("liveCashAvgVal").textContent`);
      assert.ok(Math.abs(Number(avgText) - bp / 2) <= 1.0, `the average counts the floored 0: ${avgText} vs ${bp / 2}`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });

describe("🎥 live hold meter in a browser", () => {
  it("hold (owner 2026-10-25): two clean 12 s gaps hold the line flat — DPM stays flat eight seconds after the fourth kill", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      // CSSOM normalizes "0.0%" → "0%" on readback, so bar widths assert the normalized form (6.7% keeps its decimal)
      assert.equal(await ev(until(`document.getElementById("liveDpsHoldBar").style.width === "0%"`)), true, "no gaps yet: hold bar at zero");
      // Two throwaway kills first: the first commit loads the ranks, so the
      // gap it spans is dirty (~1 s of load time) — the sleeps below start
      // after commits, so only gaps between fast commits measure cleanly.
      // The median absorbs the dirty gap: median(1 s, 12 s, 12 s) = 12 s.
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
      assert.equal(await ev(until(`document.getElementById("liveDpsVal").textContent === "Start at 1/3"`)), true, "first kill bumps the count");
      assert.equal(await ev(`document.getElementById("liveDpsHoldBar").style.width`), "0%", "one spike: still no gap, hold bar at zero");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[1].cid, "80", false)})`);
      assert.equal(await ev(until(`document.getElementById("liveDpsVal").textContent === "Start at 2/3"`)), true, "second kill bumps the count");
      await new Promise((r) => setTimeout(r, 12000)); // a slow player's real gap, cleanly measured
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[2].cid, "80", false)})`);
      assert.equal(await ev(until(`Number(document.getElementById("liveDpsVal").textContent) >= 2000`)), true, "third kill starts the meter held");
      assert.ok(Number.parseFloat(await ev(`document.getElementById("liveDpsBar").style.width`)) > 0, "DPM bar grows with the meter");
      await new Promise((r) => setTimeout(r, 12000)); // the same gap again
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[3].cid, "80", false)})`);
      await new Promise((r) => setTimeout(r, 8000)); // 8 s after the fourth kill — inside the 12 s hold
      const dpm = await ev(`Number(document.getElementById("liveDpsVal").textContent)`);
      assert.ok(dpm > 3200, `held DPM stays flat (with no hold it would be ~2990 here): ${dpm}`);
      const holdW = Number.parseFloat(await ev(`document.getElementById("liveDpsHoldBar").style.width`));
      assert.ok(holdW >= 25 && holdW <= 45, `owner 2026-10-26: 8 s into the 12 s hold timer, ~33% left: ${holdW}`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });

  it("freeze (owner 2026-10-25): decay pauses on death for the average spawn run — DPM holds its death value", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
      assert.equal(await ev(until(`document.getElementById("liveDpsVal").textContent === "Start at 1/3"`)), true, "first kill bumps the count");
      await ev(`window.__fakeWs.emit(${death(OPP[1].cid, ME.cid, "432", false)})`); // death 1: no average yet, so no freeze
      await new Promise((r) => setTimeout(r, 5000)); // the spawn run, measured
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[1].cid, "80", false)})`); // kill 2: measures the 5 s run (and clears the old run's row)
      assert.equal(await ev(until(`document.querySelectorAll("#liveList tbody.lv-vic:not(.lv-empty)").length === 1`)), true, "second kill on screen");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[2].cid, "80", false)})`); // kill 3: starts the meter
      assert.equal(await ev(until(`Number(document.getElementById("liveDpsVal").textContent) >= 2000`)), true, "third kill starts the meter");
      await ev(`window.__fakeWs.emit(${death(OPP[3].cid, ME.cid, "432", false)})`); // death 2: freeze for the 5 s average
      await new Promise((r) => setTimeout(r, 300)); // let the death commit and the tick freeze
      const atDeath = await ev(`Number(document.getElementById("liveDpsVal").textContent)`);
      await new Promise((r) => setTimeout(r, 4000)); // 4 s into the 5 s freeze
      const held = await ev(`Number(document.getElementById("liveDpsVal").textContent)`);
      assert.ok(held >= atDeath * 0.95, `frozen DPM holds its death value (with no freeze it would drain to ~94%): ${atDeath} -> ${held}`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});

describe("🎥 live gas-counter scroll in a browser", () => {
  it("scroll (owner 2026-10-25): the counter rolls ease-in — barely moves at first, then rushes the jump", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      for (let i = 0; i < 3; i++) await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[i].cid, "80", false)})`);
      const base = await ev(until(`Number(document.getElementById("liveDpsVal").textContent) > 2000`)) && await ev(`Number(document.getElementById("liveDpsVal").textContent)`);
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[3].cid, "80", false)})`); // 4th kill: one 1000 scroll
      const v0 = await ev(`Number(document.getElementById("liveDpsVal").textContent)`);
      assert.ok(v0 < base + 300, `slow start: barely moved right after the kill: ${base} -> ${v0}`);
      assert.equal(await ev(until(`Number(document.getElementById("liveDpsVal").textContent) > ${base + 300}`)), true, "scroll underway");
      await new Promise((r) => setTimeout(r, 500));
      const v1 = await ev(`Number(document.getElementById("liveDpsVal").textContent)`);
      assert.ok(v1 > v0 + 500, `speeding up: the rush phase gained 500+ in 500 ms: ${v0} -> ${v1}`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });

  it("queue (owner 2026-10-25): two quick kills scroll one by one — still rising after the first scroll's time", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      for (let i = 0; i < 3; i++) await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[i].cid, "80", false)})`);
      const base = await ev(until(`Number(document.getElementById("liveDpsVal").textContent) > 2000`)) && await ev(`Number(document.getElementById("liveDpsVal").textContent)`);
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[3].cid, "80", false)})`);
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[4].cid, "80", false)})`); // two scrolls queued, 1000 each
      // no sleeps: a loaded machine overshoots setTimeout past the second
      // scroll, so poll for the value states instead — the counter only
      // rises while a scroll plays, so each crossing pins the order
      assert.equal(await ev(until(`Number(document.getElementById("liveDpsVal").textContent) > ${base + 800}`)), true, "first scroll landed");
      const vMid = await ev(`Number(document.getElementById("liveDpsVal").textContent)`);
      assert.ok(vMid < base + 1800, `second scroll not yet landed: ${base} -> ${vMid}`);
      assert.equal(await ev(until(`Number(document.getElementById("liveDpsVal").textContent) > ${base + 1700}`)), true, "second scroll landed");
      const vEnd = await ev(`Number(document.getElementById("liveDpsVal").textContent)`);
      assert.ok(vEnd < base + 2100, `both scrolls kept, no overshoot: ${base} -> ${vEnd}`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });

  it("death waits (owner 2026-10-25): a death never cuts a scroll, and three deaths at once leave the meter safe", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      for (let i = 0; i < 3; i++) await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[i].cid, "80", false)})`);
      assert.equal(await ev(until(`Number(document.getElementById("liveDpsVal").textContent) > 2000`)), true, "meter started");
      await ev(`window.__fakeWs.emit(${death(OPP[3].cid, ME.cid, "432", false)})`); // death 1: no average yet, no freeze
      await new Promise((r) => setTimeout(r, 5000)); // the spawn run, measured
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[4].cid, "80", false)})`); // kill 4: measures the 5 s run, starts a scroll
      await ev(`window.__fakeWs.emit(${death(OPP[5].cid, ME.cid, "432", false)})`); // deaths 2, 3, 4 at once, mid-scroll
      await ev(`window.__fakeWs.emit(${death(OPP[6].cid, ME.cid, "432", false)})`);
      await ev(`window.__fakeWs.emit(${death(OPP[0].cid, ME.cid, "432", false)})`);
      await new Promise((r) => setTimeout(r, 400));
      const a = await ev(`Number(document.getElementById("liveDpsVal").textContent)`);
      await new Promise((r) => setTimeout(r, 300));
      const b = await ev(`Number(document.getElementById("liveDpsVal").textContent)`);
      assert.ok(b > a, `the scroll kept rising through the deaths instead of freezing mid-roll: ${a} -> ${b}`);
      await new Promise((r) => setTimeout(r, 3000)); // scroll done + ease converged to the frozen value
      const f1 = await ev(`document.getElementById("liveDpsVal").textContent`);
      await new Promise((r) => setTimeout(r, 1000));
      const f2 = await ev(`document.getElementById("liveDpsVal").textContent`);
      assert.equal(f1, f2, `frozen through the 5 s hold, three deaths and all: ${f1} vs ${f2}`);
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[1].cid, "80", false)})`); // next kill: the meter is not stuck
      assert.equal(await ev(until(`Number(document.getElementById("liveDpsVal").textContent) > ${Number(f2) + 500}`)), true, "a kill after the deaths scrolls up again");
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});


describe("🎥 live death-anchored hold in a browser", () => {
  it("hold A (owner 2026-10-25): a death plus two kills sets the hold from the death, not just between kills", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      assert.equal(await ev(until(`document.getElementById("liveDpsHoldBar").style.width === "0%"`)), true, "no gaps yet: hold bar at zero");
      await ev(`window.__fakeWs.emit(${death(OPP[0].cid, ME.cid, "432", false)})`); // death first: the anchor
      await new Promise((r) => setTimeout(r, 4000));
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[1].cid, "80", false)})`); // kill 1: 4 s after the death
      await new Promise((r) => setTimeout(r, 2000));
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[2].cid, "80", false)})`); // kill 2: 2 s after kill 1
      // pool [4 s, 2 s] → median 3 s; the old within-run-only hold would say 2 s
      assert.equal(await ev(until(`parseFloat(document.getElementById("liveDpsHoldBar").style.width) >= 90`)), true, "death-anchored median: hold timer starts full at the kill");
      await new Promise((r) => setTimeout(r, 1500)); // half the 3 s timer
      const holdAW = Number.parseFloat(await ev(`document.getElementById("liveDpsHoldBar").style.width`));
      assert.ok(holdAW >= 30 && holdAW <= 70, `owner 2026-10-26: half the 3 s hold timer left: ${holdAW}`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});

describe("🎥 live combat average in a browser", () => {
  it("combat average (owner 2026-10-26): median of ALL death→first-combat runs, shown in the debug box (no bar)", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      // owner 2026-10-26: the combat bar is gone — the red death line
      // drains over this median instead, the median itself lives here
      assert.equal(await ev(`document.getElementById("liveDpsCombatBar") === null && document.getElementById("liveDpsCombatLine") === null`), true, "no combat bar left");
      await ev(`window.__fakeWs.emit(${death(OPP[0].cid, ME.cid, "432", false)})`); // death 1
      await new Promise((r) => setTimeout(r, 4000));
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[1].cid, "80", false)})`); // combat 4 s after death 1
      assert.equal(await ev(until(`document.getElementById("liveDbg").textContent.includes("(n=1)")`)), true, "first run counted");
      const dbg1 = await ev(`document.getElementById("liveDbg").textContent`);
      assert.match(dbg1, /combat 4\.\ds \(n=1\)/, `first run median ~4 s: ${dbg1}`);
      await ev(`window.__fakeWs.emit(${death(OPP[2].cid, ME.cid, "432", false)})`); // death 2
      await new Promise((r) => setTimeout(r, 8000));
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[3].cid, "80", false)})`); // combat 8 s after death 2
      // median([4 s, 8 s]) = 6 s, over both deaths — the trailing-10 freeze/hold caps don't apply here
      assert.equal(await ev(until(`document.getElementById("liveDbg").textContent.includes("(n=2)")`)), true, "second run counted");
      const dbg2 = await ev(`document.getElementById("liveDbg").textContent`);
      assert.match(dbg2, /combat 6\.\ds \(n=2\)/, `second run median ~6 s: ${dbg2}`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});

describe("🎥 live session line in a browser", () => {
  it("session line (owner 2026-10-26): hidden until the first event, then duration + kills + deaths + Σ + avg", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      assert.equal(await ev(until(`document.getElementById("liveSession").style.display === "none"`)), true, "no session yet: line hidden");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[1].cid, "80", false)})`);
      assert.equal(await ev(until(`document.querySelectorAll("#liveList tbody.lv-vic:not(.lv-empty)").length === 2`)), true, "two victim rows on screen");
      assert.equal(await ev(until(`document.getElementById("liveSession").textContent.includes("2 kills")`)), true, "session line counts the kills");
      const line = await ev(`document.getElementById("liveSession").textContent`);
      assert.match(line, /^session \d+s · 2 kills · 0 deaths · Σ \d+ · Enemy avg ivi [\d.]+$/, `session line after two kills: ${line}`);
      await ev(`window.__fakeWs.emit(${death(OPP[2].cid, ME.cid, "432", false)})`); // ME dies: no banking (bounty held), pot keeps the kills
      assert.equal(await ev(until(`document.getElementById("liveSession").textContent.includes("1 deaths")`)), true, "death counted in the session line");
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});

describe("🎥 live reconnect in a browser", () => {
  it("reconnect (owner 2026-10-25): a healthy drop reconnects at once, and a kill on the new socket counts", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      await new Promise((r) => setTimeout(r, 6000)); // the socket lived past the 5 s healthy mark
      await ev(`window.__fakeWs.close()`); // FakeWs.close fires onclose, like a real drop
      // immediate reconnect: a new socket opens without waiting out a backoff timer
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "reconnected at once");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
      assert.equal(await ev(until(`document.getElementById("liveDpsVal").textContent === "Start at 1/3"`)), true, "kill on the new socket counts");
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});

describe("🎥 live share in a browser", () => {
  it("share (owner 2026-10-26): one tap copies link + Enemy avg ivi + Damage, cash-out first", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      await ev(`Object.defineProperty(navigator, "clipboard", { value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } }, configurable: true })`);
      assert.equal(await ev(`document.getElementById("liveShare").textContent`), "Share", "share button labelled");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[1].cid, "80", false)})`);
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[2].cid, "80", false)})`);
      // wait until every victim's name filled in, so the pot and avg are final
      assert.equal(await ev(until(`![...document.querySelectorAll("#liveList tbody.lv-vic .lv-nm")].some((e) => e.textContent.includes("…"))`)), true, "all three names filled");
      assert.equal(await ev(until(`document.getElementById("liveCashAvgVal").textContent !== "–"`)), true, "pot avg landed");
      await ev(`document.getElementById("liveShare").click()`);
      assert.equal(await ev(until(`document.getElementById("liveShare").textContent === "✓"`)), true, "tap shows the tick");
      const copied = await ev(`window.__copied`);
      const avgText = await ev(`document.getElementById("liveCashAvgVal").textContent`);
      assert.ok(copied.startsWith(`${ME.name} live: `) && copied.includes(`/live.html?names=${encodeURIComponent(ME.name)}`), `first line is the watch link: ${copied}`);
      assert.ok(copied.includes(`Enemy avg ivi ${avgText} · Damage `), `numbers line matches the page: ${copied}`);
      const dpmPart = copied.split("· Damage ")[1];
      assert.ok(/^\d+\.\d+$/.test(dpmPart), `DPM is a started-meter number, not warm-up: ${dpmPart}`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});

describe("🎥 live stream overlay in a browser", () => {
  it("stream (owner 2026-10-26): names list + meters + session card, K/D included", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      // before any event: the card is already there, K/D empty
      assert.equal(await ev(`getComputedStyle(document.getElementById("liveStreamCard")).display`), "block", "card shows from load");
      assert.equal(await ev(`document.getElementById("liveStreamKd").textContent`), "–", "K/D empty before the first death");
      assert.notEqual(await ev(`getComputedStyle(document.getElementById("liveList")).display`), "none", "names list shows in stream mode");
      assert.equal(await ev(`getComputedStyle(document.querySelector("footer")).display`), "none", "footer hidden in stream mode");
      assert.equal(await ev(`getComputedStyle(document.querySelector(".controls")).display`), "none", "header controls hidden in stream mode");
      assert.equal(await ev(`getComputedStyle(document.getElementById("liveDpmTau")).display`), "none", "tau controls hidden");
      assert.equal(await ev(`getComputedStyle(document.getElementById("liveCashHist")).display`), "none", "history hidden");
      assert.equal(await ev(`getComputedStyle(document.getElementById("liveShare")).display`), "none", "share hidden");
      assert.equal(await ev(`getComputedStyle(document.getElementById("liveSession")).display`), "none", "normal session line hidden");
      assert.equal(await ev(`getComputedStyle(document.querySelector("#liveDps .live-metric:last-child")).display`), "none", "online pill hidden");
      assert.equal(await ev(`getComputedStyle(document.getElementById("liveDps")).display`), "block", "DPM block stays");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[1].cid, "80", false)})`);
      await ev(`window.__fakeWs.emit(${death(OPP[2].cid, ME.cid, "432", false)})`);
      assert.equal(await ev(until(`document.getElementById("liveStreamKd").textContent === "2.00"`)), true, "K/D 2.00 after two kills and a death");
      const sesText = await ev(`document.getElementById("liveStreamSession").textContent`);
      assert.ok(sesText.includes("2 kills") && sesText.includes("1 deaths") && /Σ \d+/.test(sesText), `session card carries the session: ${sesText}`);
      assert.deepEqual(errors, [], "no page errors");
    }, { query: "&stream=1" });
  });
});

describe("🎥 live timers in a browser", () => {
  it("timers (owner 2026-10-26): death line drains from each death, hold drains from each kill, debug box holds the medians", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      const barW = (id) => ev(`parseFloat(document.getElementById("${id}").style.width) || 0`);
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      // build medians: death, 5 s to first combat, 2 s to second kill
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`); // a spike before any death
      await ev(`window.__fakeWs.emit(${death(OPP[1].cid, ME.cid, "432", false)})`); // D1
      await wait(5000);
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[1].cid, "80", false)})`); // K1: combat run ~5 s, hold gap ~5 s
      await wait(2000);
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[2].cid, "80", false)})`); // K2: hold gap ~2 s
      // death line: the next death drains over the 5 s median
      await ev(`window.__fakeWs.emit(${death(OPP[2].cid, ME.cid, "432", false)})`); // D2
      assert.equal(await ev(until(`parseFloat(document.getElementById("liveDeathLine").style.width) >= 90`)), true, "death line starts full at the death");
      await wait(2000);
      const deathMid = await barW("liveDeathLine");
      assert.ok(deathMid >= 30 && deathMid <= 75, `death line drained after 2 s of 5: ${deathMid}`);
      // hold timer: the next kill drains over the ~2 s median ([5, 2, 2] → 2 s)
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[3].cid, "80", false)})`); // K3: D2→K3 ~2 s joins the hold pool
      assert.equal(await ev(until(`parseFloat(document.getElementById("liveDpsHoldBar").style.width) >= 90`)), true, "hold bar starts full at the kill");
      await wait(1000);
      const holdMid = await barW("liveDpsHoldBar");
      assert.ok(holdMid >= 25 && holdMid <= 75, `hold bar drained after 1 s of 2: ${holdMid}`);
      // debug box: medians + counts, copyable text
      const dbg = await ev(`document.getElementById("liveDbg").textContent`);
      assert.ok(dbg.includes("hold") && dbg.includes("combat") && !dbg.includes(":"), `debug box shows medians only: ${dbg}`);
      assert.ok(dbg.includes("(n=2)"), `two combat runs counted: ${dbg}`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});

describe("🎥 live left slot in a browser", () => {
  it("left slot (owner 2026-10-26): bounty on top, assist under it, both small; a kill or a death hides the assist", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      const emAre = async (arr, why) => assert.equal(await ev(until(`JSON.stringify([...document.querySelectorAll("#liveList tbody.lv-me .lv-time .lv-em")].map((w) => w.textContent)) === ${JSON.stringify(JSON.stringify(arr))}`)), true, why);
      const assist = () => ev(`window.__fakeWs.emit(${JSON.stringify({ event_name: "GainExperience", character_id: ME.cid, experience_id: 2, amount: 100, timestamp: "0" })})`);
      await emAre([], "left slot empty before any event");
      for (let i = 0; i < 3; i++) await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[i].cid, "80", false)})`);
      await emAre(["⚰️×3"], "3 kills: bounty line only");
      await assist();
      await emAre(["⚰️×3", "🤝×1"], "an assist adds its line under the bounty");
      assert.equal(await ev(`getComputedStyle(document.querySelector("#liveList tbody.lv-me .lv-time .lv-em")).display`), "block", "emoji lines stack");
      await assist();
      await emAre(["⚰️×3", "🤝×2"], "a second assist without a kill counts up");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[3].cid, "80", false)})`);
      await emAre(["⚰️×4"], "a kill hides the assist count, streak grows");
      await assist();
      await emAre(["⚰️×4", "🤝×1"], "an assist after the kill counts again");
      await ev(`window.__fakeWs.emit(${death(OPP[0].cid, ME.cid, "432", false)})`);
      await emAre([], "a death hides the assist and clears the streak below 7");
      assert.deepEqual(errors, [], "no page errors");
    });
  });

});

describe("🎥 live assist share in a browser", () => {
  it("share (owner 2026-10-26): a 10% assist spikes 100, not 500 — three of them land far below the flat value", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      const assist = (amount) => ev(`window.__fakeWs.emit(${JSON.stringify({ event_name: "GainExperience", character_id: ME.cid, experience_id: 2, amount, timestamp: "0" })})`);
      for (let i = 0; i < 3; i++) await assist(10); // share 0.1 each, no kills yet so multiplier 1
      assert.equal(await ev(until(`!document.getElementById("liveDpsVal").textContent.includes("/")`)), true, "meter started at the 3rd spike");
      await new Promise((r) => setTimeout(r, 1000)); // easing + decay settle
      const v = parseFloat(await ev(`document.getElementById("liveDpsVal").textContent`));
      assert.ok(v > 100 && v < 1000, `three 10% assists read ~300 decaying, not the flat ~1500: ${v}`);
      assert.equal(await ev(`JSON.stringify([...document.querySelectorAll("#liveList tbody.lv-me .lv-time .lv-em")].map((w) => w.textContent))`), JSON.stringify(["🤝×3"]), "the assist counter still counts every assist");
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});

describe("🎥 live global hold in a browser", () => {
  it("global hold (owner 2026-10-26): line 1 flat while line 2 drains, falling only after the hold runs out", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      const assist = () => ev(`window.__fakeWs.emit(${JSON.stringify({ event_name: "GainExperience", character_id: ME.cid, experience_id: 2, amount: 100, timestamp: "0" })})`);
      await assist();
      await new Promise((r) => setTimeout(r, 2000));
      await assist();
      await new Promise((r) => setTimeout(r, 2000));
      await assist(); // 3 spikes 2 s apart -> hold ~2 s from the fallback gaps
      assert.equal(await ev(until(`!document.getElementById("liveDpsVal").textContent.includes("/")`)), true, "meter started at the 3rd spike");
      await new Promise((r) => setTimeout(r, 400));
      const v0 = parseFloat(await ev(`document.getElementById("liveDpsVal").textContent`));
      await new Promise((r) => setTimeout(r, 1000)); // still inside the ~2 s hold
      const v1 = parseFloat(await ev(`document.getElementById("liveDpsVal").textContent`));
      assert.ok(Math.abs(v1 - v0) / v0 < 0.05, `flat while the hold drains: ${v0} -> ${v1}`);
      await new Promise((r) => setTimeout(r, 5000)); // past the hold, decayed ~7%
      const v2 = parseFloat(await ev(`document.getElementById("liveDpsVal").textContent`));
      assert.ok(v2 < v1 * 0.95, `falls together after the hold: ${v1} -> ${v2}`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});

describe("🎥 live headshot name in a browser", () => {
  it("headshot name (owner 2026-10-26): a marked victim name is not truncated in a wide column", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", true)})`); // headshot kill
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[1].cid, "80", false)})`); // plain kill, control
      assert.equal(await ev(until(`document.querySelectorAll("#liveList tbody.lv-vic .lv-name").length === 2 && ![...document.querySelectorAll("#liveList tbody.lv-vic .lv-name")].some((n) => n.textContent.includes("…"))`)), true, "victim rows landed with names");
      const rows = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll("#liveList tbody.lv-vic .lv-name")].map((n) => ({ text: n.textContent, sw: n.scrollWidth, cw: n.clientWidth, hs: !!n.parentElement.querySelector(".lv-hs2") })))`));
      assert.equal(rows.length, 2);
      for (const r of rows) assert.ok(r.sw <= r.cw + 1, `${r.text} (headshot: ${r.hs}) truncated: scroll ${r.sw} > client ${r.cw}`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});

describe("🎥 live assist hold in a browser", () => {
  it("assist hold (owner 2026-10-26): an assist refills bar 2 exactly like a kill", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      const kill = () => ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
      const assist = () => ev(`window.__fakeWs.emit(${JSON.stringify({ event_name: "GainExperience", character_id: ME.cid, experience_id: 2, amount: 100, timestamp: "0" })})`);
      const bar = () => ev(`document.getElementById("liveDpsHoldBar") ? document.getElementById("liveDpsHoldBar").style.width : "missing"`);
      await kill();
      await new Promise((r) => setTimeout(r, 2000));
      await kill();
      await new Promise((r) => setTimeout(r, 2000));
      await kill(); // meter started, hold ~2 s
      assert.equal(await ev(until(`!document.getElementById("liveDpsVal").textContent.includes("/")`)), true, "meter started");
      await new Promise((r) => setTimeout(r, 1500)); // bar drained to ~25%
      const before = parseFloat(await bar());
      await assist();
      await new Promise((r) => setTimeout(r, 300)); // tick catches up
      const after = parseFloat(await bar());
      assert.ok(after > 70, `assist refills bar 2 to near full: ${before}% -> ${after}%`);
      assert.ok(after > before + 30, `assist visibly refills a drained bar 2: ${before}% -> ${after}%`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});

describe("🎥 live phone slot lines in a browser", () => {
  it("slot lines (owner 2026-10-26): a two-digit ×N fits the fixed time column on phones and desktop", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    for (const [w, h] of [[390, 844], [1920, 1080]]) {
      await withLive(async ({ ev, errors }) => {
        assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
        await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
        // the kill commit resets the assist count async (name lookup) — wait for its render (streak line) before counting assists, or it wipes the early ones
        assert.equal(await ev(until(`[...document.querySelectorAll("#liveList tbody.lv-me .lv-time .lv-em")].some((el) => el.textContent === "⚰️×1")`)), true, "kill committed");
        for (let k = 0; k < 12; k++) await ev(`window.__fakeWs.emit(${JSON.stringify({ event_name: "GainExperience", character_id: ME.cid, experience_id: 2, amount: 100, timestamp: "0" })})`);
        assert.equal(await ev(until(`[...document.querySelectorAll("#liveList tbody.lv-me .lv-time .lv-em")].some((el) => el.textContent === "🤝×12")`)), true, "12 assists counted");
        const fit = JSON.parse(await ev(`JSON.stringify((() => { const td = document.querySelector("#liveList tbody.lv-me .lv-time"); return [...document.querySelectorAll("#liveList tbody.lv-me .lv-time .lv-em")].map((el) => ({ text: el.textContent, sw: el.scrollWidth, cell: td.clientWidth })); })())`));
        assert.equal(fit.length, 2);
        for (const f of fit) assert.ok(f.sw <= f.cell, `${f.text} fits the time column at ${w}px: content ${f.sw} <= cell ${f.cell}`);
        assert.deepEqual(errors, [], "no page errors");
      }, { width: w, height: h });
    }
  });
});

describe("🎥 live centre row border in a browser", () => {
  it("centre row (owner 2026-10-26): no thick accent frame around the tracked character", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
      assert.equal(await ev(until(`document.querySelector("#liveList tbody.lv-me") !== null`)), true, "centre row present");
      const b = JSON.parse(await ev(`JSON.stringify((() => { const td = document.querySelector("#liveList tbody.lv-me td"); const tb = document.querySelector("#liveList tbody.lv-me"); const cs = getComputedStyle(td); const ts = getComputedStyle(tb); return { top: cs.borderTopWidth, bottom: cs.borderBottomWidth, leftColor: ts.borderLeftColor }; })())`));
      assert.equal(b.top, "1px");
      assert.equal(b.bottom, "1px");
      assert.ok(b.leftColor === "rgba(0, 0, 0, 0)" || b.leftColor === "transparent", `left bar transparent, got ${b.leftColor}`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});

describe("🎥 live death line in a browser", () => {
  it("death line (owner 2026-10-26): the death run drains as a red gradient line above the feed, as wide as the table", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      const w = () => ev(`(() => { const el = document.getElementById("liveDeathLine"); if (!el) return null; const cs = getComputedStyle(el); return { w: parseFloat(el.style.width) || 0, bg: cs.backgroundImage, before: el.parentElement.nextElementSibling && el.parentElement.nextElementSibling.id, one: document.querySelectorAll("#liveDeathLine").length }; })()`);
      await ev(`window.__fakeWs.emit(${death(OPP[0].cid, ME.cid, "80", false)})`); // death 1: killer row appears
      await new Promise((r) => setTimeout(r, 2000)); // run builds to ~2 s
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`); // kill 1: run 1 completes, killer line dims
      assert.equal(await ev(until(`![...document.querySelectorAll("#liveList tbody.lv-vic .lv-nm")].some((el) => el.textContent.includes("…"))`)), true, "kill 1 committed");
      await ev(`window.__fakeWs.emit(${death(OPP[0].cid, ME.cid, "80", false)})`); // death 2: line drains over ~2 s
      await new Promise((r) => setTimeout(r, 300)); // let the 100 ms tick set the width (initial CSS is 0%)
      const first = await w();
      assert.ok(first && first.w > 50, `line starts near full after death 2: ${JSON.stringify(first)}`);
      assert.ok(first.bg.includes("linear-gradient"), `line is a gradient: ${first.bg}`);
      assert.equal(first.before, "liveList", "line sits directly above the feed table");
      assert.equal(first.one, 1, "exactly one death line");
      await new Promise((r) => setTimeout(r, 1200));
      const second = await w();
      assert.ok(second && second.w < first.w, `line drains: ${first.w}% -> ${second.w}%`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});

describe("🎥 live feed arrival animations in a browser", () => {
  // SLOW's 1.5 s lookup keeps the lv-new arrival render alive long enough to catch the animation mid-flight.
  // moved() polls the computed transform for 500 ms: true only if the row really translates (not just a named animation).
  const moved = (sel) => `(async () => { const td = document.querySelector("${sel}"); if (!td) return false; const t0 = performance.now(); return await new Promise((res) => { (function tick() { if (getComputedStyle(td).transform !== "none") return res(true); if (performance.now() - t0 > 500) return res(false); requestAnimationFrame(tick); })(); }); })()`;
  it("victim slide (owner 2026-10-26): a new victim row slides down under the centre row, then settles", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      // The retry below is the documented behaviour (owner 2026-10-26):
      // under load the slide can finish before the first probe starts,
      // so a miss returns false and the second arrival retries — the
      // assert used to throw here, which defeated the retry entirely.
      const probeSlide = async () => {
        await ev(`window.__fakeWs.emit(${death(ME.cid, SLOW.cid, "80", false)})`); // ME kills SLOW: victim row arrives, name fills 1.5 s later
        if (!(await ev(until(`document.querySelector("tbody.lv-vic.lv-new") !== null`)))) return false;
        return await ev(moved("tbody.lv-vic.lv-new td"));
      };
      // Under full-suite load the 0.45 s slide can finish before the first probe starts; a second
      // arrival re-triggers it, so a miss retries once instead of failing the run.
      assert.equal(await probeSlide() || await probeSlide(), true, "victim row actually moves mid-slide");
      const anim = await ev(`getComputedStyle(document.querySelector("tbody.lv-vic.lv-new td")).animationName`);
      assert.ok(anim.includes("lvVicSlide"), `victim slides: ${anim}`);
      assert.equal(await ev(until(`![...document.querySelectorAll("#liveList tbody.lv-vic .lv-nm")].some((el) => el.textContent.includes("…"))`)), true, "victim name filled (commit render)");
      assert.equal(await ev(`document.querySelector("tbody.lv-vic.lv-new")`), null, "lv-new is one-shot: gone after the commit render");
      assert.deepEqual(errors, [], "no page errors");
    });
  });
  it("killer drop (owner 2026-10-26): the killer row falls onto the centre row and settles into the top row", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      await ev(`window.__fakeWs.emit(${death(SLOW.cid, ME.cid, "80", false)})`); // SLOW kills ME: killer row arrives, name fills 1.5 s later
      assert.equal(await ev(until(`document.querySelector("tbody.lv-atk.lv-new") !== null`)), true, "killer row arrives with lv-new");
      assert.equal(await ev(moved("tbody.lv-atk.lv-new td")), true, "killer row actually moves mid-drop");
      const anim = await ev(`getComputedStyle(document.querySelector("tbody.lv-atk.lv-new td")).animationName`);
      assert.ok(anim.includes("lvKillerDrop"), `killer drops: ${anim}`);
      assert.equal(await ev(until(`![...document.querySelectorAll("#liveList tbody.lv-atk .lv-nm")].some((el) => el.textContent.includes("…"))`)), true, "killer name filled (commit render)");
      assert.equal(await ev(`document.querySelector("tbody.lv-atk.lv-new")`), null, "lv-new is one-shot: gone after the commit render");
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});

describe("🎥 live unknown iVi in a browser", () => {
  it("unknown iVi (owner 2026-10-27): an uncached victim shows ?, never an emoji", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      await ev(`window.__fakeWs.emit(${death(ME.cid, SLOW.cid, "80", false)})`); // ME kills SLOW: not a ranks row, so its iVi stays unknown
      assert.equal(await ev(until(`![...document.querySelectorAll("#liveList tbody.lv-vic .lv-nm")].some((el) => el.textContent.includes("…"))`)), true, "victim name filled (commit render)");
      assert.equal(await ev(`document.querySelector("#liveList tbody.lv-vic .lv-ivc").textContent`), "?", "unknown iVi reads ? (no division to show)");
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});

describe("🎥 live DMG adds on any kill in a browser", () => {
  it("DMG adds on any kill (owner 2026-10-28): the meter counts the kill while the name is still …", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      await ev(`window.__fakeWs.emit(${death(ME.cid, SLOW.cid, "80", false)})`); // ME kills SLOW: 1.5 s lookup, the meter must not wait for it
      assert.equal(await ev(until(`document.querySelector("#liveDpsVal").textContent.includes("1/3")`)), true, "meter counts the kill at arrival");
      assert.ok(await ev(`document.querySelector("#liveList tbody.lv-vic .lv-nm").textContent.includes("…")`), "… and the name is still resolving");
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});

describe("🎥 live warm-up readout in a browser", () => {
  it("warm-up (owner 2026-10-26): small dark-gray 'Start at N/3' with the N/3 bigger inside, then a real number at 3", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      assert.equal(await ev(`document.querySelector("#liveDpsVal").textContent`), "Start at 0/3", "Start at 0/3 at load");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
      assert.equal(await ev(until(`document.querySelector("#liveDpsVal").textContent === "Start at 1/3"`)), true, "Start at 1/3 after one kill");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[1].cid, "80", false)})`);
      assert.equal(await ev(until(`document.querySelector("#liveDpsVal").textContent === "Start at 2/3"`)), true, "Start at 2/3 after two kills");
      const [valSize, fracSize] = await ev(`[getComputedStyle(document.querySelector("#liveDpsVal")).fontSize, getComputedStyle(document.querySelector("#liveDpsVal .live-dps-warm-n")).fontSize]`);
      assert.ok(parseFloat(fracSize) > parseFloat(valSize), `N/3 (${fracSize}) bigger than the small text (${valSize})`);
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[2].cid, "80", false)})`);
      assert.equal(await ev(until(`!document.querySelector("#liveDpsVal").textContent.includes("waiting")`)), true, "real DPM number at the 3rd spike");
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});

describe("🎥 live killer stays dim in a browser", () => {
  it("killer dim (owner 2026-10-26): a kill dims the old killer to 15% instead of clearing it, the next death replaces it at full opacity", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      await ev(`window.__fakeWs.emit(${death(OPP[0].cid, ME.cid, "80", false)})`); // OPP0 kills ME: killer row full
      assert.equal(await ev(until(`document.querySelector("#liveList tbody.lv-atk .lv-nm").textContent.includes(${JSON.stringify(OPP[0].name)})`)), true, "killer row shows the death");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[1].cid, "80", false)})`); // ME kills: old killer dims, stays
      assert.equal(await ev(until(`document.querySelector("#liveList tbody.lv-atk").classList.contains("lv-dim")`)), true, "old killer dims on your kill");
      assert.equal(await ev(`document.querySelector("#liveList tbody.lv-atk .lv-nm").textContent.includes(${JSON.stringify(OPP[0].name)})`), true, "dim row still names the old killer");
      assert.equal(await ev(`getComputedStyle(document.querySelector("#liveList tbody.lv-atk td")).opacity`), "0.15", "dim row at 15%");
      await ev(`window.__fakeWs.emit(${death(OPP[2].cid, ME.cid, "80", false)})`); // OPP2 kills ME: new killer at full opacity
      assert.equal(await ev(until(`document.querySelector("#liveList tbody.lv-atk .lv-nm").textContent.includes(${JSON.stringify(OPP[2].name)})`)), true, "new killer replaces the dim row");
      assert.equal(await ev(`document.querySelector("#liveList tbody.lv-atk").classList.contains("lv-dim")`), false, "new killer row is not dimmed");
      assert.equal(await ev(`getComputedStyle(document.querySelector("#liveList tbody.lv-atk td")).opacity`), "1", "new killer at full opacity");
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});

describe("🎥 live hold drops on death in a browser", () => {
  it("hold drop (owner 2026-10-26): death drops Recharge to zero; DPM value and debug box unchanged", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`); // spike before any death
      await ev(`window.__fakeWs.emit(${death(OPP[1].cid, ME.cid, "432", false)})`); // D1
      await new Promise((r) => setTimeout(r, 2000));
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[1].cid, "80", false)})`); // K1: hold gap ~2 s
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[2].cid, "80", false)})`); // K2: hold bar refills over the ~2 s median
      assert.equal(await ev(until(`parseFloat(document.getElementById("liveDpsHoldBar").style.width) >= 90`)), true, "hold bar full at the kill");
      await new Promise((r) => setTimeout(r, 2000)); // both scrolls + ease settle: the value must be stable before the death
      const dps0 = await ev(`document.getElementById("liveDpsVal").textContent`);
      const dbg0 = await ev(`document.getElementById("liveDbg").textContent`);
      await ev(`window.__fakeWs.emit(${death(OPP[2].cid, ME.cid, "432", false)})`); // D2
      assert.equal(await ev(until(`document.getElementById("liveDpsHoldBar").style.width === "0%"`)), true, "death drops Recharge to zero");
      const dps1 = await ev(`document.getElementById("liveDpsVal").textContent`);
      // owner 2026-10-26: the meter still decays normally between the two
      // reads (the freeze starts at the death, not at the first read),
      // so the pin is a tight band, not exact equality — a real drop
      // (DPH math touched) would be far outside it
      assert.ok(Math.abs(parseFloat(dps1) - parseFloat(dps0)) / parseFloat(dps0) < 0.02, `DPM value frozen within decay noise: ${dps0} -> ${dps1}`);
      assert.equal(await ev(`document.getElementById("liveDbg").textContent`), dbg0, "debug box unchanged: DPH math untouched");
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});

describe("🎥 live bar colors in a browser", () => {
  it("bar colors (owner 2026-10-26): main DPM fill is rainbow, Recharge fill is blue", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      const [dpm, hold] = await ev(`[getComputedStyle(document.querySelector("#liveDpsBar")).backgroundImage, getComputedStyle(document.querySelector("#liveDpsHoldBar")).backgroundImage]`);
      assert.ok(dpm.includes("linear-gradient") && dpm.includes("rgb(255, 23, 68)") && dpm.includes("rgb(0, 176, 255)"), `DPM rainbow: ${dpm}`);
      assert.ok(dpm.indexOf("rgb(124, 77, 255)") < dpm.indexOf("rgb(255, 23, 68)"), `DPM palette reversed: purple first, red last: ${dpm}`);
      assert.ok(hold.includes("linear-gradient") && hold.includes("rgb(25, 118, 210)"), `Recharge blue: ${hold}`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});

describe("🎥 live feed frame lines in a browser", () => {
  it("frame lines (owner 2026-10-26): death line above the table, Recharge below it, name column halved, names unclipped and centered", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      assert.equal(await ev(until(`document.querySelector("#liveList tbody.lv-me .lv-nm") !== null`)), true, "centre row on screen");
      const frame = await ev(`(() => { const wrap = document.getElementById("liveDeathLineWrap"); const hb = document.getElementById("liveDpsHoldBar"); const dps = document.getElementById("liveDps"); const tbl = document.getElementById("liveList"); const cs = getComputedStyle(tbl); const nm = document.querySelector("#liveList tbody.lv-me .lv-nm"); const pn = document.querySelector("#liveList tbody.lv-me .lv-pn"); const pnCs = getComputedStyle(pn); return { dlBefore: wrap.nextElementSibling.id, holdBeforeDps: dps.previousElementSibling.contains(hb), nmVar: cs.getPropertyValue("--lv-nm").trim(), fmVar: cs.getPropertyValue("--lv-fm").trim(), clip: nm.scrollHeight <= nm.clientHeight, centered: getComputedStyle(nm).textAlign, lhRatio: parseFloat(pnCs.lineHeight) / parseFloat(pnCs.fontSize) }; })()`);
      assert.equal(frame.dlBefore, "liveList", "death line wrap directly above the table");
      assert.equal(frame.holdBeforeDps, true, "Recharge sits between the table and the DPM block");
      assert.equal(frame.nmVar, "18.59rem", "name column +50% from halved (big tier at 1920px)");
      assert.ok(frame.lhRatio >= 1.2, `name line tall enough for descenders: ${frame.lhRatio}`);
      assert.equal(frame.fmVar, "1.9rem", "name font bumped ~12% (big tier at 1920px)");
      assert.equal(frame.clip, true, "centre name not clipped at the bigger font");
      assert.equal(frame.centered, "center", "centre name centered");
      assert.deepEqual(errors, [], "no page errors");
    });
  });
  it("frame lines on phones (owner 2026-10-26): name font 1.12rem, names unclipped", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      assert.equal(await ev(until(`document.querySelector("#liveList tbody.lv-me .lv-nm") !== null`)), true, "centre row on screen");
      const phone = await ev(`(() => { const tbl = document.getElementById("liveList"); const cs = getComputedStyle(tbl); const nm = document.querySelector("#liveList tbody.lv-me .lv-nm"); return { fmVar: cs.getPropertyValue("--lv-fm").trim(), clip: nm.scrollHeight <= nm.clientHeight }; })()`);
      assert.equal(phone.fmVar, "1.12rem", "phone name font bumped");
      assert.equal(phone.clip, true, "phone centre name not clipped");
      assert.deepEqual(errors, [], "no page errors");
    }, { width: 390, height: 844 });
  });
});

describe("🎥 live idle note in a browser", () => {
  it("idle note (owner 2026-10-26): 10 silent minutes swap the waiting line for may-be-offline-or-idle, dot and on class stay, first event clears it", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      assert.equal(await ev(until(`document.getElementById("liveState").textContent.includes("waiting for kills and deaths")`)), true, "waiting line on open");
      // jump the page clock 11 minutes past open (offset, still advancing) — the 100 ms tick then fires the idle note without a real wait
      await ev(`(() => { const real = Date.now; window.Date = class extends Date { static now() { return real() + 660000; } }; })()`);
      assert.equal(await ev(until(`document.getElementById("liveState").textContent.includes("may be offline or idle")`)), true, "idle note after 10 silent minutes");
      const st = await ev(`(() => { const el = document.getElementById("liveState"); return { dot: el.querySelector(".live-dot") !== null, cls: el.className }; })()`);
      assert.equal(st.dot, true, "blinking dot stays");
      assert.ok(st.cls.includes("on"), `on class stays: ${st.cls}`);
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`); // first kill
      assert.equal(await ev(until(`document.getElementById("liveState").textContent === ""`)), true, "first event clears the line");
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});

describe("🎥 live dynamic scale in a browser", () => {
  it("dynamic scale (owner 2026-10-26): bar full fits ME's pace, avg/p90 ticks sit at value/full", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      // ME is the top-adjs row in the harness cache; the scale follows once its row loads
      const adjs = named[0][ci("adjs")];
      const full = Math.max(1000, 2 * (0.385 + 0.000623 * adjs) * 1170);
      const avgLeft = Math.min(100, (514 / full) * 100), p90Left = Math.min(100, (1393 / full) * 100);
      assert.equal(await ev(until(`(() => { const [a, p] = [document.getElementById("liveDpmTickAvg").style.left, document.getElementById("liveDpmTickP90").style.left].map((s) => parseFloat(s)); return Math.abs(a - ${avgLeft}) < 0.6 && Math.abs(p - ${p90Left}) < 0.6; })()`)), true, `ticks at value/full for ME adjs ${adjs}: avg ${avgLeft.toFixed(1)}%, p90 ${p90Left.toFixed(1)}%`);
      const [a, p] = await ev(`[document.getElementById("liveDpmTickAvg").style.left, document.getElementById("liveDpmTickP90").style.left].map((s) => parseFloat(s))`);
      assert.ok(a < p, `avg tick left of p90 tick: ${a}% < ${p}%`);
      const titles = await ev(`[document.getElementById("liveDpmTickAvg").title, document.getElementById("liveDpmTickP90").title]`);
      assert.ok(titles[0].includes("514") && titles[1].includes("1393"), `tick tooltips name their values: ${titles}`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});

describe("🎥 live streamer mode in a browser", () => {
  it("streamer mode (owner 2026-10-26): one tap greens the page, outlines text, drops the counter below the bar, no back button", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      assert.equal(await ev(`document.getElementById("liveStreamBtn").textContent`), "Streamer mode", "switch button labelled");
      assert.equal(await ev(`document.body.classList.contains("live-stream")`), false, "normal mode at load");
      await ev(`document.getElementById("liveStreamBtn").click()`);
      assert.equal(await ev(`document.body.classList.contains("live-stream")`), true, "one tap switches to overlay mode");
      assert.equal(await ev(`getComputedStyle(document.body).backgroundColor`), "rgb(0, 255, 0)", "chromakey green background");
      assert.equal(await ev(`getComputedStyle(document.getElementById("liveStreamBtn")).display`), "none", "switch button hides itself — no button back");
      assert.ok(await ev(`location.search.includes("stream=1")`), "URL gains stream=1");
      const pos = await ev(`(() => { const bar = document.querySelector("#liveDps .live-bar"); const val = document.getElementById("liveDpsVal"); const b = bar.getBoundingClientRect(), v = val.getBoundingClientRect(); return [b.bottom, v.top]; })()`);
      assert.ok(pos[1] >= pos[0] - 1, `counter below the bar: bar bottom ${pos[0]}, val top ${pos[1]}`);
      const bg = await ev(`(() => { const cs = (el) => getComputedStyle(el); return { tbl: cs(document.getElementById("liveList")).backgroundColor, track: cs(document.querySelector("#liveDps .live-bar")).backgroundColor, hold: cs(document.getElementById("liveDpsHoldBar")).backgroundImage }; })()`);
      assert.equal(bg.tbl, "rgba(0, 0, 0, 0)", `table background drops out in stream mode: ${bg.tbl}`);
      assert.equal(bg.track, "rgba(0, 0, 0, 0)", `bar track drops out in stream mode: ${bg.track}`);
      assert.ok(bg.hold.includes("linear-gradient") && bg.hold.includes("13, 71, 161"), `Recharge is blue in stream mode: ${bg.hold}`);
      for (let i = 0; i < 3; i++) await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[i].cid, "80", false)})`);
      assert.equal(await ev(until(`document.getElementById("liveDpsLabel").textContent === "Damage"`)), true, "meter started");
      const st = await ev(`(() => { const cs = (el) => getComputedStyle(el); const v = document.getElementById("liveDpsVal"); const me = document.querySelector("#liveList tbody.lv-me td"); return { body: cs(document.body).webkitTextStrokeWidth, val: cs(v).webkitTextStrokeWidth, shadow: cs(v).textShadow, meBg: me ? cs(me).backgroundColor : "missing" }; })()`);
      assert.equal(st.body, "3px", `body vector stroke: ${JSON.stringify(st)}`);
      assert.equal(st.val, "4px", `counter vector stroke: ${JSON.stringify(st)}`);
      assert.equal(st.shadow, "none", `no shadows anywhere on the counter: ${JSON.stringify(st)}`);
      assert.equal(st.meBg, "rgba(0, 0, 0, 0)", `centre row tint drops out in stream mode: ${JSON.stringify(st)}`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});

describe("🎥 live voice lines panel in a browser", () => {
  it("voice lines panel (owner 2026-10-28): 5 fields prefilled with the default lines, edits persist, panel hides in stream mode", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      const vals = await ev(`[...document.querySelectorAll(".live-voice-line")].map((i) => [i.dataset.tier, i.value])`);
      assert.deepEqual(vals, [["--", "no contest"], ["-", "weaker"], ["≈", "even"], ["+", "strong"], ["++", "giant down"]], `fields prefilled: ${JSON.stringify(vals)}`);
      await ev(`(() => { const i = document.querySelector('.live-voice-line[data-tier="++"]'); i.value = "boss down"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
      assert.equal(await ev(until(`(JSON.parse(localStorage.getItem("ps2_live_voice_lines") || "{}"))["++"] === "boss down"`)), true, "edit persists to localStorage");
      await ev(`document.getElementById("liveStreamBtn").click()`);
      assert.equal(await ev(until(`getComputedStyle(document.getElementById("liveVoiceLines")).display === "none"`)), true, "panel hides in stream mode");
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});

describe("🎥 live bars follow the table in a browser", () => {
  it("bars follow the table (owner 2026-10-26): death-line wrap, Recharge, DPM block and track all as wide as the feed table", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      const ws = await ev(`(() => { const r = (el) => el.getBoundingClientRect().width; return { tbl: r(document.getElementById("liveList")), wrap: r(document.getElementById("liveDeathLineWrap")), hold: r(document.getElementById("liveDpsHoldBar").closest(".live-metric")), dps: r(document.getElementById("liveDps")), track: r(document.querySelector("#liveDps .live-bar")) }; })()`);
      const spread = Math.max(ws.tbl, ws.wrap, ws.hold, ws.dps, ws.track) - Math.min(ws.tbl, ws.wrap, ws.hold, ws.dps, ws.track);
      assert.ok(spread <= 2, `bars match the table width: ${JSON.stringify(ws)}`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });
  it("bars follow the table on phones (owner 2026-10-26): table and DPM block both fill the phone", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      const ws = await ev(`(() => { const r = (el) => el.getBoundingClientRect().width; return { tbl: r(document.getElementById("liveList")), dps: r(document.getElementById("liveDps")) }; })()`);
      assert.ok(Math.abs(ws.tbl - ws.dps) <= 2, `phone bars match the table width: ${JSON.stringify(ws)}`);
      assert.deepEqual(errors, [], "no page errors");
    }, { width: 390, height: 844 });
  });
});

describe("🎥 live Damage counter position in a browser", () => {
  it("counter below the bar (owner 2026-10-26): the Damage label + value line sits under the DPM bar in normal mode", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      for (let i = 0; i < 3; i++) await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[i].cid, "80", false)})`);
      assert.equal(await ev(until(`document.getElementById("liveDpsLabel").textContent === "Damage"`)), true, "meter started");
      const r = await ev(`(() => { const bar = document.querySelector("#liveDps .live-bar").getBoundingClientRect(); const lb = document.getElementById("liveDpsLabel").getBoundingClientRect(); const vl = document.getElementById("liveDpsVal").getBoundingClientRect(); return { barBottom: bar.bottom, lbTop: lb.top, vlTop: vl.top }; })()`);
      assert.ok(r.lbTop >= r.barBottom - 1, `label under the bar: ${JSON.stringify(r)}`);
      assert.ok(r.vlTop >= r.barBottom - 1, `value under the bar: ${JSON.stringify(r)}`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});
