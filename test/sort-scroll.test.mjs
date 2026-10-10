// t329u: on phones, tapping a column header to sort re-rendered the table and
// threw the horizontal scroll back to the start. Now it stays on the sorted column.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sortScrollTarget } from "../sort-scroll.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("sortScrollTarget (t329u)", () => {
  const g = { maxLeft: 1000, viewW: 390, stickyW: 100 };
  it("column already visible → keep the previous scroll", () => {
    assert.equal(sortScrollTarget({ ...g, prevLeft: 300, colL: 450, colW: 80 }), 300);
  });
  it("column off to the right → centred in the free area", () => {
    const left = sortScrollTarget({ ...g, prevLeft: 0, colL: 800, colW: 90 });
    assert.equal(left, 800 - 100 - (290 - 90) / 2);
  });
  it("column hidden under the sticky name column → brought out", () => {
    const left = sortScrollTarget({ ...g, prevLeft: 500, colL: 520, colW: 80 });
    assert.ok(left + 100 <= 520);
  });
  it("clamped to the scroll range", () => {
    assert.equal(sortScrollTarget({ ...g, prevLeft: 0, colL: 1300, colW: 90 }), 1000);
    assert.equal(sortScrollTarget({ ...g, prevLeft: 0, colL: 105, colW: 90 }), 0);
  });
});

const chrome = ["google-chrome", "chromium", "chromium-browser", "google-chrome-stable"].find((b) => {
  try { execFileSync("which", [b], { stdio: "ignore" }); return true; } catch { return false; }
});

async function withPage(fn, { width = 390, height = 844, mobile = true } = {}) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css" };
  const server = http.createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const proc = spawn(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-pipe", "--user-data-dir=" + fs.mkdtempSync("/tmp/sort-scroll-"), "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
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
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 3 : 1, mobile }, sessionId);
    await send("Page.enable", {}, sessionId);
    const ev = async (expr) => {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
      return r.result.value;
    };
    const nav = (u) => send("Page.navigate", { url: `http://127.0.0.1:${port}/${u}` }, sessionId);
    await fn({ ev, nav });
  } finally {
    proc.kill("SIGKILL");
    server.close();
  }
}

// In-page: scroll wrapper to show the last sortable header, click it, report.
const clickFar = (wrapSel, thSel) => `(async () => {
  const wrap = document.querySelector(${JSON.stringify(wrapSel)});
  const ths = [...wrap.querySelectorAll(${JSON.stringify(thSel)})];
  const th = ths[ths.length - 1];
  const key = th.getAttribute("data-sort") || th.getAttribute("data-key");
  wrap.scrollLeft = wrap.scrollWidth;
  await new Promise((r) => requestAnimationFrame(() => r()));
  const before = wrap.scrollLeft, y = window.scrollY;
  th.click();
  await new Promise((r) => setTimeout(r, 400));
  const w2 = document.querySelector(${JSON.stringify(wrapSel)});
  const t2 = [...w2.querySelectorAll(${JSON.stringify(thSel)})].find((h) => (h.getAttribute("data-sort") || h.getAttribute("data-key")) === key);
  const wr = w2.getBoundingClientRect(), tr = t2.getBoundingClientRect();
  return { before, after: w2.scrollLeft, wr: [wr.left, wr.right], tr: [tr.left, tr.right], sw: w2.scrollWidth, cw: w2.clientWidth, visible: tr.left >= wr.left - 1 && tr.right <= wr.right + 1, dy: window.scrollY - y, scrollable: w2.scrollWidth > w2.clientWidth };
})()`;

describe("sort keeps horizontal scroll at 390px (t329u)", () => {
  const need = ["shlodog", "justv6me", "yeezy"];
  const haveData = need.every((n) => fs.existsSync(path.join(root, "data/players", n + ".json")));
  it("index.html stats tables", { skip: (!chrome && "no Chrome") || (!haveData && "player files missing"), timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav(`index.html?names=${need.join(",")}`);
      assert.equal(await ev(`new Promise(async (r) => { for (let t = 0; t < 600; t++) { const a = window.__ps2EliteKd; if (a && !a.isAnalyzing() && a.getPlayerNames().length === 3 && document.querySelector(".stats-table-wrap th.sortable")) return r(1); await new Promise((q) => setTimeout(q, 50)); } r(0); })`), 1);
      // Let the auto-run's smooth scroll to the results finish first.
      await ev(`new Promise(async (r) => { let y = -1; for (let t = 0; t < 60; t++) { await new Promise((q) => setTimeout(q, 100)); if (window.scrollY === y) return r(1); y = window.scrollY; } r(0); })`);
      // t339u: sorting the 📊 Public table used to collapse its section.
      await ev(`(() => { const d = document.querySelector("details.stats-public"); if (d) d.open = true; return !!d; })()`);
      let n = 0;
      for (const tid of ["public", "adjusted"]) {
        const sel = `.stats-table-wrap:has(table[data-stats-table="${tid}"])`;
        if (!(await ev(`!!document.querySelector(${JSON.stringify(sel)})`))) continue;
        n++;
        const s = await ev(clickFar(sel, "th.sortable"));
        assert.ok(s.scrollable, `${tid} table scrolls horizontally at 390px`);
        assert.ok(s.before > 0);
        assert.ok(s.after > 0, `${tid}: scroll not reset (${JSON.stringify(s)})`);
        assert.ok(s.visible, `${tid}: sorted column visible (${JSON.stringify(s)})`);
        assert.equal(s.dy, 0, "no vertical page jump");
        assert.equal(await ev(`document.querySelector("details.stats-public").open`), true, `${tid}: 📊 Public stays open after sorting`);
      }
      assert.equal(n, 2);
    });
  });
  it("ranks.html table", { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav("ranks.html");
      await ev(`new Promise(async (r) => { for (let t = 0; t < 400 && !document.querySelector("#ranksBody tr[data-q]"); t++) await new Promise((q) => setTimeout(q, 50)); r(1); })`);
      const s = await ev(clickFar(".ranks-table-wrap", "#ranksHead th.sortable"));
      assert.ok(s.scrollable && s.before > 0, JSON.stringify(s));
      assert.ok(s.after > 0 && s.visible, JSON.stringify(s));
      assert.equal(s.dy, 0);
    });
  });
});

