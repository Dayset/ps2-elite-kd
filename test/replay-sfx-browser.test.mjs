// Replay SFX v0.1 wiring (headless): the mute button toggles the shared
// sfx instance, and the scene loads with no page errors. Sound itself is
// not asserted — headless audio stays suspended without a real gesture —
// only the wiring (button, state, persistence hook) is.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml" };
const chrome = ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]
  .map((c) => { try { return fs.realpathSync("/tmp/bin/" + c); } catch { return null; } })
  .find(Boolean) || (process.env.PATH || "").split(":").map((d) => path.join(d, "chromium")).find((p) => fs.existsSync(p));

async function withPage(url, fn) {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const userDir = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "replay-sfx-"));
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
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const m = { id: ++id, method, params }; if (sessionId) m.sessionId = sessionId;
    proc.stdio[3].write(JSON.stringify(m) + "\0"); pending.set(m.id, (r) => (r.error ? reject(new Error(method + ": " + r.error.message)) : resolve(r.result)));
  });
  try {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Page.enable", {}, sessionId); await send("Runtime.enable", {}, sessionId);
    const ev = async (expr) => {
      const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
      return r.result?.value;
    };
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/${url}` }, sessionId);
    const t0 = Date.now();
    while (!(await ev(`typeof window.__ready !== 'undefined' && window.__ready`))) {
      if (Date.now() - t0 > 60000) throw new Error("page never became ready");
      await new Promise((r) => setTimeout(r, 200));
    }
    await fn(ev);
    assert.deepEqual(errors, [], `page errors: ${errors.join(" | ")}`);
  } finally {
    proc.kill(); server.close();
  }
}

test("headless: SFX mute button toggles the shared instance", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  await withPage("replay/index.html?name=fantom220tr", async (ev) => {
    const btn = `document.querySelector('#pace button[aria-label="Toggle sound"]')`;
    assert.equal(await ev(`!!${btn}`), true, "the mute button renders in the pace row");
    assert.deepEqual(await ev(`window.__sfx()`), { muted: false }, "sound starts on in a fresh profile");
    await ev(`${btn}.click()`);
    assert.deepEqual(await ev(`window.__sfx()`), { muted: true }, "one click mutes");
    assert.equal(await ev(`${btn}.textContent`), "🔇", "the button shows the muted glyph");
    await ev(`${btn}.click()`);
    assert.deepEqual(await ev(`window.__sfx()`), { muted: false }, "a second click unmutes");
    assert.equal(await ev(`${btn}.textContent`), "🔊", "the button shows the sound glyph again");
  });
});
