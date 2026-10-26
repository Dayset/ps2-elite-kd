// 🎥 sfx.mjs in a real (headless) Chromium against a recording FakeAudioContext:
// the live event sounds play the right notes, the gesture gate still blocks UI
// sounds with no gesture, and event sounds never queue on a suspended context.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const chrome = ["chromium", "google-chrome", "chromium-browser", "google-chrome-stable"].find((b) => {
  try { execFileSync("which", [b], { stdio: "ignore" }); return true; } catch { return false; }
});

async function withPage(fn) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css" };
  const server = http.createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const userDir = fs.mkdtempSync("/tmp/sfx-");
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
    await send("Page.enable", {}, sessionId);
    await send("Runtime.enable", {}, sessionId);
    const ev = async (expr) => {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
      return r.result.value;
    };
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/test/fixtures/sfx-page.html` }, sessionId);
    await fn({ ev, errors });
  } finally {
    try { proc.kill(); } catch { /* ignore */ }
    server.close();
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

describe("🎥 live event sounds in a browser", () => {
  it("sounds (owner 2026-10-26): gate blocks, unlock plays, event sounds never queue while suspended", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withPage(async ({ ev, errors }) => {
      assert.equal(await ev(`new Promise((res) => { const t = setInterval(() => { if (window.__sfxDone) { clearInterval(t); res(true); } }, 20); })`), true, "fixture loaded");
      const oscs = () => ev(`window.__fakeOsc.map((o) => o.freqs)`);
      await ev(`window.__sfxTest.sfx("sad")`);
      assert.deepEqual(await oscs(), [], "UI sound with no gesture stays silent");
      await ev(`window.__sfxTest.sfx("victory", { event: true })`);
      assert.deepEqual(await oscs(), [], "event sound on a suspended context queues nothing");
      await ev(`window.dispatchEvent(new PointerEvent("pointerdown"))`); // unlocks the fake context
      await ev(`window.__sfxTest.sfx("victory", { event: true })`);
      assert.deepEqual(await oscs(), [[523], [659], [784], [1047]], "victory fanfare notes in order");
      await ev(`window.__sfxTest.sfx("chaChing", { event: true })`);
      assert.deepEqual(await oscs(), [[523], [659], [784], [1047], [2093], [2637], [3520]], "cha-ching dings after the fanfare");
      await ev(`window.__sfxTest.sfx("sad", { event: true })`);
      await ev(`window.__sfxTest.sfx("assist", { event: true })`);
      assert.deepEqual(await oscs(), [[523], [659], [784], [1047], [2093], [2637], [3520], [330], [262], [196], [523], [659], [784]], "sad descent, then the motivational rise");
      await ev(`window.__sfxTest.setSfxEnabled(false)`);
      await ev(`window.__sfxTest.sfx("victory", { event: true })`);
      assert.equal((await oscs()).length, 13, "muted: no new oscillators");
      assert.deepEqual(errors, [], "no page errors");
    });
  });

  it("rate (owner 2026-10-26): streamer mode plays sounds 1.3× faster — offsets and lengths scale, pitch stays", { skip: !chrome && "no Chrome", timeout: 90000 }, async () => {
    await withPage(async ({ ev, errors }) => {
      assert.equal(await ev(`new Promise((res) => { const t = setInterval(() => { if (window.__sfxDone) { clearInterval(t); res(true); } }, 20); })`), true, "fixture loaded");
      await ev(`window.dispatchEvent(new PointerEvent("pointerdown"))`); // unlocks the fake context
      await ev(`window.__sfxTest.setSfxRate(1.3)`);
      await ev(`window.__sfxTest.sfx("victory", { event: true })`);
      const starts = await ev(`window.__fakeOsc.map((o) => o.startedAt)`);
      assert.equal(starts.length, 4, "fanfare has four notes");
      const near = (a, b) => Math.abs(a - b) < 0.001;
      assert.ok(near(starts[0], 0.01) && near(starts[1], 0.01 + 0.1 / 1.3) && near(starts[2], 0.01 + 0.2 / 1.3) && near(starts[3], 0.01 + 0.3 / 1.3), `note starts scale by 1/1.3: ${starts}`);
      const stops = await ev(`window.__fakeOsc.map((o) => o.stoppedAt)`);
      assert.ok(near(stops[0], 0.01 + 0.12 / 1.3 + 0.03), `note lengths scale too: ${stops}`);
      assert.deepEqual(errors, [], "no page errors");
    });
  });
});
