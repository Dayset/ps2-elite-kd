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

/** Page-side fakes: Census REST (character lookups) and the push stream (window.__fakeWs.emit(payload)). */
const FAKES = `(() => {
  const ME = ${JSON.stringify(ME)}, OPP = ${JSON.stringify(OPP)}, SUB0 = ${JSON.stringify(SUB0)};
  const byCid = new Map([[ME.cid, ME], [SUB0.cid, SUB0], ...OPP.map((o) => [o.cid, o])]);
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const u = decodeURIComponent(typeof input === "string" ? input : input.url);
    if (u.includes("census.daybreakgames.com")) {
      if (/character\\?name\\.first_lower=/.test(u)) return Promise.resolve(json({ returned: 1, character_list: [{ character_id: ME.cid, name: { first: ME.name }, faction_id: "1" }] }));
      const m = u.match(/character_id=(\\d+)/);
      if (m && byCid.has(m[1])) { const p = byCid.get(m[1]); return Promise.resolve(json({ returned: 1, character_list: [{ character_id: p.cid, name: { first: p.name }, faction_id: "2" }] })); }
      return Promise.resolve(json({ returned: 0, character_list: [] }));
    }
    if (/workers\\.dev|honu|ps2radar/.test(u)) return Promise.resolve(new Response("", { status: 404 }));
    return realFetch(input, init);
  };
  class FakeWs {
    constructor() { window.__fakeWs = this; this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 0); }
    send() {}
    close() { this.readyState = 3; }
    emit(payload) { this.onmessage && this.onmessage({ data: JSON.stringify({ type: "serviceMessage", service: "event", payload }) }); }
  }
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

  it("bounty (owner 2026-10-25): hearts per kill on the centre line, 💰 at 7 held for 3 deaths", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
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
      await bountyIs("💰", "the 7th kill flips the slots to the bounty mark");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
      await bountyIs("💰", "a kill while bountied changes nothing");
      await ev(`window.__fakeWs.emit(${death(OPP[0].cid, ME.cid, "432", false)})`);
      await bountyIs("💰", "bounty held after the 1st death");
      await ev(`window.__fakeWs.emit(${death(OPP[1].cid, ME.cid, "432", false)})`);
      await bountyIs("💰", "bounty held after the 2nd death");
      await ev(`window.__fakeWs.emit(${death(OPP[2].cid, ME.cid, "432", false)})`);
      await slotsAre(7, 0, "the 3rd death clears the bounty back to empty slots");
      assert.deepEqual(errors, [], "no page errors");
    });
  });

  it("imaginary DPM (owner 2026-10-25): kill jumps it, it drains, an assist adds half a kill", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      const dps = () => ev(`Number(document.getElementById("liveDpsVal").textContent)`);
      assert.equal(await ev(until(`document.getElementById("liveDpsVal").textContent === "0.0"`)), true, "DPM starts at 0.0");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
      const afterKill = await ev(until(`Number(document.getElementById("liveDpsVal").textContent) >= 5000`)) && await dps();
      assert.ok(afterKill >= 5000 && afterKill <= 6000, `a kill jumps DPM to ~6000: ${afterKill}`);
      await new Promise((r) => setTimeout(r, 2500));
      const drained = await dps();
      assert.ok(drained < afterKill && drained > 3000, `DPM drains down after the kill: ${drained}`);
      const gain = JSON.stringify({ event_name: "GainExperience", character_id: ME.cid, experience_id: 2, amount: 100, timestamp: "0" });
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

  it("cash-out (owner 2026-10-25): victims' iVi summed + averaged next to DPM, live on the tick", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      assert.equal(await ev(until(`document.getElementById("liveCashSumVal").textContent === "0"`)), true, "cash sum starts at 0");
      assert.equal(await ev(until(`document.getElementById("liveCashAvgVal").textContent === "–"`)), true, "cash avg starts empty");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[1].cid, "80", false)})`);
      assert.equal(await ev(until(`document.querySelectorAll("#liveList tbody.lv-vic:not(.lv-empty)").length === 2`)), true, "two victim rows on screen");
      const ivs = await ev(`[...document.querySelectorAll("#liveList tbody.lv-vic .lv-iv")].map((e) => Number(e.textContent))`);
      assert.ok(ivs.length === 2 && ivs.every(Number.isFinite) && ivs.every((v) => v > 0), `both victims show an iVi: ${ivs}`);
      const sum = ivs[0] + ivs[1], avg = (sum / 2).toFixed(1);
      assert.equal(await ev(until(`document.getElementById("liveCashSumVal").textContent === "${sum}"`)), true, `cash sum is the victims' iVi: ${sum}`);
      assert.equal(await ev(until(`document.getElementById("liveCashAvgVal").textContent === "${avg}"`)), true, `cash avg is per victim: ${avg}`);
      // the killer does not pay: ME dies, the run is banked and the pot resets for the new run
      await ev(`window.__fakeWs.emit(${death(OPP[2].cid, ME.cid, "432", false)})`);
      assert.equal(await ev(until(`document.getElementById("liveCashSumVal").textContent === "0"`)), true, "the pot resets for the new run");
      assert.equal(await ev(until(`document.getElementById("liveCashAvgVal").textContent === "–"`)), true, "the avg empties with the pot");
      assert.equal(await ev(until(`document.querySelectorAll("#liveCashHist > div").length === 2`)), true, "one banked run in the history");
      assert.equal(await ev(`document.querySelectorAll("#liveCashHist > div")[1].textContent`), `Σ ${sum} · avg ${avg}`, "the banked run keeps its total");
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
      let texts = await vicTexts();
      assert.equal(texts.length, 2, "old run's names stay through the death");
      assert.ok(texts.join("|").includes(OPP[0].name) && texts.join("|").includes(OPP[1].name), "old names still on screen");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[3].cid, "80", false)})`);
      assert.equal(await ev(until(`document.querySelectorAll("#liveList tbody.lv-vic:not(.lv-empty)").length === 1`)), true, "one victim after the new streak's first kill");
      texts = await vicTexts();
      assert.ok(texts[0].includes(OPP[3].name), "the new name lands alone below");
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
      assert.equal(entries[0], `Σ ${runSums[5]} · avg ${runSums[5].toFixed(1)}`, "newest run first");
      assert.ok(!entries.join("|").includes(`Σ ${runSums[0]} `), "the oldest run dropped off");
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
      assert.equal(await ev(until(`document.getElementById("liveCashSumVal").textContent === "${ivs[0]}"`)), true, "the pot holds only the positive payout");
      assert.equal(await ev(until(`document.getElementById("liveCashAvgVal").textContent === "${(ivs[0] / 2).toFixed(1)}"`)), true, "the average counts the floored 0");
      assert.deepEqual(errors, [], "no page errors");
    });
  });
