// #100 stage and camera (headless): in every sampled fight frame (trade,
// commit, resolution) both duelists are inside the frame under the camera
// transform; the camera zooms out at trade and in at commit.
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
  const userDir = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "replay-cam-"));
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

// The default pair (no ?vs=): Fantom220TR vs TolyaNo, pair mode.
const PAIR = "replay/index.html?name=fantom220tr";

test("headless: both duelists stay in frame in every fight frame", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  await withPage(PAIR, async (ev) => {
    assert.equal(await ev(`window.__duelPlan() !== null`), true, "pair mode is active");
    // Step 0.5 wall s at a time (the camera snaps to its target each
    // render), and check the frame whenever the current segment is a fight
    // phase. Trade windows are short (a few seconds), so 1 s steps would
    // sample too few of them.
    const res = await ev(`(() => {
      const counts = { trade: 0, commit: 0, resolution: 0 };
      const bad = [];
      for (let i = 0; i < 1200; i++) {
        window.__render(window.__slow().wallT + 0.5);
        const p = window.__params(), plan = window.__duelPlan();
        const eng = plan.engagements.find((e) => e.t0 <= p.simT && p.simT < e.t1);
        if (!eng) continue;
        const seg = eng.segments.find((s) => s.t0 <= p.simT && p.simT < s.t1);
        if (!seg || !["trade", "commit", "resolution"].includes(seg.phase)) continue;
        counts[seg.phase]++;
        const cam = window.__camera();
        const lanes = window.__lanes();
        for (const who of ["main", "rival"]) {
          const s = lanes.find((l) => l.who === who);
          const cx = (s.x - cam.left) * cam.scale;
          const cy = (s.y - cam.top) * cam.scale;
          if (cx < 0 || cx > 1280) bad.push({ t: p.simT, phase: seg.phase, who, x: s.x, cx, scale: cam.scale });
          if (cy < 0 || cy > 400) bad.push({ t: p.simT, phase: seg.phase, who, y: s.y, cy, scale: cam.scale });
        }
      }
      return { counts, bad: bad.slice(0, 5) };
    })()`);
    assert.ok(res.counts.trade >= 10, `fight frames sampled: ${JSON.stringify(res.counts)}`);
    assert.ok(res.counts.commit >= 3, `fight frames sampled: ${JSON.stringify(res.counts)}`);
    assert.deepEqual(res.bad, [], `duelists out of frame: ${JSON.stringify(res.bad)}`);
  });
});

test("headless: camera zooms out at trade and in at commit", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  await withPage(PAIR, async (ev) => {
    // Sample the camera scale per fight phase across the plan.
    const res = await ev(`(() => {
      const scales = { trade: [], commit: [] };
      for (let i = 0; i < 600 && (scales.trade.length < 5 || scales.commit.length < 3); i++) {
        window.__render(window.__slow().wallT + 1);
        const p = window.__params(), plan = window.__duelPlan();
        const eng = plan.engagements.find((e) => e.t0 <= p.simT && p.simT < e.t1);
        if (!eng) continue;
        const seg = eng.segments.find((s) => s.t0 <= p.simT && p.simT < s.t1);
        if (seg && (seg.phase === "trade" || seg.phase === "commit")) scales[seg.phase].push(window.__camera().scale);
      }
      const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      return { trade: scales.trade.length ? avg(scales.trade) : null, commit: scales.commit.length ? avg(scales.commit) : null };
    })()`);
    assert.ok(res.trade !== null && res.commit !== null, `phases sampled: ${JSON.stringify(res)}`);
    assert.ok(res.trade < 1.0, `trade zooms out (avg scale ${res.trade.toFixed(2)})`);
    assert.ok(res.commit > 1.0, `commit zooms in (avg scale ${res.commit.toFixed(2)})`);
    assert.ok(res.commit > res.trade, "commit is closer than trade");
  });
});
