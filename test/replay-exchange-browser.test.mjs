// #106 crowd exchanges (headless): over a driven window, every fight has
// return fire, every damaged fight recovers before the next fight, no
// pot-shot hits the player mid-exchange, every death has return fire, and
// the tallies stay within Poisson-powered tolerances of the player's stats.
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
  const userDir = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "replay-exch-"));
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

test("headless: crowd fights are exchanges with recovery, tallies hold", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  // ?vs= with no such rival falls back to the crowd scene (pair stays null),
  // so this page runs planCycle, not the duel plan.
  await withPage("replay/index.html?name=fantom220tr&vs=nosuchplayer123", async (ev) => {
    // Drive until the sample is powered: at least 10 data minutes AND at
    // least 10 deaths (DPM needs the deaths; KPM/spk ride along), capped.
    await ev(`(() => {
      for (let i = 0; i < 360 && (window.__params().simT < 600 || window.__exch().deaths.length < 10); i++) {
        window.__advance(window.__slow().wallT + 10);
      }
      return true;
    })()`);
    const out = await ev(`(() => {
      const p = window.__params(), e = window.__exch();
      return { simT: p.simT, st: { kpm: p.st.kpm, dpm: p.st.dpm, spk: p.st.spk },
        stats: { k: p.stats.k, d: p.stats.d, shots: p.stats.shots },
        fights: e.fights, deaths: e.deaths, pots: e.pots };
    })()`);
    assert.ok(out.simT >= 600, `drove ${out.simT} data s`);
    assert.ok(out.fights.length >= 5, `${out.fights.length} fights`);
    for (const f of out.fights) {
      assert.ok(f.mainFired >= 1, `fight at ${f.t0} has the player's burst (${f.mainFired})`);
      assert.ok(f.retFired >= 1, `fight at ${f.t0} has return fire (${f.retFired})`);
      if (f.retH > 0) assert.ok(f.recovery.length > 0, `damaged fight at ${f.t0} (retH ${f.retH}) recovers`);
      else assert.equal(f.recovery.length, 0, `untouched fight at ${f.t0} skips recovery`);
    }
    for (let i = 0; i + 1 < out.fights.length; i++) {
      const a = out.fights[i], b = out.fights[i + 1];
      if (a.recoveryDur > 0) {
        assert.ok(b.t0 >= a.t0 + a.dur + a.recoveryDur - 0.01,
          `recovery of ${a.recoveryDur}s after the fight at ${a.t0} finishes before the next fight at ${b.t0}`);
      }
    }
    for (const d of out.deaths) {
      if (d.veh) continue;
      assert.ok(d.killerFired >= 1, `death at ${d.t0} has the killer's burst`);
      assert.ok(d.backFired >= 1, `death at ${d.t0} has the player's return fire`);
    }
    assert.ok(!out.pots.some((p) => p.hasOpp), `no pot-shot at the player mid-exchange (${out.pots.length} pot-shots at the player total)`);
    // Tallies, Poisson-powered: KPM ±40%, DPM ±75% (≥10 deaths by the drive
    // rule), shots/kill ±25%.
    const min = out.simT / 60;
    const kpm = out.stats.k / min, dpm = out.stats.d / min, spk = out.stats.shots / Math.max(1, out.stats.k);
    assert.ok(Math.abs(kpm - out.st.kpm) / out.st.kpm <= 0.40, `KPM ${kpm.toFixed(2)} vs ${out.st.kpm}`);
    assert.ok(Math.abs(dpm - out.st.dpm) / out.st.dpm <= 0.75, `DPM ${dpm.toFixed(2)} vs ${out.st.dpm}`);
    assert.ok(Math.abs(spk - out.st.spk) / out.st.spk <= 0.25, `shots/kill ${spk.toFixed(1)} vs ${out.st.spk}`);
  });
});

test("headless: crowd exchange page at 390 px runs without errors", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  await withPage("replay/index.html?name=fantom220tr&vs=nosuchplayer123", async (ev) => {
    await ev(`(() => { for (let i = 0; i < 6; i++) window.__advance(window.__slow().wallT + 10); return true; })()`);
    assert.equal(await ev(`typeof window.__exch === 'function'`), true, "the exchange log hook exists at phone width");
  }, 390);
});
