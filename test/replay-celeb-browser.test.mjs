// #107 celebration + status lines (headless): after a kill the killer
// bobs and glows for ~1.2 wall s; a status line is still on screen 2.4
// wall s after it appeared, also at ×2 playback; three lines can show at
// once; the crowd page runs at 390 px without errors.
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

async function withPage(url, fn, width = 1366) {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const userDir = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "replay-celeb-"));
  const proc = spawn(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", `--window-size=${width},900`, "--remote-debugging-pipe", "--user-data-dir=" + userDir, "about:blank"],
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

// ?vs= with no such rival falls back to the crowd scene (pair stays null).
const CROWD = "replay/index.html?name=fantom220tr&vs=nosuchplayer123";

test("headless: the killer bobs and glows for ~1.2 wall s after a kill", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  await withPage(CROWD, async (ev) => {
    // Render in small wall steps until the player's first kill (rendering
    // refreshes the pose; coarse steps would jump past the 1.2 s window).
    let killed = false;
    for (let i = 0; i < 600 && !killed; i++) {
      killed = await ev(`window.__render(window.__slow().wallT + 0.2) && window.__params().stats.k >= 1`);
    }
    assert.ok(killed, "the player lands a kill within 120 wall s");
    const buckets = {};
    for (let i = 0; i < 12; i++) {
      const s = await ev(`window.__render(window.__slow().wallT + 0.2) && window.__cheer()`);
      const e = s.wallT - s.cheerAt;
      // Buckets wider than the 0.2 step: the kill lands mid-step, so the
      // first sample's elapsed already spans [0.2, 0.4].
      for (const [lo, hi, key] of [[0.05, 0.45, "a"], [0.45, 0.75, "b"], [0.75, 1.15, "c"], [1.25, 1.6, "d"]]) {
        if (e >= lo && e < hi && !buckets[key]) buckets[key] = s;
      }
    }
    assert.ok(buckets.a && buckets.b && buckets.c, `glow samples across the window: ${JSON.stringify(buckets)}`);
    for (const k of ["a", "b", "c"]) assert.ok(buckets[k].glow > 0, `glow still drawn at bucket ${k} (elapsed ${(buckets[k].wallT - buckets[k].cheerAt).toFixed(2)})`);
    assert.ok(buckets.d && buckets.d.glow === 0, "glow ends after the 1.2 s window");
    const bobs = ["a", "b", "c"].map((k) => buckets[k].bob);
    assert.ok(Math.max(...bobs) - Math.min(...bobs) > 5, `the root moves up and down (bobs ${bobs.map((b) => b.toFixed(1)).join(", ")})`);
  });
});

async function lineLifetime(ev, label) {
  // Drive in small wall steps until a line appears, then check it is still
  // on screen 2.4 wall s later and gone (or refreshed) by 3.1 wall s.
  let found = null;
  for (let i = 0; i < 400 && !found; i++) {
    found = await ev(`window.__advance(window.__slow().wallT + 0.5) && (() => {
      const s = window.__stack(); const v = s.visible[0]; if (!v) return null;
      const raw = s.all.find((l) => l.text === v.text); return raw ? { text: raw.text, t0: raw.t0 } : null;
    })()`);
  }
  assert.ok(found, `${label}: a status line appears within 200 wall s`);
  await ev(`window.__advance(${found.t0 + 2.4})`);
  const still = await ev(`window.__stack().visible.some((l) => l.text === ${JSON.stringify(found.text)})`);
  assert.ok(still, `${label}: the line is still on screen 2.4 wall s after it appeared`);
  await ev(`window.__advance(${found.t0 + 3.1})`);
  const after = await ev(`(() => { const s = window.__stack(); const raw = s.all.find((l) => l.text === ${JSON.stringify(found.text)});
    return { visible: s.visible.some((l) => l.text === ${JSON.stringify(found.text)}), t0: raw ? raw.t0 : null }; })()`);
  assert.ok(!after.visible || after.t0 > found.t0, `${label}: the line is gone by 3.1 wall s (or refreshed by a repeat)`);
}

test("headless: a status line lasts 2.4 wall s at ×1 and at ×2", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  await withPage(CROWD, async (ev) => { await lineLifetime(ev, "×1"); });
  await withPage(CROWD + "&speed=2", async (ev) => { await lineLifetime(ev, "×2"); });
});

test("headless: three status lines can show at once (×2)", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  await withPage(CROWD + "&speed=2", async (ev) => {
    // Recovery + reload + headshot/close-call lines overlap within one
    // 2.5 wall s window at ×2; sweep a long window and keep the max.
    const max = await ev(`(() => {
      let m = 0;
      for (let i = 0; i < 2400; i++) {
        window.__advance(window.__slow().wallT + 0.5);
        m = Math.max(m, window.__stack().visible.length);
        if (m >= 3) break;
      }
      return m;
    })()`);
    assert.ok(max >= 3, `max ${max} lines visible at once`);
  });
});

test("headless: celebration page at 390 px runs without errors", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  await withPage(CROWD, async (ev) => {
    await ev(`(() => { for (let i = 0; i < 6; i++) window.__advance(window.__slow().wallT + 10); return true; })()`);
    assert.equal(await ev(`typeof window.__cheer === 'function' && typeof window.__stack === 'function'`), true, "the celebration hooks exist at phone width");
  }, 390);
});