describe("PC: Raw / Smooth / Ghost toggle centred over the graph (t338u)", () => {
  const need = ["shlodog", "justv6me"];
  const haveData = need.every((n) => fs.existsSync(path.join(root, "data/players", n + ".json")));
  it("pill centre = graph centre at 1280px", { skip: (!chrome && "no Chrome") || (!haveData && "player files missing"), timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav(`index.html?names=${need.join(",")}`);
      assert.equal(await ev(`new Promise(async (r) => { for (let t = 0; t < 600; t++) { const a = window.__ps2EliteKd; if (a && !a.isAnalyzing() && document.querySelector(".chart-wrap:not(.empty) .chart-mode-bar")) return r(1); await new Promise((q) => setTimeout(q, 50)); } r(0); })`), 1);
      const g = await ev(`(() => { const b = document.querySelector(".chart-mode-bar").getBoundingClientRect(); const w = document.querySelector(".chart-mode-row").getBoundingClientRect(); return { b: (b.left + b.right) / 2, w: (w.left + w.right) / 2 }; })()`);
      assert.ok(Math.abs(g.b - g.w) < 2, JSON.stringify(g));
      // Ghost on: the caption appears but the pill stays centred.
      await ev(`(async () => { document.querySelector(".chart-ghost-btn").click(); await new Promise((r) => setTimeout(r, 300)); })()`);
      const g2 = await ev(`(() => { const b = document.querySelector(".chart-mode-bar").getBoundingClientRect(); const w = document.querySelector(".chart-mode-row").getBoundingClientRect(); return { b: (b.left + b.right) / 2, w: (w.left + w.right) / 2 }; })()`);
      assert.ok(Math.abs(g2.b - g2.w) < 2, JSON.stringify(g2));
    }, { width: 1280, height: 900, mobile: false });
  });
});

describe("Rankings: fresh browser copy + readable chart names (t338u)", () => {
  for (const [label, opts] of [["phone", {}], ["PC", { width: 1280, height: 900, mobile: false }]]) {
    it(label, { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
      const rk = JSON.parse(fs.readFileSync(path.join(root, "data/ranks.json"), "utf8"));
      const qi = rk.cols.indexOf("query"), ai = rk.cols.indexOf("adjs");
      // 6 players with nearly the same ⚔️ iVi (names would stack).
      const byV = rk.rows.filter((r) => typeof r[ai] === "number").sort((a, b) => a[ai] - b[ai]);
      const mid = Math.floor(byV.length / 2);
      const picks = byV.slice(mid, mid + 6).map((r) => r[qi]);
      const raw = JSON.parse(fs.readFileSync(path.join(root, "data/players/shlodog.json"), "utf8"));
      const p = raw.player || raw;
      const now = Date.now();
      const store = { shlodog: { name: "ShloDog", savedAt: now, fetchedAt: now, player: { ...p, global_kd: 0.5 } } };
      await withPage(async ({ ev, nav }) => {
        await nav("ranks.html");
        await ev(`localStorage.setItem("ps2-elite-kd-cache-v2", ${JSON.stringify(JSON.stringify(store))}); 1`);
        await nav(`ranks.html?pick=${picks.map(encodeURIComponent).join(",")},shlodog`);
        await ev(`new Promise(async (r) => { for (let t = 0; t < 400 && !document.querySelector("#ranksBody tr[data-q]"); t++) await new Promise((q) => setTimeout(q, 50)); r(1); })`);
        await new Promise((r) => setTimeout(r, 500));
        await ev(`(async () => { const i = document.getElementById("ranksSearch"); i.value = "shlodog"; i.dispatchEvent(new Event("input", { bubbles: true })); await new Promise((r) => setTimeout(r, 400)); })()`);
        const fresh = await ev(`(() => { const tr = [...document.querySelectorAll("#ranksBody tr[data-q]")].find((t) => t.dataset.q.toLowerCase() === "shlodog"); return tr ? !!tr.querySelector(".sample-fresh") : null; })()`);
        assert.equal(fresh, true, "ShloDog row marked ↻ fresh");
        assert.match(await ev(`document.getElementById("ranksMeta").textContent`), /1 from your fresh fetch/);
        const boxes = await ev(`[...document.querySelectorAll("#distSvg text[font-weight='700']")].map((t) => { const b = t.getBBox(); return [b.x, b.y, b.width, b.height, t.textContent]; })`);
        assert.ok(boxes.length >= 6, "names drawn: " + boxes.length);
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          const [ax, ay, aw, ah] = boxes[i], [bx, by, bw, bh] = boxes[j];
          const ov = ax < bx + bw - 0.5 && bx < ax + aw - 0.5 && ay < by + bh - 0.5 && by < ay + ah - 0.5;
          assert.ok(!ov, "labels overlap: " + boxes[i][4] + " / " + boxes[j][4]);
        }
      }, opts);
    });
  }
});
