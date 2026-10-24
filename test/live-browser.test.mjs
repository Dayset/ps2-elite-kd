// 🎥 live.html in a real (headless) Chromium: Census and the event stream are faked in the page, events are pushed in,
// and the overlay is checked as a viewer would see it — 8 lines, weapon + headshot icons, the pre-drawn emoji pictures,
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
  it("8 lines with weapon + headshot icons, pre-drawn emojis, nothing that animates forever", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      // 6 kills (weapons: Orion, TRAC-5, NS-11A, Frag Grenade, knife, unknown), then a death by a headshot with C-4's id
      const kills = [["80", true], ["43", false], ["70998", true], ["44505", false], ["1", false], ["0", false]];
      for (const [i, [w, hs]] of kills.entries()) await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[i].cid, w, hs)})`);
      await ev(`window.__fakeWs.emit(${death(OPP[6].cid, ME.cid, "432", true)})`);
      assert.equal(await ev(until(`document.querySelectorAll("#liveList tbody.lv-vic:not(.lv-empty)").length === 6 && document.querySelector("#liveList tbody.lv-atk:not(.lv-empty)")`)), true, "6 victims + the killer on screen");
      const drawn = `(() => { const css = (document.getElementById("lvSprites") || {}).textContent || ""; const used = new Set([...document.querySelectorAll("#liveList .lv-em")].map((e) => [...e.classList].find((c) => /^lv-x\\d+$/.test(c)))); return used.size > 0 && [...used].every((c) => css.includes("." + c + "{")) && css.includes("background-image"); })()`;
      assert.equal(await ev(until(drawn)), true, "a picture for every emoji on screen");
      assert.equal(await ev(until(`document.querySelectorAll("#liveList .lv-wi[style]").length === 6`)), true, "weapon pictures shown (catalog loaded)");
      const s = await ev(`(() => {
        const L = document.getElementById("liveList");
        const lines = [...L.querySelectorAll("tbody.lv-ev")];
        const vic = [...L.querySelectorAll("tbody.lv-vic")];
        const atk = L.querySelector("tbody.lv-atk");
        const tipOf = (tb) => { const w = tb.querySelector(".lv-wi[style]"); return w ? w.dataset.tip : null; };
        return {
          lines: lines.length,
          names: vic.map((t) => t.querySelector(".lv-name").textContent),
          victimTips: vic.map(tipOf),
          victimHs: vic.map((t) => !!t.querySelector(".lv-hs:not(.lv-hs-0)")),
          cardIcon: !!vic[2].querySelector(".lv-wi.lv-wi-c"),
          killerTip: tipOf(atk),
          killerHs: !!atk.querySelector(".lv-hs:not(.lv-hs-0)"),
          meWeapon: !!L.querySelector("tbody.lv-me .lv-wi[style]"),
          emojiBoxes: [...L.querySelectorAll(".lv-em")].map((e) => Math.round(e.getBoundingClientRect().width)),
          svgFilters: document.querySelectorAll("filter").length,
          endless: document.getAnimations().filter((a) => !Number.isFinite(a.effect.getComputedTiming().endTime)).map((a) => a.animationName || (a.effect.target && a.effect.target.className)),
          fillMoving: [...L.querySelectorAll(".lv-sw")].some((e) => e.style.transform),
          noStar: !L.querySelector(".lv-g3") || getComputedStyle(L.querySelector(".lv-g3"), "::after").content === "none",
          hsTip: (atk.querySelector(".lv-hs") || {}).dataset.tip,
        };
      })()`);
      assert.equal(s.lines, 8, "killer + centre + 6 victims");
      assert.deepEqual(s.names, OPP.slice(0, 6).map((o) => o.name).reverse(), "newest kill on top");
      assert.deepEqual(s.victimTips, [null, "Mag-Cutter", "Frag Grenade", "NS-11A", "TRAC-5", "Orion VS54"], "weapon picture + name per kill (unknown id = empty slot)");
      assert.deepEqual(s.victimHs, [false, false, false, true, false, true], "headshot mark only on headshots");
      assert.equal(s.cardIcon, true, "grenade keeps its card picture");
      assert.equal(s.killerTip, "C-4");
      assert.equal(s.killerHs, true);
      assert.equal(s.hsTip, "Headshot");
      assert.equal(s.meWeapon, false, "no weapon on the centre line");
      assert.ok(s.emojiBoxes.length >= 40 && s.emojiBoxes.every((w) => w > 10), `every emoji has its picture size: ${s.emojiBoxes.slice(0, 5)}`);
      assert.equal(s.svgFilters, 0, "no SVG filters on the page");
      assert.deepEqual(s.endless, [], "nothing animates forever (CPU)");
      assert.equal(s.fillMoving, true, "the new lines fill up (moved by the ticker)");
      assert.equal(s.noStar, true, "no ✦ star (the gold shine replaced it)");
      // owner 2026-10-24: animations are drawn at 30 fps — never at the screen's own rate
      const fps = await ev(framesPerSecond);
      assert.ok(fps >= 15 && fps <= 34, `about 30 frames a second while lines fill: ${fps}`);
      // ✨ halo switch: left of 🖥️ ⚙️ Settings, off hides halos + shine and is remembered
      const sw = await ev(`(() => { const b = document.getElementById("lvHaloBtn"); const before = b.getAttribute("aria-pressed"); b.click(); const gl = document.querySelector("#liveList .lv-g3 .lv-gl, #liveList .lv-g2 .lv-gl"); return { next: b.nextElementSibling && b.nextElementSibling.id, before, after: b.getAttribute("aria-pressed"), hidden: gl ? getComputedStyle(gl).display : "none", stored: localStorage.getItem("ps2-elite-kd-live-halo") }; })()`);
      assert.deepEqual(sw, { next: "roomBadge", before: "true", after: "false", hidden: "none", stored: "0" });
      assert.deepEqual(errors, [], "no page errors");
    });
  });

  it("?fps=60 draws at 60, never more", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withLive(async ({ ev, errors }) => {
      assert.equal(await ev(until("window.__fakeWs && window.__fakeWs.readyState === 1")), true, "stream connected");
      for (let i = 0; i < 6; i++) await ev(`window.__fakeWs.emit(${death(ME.cid, OPP[i].cid, "80", false)})`);
      assert.equal(await ev(until(`document.querySelectorAll("#liveList tbody.lv-vic:not(.lv-empty)").length === 6 && (document.getElementById("lvSprites") || {}).textContent.includes("background-image")`)), true, "lines and pictures");
      const fps = await ev(framesPerSecond);
      assert.ok(fps > 34 && fps <= 64, `about 60 frames a second: ${fps}`);
      assert.deepEqual(errors, [], "no page errors");
    }, { query: "&fps=60" });
  });
});
