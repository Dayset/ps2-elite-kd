// Server switch in the Rankings toolbar (3 states: All / Osprey / Wainwright;
// PS room: All / Genudine / Ceres) — full names on PC, first letters on phones.
// One server selected shows only that server's players; All shows everyone.
// test-select-reaches: index.html rankings.mjs styles.css i18n/en.json data/ranks.json data-ps/ranks.json
// test-select: imports only
// (live.html carries the same toolbar, but naming it here would put this file's
// browser tests in the live tier; the markup test below still reads it.)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const fmt = (n) => n.toLocaleString("en-US");
/** Bare name, same rule as rankings.mjs bare(). */
const bare = (name) => String(name || "").replace(/^\s*\[[^\]]*\]\s*/, "").trim().toLowerCase();

describe("Rankings server switch (static wiring)", () => {
  it("toolbar markup in index.html and live.html: 3-state switch after Ranks", () => {
    for (const page of ["index.html", "live.html"]) {
      const html = read(page);
      assert.ok(html.includes('<span class="rk-server-switch" id="serverSwitch" role="group"'), `${page}: switch group`);
      assert.match(html, /data-i18n-aria-label="ranks\.serverGroup"/, `${page}: group label key`);
      const ranksAt = html.indexOf('id="removeRanksToggle"');
      const switchAt = html.indexOf('id="serverSwitch"');
      const locateAt = html.indexOf('id="locateWrap"');
      assert.ok(ranksAt > 0 && switchAt > ranksAt && locateAt > switchAt, `${page}: switch sits between Ranks and Find player`);
      assert.match(html, /<button type="button" class="rk-server-btn" data-server="all" aria-pressed="true"[^>]*data-i18n="ranks\.serverAll"[^>]*>All<\/button>/, `${page}: All pressed by default`);
      assert.match(html, /<button type="button" class="rk-server-btn" data-server="osprey" aria-pressed="false"[^>]*><span class="srv-full">Osprey<\/span><span class="srv-short">O<\/span><\/button>/, `${page}: Osprey full + short`);
      assert.match(html, /<button type="button" class="rk-server-btn" data-server="wainwright" aria-pressed="false"[^>]*><span class="srv-full">Wainwright<\/span><span class="srv-short">W<\/span><\/button>/, `${page}: Wainwright full + short`);
      assert.ok(html.includes("styles.css?v=20261115-srv1"), `${page}: styles pin bumped`);
      assert.ok(html.includes("app.js?v=20261120-pspure1"), `${page}: app pin bumped`);
    }
  });

  it("rankings.mjs: persisted 3-state filter, room-aware, cut before the name branch", () => {
    const rk = read("rankings.mjs");
    assert.match(rk, /const LS_SERVER_FILTER = "ps2-elite-kd-server-filter";/);
    assert.match(rk, /function readServerFilter\(\) \{[\s\S]*?serversOfRoom\(ROOM === "ps"\)\.includes\(v\) \? v : "all"/);
    assert.match(rk, /let serverFilter = readServerFilter\(\);/);
    const body = rk.slice(rk.indexOf("function sortedFiltered()"));
    const cut = body.indexOf('if (serverFilter !== "all")');
    const nameBranch = body.indexOf("if (q) {");
    assert.ok(cut > 0 && nameBranch > cut, "server cut applies before (and beside) the name branch");
    assert.match(body, /list = list\.filter\(\(r\) => r\.srvKey === serverFilter\);/);
    assert.match(rk, /localStorage\.setItem\(LS_SERVER_FILTER, next\)/);
    assert.match(rk, /syncServerSwitch\(\);\s*render\(\);/);
    assert.match(rk, /const label = SERVER_LABEL\[key\] \|\| key;/);
    assert.match(rk, /short\.textContent = label\.slice\(0, 1\);/);
    assert.match(rk, /tr\("ranks\.serverTitle", "Show only \{server\} players", \{ server: label \}\)/);
  });

  it("styles.css: joined segment, pressed like Ranks, phones show first letters", () => {
    const css = read("styles.css");
    assert.match(css, /\.rk-filter-row \.rk-server-switch \{[^}]*display: inline-flex/);
    assert.match(css, /\.rk-filter-row \.rk-server-btn\[aria-pressed="true"\] \{[^}]*border-color: var\(--accent\)/);
    assert.match(css, /\.rk-filter-row \.rk-server-btn \.srv-short \{ display: none; \}/);
    const phone = css.slice(css.indexOf("@media (max-width: 600px)"));
    assert.match(phone, /\.rk-filter-row \.rk-server-btn \.srv-full \{ display: none; \}/);
    assert.match(phone, /\.rk-filter-row \.rk-server-btn \.srv-short \{ display: inline; \}/);
  });

  it("i18n: the switch keys exist in en.json", () => {
    const en = JSON.parse(read("i18n/en.json"));
    for (const k of ["ranks.serverAll", "ranks.serverAllTitle", "ranks.serverGroup", "ranks.serverTitle"]) assert.ok(en[k], k);
    assert.equal(en["ranks.serverAll"], "All");
  });
});

// --- Browser checks (same CDP harness shape as ranks-typing.test.mjs) ---

const chrome = ["google-chrome", "chromium", "chromium-browser", "google-chrome-stable"].find((b) => {
  try { execFileSync("which", [b], { stdio: "ignore" }); return true; } catch { return false; }
});

/** Counts per server from a ranks.json payload (srvKey rule: PC osprey/wainwright, PS us→genudine / eu→ceres). */
function countsOf(file) {
  const { count, cols, rows } = JSON.parse(read(file));
  const si = cols.indexOf("srv");
  const c = { total: count, osprey: 0, wainwright: 0, genudine: 0, ceres: 0 };
  for (const r of rows) {
    if (r[si] === "osprey") c.osprey++;
    else if (r[si] === "wainwright") c.wainwright++;
    else if (r[si] === "us") c.genudine++;
    else if (r[si] === "eu") c.ceres++;
  }
  return c;
}

/** A Wainwright name no Osprey row contains as a substring (so Osprey + name = 0 rows). */
function wainwrightOnlyName() {
  const { cols, rows } = JSON.parse(read("data/ranks.json"));
  const ni = cols.indexOf("name"), si = cols.indexOf("srv");
  const ospreyBare = rows.filter((r) => r[si] === "osprey").map((r) => bare(r[ni]));
  for (const r of rows) {
    if (r[si] !== "wainwright") continue;
    const b = bare(r[ni]);
    if (b.length >= 5 && !ospreyBare.some((o) => o.includes(b))) return b;
  }
  throw new Error("no Wainwright-only name found");
}

function serve() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css" };
  const server = http.createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  return server;
}

