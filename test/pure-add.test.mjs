// 🧘 Pure view: a name added to an existing graph draws at once — no flip needed.
// Regression for 2026-10-29: drawChart computed the pure series before the
// table list updated, so a newly added player drew nothing until a mode flip.
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

async function withPage(fn, { width = 1280, height = 900 } = {}) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css" };
  const server = http.createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const userDir = fs.mkdtempSync("/tmp/pure-add-");
  const proc = spawn(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-pipe", "--user-data-dir=" + userDir, "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  let id = 0, buf = "";
  const pending = new Map();
  proc.stdio[4].on("data", (d) => {
    buf += d.toString("utf8");
    let i;
    while ((i = buf.indexOf("\0")) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
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
    const ev = async (expr) => {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
      return r.result.value;
    };
    const nav = async (u) => {
      await ev(`window.__oldPage = 1`).catch(() => {});
      await send("Page.navigate", { url: `http://127.0.0.1:${port}/${u}` }, sessionId);
      for (let t = 0; t < 400; t++) {
        if (await ev(`!window.__oldPage && document.body`).catch(() => false)) break;
        await new Promise((q) => setTimeout(q, 25));
      }
    };
    await fn({ ev, nav });
  } finally {
    proc.kill("SIGKILL");
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch { /* ignore */ }
    server.close();
  }
}

const snap = `(() => {
  const seriesG = document.querySelector('#chart g[clip-path]');
  const segs = seriesG ? seriesG.querySelectorAll(":scope > line").length : 0;
  const dashedEls = seriesG ? [...seriesG.querySelectorAll(":scope > path[stroke-dasharray]")] : [];
  const dashedStrokes = [...new Set(dashedEls.map((p) => p.getAttribute("stroke")))];
  const note = document.getElementById("chartPureNote");
  return { players: window.__ps2EliteKd.getPlayerNames(), segs, dashed: dashedEls.length, dashedStrokes, noteHidden: note ? !!note.hidden : null };
})()`;

describe("🧘 pure view: added name draws without a flip", () => {
  it("second player appears in pure mode right after typing, no swipe", { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav("index.html?names=shlodog");
      await ev(`new Promise(async (r) => { for (let t = 0; t < 600; t++) { const a = window.__ps2EliteKd; if (a && !a.isAnalyzing() && document.querySelector("#chartSection[open]")) return r(1); await new Promise((q) => setTimeout(q, 50)); } r(0); })`);
      await new Promise((q) => setTimeout(q, 1000));
      await ev(`(() => { const b = document.querySelector('[data-yscale="pure-btn"]'); if (b) b.click(); return !!b; })()`);
      await new Promise((q) => setTimeout(q, 1000));
      await ev(`(() => { const i = document.getElementById("namesInput"); i.focus(); return !!i; })()`);
      for (const ch of "justv6me") {
        await ev(`(() => { const i = document.getElementById("namesInput"); const s = i.value + ${JSON.stringify(ch)}; const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; setter.call(i, s); i.dispatchEvent(new Event("input", { bubbles: true })); return i.value; })()`);
        await new Promise((q) => setTimeout(q, 150));
      }
      await ev(`new Promise(async (r) => { for (let t = 0; t < 200; t++) { if (window.__ps2EliteKd.getPlayerNames().length >= 2) return r(1); await new Promise((q) => setTimeout(q, 50)); } r(0); })`);
      await new Promise((q) => setTimeout(q, 1000));
      const s = await ev(snap);
      assert.deepEqual(s.players, ["ShloDog", "JustV6me"]);
      assert.equal(s.segs, 0, "no solid segments in pure mode: " + JSON.stringify(s));
      assert.equal(s.dashed, 2, "both players draw a dashed Pure line: " + JSON.stringify(s));
      assert.equal(s.dashedStrokes.length, 2, "one dashed colour per player: " + JSON.stringify(s));
      assert.equal(s.noteHidden, true, "nobody is falsely hidden: " + JSON.stringify(s));
    });
  });
});
