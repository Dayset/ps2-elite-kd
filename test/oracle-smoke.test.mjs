// Oracle page smoke test (#28): load the real oracle/ page in headless Chromium against a
// canned stub API and fail on any pageerror (e.g. 2026-10-18 "betNode is not defined").
// Needs Playwright (npm "playwright" or "playwright-core") and a Chromium; skipped otherwise.
// Override the browser with PW_CHROMIUM=/path/to/chrome.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let pw = null;
for (const m of ["playwright", "playwright-core", process.env.PLAYWRIGHT_MODULE].filter(Boolean)) {
  try { pw = await import(m); pw = pw.chromium ? pw : pw.default; if (pw && pw.chromium) break; pw = null; } catch { /* try next */ }
}
const candidates = [process.env.PW_CHROMIUM, "/opt/pw-browsers/chromium", "/opt/google/chrome/chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].filter(Boolean);
const exe = candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
async function canLaunch() {
  if (!pw) return false;
  try { const b = await pw.chromium.launch(exe ? { executablePath: exe } : {}); await b.close(); return true; } catch { return false; }
}
const ok = await canLaunch();
const skip = !pw ? "Playwright not installed (npm i --no-save playwright && npx playwright install chromium)" : !ok ? "no Chromium for Playwright" : false;

function stub() {
  const now = Math.floor(Date.now() / 1000);
  const st = { t: 30, leader: "VS", win: { VS: { pct: 50 }, NC: { pct: 30 }, TR: { pct: 20 } }, territory: { VS: 40, NC: 30, TR: 30 }, momentum: { VS: 1, NC: -1, TR: 0 }, pop: { VS: 100, NC: 90, TR: 80 }, owners: {} };
  const alert = { key: "1-4-153-111", world: 1, world_name: "Osprey", zone: 4, zone_name: "Hossin", status: "live", kind: "territory", start_ts: now - 1800, dur: 90, state: st };
  // Commander with a defend row whose loss cuts bases off (#63), focus folded above it.
  const row = { name: "Cairn Station", vs: "NC", win_drop: 22.3, p_loss: 0.11, ev: 1.5, priority: 100, heat: 0, pred_heat: 0, freezing: false, cut_off: false,
    hold_factor: 1, resistance: null, median_hold_min: null, cuts: 4, cut_names: ["Hurakan", "Hurakan Secure Storage", "Hurakan Western Pass"] };
  const fac = (f) => ({ win_pct: st.win[f].pct, terr_pct: 33, war_shape: "two-front", eliminated: false, defend: [row], attack: [], kingmaker: [] });
  const vs = fac("VS");
  vs.kingmaker = [{ text: "KM big swing", my_swing: 12 }, { text: "KM small swing", my_swing: -3 }];
  alert.commander = { t: 30, leader: "VS", factions: { VS: vs, NC: fac("NC"), TR: fac("TR") }, fight_up: { deviation: false, text: "" },
    focus: { VS: { focus: { kind: "hold", bases: ["Cairn Station"], target: "NC", p: 0.11, cuts: ["Hurakan"], reconnects: [], now: 50, then: 40, text: "Hold Cairn Station against NC — losing it cuts off 1 of ours (Hurakan)" }, backups: [], quiet: false } } };
  alert.commander_ts = now - 10;
  return {
    "/live": { alerts: [alert] },
    "/history": { alerts: [], benchmark: {}, uniform: 0.2222 },
    "/health": { ok: true, last_ok_age_s: 5, last_cycle_age_s: 5 },
    "/alert": { alert, ticks: [...Array(31)].map((_, t) => ({ t, win: { VS: 40 + t / 3, NC: 35, TR: 25 } })), outliers: null },
    "/vote/quote": { open: true, pcts: { VS: 50, NC: 30, TR: 20 }, quotes: { VS: { 25: 40 }, NC: { 25: 70 }, TR: { 25: 100 } }, fee_rate: { VS: 0, NC: 0, TR: 0 } },
  };
}
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

function serve() {
  const canned = stub();
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (u.pathname.startsWith("/api/")) {
      const body = canned[u.pathname.slice(4)];
      res.writeHead(body ? 200 : 404, { "content-type": "application/json", ...cors });
      return res.end(JSON.stringify(body || { error: "not_found" }));
    }
    const p = path.join(root, decodeURIComponent(u.pathname.endsWith("/") ? u.pathname + "index.html" : u.pathname));
    if (!p.startsWith(root) || !fs.existsSync(p) || !fs.statSync(p).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
    res.end(fs.readFileSync(p));
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

describe("oracle page smoke test (#28)", { skip }, () => {
  for (const width of [390, 1366]) {
    it(`loads with no page errors at ${width} px`, { timeout: 60000 }, async () => {
      const server = await serve();
      const port = server.address().port;
      const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
      try {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e && e.message)));
        await page.goto(`http://127.0.0.1:${port}/oracle/?api=http://127.0.0.1:${port}/api`);
        await page.waitForFunction(() => /Osprey · Hossin/.test((document.getElementById("main") || {}).textContent || ""), null, { timeout: 15000 }).catch(() => {});
        await page.waitForSelector("#voteSlot .vote", { timeout: 10000 }).catch(() => {});
        assert.deepEqual(errors, [], "page threw");
        assert.match(await page.$eval("#main", (e) => e.textContent), /Osprey · Hossin/, "#main shows the alert title");
        assert.ok(await page.$("#voteSlot .vote"), "#voteSlot .vote rendered");
        // Defend rows show what losing the base cuts off (✂️ with the base names in its hover).
        const cutMark = await page.$$eval(".cmd span[title^='losing it cuts off']", (xs) => xs.map((x) => [x.textContent, x.title]));
        assert.ok(cutMark.length >= 1, "✂️ on a defend row");
        assert.deepEqual(cutMark[0], ["✂️4", "losing it cuts off 4 of ours: Hurakan, Hurakan Secure Storage, Hurakan Western Pass +1"]);
        // Focus shows the change (owner 2026-10-24), no P-numbers, kingmaker split by size vs the focus (10 %).
        const vsCard = await page.$eval(".cf h3.VS", (h) => h.parentElement.innerHTML);
        assert.match(vsCard, /\(−10\.0%\)/);
        assert.doesNotMatch(vsCard, /P100/);
        const outside = await page.$eval(".cf h3.VS", (h) => [...h.parentElement.children].filter((e) => e.tagName === "UL").map((e) => e.textContent).join("|"));
        assert.match(outside, /KM big swing/);
        assert.doesNotMatch(outside, /KM small swing/);
        assert.match(vsCard, /KM small swing/, "small one still listed, inside All moves");
        // 🔊 voice (#65): click VS's speaker, the top order is spoken (speech stubbed).
        await page.evaluate(() => { window.__said = []; window.speechSynthesis.speak = (u) => window.__said.push(u.text); window.speechSynthesis.cancel = () => {}; });
        await page.click(".cf h3.VS [data-voice]");
        const said = await page.evaluate(() => window.__said);
        assert.deepEqual(said, ["Hold Cairn Station or 10% lost, cuts 1. 50% 1st place."]);
        assert.equal(await page.$eval(".cf h3.VS [data-voice]", (b) => b.getAttribute("aria-pressed")), "true");
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(over <= 0, `horizontal scroll of ${over}px`);
      } finally {
        await browser.close();
        server.close();
      }
    });
  }
});
