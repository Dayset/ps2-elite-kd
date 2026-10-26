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
const TEAM = { cid: "5428000000000000999", name: "TeamMate" }; // same faction as ME (stub returns "1" for it)
const SLOW = { cid: "5428000000000000777", name: "Slowpoke" }; // #76: its Census lookup takes 1.5 s

/** Page-side fakes: Census REST (character lookups) and the push stream (window.__fakeWs.emit(payload)). */
const FAKES = `(() => {
  const ME = ${JSON.stringify(ME)}, OPP = ${JSON.stringify(OPP)}, SUB0 = ${JSON.stringify(SUB0)}, TEAM = ${JSON.stringify(TEAM)}, SLOW = ${JSON.stringify(SLOW)};
  const byCid = new Map([[ME.cid, ME], [SUB0.cid, SUB0], [TEAM.cid, TEAM], [SLOW.cid, SLOW], ...OPP.map((o) => [o.cid, o])]);
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const u = decodeURIComponent(typeof input === "string" ? input : input.url);
    if (u.includes("census.daybreakgames.com")) {
      if (/character\\?name\\.first_lower=/.test(u)) return Promise.resolve(json({ returned: 1, character_list: [{ character_id: ME.cid, name: { first: ME.name }, faction_id: "1" }] }));
      const m = u.match(/character_id=(\\d+)/);
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
  const proc = spawn(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--remote-debugging-pipe", "--user-data-dir=" + fs.mkdtempSync("/tmp/live-browser-"), "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
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
  }
}

const until = (cond, ms = 15000) => `new Promise(async (r) => { const end = Date.now() + ${ms}; while (Date.now() < end) { try { if (${cond}) return r(true); } catch {} await new Promise((q) => setTimeout(q, 50)); } r(false); })`;
/** Frames the ticker drew in one second: style changes inside the overlay arrive in one batch per frame. */
const framesPerSecond = `new Promise((r) => { let n = 0; const mo = new MutationObserver(() => { n++; }); mo.observe(document.getElementById("liveList"), { subtree: true, attributes: true, attributeFilter: ["style"] }); setTimeout(() => { mo.disconnect(); r(n); }, 1000); })`;
const death = (att, vic, weapon, hs) => JSON.stringify({ event_name: "Death", attacker_character_id: att, character_id: vic, attacker_weapon_id: weapon, is_headshot: hs ? "1" : "0", timestamp: "0" });

describe("🎥 live.html in a browser", () => {
  it("8 lines with weapon names + headshot marks, plain inf/zerg numbers, nothing that animates forever", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      // 6 kills (weapons: Orion, TRAC-5, NS-11A, Frag Grenade, knife, unknown), then a death by a headshot with C-4's id
      const kills = [["80", true], ["43", false], ["70998", true], ["44505", false], ["1", false], ["0", false]];
      for (const [i, [w, hs]] of kills.entries()) await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[i].cid, w, hs)})`);
      await ev(`window.__fakeWs.emit(${death(OPP[6].cid, ME.cid, "432", true)})`);
      assert.equal(await ev(until(`document.querySelectorAll("#liveList tbody.lv-vic:not(.lv-empty)").length === 6 && document.querySelector("#liveList tbody.lv-atk:not(.lv-empty)")`)), true, "6 victims + the killer on screen");
      assert.equal(await ev(until(`[...document.querySelectorAll("#liveList tbody.lv-vic .lv-wn")].map((w) => w.textContent).join("|").includes("Orion VS54")`)), true, "weapon names shown (catalog loaded)");
      const s = await ev(`(() => {
        const L = document.getElementById("liveList");
        const lines = [...L.querySelectorAll("tbody.lv-ev")];
        const vic = [...L.querySelectorAll("tbody.lv-vic")];
        const atk = L.querySelector("tbody.lv-atk");
        const me = L.querySelector("tbody.lv-me");
        const wnOf = (tb) => { const w = tb.querySelector(".lv-wn"); return w ? w.textContent : null; };
        const izOf = (tb) => { const w = tb.querySelector(".lv-iz"); return w ? w.textContent : null; };
        return {
          lines: lines.length,
          names: vic.map((t) => t.querySelector(".lv-name").textContent),
          victimWn: vic.map(wnOf),
          victimHs: vic.map((t) => !!t.querySelector(".lv-hs2")),
          victimIz: vic.map(izOf),
          killerWn: wnOf(atk),
          killerHs: !!atk.querySelector(".lv-hs2"),
          killerIz: izOf(atk),
          meWn: wnOf(me),
          meHs: !!me.querySelector(".lv-hs2"),
          meIz: izOf(me),
          noIcons: L.querySelectorAll(".lv-wi, .lv-wp, .lv-c-wp").length,
          noEmojis: L.querySelectorAll(".lv-em, .lv-sw, .lv-gl, .lv-c-em").length,
          nmW: Math.round(L.querySelector("tbody.lv-vic .lv-nm").getBoundingClientRect().width),
          svgFilters: document.querySelectorAll("filter").length,
          endless: document.getAnimations().filter((a) => !Number.isFinite(a.effect.getComputedTiming().endTime)).map((a) => a.animationName || (a.effect.target && a.effect.target.className)),
          noStar: !L.querySelector(".lv-g3") || getComputedStyle(L.querySelector(".lv-g3"), "::after").content === "none",
          hsTip: (atk.querySelector(".lv-hs2") || {}).dataset.tip,
        };
      })()`);
      assert.equal(s.lines, 8, "killer + centre + 6 victims");
      assert.deepEqual(s.names, OPP.slice(0, 6).map((o) => o.name).reverse(), "newest kill on top");
      assert.deepEqual(s.victimWn, ["", "Mag-Cutter", "Frag Grenade", "NS-11A", "TRAC-5", "Orion VS54"], "weapon name under the name per kill (unknown id = empty line)");
      assert.deepEqual(s.victimHs, [false, false, false, true, false, true], "headshot mark only on headshots");
      assert.equal(s.killerWn, "C-4");
      assert.equal(s.killerHs, true);
      assert.equal(s.hsTip, "Headshot");
      assert.equal(s.meWn, "❤️‍🔥".repeat(7), "no weapon on the centre line — 7 bounty slots, all dim after the death reset");
      assert.equal(s.meHs, false, "no headshot mark on the centre line");
      assert.equal(s.noIcons, 0, "no weapon icon column left");
      assert.equal(s.noEmojis, 0, "no emoji meters on the lines (parked)");
      assert.ok(s.nmW >= 280, `the name column absorbed the weapon column: ${s.nmW}px`);
      const izFmt = /^(?:\[\d+\/(?:~\d+|\d+|–)\]|\[–\/(?:~\d+|\d+)\]|)$/;
      for (const t of [...s.victimIz, s.killerIz, s.meIz]) assert.match(t, izFmt, `inf/zerg cell: ${t}`);
      assert.ok([...s.victimIz, s.killerIz, s.meIz].some((t) => t !== ""), "at least one inf/zerg value on screen");
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
      assert.equal(await ev(until(`document.querySelectorAll("#liveList tbody.lv-vic:not(.lv-empty)").length === 6`)), true, "lines on screen");
      const fps = await ev(framesPerSecond);
      assert.ok(fps < 5, `no per-frame style mutations with the meters parked: ${fps}`);
      assert.deepEqual(errors, [], "no page errors");
    }, { query: "&fps=60" });
  });
});

  it("bounty (owner 2026-10-25): hearts per kill on the centre line, 💰💰💰 at 7, one removed per death", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      const slots = () => ev(`(() => { const w = document.querySelector("#liveList tbody.lv-me .lv-wn"); if (!w) return null; const all = w.querySelectorAll(".lv-bh"); return { text: w.textContent, total: all.length, filled: [...all].filter((b) => !b.classList.contains("lv-bh-empty")).length }; })()`);
      const slotsAre = async (total, filled, why) => assert.equal(await ev(until(`(() => { const w = document.querySelector("#liveList tbody.lv-me .lv-wn"); if (!w) return false; const all = w.querySelectorAll(".lv-bh"); return all.length === ${total} && [...all].filter((b) => !b.classList.contains("lv-bh-empty")).length === ${filled}; })()`)), true, why);
      const bountyIs = async (t, why) => assert.equal(await ev(until(`document.querySelector("#liveList tbody.lv-me .lv-wn").textContent === ${JSON.stringify(t)}`)), true, why);
      await slotsAre(7, 0, "7 slots, none filled, before any kill");
      for (let i = 0; i < 3; i++) await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[i].cid, "80", false)})`);
      await slotsAre(7, 3, "each kill fills one slot");
      await ev(`window.__fakeWs.emit(${death(OPP[0].cid, ME.cid, "432", false)})`);
      await slotsAre(7, 0, "a death below 7 empties the slots");
      for (let i = 0; i < 7; i++) await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[i].cid, "80", false)})`);
      await bountyIs("💰💰💰", "the 7th kill flips the slots to three bounty marks");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
      await bountyIs("💰💰💰", "a kill while bountied changes nothing");
      await ev(`window.__fakeWs.emit(${death(OPP[0].cid, ME.cid, "432", false)})`);
      await bountyIs("💰💰", "the 1st death removes one bounty mark");
      await ev(`window.__fakeWs.emit(${death(OPP[1].cid, ME.cid, "432", false)})`);
      await bountyIs("💰", "the 2nd death removes another, one left");
      await ev(`window.__fakeWs.emit(${death(OPP[2].cid, ME.cid, "432", false)})`);
      await slotsAre(7, 0, "the 3rd death clears the bounty back to empty slots");
      assert.deepEqual(errors, [], "no page errors");
    });
  });

  it("imaginary DPM (owner 2026-10-25): warm-up bumps to 3, then it drains, an assist adds half a kill", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      const dps = () => ev(`Number(document.getElementById("liveDpsVal").textContent)`);
      assert.equal(await ev(until(`document.getElementById("liveDpsVal").textContent === "0/3"`)), true, "meter waits at 0/3");
      assert.equal(await ev(`document.getElementById("liveDpsLabel").textContent`), "DPM starts at 3", "warm-up explains the wait");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
      assert.equal(await ev(until(`document.getElementById("liveDpsVal").textContent === "1/3"`)), true, "first kill bumps the count");
      const gain = JSON.stringify({ event_name: "GainExperience", character_id: ME.cid, experience_id: 2, amount: 100, timestamp: "0" });
      await ev(`window.__fakeWs.emit(${gain})`);
      assert.equal(await ev(until(`document.getElementById("liveDpsVal").textContent === "2/3"`)), true, "an assist bumps the count too");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[1].cid, "80", false)})`);
      const afterKill = await ev(until(`Number(document.getElementById("liveDpsVal").textContent) >= 10000`)) && await dps();
      assert.ok(afterKill >= 10000, `the 3rd chunk starts the meter high: ${afterKill}`);
      assert.equal(await ev(`document.getElementById("liveDpsLabel").textContent`), "DPM", "label back to DPM once started");
      await new Promise((r) => setTimeout(r, 2500));
      const drained = await dps();
      assert.ok(drained < afterKill && drained > 3000, `DPM drains down after the start: ${drained}`);
      await ev(`window.__fakeWs.emit(${gain})`);
      const afterAssist = await ev(until(`Number(document.getElementById("liveDpsVal").textContent) > ${drained + 2000}`)) && await dps();
      assert.ok(afterAssist > drained + 2000, `an assist adds ~3000: ${drained} -> ${afterAssist}`);
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

  it("adjustable tau (owner 2026-10-25): changing tau rescales DPM live", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      assert.equal(await ev(`document.getElementById("liveDpmTauVal").value`), "10", "tau defaults to 10 s");
      for (let i = 0; i < 3; i++) await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[i].cid, "80", false)})`); // three chunks to start the meter
      const afterKill = await ev(until(`Number(document.getElementById("liveDpsVal").textContent) >= 15000`)) && await ev(`Number(document.getElementById("liveDpsVal").textContent)`);
      assert.ok(afterKill >= 15000, `tau=10 s three kills spike high: ${afterKill}`);
      await ev(`document.getElementById("liveDpmTauVal").value = "60"; document.getElementById("liveDpmTauVal").dispatchEvent(new Event("change", { bubbles: true }));`);
      // the counter glides to the rescaled value instead of jumping — wait
      // for the glide to converge, not just to cross 5000 mid-glide
      const afterTau = await ev(until(`Number(document.getElementById("liveDpsVal").textContent) < 3200`)) && await ev(`Number(document.getElementById("liveDpsVal").textContent)`);
      assert.ok(afterTau > 2500 && afterTau < 3200, `tau=60 s rescales the same kills to ~2900: ${afterTau}`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });

  it("teamkill (owner 2026-10-25): own-faction kills farm nothing, own-faction deaths still spend bounty", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      const slotsAre = async (total, filled, why) => assert.equal(await ev(until(`(() => { const w = document.querySelector("#liveList tbody.lv-me .lv-wn"); if (!w) return false; const all = w.querySelectorAll(".lv-bh"); return all.length === ${total} && [...all].filter((b) => !b.classList.contains("lv-bh-empty")).length === ${filled}; })()`)), true, why);
      const bountyIs = async (t, why) => assert.equal(await ev(until(`document.querySelector("#liveList tbody.lv-me .lv-wn").textContent === ${JSON.stringify(t)}`)), true, why);
      await ev(`window.__fakeWs.emit(${death(ME.cid, TEAM.cid, "80", false)})`);
      // #76: the row lands on arrival and is retracted when the commit proves the same faction
      assert.equal(await ev(until(`document.querySelectorAll("#liveList tbody.lv-vic:not(.lv-empty)").length === 0 && !document.querySelector("#liveList .lv-pend")`)), true, "a teamkill leaves no victim row");
      assert.equal(await ev(`document.getElementById("liveDpsVal").textContent`), "0/3", "a teamkill adds no DPM chunk");
      await slotsAre(7, 0, "a teamkill fills no heart");
      for (let i = 0; i < 7; i++) await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[i].cid, "80", false)})`);
      await bountyIs("💰💰💰", "7 enemy kills earn three bounty marks");
      await ev(`window.__fakeWs.emit(${death(TEAM.cid, ME.cid, "432", false)})`);
      await bountyIs("💰💰", "a death to your own faction still spends one bounty mark");
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
      // new run, rapid fire: the slow victim first, then three fast ones, all in the same task
      const burst = [SLOW.cid, ...OPP.slice(0, 3).map((o) => o.cid)].map((c) => `window.__fakeWs.emit(${death(ME.cid, c, "80", false)});`).join(" ");
      await ev(burst);
      const now = await ev(names);
      assert.equal(now.length, 5, `every row lands on arrival (4 new + the old run's, not yet cleared): ${now}`);
      assert.equal(now[3], "…", "the slow victim shows … in the name while its lookup runs");
      assert.ok(!now.join("|").includes("#"), "no raw #id on screen");
      // the fast victims' names fill in before the slow lookup lands
      assert.equal(await ev(until(`${names}.slice(0, 3).join("|") === ${JSON.stringify(OPP.slice(0, 3).map((o) => o.name).reverse().join("|"))}`, 1200)), true, "later kills are not held back by the slow lookup");
      // after the slow lookup: the old run is cleared, all four new rows stay, newest on top
      assert.equal(await ev(until(`${names}.join("|") === ${JSON.stringify([...OPP.slice(0, 3).map((o) => o.name).reverse(), SLOW.name].join("|"))}`)), true, "all four rows of the new run, old run cleared");
      assert.deepEqual(errors, [], "no page errors");
    });
  });

  it("cash-out (owner 2026-10-25): victims' iVi summed + averaged next to DPM, live on the tick", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      assert.equal(await ev(until(`document.getElementById("liveCashSumVal").textContent === "0"`)), true, "cash sum starts at 0");
      assert.equal(await ev(until(`document.getElementById("liveCashAvgVal").textContent === "–"`)), true, "cash avg starts empty");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[1].cid, "80", false)})`);
      assert.equal(await ev(until(`document.querySelectorAll("#liveList tbody.lv-vic:not(.lv-empty)").length === 2`)), true, "two victim rows on screen");
      assert.equal(await ev(`getComputedStyle(document.querySelector("#liveList tbody.lv-vic .lv-iz")).textAlign`), "left", "the inf/zerg cell aligns left");
      const ivs = await ev(`[...document.querySelectorAll("#liveList tbody.lv-vic .lv-iv")].map((e) => Number(e.textContent))`);
      assert.ok(ivs.length === 2 && ivs.every(Number.isFinite) && ivs.every((v) => v > 0), `both victims show an iVi: ${ivs}`);
      const b = (v) => Math.round(v * 1.34);
      const sum = b(ivs[1]) + b(ivs[0]), avg = (sum / 2).toFixed(1), formula = `${sum} (${b(ivs[1])} + ${b(ivs[0])})+34%`; // rows are newest-first, the formula is kill order; parts are boosted
      // ±1 tolerance, like the cashed-out-runs test: the page boosts RAW
      // adjs while the test only sees ROUNDED displays, so a fixture
      // drifting across a rounding boundary shifts a part by 1 (seen
      // 2026-10-25: raw ~1401.2 displays 1401 but boosts to 1878, not 1877)
      assert.equal(await ev(until(`document.getElementById("liveCashSumVal").textContent.includes(" + ")`)), true, `cash sum shows the formula: ${formula}`);
      const sumText = await ev(`document.getElementById("liveCashSumVal").textContent`);
      const m = sumText.match(/^(\d+) \((\d+) \+ (\d+)\)\+34%$/);
      assert.ok(m, `formula parses: ${sumText}`);
      assert.ok(Math.abs(Number(m[2]) - b(ivs[1])) <= 1 && Math.abs(Number(m[3]) - b(ivs[0])) <= 1, `parts within 1 of display-derived: ${sumText} vs ${formula}`);
      assert.equal(Number(m[1]), Number(m[2]) + Number(m[3]), "sum matches its parts");
      const avgText = await ev(`document.getElementById("liveCashAvgVal").textContent`);
      assert.ok(Math.abs(Number(avgText) - Number(avg)) <= 1.0, `cash avg is per victim: ${avgText} vs ${avg}`);
      // the killer does not pay: ME dies, the run is banked and the pot resets for the new run
      await ev(`window.__fakeWs.emit(${death(OPP[2].cid, ME.cid, "432", false)})`);
      assert.equal(await ev(until(`document.getElementById("liveCashSumVal").textContent === "0"`)), true, "the pot resets for the new run");
      assert.equal(await ev(until(`document.getElementById("liveCashAvgVal").textContent === "–"`)), true, "the avg empties with the pot");
      assert.equal(await ev(until(`document.querySelectorAll("#liveCashHist > div").length === 2`)), true, "one banked run in the history");
      assert.equal(await ev(`document.querySelectorAll("#liveCashHist > div")[1].textContent`), `Σ ${sumText} · avg ${avgText}`, "the banked run keeps its formula");
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
      const pot = () => ev(`[document.getElementById("liveCashSumVal").textContent, document.getElementById("liveCashAvgVal").textContent]`);
      const histEntries = () => ev(`[...document.querySelectorAll("#liveCashHist > div")].slice(1).map((d) => d.textContent)`);
      const runSums = [];
      for (let i = 0; i < 6; i++) {
        await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[i].cid, "80", false)})`);
        assert.equal(await ev(until(`document.querySelector("#liveList tbody.lv-vic .lv-iv") && Number(document.querySelector("#liveList tbody.lv-vic .lv-iv").textContent) > 0`)), true, `run ${i + 1}: victim iVi on screen`);
        runSums.push(await ev(`Number(document.querySelector("#liveList tbody.lv-vic .lv-iv").textContent)`));
        await ev(`window.__fakeWs.emit(${death(OPP[6].cid, ME.cid, "432", false)})`);
        assert.deepEqual(await ev(until(`document.getElementById("liveCashSumVal").textContent === "0" && document.getElementById("liveCashAvgVal").textContent === "–" && document.querySelectorAll("#liveCashHist > div").length === ${Math.min(i + 2, 6)}`)), true, `run ${i + 1}: banked, pot reset`);
      }
      const entries = await histEntries();
      assert.equal(entries.length, 5, "history caps at 5 runs");
      const b5 = Math.round(runSums[5] * 1.34), b0 = Math.round(runSums[0] * 1.34);
      const entrySum = (e) => Number(e.match(/Σ (\d+)\+34%/)?.[1]);
      assert.ok(Math.abs(entrySum(entries[0]) - b5) <= 1, `newest run first (within display rounding: the row iVi is already rounded, the pot boosts the raw value): ${entries[0]} vs ${b5}`);
      assert.ok(!entries.map(entrySum).some((v) => Math.abs(v - b0) <= 1), "the oldest run dropped off");
      assert.deepEqual(await pot(), ["0", "–"], "pot empty after the last run ends");
      assert.deepEqual(errors, [], "no page errors");
    });
  });

  it("sub-0 floor (owner 2026-10-25): a negative-iVi victim pays 0, never subtracts", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    // The fixture proof is data-side: SUB0's cached adjs is negative. The
    // feed cell itself already floors (adjs column floorZero), so the
    // screen shows 0 for them — the pot must now match that, not go below.
    assert.ok(sub0row[ci("adjs")] < -100, `SUB0 is genuinely sub-0 in the cache: ${sub0row[ci("adjs")]}`);
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      await ev(`window.__fakeWs.emit(${death(ME.cid, SUB0.cid, "80", false)})`);
      assert.equal(await ev(until(`document.querySelector("#liveList tbody.lv-vic .lv-iv") && document.querySelector("#liveList tbody.lv-vic .lv-iv").textContent === "0"`)), true, "the feed already floors their shown iVi at 0");
      assert.equal(await ev(until(`document.getElementById("liveCashSumVal").textContent === "0"`)), true, "the floored payout is 0, not negative");
      assert.equal(await ev(until(`document.getElementById("liveCashAvgVal").textContent === "0.0"`)), true, "a known 0 payout counts in the average");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
      assert.equal(await ev(until(`document.querySelectorAll("#liveList tbody.lv-vic:not(.lv-empty)").length === 2`)), true, "two victims on screen");
      const ivs = await ev(`[...document.querySelectorAll("#liveList tbody.lv-vic .lv-iv")].map((e) => Number(e.textContent))`);
      assert.ok(ivs[0] > 0 && ivs[1] === 0, `newest victim positive, sub-0 victim shown floored: ${ivs}`);
      const bp = Math.round(ivs[0] * 1.34);
      // ±1 tolerance (same rounding-boundary note as the cash-out test):
      // the page boosts the raw adj, the test only sees the rounded display
      assert.equal(await ev(until(`document.getElementById("liveCashSumVal").textContent.includes("(0 + ")`)), true, "the pot shows the boosted formula: floored 0 plus the boosted payout");
      const sumText = await ev(`document.getElementById("liveCashSumVal").textContent`);
      const m = sumText.match(/^(\d+) \(0 \+ (\d+)\)\+34%$/);
      assert.ok(m, `formula parses: ${sumText}`);
      assert.ok(Math.abs(Number(m[2]) - bp) <= 1, `boosted part within 1 of display-derived ${bp}: ${m[2]}`);
      assert.equal(Number(m[1]), Number(m[2]), "sum is the boosted part alone (floored 0 adds nothing)");
      const avgText = await ev(`document.getElementById("liveCashAvgVal").textContent`);
      assert.ok(Math.abs(Number(avgText) - bp / 2) <= 1.0, `the average counts the floored 0: ${avgText} vs ${bp / 2}`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });

