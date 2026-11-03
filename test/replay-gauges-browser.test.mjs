// 🎬 Living stat gauges (#108, headless): with __fast(120) the KPM gauge
// shows the right notch positions for the player's KPM and as many kill
// marks as __params().stats.k; the K/D row shows floor(K/D) coffins + a
// partial bar of the right width; "All stats" is collapsed by default and
// holds the old chips. The __fast call and every simT-sensitive read happen
// in ONE evaluate: after __fast returns, the frame loop's jump cut advances
// simT and the tallies, so a later read would measure a different moment
// (the same lesson as #104's acceptance test).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const chrome = ["google-chrome", "chromium", "chromium-browser", "google-chrome-stable"].find((c) => {
  try { execFileSync("which", [c], { stdio: "pipe" }); return true; } catch { return false; }
});
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".webp": "image/webp" };

async function withPage(url, metrics, fn) {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const userDir = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "replay-gauges-"));
  const proc = spawn(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--window-size=1366,900", "--remote-debugging-pipe", "--user-data-dir=" + userDir, "about:blank"],
    { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  let id = 0, buf = "";
  const pending = new Map(), errors = [];
  proc.stdio[4].on("data", (d) => {
    buf += d.toString("utf8"); let i;
    while ((i = buf.indexOf("\0")) >= 0) {
      const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      if (msg.method === "Runtime.exceptionThrown") errors.push("exception: " + (msg.params.exceptionDetails?.text || "?"));
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push("console: " + (msg.params.args?.map((a) => a.value).join(" ") || "?"));
      // Note: Log.entryAdded resource 404s are NOT page errors here — a
      // missing weapon .webp is handled by the img onerror (it removes
      // itself), and the same 404 appears on the pre-gauge page.
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const m = { id: ++id, method, params }; if (sessionId) m.sessionId = sessionId;
    pending.set(m.id, (r) => (r.error ? reject(new Error(method + ": " + r.error.message)) : resolve(r.result)));
    proc.stdio[3].write(JSON.stringify(m) + "\0");
  });
  try {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Page.enable", {}, sessionId); await send("Runtime.enable", {}, sessionId);
    if (metrics) await send("Emulation.setDeviceMetricsOverride", metrics, sessionId);
    const ev = async (expr) => {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
      return r.result.value;
    };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/${url}` }, sessionId);
    for (let i = 0; i < 200; i++) { await sleep(200); try { if (await ev("window.__ready === true")) break; } catch {} }
    await fn(ev);
    assert.deepEqual(errors, [], "no page errors");
  } finally { proc.kill("SIGKILL"); try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {} server.close(); }
}

test("headless: pair gauges after __fast(120)", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  await withPage("replay/index.html?name=TolyaNo&vs=Fantom220TR", null, async (ev) => {
    const out = await ev(`(() => {
      const p = window.__fast(120, 1/30); const g = window.__gaugeState();
      const det = document.getElementById('allStats');
      const kdRow = document.querySelector('#gauges [data-gauge="kd"] .g-kd-row');
      return { k: p.stats.k, d: p.stats.d, g,
        gauges: [...document.querySelectorAll('#gauges .gauge')].map(e => e.dataset.gauge),
        allStatsOpen: det ? det.open : null, chipsInDetails: det ? det.querySelectorAll('.chip').length : -1,
        domCoffins: kdRow ? kdRow.querySelectorAll('.coffin').length : -1,
        domPartial: kdRow ? kdRow.querySelector('.g-partial i')?.style.width : null,
        domNotches: [...document.querySelectorAll('#gauges [data-gauge="kpm"] .g-notch')].length };
    })()`);
    assert.deepEqual(out.gauges, ["kpm", "kd", "acc", "hs", "spk"]);
    // TolyaNo KPM 1.44 → 41.7 s interval; after __fast(120) the span is
    // 120–180 s, so the notches are 125.0 s and 166.7 s into it.
    assert.equal(out.g.main.kpm.spanSec, 60);
    assert.equal(out.g.main.kpm.notches.length, 2);
    assert.ok(Math.abs(out.g.main.kpm.notches[0].frac - 5 / 60) < 0.01);
    assert.ok(Math.abs(out.g.main.kpm.notches[1].frac - 46.7 / 60) < 0.01);
    assert.equal(out.g.main.kpm.marks.length, out.k, "kill marks == scene kills");
    assert.equal(out.g.rival.kpm.marks.length, out.d, "rival marks == scene deaths");
    // K/D: TolyaNo 4.54 → 4 coffins + 54 % bar; Fantom220TR 4.67 → 4 + 67 %.
    assert.equal(out.g.main.kd[0].full, 4);
    assert.ok(Math.abs(out.g.main.kd[0].frac - 0.54) < 0.01);
    assert.ok(Math.abs(out.g.main.kd[0].partialWidth - 0.54) < 0.01);
    assert.equal(out.g.rival.kd[0].full, 4);
    assert.ok(Math.abs(out.g.rival.kd[0].frac - 0.67) < 0.01);
    assert.equal(out.domCoffins, 4, "first K/D row renders floor(K/D) coffins");
    assert.equal(out.domPartial, "54%", "partial bar width matches the fraction");
    assert.equal(out.allStatsOpen, false, "All stats collapsed by default");
    assert.equal(out.chipsInDetails, 26, "21 main chips + 5 opponent chips, unchanged content");
  });
});

test("headless: crowd gauges and 390 px width", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  await withPage("replay/index.html?name=TolyaNo&vs=NoSuchPlayer999", null, async (ev) => {
    const out = await ev(`(() => { const p = window.__fast(120, 1/30); const g = window.__gaugeState();
      const det = document.getElementById('allStats');
      return { k: p.stats.k, rival: g.rival, marks: g.main.kpm.marks.length, kd: g.main.kd[0],
        allStatsOpen: det ? det.open : null, chipsInDetails: det ? det.querySelectorAll('.chip').length : -1 }; })()`);
    assert.equal(out.rival, null, "crowd mode shows the player only");
    assert.equal(out.marks, out.k, "kill marks == scene kills in crowd mode");
    assert.equal(out.kd.filled, Math.min(out.kd.kills, out.kd.full), "kills fill coffins left to right");
    assert.equal(out.allStatsOpen, false);
    assert.equal(out.chipsInDetails, 21, "crowd mode holds the 21 main chips");
  });
  await withPage("replay/index.html?name=TolyaNo&vs=Fantom220TR", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, async (ev) => {
    const out = await ev(`(() => { window.__fast(120, 1/30);
      return { gauges: document.querySelectorAll('#gauges .gauge').length, scrollW: document.documentElement.scrollWidth }; })()`);
    assert.equal(out.gauges, 5);
    assert.ok(out.scrollW <= 414, `gauges must not widen the page past the pre-existing #life overflow (414), got ${out.scrollW}`);
  });
});
