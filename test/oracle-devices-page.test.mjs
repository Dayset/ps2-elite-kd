// #82 in two real (headless) browsers: a signed-in PC shows a one-time QR, a phone opens the link and is signed in
// as the same character, and both vote from one wallet — one vote per faction per alert, the stale device told why.
// The real Worker auth + vote handlers run behind a local HTTP server on an in-memory D1 (node:sqlite).
// Needs Playwright (PLAYWRIGHT_MODULE=/opt/node-tools/node_modules/playwright/index.mjs here) and a Chromium.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let sqlite = null;
try { sqlite = await import("node:sqlite"); } catch {}
let pw = null;
for (const m of ["playwright", "playwright-core", process.env.PLAYWRIGHT_MODULE].filter(Boolean)) {
  try { pw = await import(m); pw = pw.chromium ? pw : pw.default; if (pw && pw.chromium) break; pw = null; } catch { /* try next */ }
}
const candidates = [process.env.PW_CHROMIUM, "/opt/pw-browsers/chromium", "/opt/google/chrome/chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].filter(Boolean);
const exe = candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
let ok = false;
if (pw) { try { const b = await pw.chromium.launch(exe ? { executablePath: exe } : {}); await b.close(); ok = true; } catch { /* no browser */ } }
const skip = !sqlite ? "node:sqlite unavailable" : !pw ? "Playwright not installed" : !ok ? "no Chromium for Playwright" : false;

const SCHEMA = fs.readFileSync(path.join(root, "oracle-worker/schema.sql"), "utf8");
function fakeD1() {
  const db = new sqlite.DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const run = (sql, args) => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; };
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { return run(sql, args); },
    _exec() { return run(sql, args); },
  });
  return { raw: db, prepare: (sql) => stmt(sql), async batch(l) { db.exec("BEGIN"); try { const r = l.map((s) => s._exec()); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } } };
}
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const CID = "5428010618035300555", NAME = "TwoScreens";

async function serve() {
  const { handleAuth } = await import("../oracle-worker/src/auth.js");
  const { handleVote } = await import("../oracle-worker/src/vote.js");
  const DB = fakeD1();
  const env = { DB };
  const now = Math.floor(Date.now() / 1000);
  const st = { ts: now, t: 30, leader: "VS", win: { VS: { pct: 50 }, NC: { pct: 30 }, TR: { pct: 20 } }, territory: { VS: 40, NC: 30, TR: 30 }, momentum: { VS: 1, NC: -1, TR: 0 }, pop: { VS: 100, NC: 90, TR: 80 }, owners: {} };
  const alert = { key: "1-4-153-111", world: 1, world_name: "Osprey", zone: 4, zone_name: "Hossin", status: "live", kind: "territory", start_ts: now - 1800, dur: 90, state: st };
  DB.raw.prepare("INSERT INTO alert (key, world, zone, instance_id, event_id, start_ts, dur, status, state, updated) VALUES (?,1,4,111,153,?,90,'live',?,0)").run(alert.key, alert.start_ts, JSON.stringify(st));
  const canned = {
    "/live": { alerts: [alert] },
    "/history": { alerts: [], benchmark: {}, uniform: 0.2222 },
    "/health": { ok: true, last_ok_age_s: 5, last_cycle_age_s: 5 },
    "/alert": { alert, ticks: [...Array(31)].map((_, t) => ({ t, win: { VS: 40 + t / 3, NC: 35, TR: 25 } })), outliers: null },
  };
  const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname.startsWith("/api/")) {
      const p = u.pathname.slice(4);
      if (p.startsWith("/auth/") || p.startsWith("/vote/")) {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = chunks.length ? Buffer.concat(chunks) : undefined;
        const url = new URL("https://oracle" + p + u.search);
        const r = new Request(url, { method: req.method, headers: { ...req.headers, "cf-connecting-ip": "127.0.0.1" }, body: req.method === "POST" ? body : undefined });
        const out = p.startsWith("/auth/") ? await handleAuth(r, env, url, json) : await handleVote(r, env, url, json);
        res.writeHead(out.status, { "content-type": "application/json" });
        return res.end(await out.text());
      }
      const body = canned[p];
      res.writeHead(body ? 200 : 404, { "content-type": "application/json" });
      return res.end(JSON.stringify(body || { error: "not_found" }));
    }
    const f = path.join(root, decodeURIComponent(u.pathname.endsWith("/") ? u.pathname + "index.html" : u.pathname));
    if (!f.startsWith(root) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  // The PC already passed the in-game logout: a completed challenge -> its verified token.
  DB.raw.prepare("INSERT INTO challenge (id, cid, name, world, faction, created, status) VALUES ('pcchal',?,?,1,'VS',?,'passed')").run(CID, NAME, now);
  const done = await handleAuth(new Request("https://oracle/auth/complete", { method: "POST", body: JSON.stringify({ id: "pcchal" }) }), env, new URL("https://oracle/auth/complete"), json);
  const pcToken = (await done.json()).token;
  return { server, DB, pcToken, port: server.address().port };
}

