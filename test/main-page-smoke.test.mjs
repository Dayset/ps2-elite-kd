// test-select-reaches: index.html app.js app-util.mjs styles.css rankings.mjs
// #66 safety net for splitting app.js: the main page in a real (headless) Chromium with two saved players —
// stats table, chart, Rankings table, theme switch and the 🌊 wave all run, and no page error is thrown.
// Census and the Worker are faked in the page (no network); saved players come from data/ like on the site.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ranks = JSON.parse(fs.readFileSync(path.join(root, "data", "ranks.json"), "utf8"));
const ci = (c) => ranks.cols.indexOf(c);
const idx = JSON.parse(fs.readFileSync(path.join(root, "data", "index.json"), "utf8"));
const saved = new Set((idx.players || []).map((p) => p.slug));
const NAMES = ranks.rows.filter((r) => typeof r[ci("adjs")] === "number" && saved.has(r[ci("slug")])).slice(0, 2).map((r) => r[ci("name")]);

const FAKES = `(() => {
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const u = typeof input === "string" ? input : input.url;
    if (u.includes("census.daybreakgames.com")) return Promise.resolve(json({ returned: 0, character_list: [] }));
    if (/workers\\.dev|honu|ps2radar/.test(u)) return Promise.resolve(new Response("", { status: 404 }));
    return realFetch(input, init);
  };
  window.WebSocket = class { constructor() {} send() {} close() {} };
})();`;

const chrome = ["google-chrome", "chromium", "chromium-browser", "google-chrome-stable"].find((b) => {
  try { execFileSync("which", [b], { stdio: "ignore" }); return true; } catch { return false; }
});

async function withPage(url, fn, { width = 1600, height = 1000 } = {}) {
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
  const proc = spawn(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--remote-debugging-pipe", "--user-data-dir=" + fs.mkdtempSync("/tmp/main-smoke-"), "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
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
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/${url}` }, sessionId);
    await fn({ ev, errors });
  } finally {
    proc.kill("SIGKILL");
    server.close();
  }
}

const until = (cond, ms = 20000) => `new Promise(async (r) => { const end = Date.now() + ${ms}; while (Date.now() < end) { try { if (${cond}) return r(true); } catch {} await new Promise((q) => setTimeout(q, 50)); } r(false); })`;

describe("main page smoke (#66)", () => {
  it("two saved players: stats, chart, Rankings, theme and wave work without page errors", { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
    assert.equal(NAMES.length, 2, "two saved players in data/");
    await withPage(`index.html?names=${NAMES.map(encodeURIComponent).join(",")}`, async ({ ev, errors }) => {
      assert.equal(await ev(until(`document.querySelectorAll('#statsPanel th[scope="row"].stats-name').length >= 2`)), true, "stats table for both players");
      const chartInfo = await ev(`new Promise((r) => setTimeout(() => { const c = document.getElementById("chart"); r({ shown: !c.hasAttribute("hidden"), paths: c.querySelectorAll("path").length, dots: c.querySelectorAll("circle").length }); }, 3000))`);
      assert.ok(chartInfo.shown && chartInfo.paths >= 1 && chartInfo.dots > 10, `chart drawn: ${JSON.stringify(chartInfo)}`);
      // saved-players chips render (shared cache + this browser)
      assert.equal(await ev(until(`document.querySelector("#cacheChips details.cache-shared")`)), true, "shared-cache fold (cache-chips.mjs ran)");
      // Analyze with "Fetch fresh data" (Census is faked empty here): the progress bar opens, the run ends, the page survives
      await ev(`(() => { const m = document.getElementById("progress"); window.__seenProgress = false; new MutationObserver(() => { if (!m.hidden) window.__seenProgress = true; }).observe(m, { attributes: true }); const f = document.getElementById("fetchFresh"); if (!f.checked) f.click(); document.getElementById("analyzeBtn").click(); })()`);
      assert.equal(await ev(until(`document.getElementById("progress").hidden && window.__seenProgress`, 60000)), true, "Analyze opens the progress bar and finishes");
      // Rankings big table
      await ev(`(() => { const d = document.getElementById("ranksTableSection"); d.open = true; d.dispatchEvent(new Event("toggle")); })()`);
      assert.equal(await ev(until(`document.querySelectorAll("#ranksBody tr").length > 20`)), true, "Rankings rows render");
      // theme switch both ways
      const th = await ev(`(() => { const b = document.getElementById("themeToggle"); const a = document.documentElement.getAttribute("data-theme"); b.click(); const m = document.documentElement.getAttribute("data-theme"); b.click(); return [a, m, document.documentElement.getAttribute("data-theme")]; })()`);
      assert.notEqual(th[0], th[1], "theme toggles");
      assert.equal(th[0], th[2], "and back");
      // 🌊 wave: Smooth starts it, Raw stops it
      await ev(`document.querySelector('.chart-mode-btn[data-mode="banded"]').click()`);
      await ev(`new Promise((r) => setTimeout(r, 400))`);
      await ev(`document.querySelector('.chart-mode-btn[data-mode="cumulative"]').click()`);
      await ev(`new Promise((r) => setTimeout(r, 200))`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});
