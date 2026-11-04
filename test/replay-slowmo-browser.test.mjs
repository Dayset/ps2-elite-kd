// 🎬 Replay slow-mo toggle (Dayset 2026-11-03, headless): the 🐌 toggle
// defaults on and works at x1/x2/cine; a kill at x2 dips under x0.6
// (envelope + pre-kill) with slow-mo on and stays constant with it off;
// a crowd kill shows a "the crowd" killcam plus the envelope; a cine
// jump cut lands 5 data s before the fight instead of cutting into it.
// The Worker call is intercepted and failed: the menu's down-note is not
// under test here, and no test may depend on the sandbox reaching the
// live cache (that produced ERR_TUNNEL_CONNECTION_FAILED in full runs).
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
  const userDir = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "replay-slowmo-"));
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
      if (msg.method === "Fetch.requestPaused") send("Fetch.failRequest", { requestId: msg.params.requestId, errorReason: "Failed" }, msg.sessionId).catch(() => {});
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
    const result = await fn(ev);
    assert.deepEqual(errors, [], `page errors: ${errors.join(" | ")}`);
    return result;
  } finally {
    proc.kill(); server.close();
  }
}

// The default pair (no ?vs=): Fantom220TR vs TolyaNo, pair mode.
const PAIR = "replay/index.html?name=fantom220tr";
const slowBtn = `[...document.querySelectorAll('#pace button')].find((b) => b.textContent === '🐌')`;

test("headless: slow-mo toggle defaults on, toggles, persists, ?slowmo wins", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  await withPage(PAIR, async (ev) => {
    assert.equal(await ev(`window.__slowmo().on`), true, "default on");
    const out = await ev(`(() => { const b = ${slowBtn}; b.click();
      return { on: window.__slowmo().on, stored: localStorage.getItem('ps2ekd:replaySlowmo'), pressed: b.getAttribute('aria-pressed') }; })()`);
    assert.equal(out.on, false, "click turns it off");
    assert.equal(out.stored, "0");
    assert.equal(out.pressed, "false");
    const out2 = await ev(`(() => { const b = ${slowBtn}; b.click();
      return { on: window.__slowmo().on, stored: localStorage.getItem('ps2ekd:replaySlowmo') }; })()`);
    assert.equal(out2.on, true, "click turns it back on");
    assert.equal(out2.stored, "1");
  });
  await withPage(PAIR + "&slowmo=0", async (ev) => {
    assert.equal(await ev(`window.__slowmo().on`), false, "?slowmo=0 loads off");
  });
  await withPage(PAIR + "&slowmo=1", async (ev) => {
    assert.equal(await ev(`window.__slowmo().on`), true, "?slowmo=1 loads on");
  });
});

test("headless: a kill at x2 dips under x0.6 with slow-mo on, stays flat with it off", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  for (const [extra, wantDip] of [["", true], ["&slowmo=0", false]]) {
    await withPage(PAIR + `&speed=2${extra}`, async (ev) => {
      const plan = await ev(`window.__duelPlan().engagements.filter((e) => e.killAt != null).map((e) => e.killAt)`);
      assert.ok(plan.length > 0, "plan has kills");
      const killAt = plan[0];
      const now = await ev(`window.__slow().simT`);
      await ev(`window.__fast(${Math.max(0, killAt - 3 - now)}, 1/30)`);
      // Step wall time in 0.1 s increments across the kill, sampling the rate.
      const samples = [];
      let w = await ev(`window.__slow().wallT`);
      for (let i = 0; i < 60; i++) {
        w += 0.1;
        const s = await ev(`window.__advance(${w}); window.__slow()`);
        samples.push(s);
        if (s.simT > killAt + 3) break;
      }
      assert.ok(samples.some((s) => s.simT > killAt), "stepping crossed the kill");
      const around = samples.filter((s) => s.simT >= killAt - 1.5 && s.simT <= killAt + 1.5);
      const after = samples.filter((s) => s.simT > killAt + 3);
      if (wantDip) {
        assert.ok(around.some((s) => s.scale < 0.6), `slow-mo dips near the kill (min ${Math.min(...around.map((s) => s.scale)).toFixed(2)})`);
        assert.ok(after.some((s) => Math.abs(s.scale - 2) < 0.15), "rate returns to x2 after the kill");
      } else {
        assert.ok(around.every((s) => Math.abs(s.scale - 2) < 0.05), "slow-mo off: x2 stays constant through the kill");
      }
    });
  }
});