async function startBrowser(mode) {
  const server = serve();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const userDir = fs.mkdtempSync("/tmp/ranks-server-");
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
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
    return r.result.value;
  };
  if (mode === "mobile") {
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }, sessionId);
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, sessionId);
  } else {
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
  }
  await send("Page.enable", {}, sessionId);
  const go = async (url) => {
    await send("Page.navigate", { url }, sessionId);
    await ev(`new Promise(async (r) => { for (let t = 0; t < 400 && !document.querySelector("#ranksBody tr[data-q]"); t++) await new Promise((q) => setTimeout(q, 50)); r(1); })`);
    await ev(`(document.getElementById("ranksTableSection").open = true, 1)`);
    // Let the progressive render settle (same 1 s-quiet wait as ranks-typing).
    await ev(`new Promise((r) => { let t; const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(done, 1000); }); const done = () => { mo.disconnect(); r(1); }; mo.observe(document.getElementById("ranksBody"), { childList: true, subtree: true }); t = setTimeout(done, 1000); setTimeout(done, 30000); })`);
  };
  const meta = () => ev(`document.querySelector("#ranksMeta").firstElementChild.textContent`);
  const clickServer = async (key) => {
    await ev(`document.querySelector('#serverSwitch [data-server="${key}"]').click(); 1`);
    await new Promise((r) => setTimeout(r, 400));
  };
  const pressed = () => ev(`[...document.querySelectorAll("#serverSwitch .rk-server-btn")].map((b) => b.dataset.server + ":" + b.getAttribute("aria-pressed")).join(" ")`);
  const close = () => { proc.kill("SIGKILL"); try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {} server.close(); };
  return { port, send, ev, go, meta, clickServer, pressed, close, sessionId };
}

