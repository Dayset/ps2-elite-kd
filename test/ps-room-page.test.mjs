// PlayStation room on the real page (#55): with ?room=ps the page reads data-ps/
// only, asks only the PS Census namespaces, never calls the PC cache Worker and
// keeps its own browser storage. The same name in both rooms opens two
// different players. Headless Chromium; skipped when none is on PATH.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { upsertPsEntry, buildPsPayload } from "../scripts/refresh-ps.mjs";
import { usePsReviewLists, buildRanksWithGuard, addServerColumn, buildNames, buildRanksLite } from "../scripts/build-ranks.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chrome = ["google-chrome", "chromium", "chromium-browser", "google-chrome-stable"].find((b) => {
  try { execFileSync("which", [b], { stdio: "ignore" }); return true; } catch { return false; }
});

/** A small PS tree in a temp dir (served as /data-ps/): ShloDog here is a PS player, not PC's ShloDog. */
let psDir = "";
const PS_SHLODOG = "us-5428452358028858337";
function buildPsTree() {
  psDir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-room-page-"));
  fs.mkdirSync(path.join(psDir, "players"));
  for (const f of ["hidden.json", "reviewed.json", "farm.json", "not-farm.json"]) fs.writeFileSync(path.join(psDir, f), JSON.stringify({ players: {} }));
  const now = Date.now();
  const index = { players: [] };
  const people = [
    { cid: "5428452358028858337", name: "ShloDog", ns: "ps2ps4us", k: 0.7 },
    { cid: "5428352936447594833", name: "Shadow", ns: "ps2ps4eu", k: 1.1 },
    { cid: "5429825812514923825", name: "BrenKill", ns: "ps2ps4us", k: 0.9, tag: "PSN" },
  ];
  for (const x of people) {
    const rows = [];
    for (let i = 0; i < 60; i++) rows.push({ name: `PsOpp${i}`, kills: 2 + ((i * 7) % 9), deaths: 1 + ((i * 5) % 7), kpm: +(0.2 + (((i * 13) % 25) / 10) * x.k).toFixed(3) });
    const c = { character_id: x.cid, name: { first: x.name }, ...(x.tag ? { outfit: { alias: x.tag } } : {}),
      times: { creation: String(Math.floor(now / 1000) - 900 * 86400), last_login: String(Math.floor(now / 1000) - 7200) },
      stats: { stat_history: [{ stat_name: "kills", all_time: "40000" }, { stat_name: "deaths", all_time: "30000" }, { stat_name: "time", all_time: "3000000" }] } };
    const r = { own: { kpm: 0.8 * x.k, acc: 25, hsr: 20 * x.k, ivi: 500 * x.k }, rows, board: rows, lookups: rows.length, paceFails: 0, skipped: 0, ownFailed: false };
    const p = buildPsPayload({ c, ns: x.ns, r, now });
    fs.writeFileSync(path.join(psDir, `players/${p.key}.json`), JSON.stringify(p));
    upsertPsEntry(index, { key: p.key, ns: x.ns, cid: x.cid, display: p.player.display, savedAt: now, top: 200 });
  }
  fs.writeFileSync(path.join(psDir, "index.json"), JSON.stringify(index));
  usePsReviewLists(psDir);
  const { ranks } = buildRanksWithGuard(psDir, { known: {} });
  addServerColumn(ranks, index);
  fs.writeFileSync(path.join(psDir, "ranks.json"), JSON.stringify(ranks));
  fs.writeFileSync(path.join(psDir, "names.json"), JSON.stringify(buildNames(index, { withFile: true })));
  fs.writeFileSync(path.join(psDir, "ranks-lite.json"), JSON.stringify(buildRanksLite(ranks)));
}

