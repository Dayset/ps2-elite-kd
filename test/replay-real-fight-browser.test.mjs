// 🎬 Replay real fight (#101, headless): the menu lists recorded fights
// from a fixture /duels/pair reply, ?real= plays one with the real kill
// order and gaps, and a dead Worker leaves the synthesized scene plus a note.
// The Worker call is intercepted at the CDP Fetch domain, so no test ever
// touches the live cache.
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
const FIXTURE = fs.readFileSync(path.join(ROOT, "test/fixtures/duels-pair.json"), "utf8");

async function withPage(url, mode, fn, width = 1366) {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const userDir = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "replay-real-"));
  const proc = spawn(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", `--window-size=${width},900`, "--remote-debugging-pipe", "--user-data-dir=" + userDir, "about:blank"],
    { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  let id = 0, buf = "";
  const pending = new Map(), errors = [];
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const m = { id: ++id, method, params }; if (sessionId) m.sessionId = sessionId;
    proc.stdio[3].write(JSON.stringify(m) + "\0"); pending.set(m.id, (r) => (r.error ? reject(new Error(method + ": " + r.error.message)) : resolve(r.result)));
  });
  proc.stdio[4].on("data", (d) => {
    buf += d.toString("utf8"); let i;
    while ((i = buf.indexOf("\0")) >= 0) {
      const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      if (msg.method === "Runtime.exceptionThrown") errors.push("exception: " + (msg.params.exceptionDetails?.text || "?"));
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push("console: " + (msg.params.args?.map((a) => a.value).join(" ") || "?"));
      if (msg.method === "Fetch.requestPaused") {
        // Fetch events are session-scoped: the fulfill/fail must go back on
        // the same session, or the request stays paused until the page's
        // 45 s fetch timeout (the first version of this test missed this
        // and every Worker call hung).
        const reqId = msg.params.requestId, sid = msg.sessionId;
        if (mode === "down") send("Fetch.failRequest", { requestId: reqId, errorReason: "Failed" }, sid).catch(() => {});
        else send("Fetch.fulfillRequest", { requestId: reqId, responseCode: 200,
          // The real Worker sends CORS headers; without them the browser's
          // CORS check rejects the fulfilled cross-origin response.
          responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" }], body: Buffer.from(FIXTURE).toString("base64") }, sid).catch(() => {});
      }
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    }
  });
  try {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Page.enable", {}, sessionId); await send("Runtime.enable", {}, sessionId);
    await send("Fetch.enable", { patterns: [{ urlPattern: "*ps2-elite-kd-cache.dayset.workers.dev/duels/pair*" }] }, sessionId);
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

const waitFor = async (ev, expr, ms = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await new Promise((r) => setTimeout(r, 200)); }
  return false;
};

// The default pair (no ?vs=): Fantom220TR vs TolyaNo, pair mode.
// Date strings are computed here, not hardcoded: the page formats dates in
// the host timezone, and the test host shares it with the browser.
const dstr = (t) => new Date(t * 1000).toLocaleDateString("en", { day: "numeric", month: "short" });
const D_OLD = dstr(1762001000), D_NEW = dstr(1762005000);
const PAIR = "replay/index.html?name=fantom220tr";

test("headless: the real-fight menu lists the fixture fights, newest first", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  await withPage(PAIR, "ok", async (ev) => {
    assert.ok(await waitFor(ev, `document.getElementById('realFights') !== null`), "menu appears after the fetch");
    const rows = await ev(`[...document.querySelectorAll('#realFights .real-row')].map((b) => b.textContent)`);
    assert.deepEqual(rows, [`${D_NEW} · 2–0`, `${D_OLD} · 2–2 · 1v1`]);
    assert.equal(await ev(`document.getElementById('realFights').open`), false, "menu starts collapsed");
  });
});

test("headless: the real-fight menu fits a 390 px phone width", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  await withPage(PAIR, "ok", async (ev) => {
    assert.ok(await waitFor(ev, `document.getElementById('realFights') !== null`), "menu appears after the fetch");
    const w = await ev(`Math.max(...[...document.querySelectorAll('#realFights .real-row')].map((b) => b.scrollWidth))`);
    assert.ok(w <= 390, `menu rows fit the viewport (widest ${w}px)`);
  }, 390);
});

test("headless: ?real= plays the fixture fight with the real order and gaps", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  await withPage(PAIR + "&real=1762001000", "ok", async (ev) => {
    const real = await ev(`window.__real()`);
    assert.equal(real.t0, 1762001000);
    assert.deepEqual([real.a, real.b], [2, 2]);
    assert.equal(real.one, true);
    assert.equal(real.real, true);
    const plan = await ev(`(() => {
      const p = window.__duelPlan();
      return { real: p.real, outcomes: p.engagements.map((e) => e.outcome),
        gaps: p.engagements.map((e, i) => (i ? Math.round(e.killAt - p.engagements[i - 1].killAt) : 0)),
        weapons: p.engagements.map((e) => e.weaponDoc?.name),
        veh: p.engagements.map((e) => e.veh), hs: p.engagements.map((e) => e.hs) };
    })()`);
    assert.equal(plan.real, true);
    assert.deepEqual(plan.outcomes, ["a", "b", "a", "b"]);
    assert.deepEqual(plan.gaps, [0, 80, 120, 130]);
    assert.deepEqual(plan.weapons, ["MSW-R", "LA1 Anchor", "MSW-R", "LA1 Anchor"]);
    assert.deepEqual(plan.veh, [0, 0, 0, 0]);
    assert.deepEqual(plan.hs, [false, true, true, false]);
    assert.match(await ev(`document.getElementById('realTitle').textContent`), new RegExp(`Real fight · ${D_OLD} · 2–2`));
    // Playing it through counts the real score up to the final 2–2.
    const dur = await ev(`window.__duelPlan().duration`);
    await ev(`window.__fast(${dur + 10}, 1/30)`);
    assert.match(await ev(`document.getElementById('duelScore').textContent`), /2 – 2/);
  });
});

test("headless: Worker down keeps the synthesized scene and a short note", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  await withPage(PAIR, "down", async (ev) => {
    assert.equal(await ev(`window.__duelPlan() !== null && !window.__duelPlan().real`), true, "synthesized plan, not real");
    assert.equal(await ev(`window.__real()`), null, "no real fight active");
    assert.ok(await waitFor(ev, `[...document.querySelectorAll('#hud .note')].some((n) => n.textContent.includes('unreachable'))`), "unreachable note shows");
    assert.equal(await ev(`document.getElementById('realFights')`), null, "no menu without data");
  });
});
