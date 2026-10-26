// 🔥 Heat toggle (owner t692u): orders go to the hottest fight, ignoring the alert math.
// One direction, two when the second is close in heat; pulsing rings on those bases; the
// voice says just "Attack X." / "Defend X."; the choice is remembered; 9 languages.
// Unit checks always run; the browser part needs Playwright + Chromium (skipped otherwise).
import { test, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { heatPlan, heatCandidates, CLOSE } from "../oracle-worker/src/heatmode.js";
import { modeFocus, pickHeat, HEAT_KEY } from "../oracle/js/sticky.js";
import { sayText } from "../oracle/js/voice.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

// Tiny lattice: WG(1) - A(2) - B(3) - C(4) - D(5); VS owns WG, A, B; NC owns C, D.
const L = { names: { 1: "VS Warpgate", 2: "A", 3: "B", 4: "C", 5: "D" }, adj: new Map([["1", ["2"]], ["2", ["1", "3"]], ["3", ["2", "4"]], ["4", ["3", "5"]], ["5", ["4"]]]) };
const own = new Map([["1", 1], ["2", 1], ["3", 1], ["4", 2], ["5", 2]]);
const NOW = 100000;

test("heat plan: hottest fight, attack next to us or defend ours, 2nd only when close", () => {
  assert.equal(CLOSE, 0.6);
  // NC took C from VS 1 min ago -> VS: attack (retake) C, 100 * 0.75.
  let p = heatPlan({ own, lattice: L, flips: [[NOW - 60, "NC", "VS", "4"]], nowTs: NOW });
  assert.deepEqual(p.VS.focus, { kind: "take", bases: ["C"], target: "NC", heat: 75, hot: true });
  assert.equal(p.VS.backups.length, 0, "B (next to C) is only 30: not close");
  assert.equal(p.NC.focus.kind, "hold"); assert.equal(p.NC.focus.bases[0], "C");
  assert.equal(p.NC.focus.target, "VS", "the side fighting for it");
  assert.ok(!("TR" in p), "a faction with no bases gets no plan");
  // Two fights of similar heat: two directions; warpgates never.
  p = heatPlan({ own, lattice: L, flips: [[NOW - 60, "NC", "VS", "4"], [NOW - 30, "VS", "NC", "2"]], nowTs: NOW });
  assert.deepEqual([p.VS.focus, ...p.VS.backups].map((x) => x.bases[0]), ["A", "C"]);
  assert.ok(!heatCandidates({ own, lattice: L, flips: [[NOW - 10, "NC", "VS", "2"]], nowTs: NOW }, "VS").some((x) => /Warpgate/.test(x.name)));
  // No fight in the last 4 minutes: quiet.
  assert.equal(heatPlan({ own, lattice: L, flips: [[NOW - 300, "NC", "VS", "4"]], nowTs: NOW }).VS.quiet, true);
});

test("heat toggle: page wiring, remembered, voice, 9 languages, Worker", () => {
  assert.equal(HEAT_KEY, "ps2oracle_heatmode");
  assert.equal(pickHeat("1"), true); assert.equal(pickHeat(null), false);
  const c = { focus: { VS: { focus: { kind: "take", bases: ["X"] }, backups: [] } }, focus_heat: { VS: { focus: { kind: "hold", bases: ["H"], hot: true, heat: 90 }, backups: [], quiet: false } } };
  assert.equal(modeFocus(c, "big", {}, { ts: 1 }, true).VS.focus.bases[0], "H");
  assert.equal(modeFocus(c, "big", {}, { ts: 1 }, false).VS.focus.bases[0], "X");
  assert.equal(modeFocus({ focus: c.focus }, "big", {}, { ts: 1 }, true).VS.focus.bases[0], "X", "older Worker rows: normal plan");
  assert.equal(sayText("VS", c.focus_heat.VS), "Defend H.");
  assert.equal(sayText("VS", { focus: { kind: "take", bases: ["C"], hot: true }, backups: [] }), "Attack C.");
  const w = read("oracle-worker/src/index.js"), main = read("oracle/js/main.js"), cmd = read("oracle/js/commander.js");
  assert.match(w, /cmd\.focus_heat = heatPlan\(\{ own, lattice, flips, nowTs/);
  assert.match(main, /localStorage\.setItem\(HEAT_KEY/);
  assert.match(cmd, /\$\{voiceButton\(f\)\}\$\{heatButton\(heat\)\}/, "next to the voice button");
  for (const l of ["en", "ja", "ru", "de", "fr", "zh", "es", "uk", "it"]) {
    const j = JSON.parse(read(`i18n/${l}.json`));
    for (const k of ["or.c.heatOn", "or.c.heatOff", "or.c.heatN", "or.c.heatNote"]) assert.ok(j[k] && j[k].includes("🔥"), `${l} ${k}`);
    assert.match(j["or.c.heatN"], /\{n\}/);
  }
});
let pw = null;
for (const m of ["playwright", "playwright-core", process.env.PLAYWRIGHT_MODULE].filter(Boolean)) {
  try { pw = await import(m); pw = pw.chromium ? pw : pw.default; if (pw && pw.chromium) break; pw = null; } catch { /* next */ }
}
const exe = [process.env.PW_CHROMIUM, "/opt/pw-browsers/chromium", "/opt/google/chrome/chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].filter(Boolean).find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
let ok = false;
if (pw) { try { const b = await pw.chromium.launch(exe ? { executablePath: exe } : {}); await b.close(); ok = true; } catch { /* no browser */ } }

function stub() {
  const now = Math.floor(Date.now() / 1000);
  const st = { t: 30, leader: "VS", win: { VS: { pct: 50 }, NC: { pct: 30 }, TR: { pct: 20 } }, territory: { VS: 40, NC: 30, TR: 30 }, momentum: {}, pop: { VS: 100, NC: 90, TR: 80 }, owners: {} };
  const alert = { key: "1-4-153-111", world: 1, world_name: "Osprey", zone: 4, zone_name: "Hossin", status: "live", kind: "territory", start_ts: now - 1800, dur: 90, state: st };
  const atk = (name) => ({ name, target: "NC", win_gain: 3, priority: 100, heat: 0 });
  const fac = () => ({ win_pct: 33, terr_pct: 33, war_shape: "two-front", eliminated: false, attack: [atk("Fort Drexler"), atk("Hatcher Airstation"), atk("Matsuda Genetics")], defend: [], kingmaker: [] });
  const focus = { focus: { kind: "take", bases: ["Cairn Station"], target: "NC", now: 50, then: 55, text: "Take Cairn Station" }, backups: [], quiet: false };
  const hot = { focus: { kind: "take", bases: ["Fort Drexler"], target: "NC", heat: 100, hot: true }, backups: [{ kind: "hold", bases: ["Hatcher Airstation"], target: "TR", heat: 80, hot: true }], quiet: false, heat_mode: true };
  alert.commander = { t: 30, leader: "VS", factions: { VS: fac(), NC: fac(), TR: fac() }, fight_up: { deviation: false, text: "" }, focus: { VS: focus, NC: focus, TR: focus },
    focus_heat: { VS: hot, NC: { focus: null, backups: [], quiet: true, heat_mode: true }, TR: hot } };
  alert.commander_ts = now - 10;
  return { "/live": { alerts: [alert] }, "/history": { alerts: [], benchmark: {}, uniform: 0.2222 }, "/health": { ok: true, last_ok_age_s: 5, last_cycle_age_s: 5 },
    "/alert": { alert, ticks: [], outliers: null }, "/vote/quote": { open: false } };
}
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };
function serve() {
  const canned = stub();
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname.startsWith("/api/")) { const body = canned[u.pathname.slice(4)]; res.writeHead(body ? 200 : 404, { "content-type": "application/json", "access-control-allow-origin": "*" }); return res.end(JSON.stringify(body || {})); }
    const p = path.join(root, decodeURIComponent(u.pathname.endsWith("/") ? u.pathname + "index.html" : u.pathname));
    if (!p.startsWith(root) || !fs.existsSync(p) || !fs.statSync(p).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" }); res.end(fs.readFileSync(p));
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}
// Ring centre vs the base's own point on the map (SVG → screen through the live transform).
const rings = (page) => page.$$eval("#map .pulses .pw", (ws) => ws.map((w) => { const r = w.getBoundingClientRect(); return { n: +w.dataset.n, x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, pc: w.style.getPropertyValue("--pc") }; }));
const badges = (page) => page.$$eval("#map .ords .ob", (cs) => cs.map((c) => { const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }));

describe("oracle 🔥 heat toggle in the browser (t692)", { skip: !ok && "Playwright/Chromium not available" }, () => {
  for (const width of [390, 1366]) {
    it(`toggle, 2 rings on the heat bases, remembered, no errors at ${width} px`, { timeout: 60000 }, async () => {
      const server = await serve(), port = server.address().port;
      const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
      try {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const errors = []; page.on("pageerror", (e) => errors.push(String(e && e.message)));
        const url = `http://127.0.0.1:${port}/oracle/?api=http://127.0.0.1:${port}/api`;
        await page.goto(url);
        await page.waitForSelector("#map .pulses .pw", { timeout: 15000 });
        assert.equal((await rings(page)).length, 1, "Solo: 1 ring");
        assert.equal(await page.$eval(".cf.on [data-heat]", (b) => b.getAttribute("aria-pressed")), "false");
        await page.click(".cf.on [data-heat]");
        await page.waitForFunction(() => document.querySelectorAll("#map .pulses .pw").length === 2, null, { timeout: 5000 });
        assert.equal(await page.$eval(".cf.on [data-heat]", (b) => b.getAttribute("aria-pressed")), "true");
        assert.match(await page.$eval(".cf.on .focus", (e) => e.textContent), /Attack.*Fort Drexler.*fight heat 100/s);
        assert.match(await page.$eval(".cmodenote", (e) => e.textContent), /hottest fight/);
        const rs = await rings(page), bs = await badges(page);
        rs.forEach((r, i) => assert.ok(Math.hypot(r.x - bs[i].x, r.y - bs[i].y) < r.w / 2 + 25, `ring ${r.n} on its heat base`));
        await page.reload();
        await page.waitForSelector("#map .pulses .pw", { timeout: 15000 });
        assert.equal(await page.$eval(".cf.on [data-heat]", (b) => b.getAttribute("aria-pressed")), "true", "remembered");
        assert.equal((await rings(page)).length, 2);
        await page.click(".cf.on [data-heat]");
        await page.waitForFunction(() => document.querySelectorAll("#map .pulses .pw").length === 1, null, { timeout: 5000 });
        assert.deepEqual(errors, []);
      } finally { await browser.close(); server.close(); }
    });
  }
});