describe("Rankings server switch (browser)", () => {
  it("desktop: All / Osprey / Wainwright counts, name + server combine, persistence, PS relabel", { skip: !chrome && "no Chrome installed", timeout: 120000 }, async () => {
    const pc = countsOf("data/ranks.json");
    const ps = countsOf("data-ps/ranks.json");
    const name = wainwrightOnlyName();
    const b = await startBrowser("desktop");
    try {
      await b.go(`http://127.0.0.1:${b.port}/index.html#rankings`);
      // Full names on PC, short letters hidden.
      assert.equal(await b.ev(`getComputedStyle(document.querySelector('[data-server="osprey"] .srv-full')).display`), "inline");
      assert.equal(await b.ev(`getComputedStyle(document.querySelector('[data-server="osprey"] .srv-short')).display`), "none");
      assert.equal(await b.meta(), `${fmt(pc.total)} of ${fmt(pc.total)} players`);
      await b.clickServer("osprey");
      assert.equal(await b.meta(), `${fmt(pc.osprey)} of ${fmt(pc.total)} players`);
      assert.equal(await b.pressed(), "all:false osprey:true wainwright:false");
      assert.equal(await b.ev(`localStorage.getItem("ps2-elite-kd-server-filter")`), "osprey");
      // Name search + server: a Wainwright-only name finds nobody on Osprey…
      await b.ev(`(() => { const el = document.getElementById("ranksSearch"); el.value = ${JSON.stringify(name)}; el.dispatchEvent(new Event("input", { bubbles: true })); return 1; })()`);
      await new Promise((r) => setTimeout(r, 800));
      assert.equal(await b.meta(), `0 of ${fmt(pc.total)} players`);
      // …and finds its row once the filter is cleared.
      await b.ev(`(() => { const el = document.getElementById("ranksSearch"); el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); return 1; })()`);
      await new Promise((r) => setTimeout(r, 800));
      assert.equal(await b.meta(), `${fmt(pc.osprey)} of ${fmt(pc.total)} players`);
      await b.clickServer("wainwright");
      assert.equal(await b.meta(), `${fmt(pc.wainwright)} of ${fmt(pc.total)} players`);
      await b.clickServer("all");
      assert.equal(await b.meta(), `${fmt(pc.total)} of ${fmt(pc.total)} players`);
      // Persistence across reload…
      await b.clickServer("osprey");
      await b.go(`http://127.0.0.1:${b.port}/index.html#rankings`);
      assert.equal(await b.meta(), `${fmt(pc.osprey)} of ${fmt(pc.total)} players`);
      assert.equal(await b.pressed(), "all:false osprey:true wainwright:false");
      // …but a PC value never leaks into the PS room: it falls back to All,
      // and the same switch relabels to Genudine / Ceres.
      await b.go(`http://127.0.0.1:${b.port}/index.html?room=ps#rankings`);
      assert.equal(await b.pressed(), "all:true genudine:false ceres:false");
      assert.equal(await b.ev(`document.querySelector('[data-server="genudine"] .srv-full').textContent`), "Genudine");
      assert.equal(await b.ev(`document.querySelector('[data-server="genudine"] .srv-short').textContent`), "G");
      assert.equal(await b.ev(`document.querySelector('[data-server="ceres"] .srv-full').textContent`), "Ceres");
      assert.equal(await b.meta(), `${fmt(ps.total)} of ${fmt(ps.total)} players`);
      await b.clickServer("genudine");
      assert.equal(await b.meta(), `${fmt(ps.genudine)} of ${fmt(ps.total)} players`);
      await b.clickServer("ceres");
      assert.equal(await b.meta(), `${fmt(ps.ceres)} of ${fmt(ps.total)} players`);
    } finally {
      b.close();
    }
  });

  it("mobile (390px): first letters only, switch fits, a real tap filters", { skip: !chrome && "no Chrome installed", timeout: 120000 }, async () => {
    const pc = countsOf("data/ranks.json");
    const b = await startBrowser("mobile");
    try {
      await b.go(`http://127.0.0.1:${b.port}/index.html#rankings`);
      assert.equal(await b.ev(`getComputedStyle(document.querySelector('[data-server="osprey"] .srv-full')).display`), "none");
      assert.equal(await b.ev(`getComputedStyle(document.querySelector('[data-server="osprey"] .srv-short')).display`), "inline");
      assert.equal(await b.ev(`document.querySelector('[data-server="osprey"] .srv-short').textContent`), "O");
      assert.equal(await b.ev(`document.querySelector('[data-server="wainwright"] .srv-short').textContent`), "W");
      const fit = await b.ev(`(() => { const sw = document.getElementById("serverSwitch").getBoundingClientRect(); const row = document.querySelector(".rk-filter-row"); return { right: sw.right, vw: innerWidth, rowOverflow: row.scrollWidth - row.clientWidth }; })()`);
      assert.ok(fit.right <= fit.vw, `switch right ${fit.right} within ${fit.vw}px viewport`);
      assert.ok(fit.rowOverflow <= 1, `filter row overflows by ${fit.rowOverflow}px`);
      // A real tap (not a JS click) on the O button.
      const pt = await b.ev(`(() => { const r = document.querySelector('[data-server="osprey"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1 }, b.sessionId);
      await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: 1 }, b.sessionId);
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(await b.meta(), `${fmt(pc.osprey)} of ${fmt(pc.total)} players`);
    } finally {
      b.close();
    }
  });
});