describe("#82 PC + phone in two browsers", { skip }, () => {
  it("QR from the PC signs the phone in; one wallet; one vote per faction; the stale device is told why", { timeout: 120000 }, async () => {
    const { server, DB, pcToken, port } = await serve();
    const base = `http://127.0.0.1:${port}/oracle/?api=http://127.0.0.1:${port}/api`;
    const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
    const errors = [];
    try {
      const pcCtx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      await pcCtx.addInitScript((t) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("ps2oracle_token", t); sessionStorage.setItem("seeded", "1"); } }, pcToken);
      const pc = await pcCtx.newPage();
      pc.on("pageerror", (e) => errors.push("pc: " + e.message));
      await pc.goto(base);
      await pc.waitForFunction((n) => (document.getElementById("who") || {}).textContent.includes(n), NAME, { timeout: 15000 });

      // PC: 📱 Phone -> one-time QR. The QR on screen encodes exactly the link the Worker minted.
      const minted = pc.waitForResponse((r) => r.url().endsWith("/api/auth/link") && r.request().method() === "POST");
      await pc.click("#linkPhone");
      const link = await (await minted).json();
      await pc.waitForSelector("#authBody .qr svg");
      const { qrSvg } = await import("../oracle/js/link.js");
      const shown = await pc.$eval("#authBody .qr svg path", (e) => e.getAttribute("d"));
      const want = /<path d="([^"]+)"/.exec(qrSvg(link.url, "One-time sign-in code"))[1];
      assert.equal(shown, want, "the QR on screen encodes exactly the minted link (same modules)");
      assert.match(link.url, /^https:\/\/dayset\.github\.io\/ps2-elite-kd\/oracle\/#link=[A-Za-z0-9_-]{43}$/);
      const code = link.url.split("#link=")[1];

      // Phone (390 px) opens the link: signed in as the same character, no logout, code gone from the address bar.
      const phCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const phone = await phCtx.newPage();
      phone.on("pageerror", (e) => errors.push("phone: " + e.message));
      await phone.goto(`${base}#link=${code}`);
      await phone.waitForFunction((n) => (document.getElementById("who") || {}).textContent.includes(n), NAME, { timeout: 15000 });
      assert.equal(await phone.evaluate(() => location.hash), "", "the code is stripped from the address bar");
      assert.match(await phone.$eval("#authBody", (e) => e.textContent), /Signed in as TwoScreens on this device/);
      const phToken = await phone.evaluate(() => localStorage.getItem("ps2oracle_token"));
      assert.ok(phToken && phToken !== pcToken, "the phone has its own session token");
      await phone.click("#authClose");

      // The PC dialog follows: phone signed in, 2 devices.
      await pc.waitForFunction(() => /Phone signed in ✓/.test(document.getElementById("authBody").textContent), null, { timeout: 10000 });
      assert.match(await pc.$eval("#authBody", (e) => e.textContent), /Signed in on 2 devices/);
      await pc.click("#authClose");

      // Both panels load. The phone's view goes stale: the PC votes VS meanwhile.
      await phone.waitForSelector("#voteSlot .facpick.VS:not([disabled])", { timeout: 15000 });
      await pc.waitForSelector("#voteSlot .facpick.VS:not([disabled])", { timeout: 15000 });
      await pc.click("#voteSlot .facpick.VS");
      await pc.click("#voteSlot #votePlace");
      await pc.waitForFunction(() => /Voted VS with 50/.test(document.querySelector("#voteSlot .votemsg")?.textContent || ""), null, { timeout: 10000 });
      await pc.waitForSelector("#voteSlot .facpick.VS[disabled]", { timeout: 10000 });
      assert.match(await pc.$eval("#voteSlot .facpick.VS", (b) => b.textContent), /VS ✓/);

      // The stale phone still offers VS: the server refuses, the phone says why and catches up.
      await phone.click("#voteSlot .facpick.VS");
      await phone.click("#voteSlot #votePlace");
      await phone.waitForFunction(() => /already voted VS on this alert \(maybe from another device\)/.test(document.querySelector("#voteSlot .votemsg")?.textContent || ""), null, { timeout: 10000 });
      await phone.waitForSelector("#voteSlot .facpick.VS[disabled]", { timeout: 10000 });
      assert.match(await phone.$eval("#voteSlot .votebar", (e) => e.textContent), /BonusCheques 950/, "the phone shows the real balance");

      // The phone backs NC; the PC sees it when it comes back into focus.
      await phone.click("#voteSlot .facpick.NC");
      await phone.click("#voteSlot #votePlace");
      await phone.waitForFunction(() => /Voted NC with 50/.test(document.querySelector("#voteSlot .votemsg")?.textContent || ""), null, { timeout: 10000 });
      await new Promise((r) => setTimeout(r, 2100)); // focus refetches are throttled to one per 2 s
      await pc.evaluate(() => window.dispatchEvent(new Event("focus")));
      await pc.waitForSelector("#voteSlot .facpick.NC[disabled]", { timeout: 10000 });
      assert.match(await pc.$eval("#voteSlot .votebar", (e) => e.textContent), /BonusCheques 900/);

      // Daily BonusCheque: claimed on the PC; the stale phone still shows the link and is told it's taken.
      await pc.click("#voteSlot #voteBonus");
      await pc.waitForFunction(() => /\+25 BonusCheques added/.test(document.querySelector("#voteSlot .votemsg")?.textContent || ""), null, { timeout: 10000 });
      await phone.click("#voteSlot #voteBonus");
      await phone.waitForFunction(() => /already claimed \(maybe on another device\)/.test(document.querySelector("#voteSlot .votemsg")?.textContent || ""), null, { timeout: 10000 });
      assert.equal(await phone.$("#voteSlot #voteBonus"), null, "the claim link goes away");

      assert.equal(DB.raw.prepare("SELECT COUNT(*) n FROM vote WHERE cid=?").get(CID).n, 2, "two votes: VS and NC");
      assert.equal(DB.raw.prepare("SELECT balance FROM wallet WHERE cid=?").get(CID).balance, 925, "1000 − 50 − 50 + 25");

      // Signing out on the phone keeps the PC signed in.
      await phone.click("#signOut");
      await phone.waitForSelector("#signIn", { timeout: 5000 });
      await pc.reload();
      await pc.waitForFunction((n) => (document.getElementById("who") || {}).textContent.includes(n), NAME, { timeout: 15000 });
      assert.deepEqual(errors, [], "no page errors");
    } finally {
      await browser.close();
      server.close();
    }
  });
});