describe("🎥 live hold meter in a browser", () => {
  it("hold (owner 2026-10-25): two clean 12 s gaps hold the line flat — DPM stays above 8000 eight seconds after the fourth kill", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      assert.equal(await ev(until(`document.getElementById("liveDpsHold").textContent === "hold 0s"`)), true, "no gaps yet: hold 0s");
      // Two throwaway kills first: the first commit loads the ranks, so the
      // gap it spans is dirty (~1 s of load time) — the sleeps below start
      // after commits, so only gaps between fast commits measure cleanly.
      // The median absorbs the dirty gap: median(1 s, 12 s, 12 s) = 12 s.
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
      assert.equal(await ev(until(`document.getElementById("liveDpsVal").textContent === "1/3"`)), true, "first kill bumps the count");
      assert.equal(await ev(`document.getElementById("liveDpsHold").textContent`), "hold 0s", "one spike: still no gap, hold 0s");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[1].cid, "80", false)})`);
      assert.equal(await ev(until(`document.getElementById("liveDpsVal").textContent === "2/3"`)), true, "second kill bumps the count");
      await new Promise((r) => setTimeout(r, 12000)); // a slow player's real gap, cleanly measured
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[2].cid, "80", false)})`);
      assert.equal(await ev(until(`Number(document.getElementById("liveDpsVal").textContent) >= 10000`)), true, "third kill starts the meter held");
      await new Promise((r) => setTimeout(r, 12000)); // the same gap again
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[3].cid, "80", false)})`);
      await new Promise((r) => setTimeout(r, 8000)); // 8 s after the fourth kill — inside the 12 s hold
      const dpm = await ev(`Number(document.getElementById("liveDpsVal").textContent)`);
      assert.ok(dpm > 8000, `held DPM stays above 8000 (with no hold it would be ~3900 here): ${dpm}`);
      assert.equal(await ev(`document.getElementById("liveDpsHold").textContent`), "hold 12s", "median of the gaps: hold 12s");
      assert.deepEqual(errors, [], "no page errors");
    });
  });

  it("freeze (owner 2026-10-25): decay pauses on death for the average spawn run — DPM holds its death value", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
      assert.equal(await ev(until(`document.getElementById("liveDpsVal").textContent === "1/3"`)), true, "first kill bumps the count");
      await ev(`window.__fakeWs.emit(${death(OPP[1].cid, ME.cid, "432", false)})`); // death 1: no average yet, so no freeze
      await new Promise((r) => setTimeout(r, 5000)); // the spawn run, measured
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[1].cid, "80", false)})`); // kill 2: measures the 5 s run (and clears the old run's row)
      assert.equal(await ev(until(`document.querySelectorAll("#liveList tbody.lv-vic:not(.lv-empty)").length === 1`)), true, "second kill on screen");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[2].cid, "80", false)})`); // kill 3: starts the meter
      assert.equal(await ev(until(`Number(document.getElementById("liveDpsVal").textContent) >= 10000`)), true, "third kill starts the meter");
      await ev(`window.__fakeWs.emit(${death(OPP[3].cid, ME.cid, "432", false)})`); // death 2: freeze for the 5 s average
      await new Promise((r) => setTimeout(r, 300)); // let the death commit and the tick freeze
      const atDeath = await ev(`Number(document.getElementById("liveDpsVal").textContent)`);
      await new Promise((r) => setTimeout(r, 4000)); // 4 s into the 5 s freeze
      const held = await ev(`Number(document.getElementById("liveDpsVal").textContent)`);
      assert.ok(held >= atDeath * 0.95, `frozen DPM holds its death value (with no freeze it would drain to ~67%): ${atDeath} -> ${held}`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});

describe("🎥 live gas-counter scroll in a browser", () => {
  it("scroll (owner 2026-10-25): the counter rolls ease-in — barely moves at first, then rushes the jump", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      for (let i = 0; i < 3; i++) await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[i].cid, "80", false)})`);
      const base = await ev(until(`Number(document.getElementById("liveDpsVal").textContent) > 10000`)) && await ev(`Number(document.getElementById("liveDpsVal").textContent)`);
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[3].cid, "80", false)})`); // 4th kill: one 6000 scroll
      const v0 = await ev(`Number(document.getElementById("liveDpsVal").textContent)`);
      assert.ok(v0 < base + 2000, `slow start: barely moved right after the kill: ${base} -> ${v0}`);
      assert.equal(await ev(until(`Number(document.getElementById("liveDpsVal").textContent) > ${base + 1000}`)), true, "scroll underway");
      await new Promise((r) => setTimeout(r, 500));
      const v1 = await ev(`Number(document.getElementById("liveDpsVal").textContent)`);
      assert.ok(v1 > v0 + 2000, `speeding up: the rush phase gained 2000+ in 500 ms: ${v0} -> ${v1}`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });

  it("queue (owner 2026-10-25): two quick kills scroll one by one — still rising after the first scroll's time", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      for (let i = 0; i < 3; i++) await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[i].cid, "80", false)})`);
      const base = await ev(until(`Number(document.getElementById("liveDpsVal").textContent) > 10000`)) && await ev(`Number(document.getElementById("liveDpsVal").textContent)`);
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[3].cid, "80", false)})`);
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[4].cid, "80", false)})`); // two scrolls queued, 6000 each
      // no sleeps: a loaded machine overshoots setTimeout past the second
      // scroll, so poll for the value states instead — the counter only
      // rises while a scroll plays, so each crossing pins the order
      assert.equal(await ev(until(`Number(document.getElementById("liveDpsVal").textContent) > ${base + 5000}`)), true, "first scroll landed");
      const vMid = await ev(`Number(document.getElementById("liveDpsVal").textContent)`);
      assert.ok(vMid < base + 11000, `second scroll not yet landed: ${base} -> ${vMid}`);
      assert.equal(await ev(until(`Number(document.getElementById("liveDpsVal").textContent) > ${base + 10000}`)), true, "second scroll landed");
      const vEnd = await ev(`Number(document.getElementById("liveDpsVal").textContent)`);
      assert.ok(vEnd < base + 12500, `both scrolls kept, no overshoot: ${base} -> ${vEnd}`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });

  it("death waits (owner 2026-10-25): a death never cuts a scroll, and three deaths at once leave the meter safe", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      for (let i = 0; i < 3; i++) await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[i].cid, "80", false)})`);
      assert.equal(await ev(until(`Number(document.getElementById("liveDpsVal").textContent) > 10000`)), true, "meter started");
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
      assert.equal(await ev(until(`Number(document.getElementById("liveDpsVal").textContent) > ${Number(f2) + 1000}`)), true, "a kill after the deaths scrolls up again");
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});


describe("🎥 live death-anchored hold in a browser", () => {
  it("hold A (owner 2026-10-25): a death plus two kills sets the hold from the death, not just between kills", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      assert.equal(await ev(until(`document.getElementById("liveDpsHold").textContent === "hold 0s"`)), true, "no gaps yet: hold 0s");
      await ev(`window.__fakeWs.emit(${death(OPP[0].cid, ME.cid, "432", false)})`); // death first: the anchor
      await new Promise((r) => setTimeout(r, 4000));
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[1].cid, "80", false)})`); // kill 1: 4 s after the death
      await new Promise((r) => setTimeout(r, 2000));
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[2].cid, "80", false)})`); // kill 2: 2 s after kill 1
      // pool [4 s, 2 s] → median 3 s; the old within-run-only hold would say 2 s
      assert.equal(await ev(until(`document.getElementById("liveDpsHold").textContent === "hold 3s"`)), true, "death-anchored median: hold 3s");
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});

describe("🎥 live combat average in a browser", () => {
  it("combat average (owner 2026-10-25): median of ALL death→first-combat runs, shown next to hold", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      // before any death→combat run: the span is empty and its separator hidden
      assert.equal(await ev(until(`document.getElementById("liveDpsCombat").textContent === "" && document.getElementById("liveDpsCombatSep").style.display === "none"`)), true, "no run yet: combat hidden");
      await ev(`window.__fakeWs.emit(${death(OPP[0].cid, ME.cid, "432", false)})`); // death 1
      await new Promise((r) => setTimeout(r, 4000));
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[1].cid, "80", false)})`); // combat 4 s after death 1
      assert.equal(await ev(until(`document.getElementById("liveDpsCombat").textContent === "combat 4s (n=1)"`)), true, "first run: combat 4s (n=1)");
      // the combat span sits in the same DPM row, right after hold
      assert.equal(await ev(`document.getElementById("liveDpsCombat").previousElementSibling.id === "liveDpsCombatSep" && document.getElementById("liveDpsCombatSep").previousElementSibling.id === "liveDpsHold"`), true, "combat sits right after hold");
      await ev(`window.__fakeWs.emit(${death(OPP[2].cid, ME.cid, "432", false)})`); // death 2
      await new Promise((r) => setTimeout(r, 8000));
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[3].cid, "80", false)})`); // combat 8 s after death 2
      // median([4 s, 8 s]) = 6 s, over both deaths — the trailing-10 freeze/hold caps don't apply here
      assert.equal(await ev(until(`document.getElementById("liveDpsCombat").textContent === "combat 6s (n=2)"`)), true, "all deaths: combat 6s (n=2)");
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
      assert.equal(await ev(until(`document.getElementById("liveDpsVal").textContent === "1/3"`)), true, "kill on the new socket counts");
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});
