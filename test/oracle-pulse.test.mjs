// Pulsing target rings on the Oracle map (owner t688u): Solo marks order #1, Big squad
// #1-#3, in the selected faction's colour; the rings follow pan/zoom; the pulse is CSS
// transform/opacity only, and prefers-reduced-motion leaves a static ring.
// Static checks always run; the browser part needs Playwright + Chromium (skipped otherwise).
import { test, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("pulse ring: CSS is transform/opacity only and stops for reduced motion", () => {
  const css = read("oracle/oracle.css"), map = read("oracle/js/map.js");
  const kf = css.match(/@keyframes orPulse \{([^@]*?)\}\s*\n/);
  assert.ok(kf, "orPulse keyframes");
  const props = [...kf[1].matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(props)].sort(), ["opacity", "transform"]);
  assert.match(css, /#map \.pulses \.pp \{[^}]*animation: orPulse 1\.4s/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{ animation: none !important/);
  assert.match(map, /S\.cmdMode === "big" \? 3 : 1/);
  assert.doesNotMatch(read("styles.css"), /orPulse/, "main site not animated");
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
  alert.commander = { t: 30, leader: "VS", factions: { VS: fac(), NC: fac(), TR: fac() }, fight_up: { deviation: false, text: "" }, focus: { VS: focus, NC: focus, TR: focus } };
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

describe("oracle map pulse rings (t688)", { skip: !ok && "Playwright/Chromium not available" }, () => {
  for (const width of [390, 1366]) {
    it(`Solo #1, Big squad #1-#3, follows zoom, reduced motion static at ${width} px`, { timeout: 60000 }, async () => {
      const server = await serve(), port = server.address().port;
      const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
      try {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const errors = []; page.on("pageerror", (e) => errors.push(String(e && e.message)));
        await page.goto(`http://127.0.0.1:${port}/oracle/?api=http://127.0.0.1:${port}/api`);
        await page.waitForSelector("#map .pulses .pw", { timeout: 15000 });
        let rs = await rings(page);
        assert.deepEqual(rs.map((r) => r.n), [1], "Solo: only #1");
        assert.equal(rs[0].pc, "var(--vs)", "selected faction colour");
        assert.ok(rs[0].w >= 30, "big enough to see on a phone");
        const dist = (r, b) => Math.hypot(r.x - b.x, r.y - b.y);
        const near = (r, b) => dist(r, b) < r.w / 2 + 25;   // badge right next to the ring
        const clear = (r, b) => dist(r, b) > r.w / 2;        // ...but not hidden under it
        assert.ok(near(rs[0], (await badges(page))[0]), "ring sits on order 1's base (next to its badge)");
        assert.ok(clear(rs[0], (await badges(page))[0]), "number badge not covered by the ring");
        assert.equal(await page.$eval("#map .pulses .pp", (e) => getComputedStyle(e).animationName), "orPulse");
        await page.click("[data-cmode='big']");
        await page.waitForFunction(() => document.querySelectorAll("#map .pulses .pw").length === 3, null, { timeout: 5000 });
        rs = await rings(page);
        assert.deepEqual(rs.map((r) => r.n), [1, 2, 3], "Big squad: #1-#3");
        // Zoom in at the first ring: rings move with the map and stay next to their badges.
        const before = rs[0];
        const box = await page.$eval("#map svg", (s) => { const r = s.getBoundingClientRect(); return [r.left + r.width * 0.3, r.top + r.height * 0.3]; });
        await page.mouse.move(box[0], box[1]); await page.mouse.wheel(0, -600); await page.waitForTimeout(300);
        const after = await rings(page), bs = await badges(page);
        assert.ok(Math.hypot(after[0].x - before.x, after[0].y - before.y) > 5, "ring moved with the zoom");
        after.forEach((r, i) => { assert.ok(near(r, bs[i]), `ring ${r.n} still on its base after zoom`); assert.ok(clear(r, bs[i]), `badge ${r.n} not covered`); });
        // Reduced motion: no pulse, the static ring stays.
        await page.emulateMedia({ reducedMotion: "reduce" });
        assert.equal(await page.$eval("#map .pulses .pp", (e) => getComputedStyle(e).animationName), "none");
        assert.equal(await page.$eval("#map .pulses .ps", (e) => getComputedStyle(e).borderTopStyle), "solid");
        assert.deepEqual(errors, []);
      } finally { await browser.close(); server.close(); }
    });
  }
});
