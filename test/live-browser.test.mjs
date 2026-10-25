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

/** Page-side fakes: Census REST (character lookups) and the push stream (window.__fakeWs.emit(payload)). */
const FAKES = `(() => {
  const ME = ${JSON.stringify(ME)}, OPP = ${JSON.stringify(OPP)};
  const byCid = new Map([[ME.cid, ME], ...OPP.map((o) => [o.cid, o])]);
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
      assert.equal(await ev(until(`document.getElementById("liveDpsVal").textContent === "0.000"`)), true, "DPM starts at 0.000");
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

  it("trends (owner 2026-10-25): interval lines only, faction colours, 3-item legend", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[0].cid, "80", false)})`);
      await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[1].cid, "80", false)})`);
      await ev(`window.__fakeWs.emit(${death(OPP[2].cid, ME.cid, "432", false)})`);
      await ev(`window.__fakeWs.emit(${death(OPP[3].cid, ME.cid, "432", false)})`);
      assert.equal(await ev(until(`!document.getElementById("liveTrends").classList.contains("live-trends-skel")`)), true, "chart drawn (not skeleton)");
      // interval lines need two 30 s buckets: wait one bucket out, then one more death redraws with two points per line
      await new Promise((r) => setTimeout(r, 31000));
      await ev(`window.__fakeWs.emit(${death(OPP[4].cid, ME.cid, "432", false)})`);
      await new Promise((r) => setTimeout(r, 500));
      const s = await ev(`(() => {
        const cv = document.getElementById("liveTrendCanvas");
        const w = cv.width, d = cv.getContext("2d").getImageData(0, 0, w, cv.height).data;
        const top = Math.round(16 * (w / cv.clientWidth)); // the plot area starts below the axis titles
        const near = (hex) => { const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); let n = 0; for (let i = 0; i < d.length; i += 4) { const y = Math.floor(i / 4 / w); if (y >= top && d[i + 3] > 100 && Math.abs(d[i] - r) < 40 && Math.abs(d[i + 1] - g) < 40 && Math.abs(d[i + 2] - b) < 40) n++; } return n; };
        return {
          legend: [...document.querySelectorAll("#liveTrendLegend .lv-tl")].map((e) => e.textContent).join(" | "),
          ncBlue: near("#3e8ef7"), trRed: near("#e0453a"), vsPurple: near("#b061ff"),
        };
      })()`);
      assert.equal(s.legend, "KPM interval | DPM interval | K/D interval");
      assert.ok(s.ncBlue > 0 && s.trRed > 0 && s.vsPurple > 0, `all three faction colours drawn: blue ${s.ncBlue}, red ${s.trRed}, purple ${s.vsPurple}`);
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
      const ivs = await ev(`[...document.querySelectorAll("#liveList tbody.lv-vic .lv-iv")].map((e) => Number(e.textContent))`);
      assert.ok(ivs.length === 2 && ivs.every(Number.isFinite) && ivs.every((v) => v > 0), `both victims show an iVi: ${ivs}`);
      const sum = ivs[0] + ivs[1], avg = (sum / 2).toFixed(1);
      assert.equal(await ev(until(`document.getElementById("liveCashSumVal").textContent === "${sum}"`)), true, `cash sum is the victims' iVi: ${sum}`);
      assert.equal(await ev(until(`document.getElementById("liveCashAvgVal").textContent === "${avg}"`)), true, `cash avg is per victim: ${avg}`);
      // the killer does not pay: ME dies, the cash-out stands
      await ev(`window.__fakeWs.emit(${death(OPP[2].cid, ME.cid, "432", false)})`);
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(await ev(`document.getElementById("liveCashSumVal").textContent`), String(sum), "a death changes nothing");
      assert.deepEqual(errors, [], "no page errors");
    });
  });