test("headless: a crowd kill shows a 'the crowd' killcam plus the envelope", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  // Crowd kills are rare (thirdP ~0.022), so the default pair's plan has
  // none — scan the reference pairs for the first plan that has one.
  const pairs = JSON.parse(fs.readFileSync(path.join(ROOT, "test/fixtures/replay-pairs.json"), "utf8")).pairs;
  let done = false;
  for (const p of pairs) {
    const url = `replay/index.html?name=${encodeURIComponent(p.aShard.n)}&vs=${encodeURIComponent(p.bShard.n)}`;
    const found = await withPage(url, async (ev) => {
      const thirds = await ev(`window.__duelPlan().engagements.filter((e) => e.outcome === 'third').map((e) => e.segments.find((s) => s.phase === 'resolution').t0)`);
      if (!thirds.length) return false;
      const deathT = thirds[0];
      const now = await ev(`window.__slow().simT`);
      await ev(`window.__fast(${Math.max(0, deathT - 3 - now)}, 1/30)`);
      let w = await ev(`window.__slow().wallT`);
      const samples = [];
      for (let i = 0; i < 60; i++) {
        w += 0.1;
        const s = await ev(`window.__advance(${w}); window.__slow()`);
        samples.push(s);
        if (s.simT > deathT + 1.5) break;
      }
      const kc = await ev(`(() => { const el = document.getElementById('killcam'); return el ? { hidden: el.hidden, text: el.textContent } : null; })()`);
      assert.ok(kc && !kc.hidden, "killcam shows for the crowd kill");
      assert.ok(kc.text.includes("the crowd"), `killcam names the crowd, got: ${kc.text}`);
      assert.ok(!kc.text.includes("MSW-R") && !kc.text.includes("Anchor"), "no killer weapon is shown for a crowd kill");
      const after = samples.filter((s) => s.simT > deathT && s.simT <= deathT + 1.5);
      assert.ok(after.some((s) => s.scale < 0.6), "the crowd kill plays the slow-mo envelope");
      return true;
    });
    if (found) { done = true; break; }
  }
  assert.ok(done, "no reference pair plan contains a crowd kill");
});

test("headless: a cine jump cut lands 5 data s before the fight", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  await withPage(PAIR + "&speed=cine", async (ev) => {
    const FAST = new Set(["running", "respawnTimer", "beingRevived", "idle", "reposition", "reloading", "travel", "revived", "aftermath"]);
    const segs = await ev(`window.__plan()`);
    let run = null;
    for (let i = 0; i < segs.length;) {
      if (!FAST.has(segs[i][0])) { i++; continue; }
      let j = i, end = segs[i][1] + segs[i][2];
      // __plan() rounds times to 0.1 s, so contiguity needs a loose tolerance.
      while (j + 1 < segs.length && FAST.has(segs[j + 1][0]) && Math.abs(segs[j + 1][1] - end) < 0.15) { j++; end = segs[j][1] + segs[j][2]; }
      if (end - segs[i][1] > 20) { run = { start: segs[i][1], end, len: end - segs[i][1] }; break; }
      i = j + 1;
    }
    assert.ok(run, "plan has a calm stretch over 20 data s");
    const before = await ev(`window.__params().jump`);
    const now = await ev(`window.__slow().simT`);
    await ev(`window.__fast(${Math.max(0, run.start - 1 - now)}, 1/30)`);
    let w = await ev(`window.__slow().wallT`), jumped = null, simAtJump = null;
    for (let i = 0; i < 400 && !jumped; i++) {
      w += 0.1;
      const s = await ev(`window.__advance(${w}); ({ jump: window.__params().jump, simT: window.__slow().simT })`);
      if (s.jump && s.jump !== before && s.jump.at > (before?.at ?? -1)) { jumped = s.jump; simAtJump = s.simT; }
    }
    assert.ok(jumped, "a jump cut fired on the stretch");
    assert.ok(Math.abs(jumped.n - (run.len - 5)) <= 2, `card shows the skipped seconds (${jumped.n}), not the full stretch (${run.len.toFixed(1)})`);
    assert.ok(simAtJump > run.end - 5.5 && simAtJump < run.end - 4, `scene lands ~5 s before the fight (simT ${simAtJump.toFixed(1)}, fight at ${run.end.toFixed(1)})`);
  });
});
