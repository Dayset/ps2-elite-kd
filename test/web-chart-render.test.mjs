// 🕸️ Web view on the real page (headless Chromium): the 3rd carousel view
// renders the three reference players' webs, emoji-only vertices, chips
// toggle players — and both 🧘 Pure and 🕸️ Web stay hidden unless the
// debug box is on (public carousel = 💀 iVi only).
// Census and the Worker are faked in the page (no network); players come
// from data/ like on the site.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NAMES = ["xCloneKano", "Zyr0s", "Fantom220TR"];

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
const DEBUG_PRESET = `(() => { try { localStorage.setItem("ps2-elite-kd-debug-cols", "1"); } catch {} })();`;

const chrome = ["google-chrome", "chromium", "chromium-browser", "google-chrome-stable"].find((b) => {
  try { execFileSync("which", [b], { stdio: "ignore" }); return true; } catch { return false; }
});

async function withPage(url, fn, { width = 1600, height = 1000, preset = null } = {}) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png" };
  const server = http.createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const userDir = fs.mkdtempSync("/tmp/web-chart-");
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
    if (preset) await send("Page.addScriptToEvaluateOnNewDocument", { source: preset }, sessionId);
    const ev = async (expr) => {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
      return r.result.value;
    };
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/${url}` }, sessionId);
    await fn({ ev, errors });
  } finally {
    proc.kill("SIGKILL");
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch { /* ignore */ }
    server.close();
  }
}

const until = (cond, ms = 60000) => `new Promise(async (r) => { const end = Date.now() + ${ms}; while (Date.now() < end) { try { if (${cond}) return r(true); } catch {} await new Promise((q) => setTimeout(q, 50)); } r(false); })`;
const titles = () => `[...document.querySelectorAll(".web-dot title")].map((t) => t.textContent)`;
const titleVal = (name, emoji) => `(() => { const t = (${titles()}).find((x) => x.startsWith(${JSON.stringify(name + ": " + emoji)})); if (!t) return null; const m = t.match(/([\\d.]+)%$/); return m ? parseFloat(m[1]) : null; })()`;

describe("web radar on the real page", () => {
  it("debug on: 🕸️ button shows, three webs render, emoji-only vertices, chips toggle", { skip: !chrome && "no Chrome", timeout: 240000 }, async () => {
    await withPage(`index.html?names=${NAMES.map(encodeURIComponent).join(",")}`, async ({ ev, errors }) => {
      assert.equal(await ev(until(`!document.getElementById("chart").hasAttribute("hidden") && document.querySelectorAll("#chart path").length >= 1`)), true, "💀 chart draws first");
      assert.equal(await ev(`!document.querySelector('[data-yscale="web-btn"]').hidden`), true, "🕸️ button visible with debug on");
      assert.equal(await ev(`!document.querySelector('[data-yscale="pure-btn"]').hidden`), true, "🧘 button visible with debug on");
      await ev(`document.querySelector('[data-yscale="web-btn"]').click()`);
      assert.equal(await ev(until(`document.querySelectorAll(".web-poly").length === 3`)), true, "three webs drawn");
      const axes = await ev(`[...document.querySelectorAll(".web-axis")].map((t) => t.childNodes[0].textContent)`);
      assert.equal(axes.length, 10, "ten axis labels");
      for (const a of axes) assert.ok(!/[A-Za-z]/.test(a), `axis label is emoji only: ${a}`);
      assert.deepEqual(axes, ["⚔️", "🏃", "🦁", "🛡️", "☠️", "🎲", "🤝", "🪳", "🧼", "🪖"]);
      assert.equal(await ev(`document.querySelectorAll("#chartWebChips .chart-web-chip").length`), 3, "three legend chips");
      // Rendered numbers (bands — the snapshot drifts): Zyr0s most solo,
      // Fantom's Clean still ≥95, Kano's inverted Assists ≥80.
      assert.ok((await ev(titleVal("Zyr0s", "🪳"))) >= 85, "Zyr0s Solo renders high");
      assert.ok((await ev(titleVal("Fantom220TR", "🧼"))) >= 95, "Fantom Clean renders high");
      assert.ok((await ev(titleVal("xCloneKano", "🤝"))) >= 80, "Kano Assists (inverted) renders high");
      assert.ok((await ev(titleVal("Zyr0s", "🎲"))) != null, "Zyr0s Luck vertex exists");
      // Chips toggle a web off and back on.
      await ev(`document.querySelector("#chartWebChips .chart-web-chip").click()`);
      assert.equal(await ev(until(`document.querySelectorAll(".web-poly").length === 2`)), true, "chip hides one web");
      await ev(`document.querySelector("#chartWebChips .chart-web-chip").click()`);
      assert.equal(await ev(until(`document.querySelectorAll(".web-poly").length === 3`)), true, "chip shows it again");
      assert.deepEqual(errors, [], "no page errors");
    }, { preset: DEBUG_PRESET });
  });

  it("debug off: 🧘 and 🕸️ buttons hidden, public carousel is 💀 only", { skip: !chrome && "no Chrome", timeout: 240000 }, async () => {
    await withPage(`index.html?names=${NAMES.map(encodeURIComponent).join(",")}`, async ({ ev, errors }) => {
      assert.equal(await ev(until(`!document.getElementById("chart").hasAttribute("hidden") && document.querySelectorAll("#chart path").length >= 1`)), true, "💀 chart draws");
      assert.equal(await ev(`document.querySelector('[data-yscale="web-btn"]').hidden`), true, "🕸️ button hidden with debug off");
      assert.equal(await ev(`document.querySelector('[data-yscale="pure-btn"]').hidden`), true, "🧘 button hidden with debug off");
      assert.equal(await ev(`document.getElementById("chartModeBar").hidden`), true, "no flip bar at all in public mode");
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});
