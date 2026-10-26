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
  alert.commander.focus.TR = { focus: { kind: "push", bases: ["Bitol"], target: "NC", p: 0.3, cuts: [], reconnects: [], now: 20, then: 20, heat: 46, text: "Push Bitol (NC): the fight is there" }, backups: [], quiet: false, minor: true };
  alert.commander.pockets = { VS: [{ chokepoint: "Cairn Station", cp_fid: "266000", bases: ["Hurakan", "Hurakan Secure Storage", "Hurakan Western Pass", "Johari Cove"], fids: ["263000", "264000"], n: 4, hold_drop: 10 }] };
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
        // Base names are links with order numbers; the map carries the same number (owner 2026-10-24).
        assert.ok(await page.$(".cf h3.VS ~ .focus .blink[data-base='Cairn Station']"), "focus base name is a link");
        assert.equal(await page.$eval(".cf h3.VS ~ .focus .onum", (e) => e.textContent), "1");
        await page.waitForSelector("#map .ords circle", { timeout: 10000 });
        assert.equal(await page.$eval("#map .ords", (g) => [...g.querySelectorAll("text")].map((t) => t.textContent).join(" ")), "1 −10%");
                // Map: base borders, a dot per base, and a faction switch for the orders.
        assert.ok(await page.$eval("#map path.borders", (p) => p.getAttribute("d").length > 1000));
        assert.ok(await page.$$eval("#map .pois circle", (c) => c.length) > 50);
        await page.click("#map [data-mapfac='NC']");
        await page.waitForFunction(() => document.querySelector("#map [data-mapfac='NC'].on"), null, { timeout: 5000 });
        await page.click("#map [data-mapfac='VS']");
        await page.waitForFunction(() => document.querySelector("#map [data-mapfac='VS'].on"), null, { timeout: 5000 });
                assert.match(await page.$eval(".cf h3.TR", (h) => h.parentElement.textContent), /Busiest front:.*Push Bitol.*46% chance it changes hands/s);
                assert.match(await page.$eval(".cf h3.VS", (h) => h.parentElement.querySelector(".pocket").textContent), /Pocket Hurakan, Hurakan Secure Storage, Hurakan Western Pass \+1: hold Cairn Station or −10%/);
                // 🔊 voice (#65): click VS's speaker, the top order is spoken (speech stubbed).
        await page.evaluate(() => {
          window.__said = []; window.speechSynthesis.speak = (u) => window.__said.push(u.text); window.speechSynthesis.cancel = () => {};
          // Edge-like list (owner t650u): dozens of voices with long names.
          const vs = Array.from({ length: 40 }, (_, i) => ({ name: `Microsoft Voice${i} Online (Natural) - English (United States of America, long name ${i})`, lang: "en-US", localService: false }));
          window.speechSynthesis.getVoices = () => vs;
          window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } }; // fake voices are plain objects; the real Utterance rejects them
        });
        await page.click(".cf h3.VS [data-voice]");
        const said = await page.evaluate(() => window.__said);
        assert.deepEqual(said, ["Defend Cairn Station."]);
        assert.equal(await page.$eval(".cf h3.VS [data-voice]", (b) => b.getAttribute("aria-pressed")), "true");
        // ⚙️ voice list (owner t650u): no always-visible dropdown; ⚙️ next to the speaker opens a compact list.
        assert.equal(await page.$(".voicesel, #main select[data-voicesel]"), null, "no voice dropdown");
        const gear = ".cf h3.VS [data-voice] + [data-voicegear]";
        assert.ok(await page.$(gear), "⚙️ right after the speaker");
        await page.click(gear);
        const box = await page.$eval(".voicemenu", (m) => { const r = m.getBoundingClientRect(), o = m.querySelector(".vopt"); return { shown: !m.hidden, l: r.left, r: r.right, h: r.height, vw: innerWidth, vh: innerHeight, n: m.querySelectorAll(".vopt").length, scrolls: m.scrollHeight > m.clientHeight, cut: o.scrollWidth > o.clientWidth, ell: getComputedStyle(o).textOverflow, title: o.title }; });
        assert.ok(box.shown && box.n === 40, "list open with every voice");
        assert.ok(box.l >= 0 && box.r <= box.vw && box.r - box.l <= 321, `list fits the screen (${box.l}–${box.r} of ${box.vw})`);
        assert.ok(box.h <= box.vh * 0.5 + 1 && box.scrolls, "list height capped, scrolls");
        assert.ok(box.cut && box.ell === "ellipsis" && /long name 0\)$/.test(box.title), "long names cut with …, full name on hover");
        await page.click(".voicemenu .vopt:nth-child(3)");
        assert.equal(await page.$eval(".voicemenu", (m) => m.hidden), true, "closes on a pick");
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("ps2oracle_voice")).voice), "Microsoft Voice10 Online (Natural) - English (United States of America, long name 10)");
        assert.equal((await page.evaluate(() => window.__said)).at(-1), "Voice set.");
        await page.click(gear);
        assert.match(await page.$eval(".voicemenu .vopt.on", (o) => o.textContent), /^✓ Microsoft Voice10 /, "saved voice ticked");
        await page.keyboard.press("Escape");
        assert.equal(await page.$eval(".voicemenu", (m) => m.hidden), true, "closes on Escape");
        await page.click(gear);
        await page.mouse.click(5, 5);
        assert.equal(await page.$eval(".voicemenu", (m) => m.hidden), true, "closes on a tap elsewhere");
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(over <= 0, `horizontal scroll of ${over}px`);
      } finally {
        await browser.close();
        server.close();
      }
    });
  }
});
