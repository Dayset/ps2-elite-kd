// 🎬 #111 PS replay page (headless): room=ps reads only data-ps/, pair mode
// works on PS keys (default rival = top scrim partner, unknown factions never
// count as same), and scrim mode counts up to the row's real final score,
// shows the end card, and reports an exact seed-searched plan.
// JEKYLL (eu-5428352936459348305) has exactly one stored scrim: vs
// [CoMa] SuicideBomer (eu-5429307353080643105), 3–7, t0 1769724767,
// 745 s, weapons 6002640 / 6011563. The partner is NOT in the replay cache,
// so scrim mode must synthesize him (medians + row weapon) to play at all.
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

async function withPage(url, fn, width = 1366) {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const userDir = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "replay-ps-"));
  const proc = spawn(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", `--window-size=${width},900`, "--remote-debugging-pipe", "--user-data-dir=" + userDir, "about:blank"],
    { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  let id = 0, buf = "";
  const pending = new Map(), errors = [], reqs = [];
  proc.stdio[4].on("data", (d) => {
    buf += d.toString("utf8"); let i;
    while ((i = buf.indexOf("\0")) >= 0) {
      const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      if (msg.method === "Runtime.exceptionThrown") errors.push("exception: " + (msg.params.exceptionDetails?.text || "?"));
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push("console: " + (msg.params.args?.map((a) => a.value).join(" ") || "?"));
      if (msg.method === "Network.requestWillBeSent") reqs.push(msg.params.request.url);
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
    await send("Page.enable", {}, sessionId); await send("Runtime.enable", {}, sessionId); await send("Network.enable", {}, sessionId);
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
    await fn(ev, reqs);
    assert.deepEqual(errors, [], "no page errors");
  } finally { proc.kill("SIGKILL"); try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {} server.close(); }
}

const ME = "eu-5428352936459348305", OPP = "eu-5429307353080643105", T0 = 1769724767;
// A cached PS pair with a real killboard row (JEKYLL vs ElquantedOG, 2–33):
// pair mode needs the partner's shard doc or a killboard row, and the scrim
// partner above has neither, so the pair test uses this row instead.
const OPP2 = "eu-5429500088112034097";

test("headless: PS pair mode on keys, rival rig distinct from main", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  await withPage(`replay/index.html?room=ps&name=${ME}&vs=${OPP2}`, async (ev) => {
    const out = await ev(`(() => {
      const pair = window.__pair(), plan = window.__duelPlan();
      const lanes = window.__lanes();
      const main = lanes.find((l) => l.who === 'main'), rival = lanes.find((l) => l.who === 'rival');
      return { pair: !!pair, plan: !!plan, mainX: main?.x, rivalX: rival?.x };
    })()`);
    assert.equal(out.pair, true, "a PS pair resolves");
    assert.equal(out.plan, true, "a PS duel plan builds");
    assert.ok(out.mainX != null && out.rivalX != null && out.mainX < out.rivalX,
      "main and rival stand on opposite sides (distinct rigs for unknown PS factions)");
  });
});

test("headless: PS scrim mode counts to the real 3–7 and shows the end card", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  await withPage(`replay/index.html?room=ps&name=${ME}&vs=${OPP}&scrim=${T0}`, async (ev, reqs) => {
    const scrim = await ev(`window.__scrim()`);
    assert.deepEqual(
      { t0: scrim.t0, k: scrim.k, d: scrim.d, exact: scrim.exact },
      { t0: T0, k: 3, d: 7, exact: true },
      "the seed search lands the row's exact final score");
    assert.ok(scrim.planEnd >= 745, "the scene ends at the plan's own end, past the row window");
    // Drive past the plan's end (default x1: no jump cuts, 1:1).
    await ev(`(() => { const end = window.__scrim().planEnd + 1;
      for (let i = 0; i < 400 && window.__params().simT < end; i++) { window.__advance(window.__slow().wallT + 10); }
      return true; })()`);
    const out = await ev(`(() => {
      const s = window.__params().stats, card = document.getElementById('scrimEnd');
      return { k: s.k, d: s.d, endShown: window.__scrim().endShown, cardHidden: card ? card.hidden : null,
        cardText: card ? card.textContent : null };
    })()`);
    assert.equal(out.k, 3, "main's kills count up to the row's 3");
    assert.equal(out.d, 7, "main's deaths count up to the row's 7");
    assert.equal(out.endShown, true, "the end card triggers past the row duration");
    assert.equal(out.cardHidden, false, "the end card is visible");
    assert.ok(out.cardText.includes("3–7"), `end card carries the final score, got: ${out.cardText}`);
    assert.ok(out.cardText.includes("12 min") || out.cardText.includes("13 min"), `end card carries the length, got: ${out.cardText}`);
    // No PC fetch in ?room=ps: every data request goes to data-ps/, and
    // nothing touches the PC Worker or a Census namespace.
    const pcReqs = reqs.filter((u) => (u.includes("/data/") && !u.includes("/data-ps/")) || u.includes("workers.dev") || u.includes("census.daybreakgames"));
    assert.deepEqual(pcReqs, [], `PS page fetched PC resources: ${pcReqs.join(", ")}`);
    assert.ok(reqs.some((u) => u.includes("/data-ps/replay/")), "the page actually read PS replay data");
  });
});

test("headless: PS pair mode without ?vs= defaults to the top scrim partner", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  await withPage(`replay/index.html?room=ps&name=${ME}`, async (ev) => {
    const out = await ev(`(() => {
      const pair = window.__pair();
      return { pair: !!pair, bName: pair?.b?.name || null, plan: !!window.__duelPlan() };
    })()`);
    assert.equal(out.pair, true, "a default rival resolves");
    assert.ok(out.bName && out.bName.includes("SuicideBomer"), `default rival is the top scrim partner, got: ${out.bName}`);
    assert.equal(out.plan, true, "a duel plan builds for the default rival");
  });
});

test("headless: PS scrim page at 390 px shows the end card", { skip: !chrome && "no Chrome", timeout: 300000 }, async () => {
  await withPage(`replay/index.html?room=ps&name=${ME}&vs=${OPP}&scrim=${T0}`, async (ev) => {
    await ev(`(() => { const end = window.__scrim().planEnd + 1;
      for (let i = 0; i < 400 && window.__params().simT < end; i++) { window.__advance(window.__slow().wallT + 10); }
      return true; })()`);
    const shown = await ev(`(() => { const c = document.getElementById('scrimEnd'); return !!c && !c.hidden; })()`);
    assert.equal(shown, true, "the end card shows at phone width too");
  }, 390);
});
