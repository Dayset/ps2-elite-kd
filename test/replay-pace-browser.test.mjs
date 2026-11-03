// 🎬 Pace selector (#110, headless): x1/x2 clocks are exact, the stored /
// URL / default choice resolves as specified, Cinematic frame steps stay
// within the 0.4 s ramp outside bullet time and jump cuts, and tallies after
// 10 data minutes are identical in all three paces (same seed). The tally
// runs use __advance (no canvas draws), not __render, so they stay fast.
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
  const userDir = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "replay-pace-"));
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
    const waitReady = async () => {
      for (let i = 0; i < 200; i++) { await sleep(200); try { if (await ev("window.__ready === true")) return; } catch {} }
      throw new Error("page never ready");
    };
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/${url}` }, sessionId);
    await waitReady();
    await fn(ev, waitReady);
    assert.deepEqual(errors, [], "no page errors");
  } finally { proc.kill("SIGKILL"); try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {} server.close(); }
}
const PAIR = "replay/index.html?name=TolyaNo&vs=Fantom220TR";

test("headless: x1 and x2 clocks advance at exactly 1 and 2 data s per wall s", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  for (const [speed, expect] of [["1", 120], ["2", 240]]) {
    await withPage(`${PAIR}&speed=${speed}`, null, async (ev) => {
      const out = await ev(`(() => { window.__render(120); const b = window.__params().simT;
        const btn = document.querySelector('#pace button[aria-pressed="true"]');
        return { simT: b, pressed: btn ? btn.dataset.pace : null, rateText: document.querySelector('#pace .pace-rate')?.textContent }; })()`);
      // Absolute, not a delta: the page's live frame loop has already run
      // the clock a little by the time this evaluate lands, so a delta
      // from a __render(0) baseline would come up short by exactly that
      // head start. With a constant rate and no jump cuts (x1/x2 never
      // jump), simT after __render(120) is rate x 120 regardless.
      assert.ok(Math.abs(out.simT - expect) < 0.05, `speed=${speed}: simT ${out.simT}, expected ${expect}`);
      assert.equal(out.pressed, speed);
      assert.equal(out.rateText, speed === "1" ? "×1.0" : "×2.0");
    });
  }
});

test("headless: default x1, stored choice, and URL wins over storage", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  await withPage(PAIR, null, async (ev) => {
    const pressed = await ev(`document.querySelector('#pace button[aria-pressed="true"]')?.dataset.pace`);
    assert.equal(pressed, "1", "default is x1 with no URL and no storage");
  });
  await withPage(PAIR, null, async (ev, waitReady) => {
    await ev(`localStorage.setItem('ps2ekd:replayPace', '2'); location.reload();`);
    await waitReady();
    const pressed = await ev(`document.querySelector('#pace button[aria-pressed="true"]')?.dataset.pace`);
    assert.equal(pressed, "2", "the stored choice is picked up on load");
    await ev(`localStorage.setItem('ps2ekd:replayPace', '1'); location.reload();`);
    await waitReady();
    const pressed2 = await ev(`document.querySelector('#pace button[aria-pressed="true"]')?.dataset.pace`);
    assert.equal(pressed2, "1");
  });
  await withPage(`${PAIR}&speed=cine`, null, async (ev) => {
    await ev(`localStorage.setItem('ps2ekd:replayPace', '1');`);
    const pressed = await ev(`document.querySelector('#pace button[aria-pressed="true"]')?.dataset.pace`);
    assert.equal(pressed, "cine", "URL wins over storage for this load (storage is not rewritten by it)");
    const stored = await ev(`localStorage.getItem('ps2ekd:replayPace')`);
    assert.equal(stored, "1", "the URL choice does not overwrite the stored choice");
  });
});

test("headless: Cinematic frame steps stay within the ramp outside bullet time and jump cuts", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  await withPage(`${PAIR}&speed=cine`, null, async (ev) => {
    const out = await ev(`(() => {
      // __advance, not __render: the ramp, the scale and the simT are all
      // advance-driven (freeze is consumed in advance too); drawing 14,400
      // canvas frames times the test out past its 300 s budget, while the
      // same stepping without draws runs in seconds.
      let w = window.__slow().wallT, maxStep = 0, frames = 0, bulletFrames = 0, jumpFrames = 0;
      let prev = window.__slow();
      for (let i = 0; i < 14400; i++) {
        w = window.__slow().wallT + 1 / 120; window.__advance(w); const s = window.__slow(); frames++;
        const dSim = s.simT - prev.simT;
        if (prev.bullet || s.bullet) bulletFrames++;
        else if (dSim > 0.05) jumpFrames++;
        else maxStep = Math.max(maxStep, Math.abs(s.scale - prev.scale));
        prev = s;
      }
      return { maxStep, frames, bulletFrames, jumpFrames };
    })()`);
    // Largest non-bullet, non-jump target step is 2 -> 0.5 (1.5 over 0.4 s
    // = 0.03125 per 1/120 s frame); 0.04 leaves float slack.
    assert.ok(out.maxStep <= 0.04, `max frame step ${out.maxStep} exceeds the ramp`);
    assert.ok(out.jumpFrames > 0, "the run actually contained jump cuts (else the exclusion is vacuous)");
    assert.ok(out.bulletFrames >= 0);
  });
});

test("headless: tallies after 10 data minutes are identical in all three paces", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  const tallies = {}, stops = {};
  let cineGap = null;
  for (const speed of ["1", "2", "cine"]) {
    await withPage(`${PAIR}&speed=${speed}`, null, async (ev) => {
      const st = await ev(`(() => {
        let w = window.__slow().wallT;
        // Fast jumps to 590 data s, then single-frame steps to the 600 mark:
        // coarse jumps overshoot by up to a whole jump (10–20 data s), and a
        // shot in that overshoot gap is not a pace difference. Single frames
        // shrink the crossing window to one frame (<= 2/120 data s).
        for (let i = 0; i < 200 && window.__params().simT < 590; i++) { w = window.__slow().wallT + 10; window.__advance(w); }
        for (let i = 0; i < 10000 && window.__params().simT < 600; i++) { w = window.__slow().wallT + 1 / 120; window.__advance(w); }
        const s = window.__params().stats;
        return { simT: window.__params().simT, k: s.k, d: s.d, a: s.a, hs: s.hs, hh: s.hh, shots: s.shots, hits: s.hits, veh: s.veh, rev: s.rev };
      })()`);
      assert.ok(st.simT >= 600, `speed=${speed} did not reach 600 data s (got ${st.simT})`);
      stops[speed] = st.simT;
      const { simT: _overshoot, ...tally } = st;
      tallies[speed] = tally;
      if (speed === "cine") {
        // The main's plan shots scheduled in the stopping sliver (600,
        // cineStop]: under __advance driving the pump fires every plan shot
        // with t <= the stopping time, in order, with no skips, so these are
        // exactly the shots Cinematic counts that x1 (stopping on 600.0)
        // does not. Counted from the plan itself, on the same page.
        cineGap = await ev(`(() => {
          const stop = window.__params().simT;
          let shots = 0, hits = 0;
          for (const e of window.__duelPlan().engagements) for (const sh of e.shots) {
            if (sh.from === 'a' && sh.t > 600 && sh.t <= stop) { shots++; if (sh.hit) hits++; }
          }
          return { shots, hits, stop };
        })()`);
      }
    });
  }
  assert.deepEqual(tallies["2"], tallies["1"], "x2 tallies match x1");
  // Cinematic tallies must equal x1's plus exactly the sliver shots: any
  // other difference is a real pace bug, not a stopping artifact.
  assert.deepEqual(
    { ...tallies.cine, shots: tallies.cine.shots - cineGap.shots, hits: tallies.cine.hits - cineGap.hits },
    tallies["1"], `Cinematic tallies match x1 once the stopping sliver is accounted for (stop ${stops.cine}, sliver ${JSON.stringify(cineGap)})`);
});

test("headless: pace selector at 390 px, clickable", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  await withPage(PAIR, { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, async (ev) => {
    const out = await ev(`(() => {
      const btns = [...document.querySelectorAll('#pace button')];
      const before = document.querySelector('#pace button[aria-pressed="true"]')?.dataset.pace;
      document.querySelector('#pace button[data-pace="2"]').click();
      const after = document.querySelector('#pace button[aria-pressed="true"]')?.dataset.pace;
      return { n: btns.length, before, after, stored: localStorage.getItem('ps2ekd:replayPace'),
        scrollW: document.documentElement.scrollWidth, paceW: document.getElementById('pace')?.getBoundingClientRect().width ?? 0 };
    })()`);
    assert.equal(out.n, 3);
    assert.equal(out.before, "1");
    assert.equal(out.after, "2", "clicking x2 selects it");
    assert.equal(out.stored, "2", "a click persists the choice");
    assert.ok(out.paceW > 0 && out.paceW <= 390, "selector fits the phone width");
    assert.ok(out.scrollW <= 414, `selector must not widen the page past the pre-existing #life overflow (414), got ${out.scrollW}`);
  });
});