async function withPage(fn) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css" };
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const p = u.startsWith("/data-ps/") ? path.join(psDir, u.slice("/data-ps/".length)) : path.join(root, u);
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-room-chrome-")); // owner 2026-10-26: removed in finally — each run leaked ~14 MB until /tmp hit 100%
  const proc = spawn(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-pipe", "--user-data-dir=" + userDir, "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  let id = 0, buf = "";
  const pending = new Map();
  proc.stdio[4].on("data", (d) => {
    buf += d.toString("utf8");
    let i;
    while ((i = buf.indexOf("\0")) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
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
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send("Page.enable", {}, sessionId);
    await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__errs=[];addEventListener('error',e=>__errs.push(String(e.message)));addEventListener('unhandledrejection',e=>__errs.push(String(e.reason)));" }, sessionId);
    const ev = async (expr) => {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
      return r.result.value;
    };
    const nav = async (u) => {
      await send("Page.navigate", { url: `http://127.0.0.1:${port}/${u}` }, sessionId);
      // Page.navigate returns before the new document is parsed: wait for it.
      for (let t = 0; t < 200; t++) {
        const ok = await ev(`location.href.endsWith(${JSON.stringify(u)}) && !!window.__ps2EliteKd`).catch(() => false);
        if (ok) return;
        await new Promise((q) => setTimeout(q, 50));
      }
      throw new Error("page did not load: " + u);
    };
    await fn({ ev, nav });
  } finally {
    proc.kill("SIGKILL");
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch { /* ignore */ }
    server.close();
  }
}

/** Wait until the stats table shows n names (the graph is drawn). */
const shown = (n) => `new Promise(async (r) => { for (let t = 0; t < 300; t++) { const k = document.querySelectorAll("#stats th.stats-name, th.stats-name").length; if (k >= ${n}) return r(true); await new Promise((q) => setTimeout(q, 50)); } r(false); })`;
const resources = `performance.getEntriesByType("resource").map((e) => e.name.replace(location.origin + "/", ""))`;

describe("PlayStation room page (#55)", { skip: !chrome && "no Chrome" }, () => {
  before(() => buildPsTree());
  after(() => { if (psDir) fs.rmSync(psDir, { recursive: true, force: true }); });

  it("?room=ps: PS files only, PS Census only, no PC Worker, own storage; same name in PC opens PC's player", { timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav("index.html?room=ps&names=ShloDog");
      assert.equal(await ev(`document.documentElement.dataset.room`), "ps");
      assert.equal(await ev(`document.getElementById("roomSelect").value`), "ps");
      await ev(`document.getElementById("analyzeBtn").click()`);
      assert.equal(await ev(shown(1)), true, "PS ShloDog drawn");
      await ev(`new Promise((r) => setTimeout(r, 1500))`);
      const ps = await ev(resources);
      assert.ok(ps.includes(`data-ps/players/${PS_SHLODOG}.json`), "PS ShloDog file");
      for (const u of ps) {
        assert.ok(!/^data\/(players|ranks|ranks-lite|index|hidden|reviewed|farm|not-farm)\b/.test(u), `PS room read PC data: ${u}`);
        assert.ok(!/workers\.dev/.test(u), `PS room called the PC cache Worker: ${u}`);
        const ns = (/census\.daybreakgames\.com\/s:[^/]+\/get\/([a-z0-9]+):v2/.exec(u) || [])[1];
        if (ns) assert.ok(ns === "ps2ps4us" || ns === "ps2ps4eu", `PS room asked Census ${ns}`);
      }
      assert.match(await ev(`document.querySelector(".srv-tag") && document.querySelector(".srv-tag").textContent`), /Genudine/);
      const keys = await ev(`Object.keys(localStorage).filter((k) => /cache-v2|-last|pending-names/.test(k))`);
      assert.ok(keys.length && keys.every((k) => k.endsWith(":ps")), `PS storage keys: ${keys}`);
      assert.equal(await ev(`getComputedStyle(document.getElementById("liveBtn")).display`), "none", "Live is PC only");
      assert.deepEqual(await ev(`window.__errs`), []);

      // Same name, PC room: PC's ShloDog file, nothing from data-ps/.
      await nav("index.html?names=ShloDog");
      assert.equal(await ev(`document.documentElement.dataset.room`), "pc");
      await ev(`document.getElementById("analyzeBtn").click()`);
      assert.equal(await ev(shown(1)), true, "PC ShloDog drawn");
      await ev(`new Promise((r) => setTimeout(r, 1500))`);
      const pc = await ev(resources);
      assert.ok(pc.includes("data/players/shlodog.json"), "PC ShloDog file");
      assert.ok(!pc.some((u) => u.startsWith("data-ps/")), "PC room read data-ps/");
      assert.equal(await ev(`document.querySelectorAll(".srv-tag").length`), 0);
      assert.deepEqual(await ev(`window.__errs`), []);
    });
  });
});

describe("🎥 PS footer per-day line (owner 2026-10-26)", () => {
  it("per-day line shows in the PS room too: no IS_PS early return, room-aware launch, names file, and storage key", () => {
    const js = fs.readFileSync(path.join(root, "app.js"), "utf8");
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    assert.ok(!js.includes('if (!el || IS_PS) return;'), "the #55 PS early return is gone");
    assert.ok(js.includes("function pageNameRate()"));
    assert.ok(js.includes('const LAUNCH_UTC = IS_PS ? Date.UTC(2026, 9, 22) : Date.UTC(2026, 9, 7);'), "PS launch Oct 22, PC launch Oct 7");
    assert.ok(js.includes('fetch(IS_PS ? "data-ps/names.json" : "data/names.json"'), "PS room fetches its own names file");
    assert.ok(js.includes('const KEY = IS_PS ? "ps2ekd-page-namerate-ps" : "ps2ekd-page-namerate";'), "cached total is room-scoped");
    assert.ok(html.includes('<p id="pageNameRate"'), "the footer element exists in the shared footer");
  });
});
