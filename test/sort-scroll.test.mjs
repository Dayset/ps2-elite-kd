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
    await fn({ ev, nav, send, sessionId });
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
  it("Rankings table", { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav("index.html#rankings");
      await ev(`new Promise(async (r) => { for (let t = 0; t < 400 && !document.querySelector("#ranksBody tr[data-q]"); t++) await new Promise((q) => setTimeout(q, 50)); r(1); })`);
      await ev(`new Promise((r) => { document.getElementById("ranksTableSection").open = true; setTimeout(() => r(1), 200); })`); // folded by default (t358u)
      const s = await ev(clickFar(".ranks-table-wrap", "#ranksHead th.sortable"));
      assert.ok(s.scrollable && s.before > 0, JSON.stringify(s));
      assert.ok(s.after > 0 && s.visible, JSON.stringify(s));
      assert.equal(s.dy, 0);
    });
  });
});

describe("PC: 💀 / 📈 switch in the graph's top-right corner (t378u)", () => {
  const need = ["shlodog", "justv6me"];
  const haveData = need.every((n) => fs.existsSync(path.join(root, "data/players", n + ".json")));
  it("switch sits top-right, above the zoom, at 1280px", { skip: (!chrome && "no Chrome") || (!haveData && "player files missing"), timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav(`index.html?names=${need.join(",")}`);
      assert.equal(await ev(`new Promise(async (r) => { for (let t = 0; t < 600; t++) { const a = window.__ps2EliteKd; if (a && !a.isAnalyzing() && document.querySelector(".chart-wrap:not(.empty) .chart-mode-bar")) return r(1); await new Promise((q) => setTimeout(q, 50)); } r(0); })`), 1);
      const g = await ev(`(() => { const b = document.querySelector(".chart-mode-bar").getBoundingClientRect(); const w = document.querySelector(".chart-wrap").getBoundingClientRect(); const z = document.getElementById("yZoomSlider").getBoundingClientRect(); return { right: w.right - b.right, top: b.top - w.top, mid: (b.left + b.right) / 2 - (w.left + w.right) / 2, zoomBelow: z.top >= b.bottom }; })()`);
      assert.ok(g.mid > 0 && g.top < 40 && g.zoomBelow, JSON.stringify(g));
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
        await nav("index.html");
        await ev(`localStorage.setItem("ps2-elite-kd-cache-v2", ${JSON.stringify(JSON.stringify(store))}); 1`);
        await nav(`index.html?names=${picks.map(encodeURIComponent).join(",")},shlodog#rankings`);
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

describe("Analyze names box typing stays fast with a big shared cache (t343u)", () => {
  const haveData = ["shlodog", "yeezy"].every((n) => fs.existsSync(path.join(root, "data/players", n + ".json")));
  it("no rebuild per key; highlights follow after the pause", { skip: (!chrome && "no Chrome") || (!haveData && "player files missing"), timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav("index.html?names=shlodog");
      assert.equal(await ev(`new Promise(async (r) => { for (let t = 0; t < 600; t++) { const a = window.__ps2EliteKd; if (a && !a.isAnalyzing() && document.querySelector("details.cache-shared")) return r(1); await new Promise((q) => setTimeout(q, 50)); } r(0); })`), 1);
      const res = await ev(`(async () => {
        const inp = document.getElementById("namesInput");
        const details = document.querySelector("details.cache-shared");
        inp.focus();
        const per = [];
        for (const ch of "yeezy") {
          const t = performance.now();
          inp.value += ch;
          inp.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }));
          per.push(performance.now() - t);
        }
        const sameNode = document.querySelector("details.cache-shared") === details;
        await new Promise((r) => setTimeout(r, 450));
        const y = document.querySelector('details.chip-group[data-letter="Y"]');
        const chip = y && [...y.querySelectorAll("button.chip")].find((b) => b.textContent.trim().toLowerCase().endsWith("yeezy"));
        return { max: Math.max(...per), sameNode, focused: document.activeElement === inp, yPicked: y && y.classList.contains("has-picked"), yOpen: y && y.open, chipSel: !!(chip && chip.classList.contains("selected")), value: inp.value };
      })()`);
      assert.ok(res.sameNode, "cache list not rebuilt while typing");
      assert.ok(res.focused && res.value === "yeezy", JSON.stringify(res));
      assert.ok(res.max < 40, "per-key handler time " + res.max);
      assert.ok(res.yPicked && res.yOpen && res.chipSel, JSON.stringify(res));
    });
  });
});

describe("One page: names typed in the names box tick the Rankings table (t348u → t356u)", () => {
  it("typed chips ✅ in the table; 10 limit keeps the text", { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
    const rk = JSON.parse(fs.readFileSync(path.join(root, "data/ranks.json"), "utf8"));
    const qi = rk.cols.indexOf("query");
    const has = (q) => rk.rows.some((r) => String(r[qi]).toLowerCase() === q);
    if (!has("shlodog") || !has("wrel")) return;
    await withPage(async ({ ev, nav }) => {
      await nav("index.html#rankings");
      await ev(`new Promise(async (r) => { for (let t = 0; t < 400 && !document.querySelector("#ranksBody tr[data-q]"); t++) await new Promise((q) => setTimeout(q, 50)); r(1); })`);
      await ev(`(() => { document.getElementById("clearNamesBtn").click(); return 1; })()`);
      const type = (txt) => ev(`(async () => { const i = document.getElementById("namesInput"); i.focus(); for (const ch of ${JSON.stringify(txt)}) { i.value += ch; i.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" })); } await new Promise((r) => setTimeout(r, 400)); return { value: i.value, chips: [...document.querySelectorAll("#nameTokens .name-token")].map((b) => b.textContent.trim().toLowerCase()), ticked: [...document.querySelectorAll('#ranksBody input[type="checkbox"]:checked')].map((c) => c.closest("tr").dataset.q.toLowerCase()).sort(), focused: document.activeElement === i }; })()`);
      let s = await type("SHLODOG ");
      assert.deepEqual(s.chips, ["shlodog"]);
      assert.equal(s.value, "");
      assert.ok(s.focused);
      s = await type("[XYZ] wrel,");
      assert.deepEqual(s.ticked, ["shlodog", "wrel"], "table ✅ follow the names box");
      const others = rk.rows.map((r) => String(r[qi])).filter((q) => /^[A-Za-z0-9]+$/.test(q) && !["shlodog", "wrel"].includes(q.toLowerCase())).slice(0, 9);
      s = await type(others.slice(0, 8).join(" ") + " ");
      assert.equal(s.chips.length, 10);
      assert.equal(await ev(`document.querySelectorAll('#ranksBody input[type="checkbox"]:disabled').length > 0`), true, "unticked boxes disabled at 10");
      s = await type(others[8] + " ");
      assert.equal(s.chips.length, 10);
      assert.ok(s.value.includes(others[8]), "11th name stays as text: " + s.value);
    });
  });
});

describe("Rankings chart clicks scroll the list with picks + search text (t349u/t350u)", () => {
  it("column click and name-label click", { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
    const rk = JSON.parse(fs.readFileSync(path.join(root, "data/ranks.json"), "utf8"));
    const qi = rk.cols.indexOf("query");
    const picks = ["shlodog", "wrel", "yeezy"].filter((q) => rk.rows.some((r) => String(r[qi]).toLowerCase() === q));
    if (picks.length < 3) return;
    await withPage(async ({ ev, nav, send, sessionId }) => {
      await nav(`index.html?names=${picks.join(",")}#rankings`);
      await ev(`new Promise(async (res) => { for (let t = 0; t < 400 && !document.querySelector("#distSvg .dist-hit"); t++) await new Promise((r) => setTimeout(r, 50)); res(1); })`);
      // Left-over search text (the old cause: table filtered to 1 row → nothing to scroll to).
      await ev(`(async () => { const i = document.getElementById("ranksSearch"); i.value = "yeez"; i.dispatchEvent(new Event("input", { bubbles: true })); await new Promise((r) => setTimeout(r, 500)); })()`);
      assert.equal(await ev(`document.querySelectorAll("#ranksBody tr[data-q]").length`), 1);
      const click = async (sel) => {
        await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: "center" }), 1`);
        await new Promise((r) => setTimeout(r, 300));
        const c = await ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.6 }; })()`);
        for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: c.x, y: c.y, button: "left", clickCount: 1 }, sessionId);
        await new Promise((r) => setTimeout(r, 1500));
      };
      await ev(`document.querySelector('#distSvg .dist-hit[data-bin="3"]').scrollIntoView({ block: "center" }), 1`);
      await new Promise((r) => setTimeout(r, 300));
      const y0 = await ev(`window.scrollY`);
      await click('#distSvg .dist-hit[data-bin="3"]');
      let st = await ev(`({ st: document.getElementById("ranksScroll").scrollTop, rows: document.querySelectorAll("#ranksBody tr[data-q]").length, filter: document.getElementById("ranksSearch").value, chips: document.querySelectorAll("#nameTokens .name-token").length, flashed: document.querySelectorAll("#ranksBody tr.rk-flash").length })`);
      assert.ok(st.rows > 100 && st.st > 0 && st.flashed >= 1, JSON.stringify(st));
      assert.equal(st.filter, "");
      assert.equal(st.chips, 3, "picks kept");
      assert.equal(await ev(`window.scrollY`), y0, "page / chart stay put on PC");
      // Name label → that player's row, visible in the list box.
      const q = await ev(`document.querySelector("#distSvg text.dist-name").getAttribute("data-q")`);
      await click(`#distSvg text.dist-name[data-q="${q}"]`);
      const v = await ev(`(() => { const wrap = document.getElementById("ranksScroll"); const tr = document.querySelector('#ranksBody tr[data-q="' + CSS.escape(${JSON.stringify(q)}) + '"]'); const wr = wrap.getBoundingClientRect(), rr = tr.getBoundingClientRect(); return { j: window.__lastPlayerJump && window.__lastPlayerJump.q, visible: rr.top >= wr.top && rr.bottom <= wr.bottom, flash: tr.classList.contains("rk-flash") }; })()`);
      assert.equal(v.j, q);
      assert.ok(v.visible && v.flash, JSON.stringify(v));
    }, { width: 1400, height: 900, mobile: false });
  });
});

describe("Analyze: removing a chip updates graph + tables right away; Analyze never drops players (t351u)", () => {
  const NAMES = ["ReybNC", "ReybNS", "Reyb", "WHITEBROCOBALT", "[RWCN] R1QingTingDuiZhang", "RachelDoe"];
  const have = NAMES.every((n) => fs.existsSync(path.join(root, "data/players", n.replace(/^\[.*?\]\s*/, "").toLowerCase() + ".json")));
  it("chip × → stats / URL follow; double Analyze and a failing live fetch keep the 5 players", { skip: !have || !chrome }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav("index.html?names=" + encodeURIComponent(NAMES.join(",")));
      const statsNames = () => ev(`[...document.querySelectorAll("#statsPanel .stats-name .nm")].map((e) => e.getAttribute("data-full") || e.textContent)`);
      const idle = () => ev(`new Promise(async (res) => { for (let t = 0; t < 300; t++) { if (!document.getElementById("analyzeBtn").disabled && document.querySelectorAll("#statsPanel .stats-name").length) break; await new Promise((r) => setTimeout(r, 50)); } await new Promise((r) => setTimeout(r, 400)); res(1); })`);
      await idle();
      assert.equal((await statsNames()).length, 6);
      const statsHas = (n) => ev(`[...document.querySelectorAll("#statsPanel tbody")].some((tb) => tb.innerHTML.includes(${JSON.stringify(n)}))`);
      assert.ok(await statsHas("RachelDoe"));
      await ev(`[...document.querySelectorAll("#nameTokens .name-token")].find((b) => /RachelDoe/.test(b.textContent)).click(), 1`);
      await new Promise((r) => setTimeout(r, 300));
      let l = await statsNames();
      assert.equal(l.length, 5, "graph follows the chip without Analyze: " + l);
      assert.ok(!l.some((n) => /RachelDoe/.test(n)));
      assert.ok(!(await statsHas("RachelDoe")), "tables follow too");
      assert.ok(!(await ev(`decodeURIComponent(location.search)`)).includes("RachelDoe"), "URL follows");
      for (let i = 0; i < 2; i++) {
        await ev(`document.getElementById("analyzeBtn").click(), 1`);
        await idle();
        l = await statsNames();
        assert.equal(l.length, 5, `Analyze #${i + 1}: ${l}`);
      }
      // "Fetch fresh" while Census says "no such character" for everyone: keep the saved copies.
      await ev(`(() => { const of = window.fetch; window.fetch = (u, o) => { const s = String((u && u.url) || u); if (/^https?:/.test(s) && !s.startsWith(location.origin)) return Promise.resolve(new Response(JSON.stringify({ character_list: [], returned: 0 }), { status: 200, headers: { "content-type": "application/json" } })); return of(u, o); }; const f = document.getElementById("fetchFresh"); f.checked = true; f.dispatchEvent(new Event("change")); return 1; })()`);
      await ev(`document.getElementById("analyzeBtn").click(), 1`);
      await idle();
      l = await statsNames();
      assert.equal(l.length, 5, "failed live refresh keeps players: " + l);
      assert.match(await ev(`document.getElementById("status").textContent`), /kept the saved copy/);
      // Re-adding a saved name joins the graph without Analyze.
      await ev(`(() => { const i = document.getElementById("namesInput"); i.value = "RachelDoe "; i.dispatchEvent(new Event("input", { bubbles: true })); return 1; })()`);
      await idle();
      assert.equal((await statsNames()).length, 6, "cached name added → graphed");
    });
  });
});

describe("Rankings: removing a names-box chip unticks, unmarks and updates ?names= (t351u/t356u)", () => {
  it("chip × → checkbox off, chart label gone, ?names= updated", { skip: !chrome }, async () => {
    const rk = JSON.parse(fs.readFileSync(path.join(root, "data/ranks.json"), "utf8"));
    const qi = rk.cols.indexOf("query");
    const picks = ["shlodog", "wrel", "yeezy"].filter((q) => rk.rows.some((r) => String(r[qi]).toLowerCase() === q));
    if (picks.length < 3) return;
    await withPage(async ({ ev, nav }) => {
      await nav(`index.html?names=${picks.join(",")}#rankings`);
      await ev(`new Promise(async (res) => { for (let t = 0; t < 400 && !(document.querySelectorAll("#distSvg text.dist-name").length >= 3 && document.querySelectorAll("#statsPanel .stats-name").length >= 3); t++) await new Promise((r) => setTimeout(r, 50)); res(1); })`);
      const q = await ev(`document.querySelector("#distSvg text.dist-name").getAttribute("data-q")`);
      await ev(`[...document.querySelectorAll("#nameTokens .name-token")].find((b) => b.textContent.trim().toLowerCase() === ${JSON.stringify(q)}.toLowerCase()).click(), 1`);
      await new Promise((r) => setTimeout(r, 500));
      const st = await ev(`({ chips: document.querySelectorAll("#nameTokens .name-token").length, stats: document.querySelectorAll("#statsPanel .stats-name").length, label: !!document.querySelector('#distSvg text.dist-name[data-q="${q}"]'), cb: (() => { const c = document.querySelector('#ranksBody tr[data-q="${q}"] input[type=checkbox]'); return c ? c.checked : false; })(), names: new URL(location.href).searchParams.get("names") || "", pos: document.getElementById("rkPositions").textContent })`);
      assert.equal(st.chips, 2);
      assert.equal(st.stats, 2, "graph follows");
      assert.equal(st.label, false);
      assert.equal(st.cb, false);
      assert.ok(!st.names.toLowerCase().split(",").includes(q.toLowerCase()), st.names);
      assert.ok(!st.pos.toLowerCase().includes(q.toLowerCase()), "🏅 positions follow");
    });
  });
});

describe("Rankings table / positions fold away and remember it (t357u/t358u)", () => {
  it("closed state survives a reload; a chart bar click opens it and scrolls", { skip: !chrome, timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      const ready = `new Promise(async (res) => { for (let t = 0; t < 400 && !document.querySelector("#distSvg .dist-hit"); t++) await new Promise((r) => setTimeout(r, 50)); res(1); })`;
      await nav("index.html#rankings");
      await ev(ready);
      assert.equal(await ev(`document.getElementById("ranksTableSection").open`), false, "folded by default (t358u)");
      assert.equal(await ev(`document.getElementById("rkPosSection").open`), false, "positions folded by default (t358u)");
      // Open, then close again → remembered closed.
      await ev(`(async () => { const s = document.querySelector("#ranksTableSection > summary"); s.click(); await new Promise((r) => setTimeout(r, 200)); s.click(); await new Promise((r) => setTimeout(r, 200)); })()`);
      assert.equal(await ev(`localStorage.getItem("ps2-elite-kd-ranks-table-open")`), "0");
      await nav("index.html#rankings");
      await ev(ready);
      assert.equal(await ev(`document.getElementById("ranksTableSection").open`), false, "remembered closed");
      await ev(`(async () => { document.querySelector('#distSvg .dist-hit[data-bin="3"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((r) => setTimeout(r, 1500)); })()`);
      const st = await ev(`({ open: document.getElementById("ranksTableSection").open, st: document.getElementById("ranksScroll").scrollTop, jump: !!window.__lastBinJump })`);
      assert.ok(st.open && st.jump && st.st > 0, JSON.stringify(st));
    }, { width: 1400, height: 900, mobile: false });
  });
});

describe("🏅 positions table sorted by ⚔️ iVi, #1 on top (t358u)", () => {
  it("rows follow iVi (highest first), not names-box order", { skip: !chrome, timeout: 120000 }, async () => {
    const rk = JSON.parse(fs.readFileSync(path.join(root, "data/ranks.json"), "utf8"));
    const qi = rk.cols.indexOf("query"), ai = rk.cols.indexOf("adjs");
    const withIvi = rk.rows.filter((r) => Number.isFinite(r[ai]));
    if (withIvi.length < 3) return;
    const srt = withIvi.slice().sort((a, b) => b[ai] - a[ai]);
    // Lowest, middle, highest iVi typed in that (worst-first) order.
    const picks = [srt[srt.length - 1], srt[Math.floor(srt.length / 2)], srt[0]].map((r) => String(r[qi]));
    await withPage(async ({ ev, nav }) => {
      await nav(`index.html?names=${picks.map(encodeURIComponent).join(",")}#rankings`);
      await ev(`new Promise(async (res) => { for (let t = 0; t < 400 && document.querySelectorAll("#rkPositions .rk-pos-jump").length < 3; t++) await new Promise((r) => setTimeout(r, 50)); res(1); })`);
      const st = await ev(`({ order: [...document.querySelectorAll("#rkPositions .rk-pos-jump")].map((a) => a.dataset.q.toLowerCase()), count: document.getElementById("rkPosCount").textContent, open: document.getElementById("rkPosSection").open })`);
      assert.deepEqual(st.order, picks.slice().reverse().map((q) => q.toLowerCase()), "highest iVi first");
      assert.equal(st.count, "(3)");
      assert.equal(st.open, false, "folded by default");
    });
  });
});

describe("A graphed player not in the shared Rankings still shows on 📊 / 🏅 (t359u)", () => {
  it("local-only row from this browser's copy", { skip: !chrome, timeout: 120000 }, async () => {
    const raw = JSON.parse(fs.readFileSync(path.join(root, "data/players/brackiense.json"), "utf8"));
    const p = raw.player || raw;
    const now = Date.now();
    const fake = { ...p, display: "Zzlocalonly", name: "Zzlocalonly", source: "live:quick" };
    const store = { zzlocalonly: { name: "Zzlocalonly", savedAt: now, fetchedAt: now, player: fake } };
    await withPage(async ({ ev, nav }) => {
      await nav("index.html");
      await ev(`new Promise((r) => setTimeout(r, 500))`);
      await ev(`(localStorage.setItem("ps2-elite-kd-cache-v2", ${JSON.stringify(JSON.stringify(store))}), localStorage.setItem("ps2-elite-kd-ranks-pos-open", "1"), 1)`);
      await nav("index.html?names=Zzlocalonly,ShloDog#rankings");
      await ev(`new Promise(async (res) => { for (let t = 0; t < 400 && !document.querySelector('#distSvg text.dist-name[data-q="Zzlocalonly"]'); t++) await new Promise((r) => setTimeout(r, 50)); res(1); })`);
      const st = await ev(`({ stats: document.querySelectorAll("#statsPanel .stats-name").length, label: !!document.querySelector('#distSvg text.dist-name[data-q="Zzlocalonly"]'), pos: [...document.querySelectorAll("#rkPositions .rk-pos-jump")].map((a) => a.dataset.q), fresh: !!document.querySelector("#rkPositions .sample-fresh"), missing: /Not in the Rankings/.test(document.getElementById("rkPositions").textContent), meta: document.getElementById("ranksMeta").textContent, row: !!document.querySelector('#ranksBody tr[data-q="Zzlocalonly"]') || null })`);
      assert.equal(st.stats, 2, "both on the skill graph");
      assert.ok(st.label, "on the 📊 chart");
      assert.ok(st.pos.includes("Zzlocalonly"), JSON.stringify(st));
      assert.ok(st.pos.includes("ShloDog"));
      assert.ok(st.fresh, "↻ mark");
      assert.equal(st.missing, false);
      assert.match(st.meta, /1 only in this browser/);
      // Removing the name drops the local-only row again.
      await ev(`[...document.querySelectorAll("#nameTokens .name-token")].find((b) => /zzlocalonly/i.test(b.textContent)).click(), 1`);
      await new Promise((r) => setTimeout(r, 800));
      const st2 = await ev(`({ label: !!document.querySelector('#distSvg text.dist-name[data-q="Zzlocalonly"]'), meta: document.getElementById("ranksMeta").textContent })`);
      assert.equal(st2.label, false);
      assert.doesNotMatch(st2.meta, /only in this browser/);
      // The bug's order: Rankings already loaded, then the new name is fetched + added.
      await ev(`(localStorage.removeItem("ps2-elite-kd-cache-v2"), 1)`);
      await nav("index.html?names=ShloDog#rankings");
      await ev(`new Promise(async (res) => { for (let t = 0; t < 400 && !document.querySelector('#distSvg text.dist-name[data-q="ShloDog"]'); t++) await new Promise((r) => setTimeout(r, 50)); res(1); })`);
      await ev(`(() => { localStorage.setItem("ps2-elite-kd-cache-v2", ${JSON.stringify(JSON.stringify(store))}); const i = document.getElementById("namesInput"); i.value = "Zzlocalonly "; i.dispatchEvent(new Event("input", { bubbles: true })); return 1; })()`);
      await ev(`new Promise(async (res) => { for (let t = 0; t < 200 && !document.querySelector('#distSvg text.dist-name[data-q="Zzlocalonly"]'); t++) await new Promise((r) => setTimeout(r, 50)); res(1); })`);
      const st3 = await ev(`({ stats: document.querySelectorAll("#statsPanel .stats-name").length, label: !!document.querySelector('#distSvg text.dist-name[data-q="Zzlocalonly"]'), pos: [...document.querySelectorAll("#rkPositions .rk-pos-jump")].map((a) => a.dataset.q) })`);
      assert.ok(st3.label, "added after Rankings loaded → on the 📊 chart");
      assert.ok(st3.pos.includes("Zzlocalonly"));
    });
  });
});

describe("Big table after a browser-only player joins: no 'undefined' (t360u)", () => {
  it("every row has a rank number and values after the local-only merge", { skip: !chrome, timeout: 120000 }, async () => {
    const raw = JSON.parse(fs.readFileSync(path.join(root, "data/players/brackiense.json"), "utf8"));
    const p = raw.player || raw;
    const now = Date.now();
    const store = { zzlocalonly: { name: "Zzlocalonly", savedAt: now, fetchedAt: now, player: { ...p, display: "Zzlocalonly", name: "Zzlocalonly", source: "live:quick" } } };
    await withPage(async ({ ev, nav }) => {
      // Rankings first (the bug's order), then the browser-only name is added.
      await nav("index.html?names=ShloDog#rankings");
      await ev(`new Promise(async (res) => { for (let t = 0; t < 400 && !document.querySelector("#ranksBody tr[data-q]"); t++) await new Promise((r) => setTimeout(r, 50)); res(1); })`);
      await ev(`(() => { localStorage.setItem("ps2-elite-kd-cache-v2", ${JSON.stringify(JSON.stringify(store))}); document.getElementById("ranksTableSection").open = true; const i = document.getElementById("namesInput"); i.value = "Zzlocalonly "; i.dispatchEvent(new Event("input", { bubbles: true })); return 1; })()`);
      await ev(`new Promise(async (res) => { for (let t = 0; t < 200 && !document.querySelector('#ranksBody tr[data-q="Zzlocalonly"]'); t++) await new Promise((r) => setTimeout(r, 100)); res(1); })`);
      // Whole list rendered (progressive chunks finish).
      await ev(`new Promise(async (r) => { let n = -1; for (let t = 0; t < 200; t++) { await new Promise((q) => setTimeout(q, 250)); const m = document.querySelectorAll("#ranksBody tr[data-q]").length; if (m === n) break; n = m; } r(1); })`);
      const st = await ev(`(() => { const trs = [...document.querySelectorAll("#ranksBody tr[data-q]")]; const ranks = trs.map((tr) => tr.querySelector(".rk-num")?.textContent || ""); const txt = document.getElementById("ranksBody").textContent; return { n: trs.length, undef: (txt.match(/undefined/g) || []).length, nan: (txt.match(/NaN/g) || []).length, local: trs.some((tr) => tr.dataset.q === "Zzlocalonly"), seq: ranks.filter((x) => x !== "—").every((x, i, a) => i === 0 || +x === +a[i - 1] + 1), first: ranks[0], meta: document.getElementById("ranksMeta").textContent }; })()`);
      assert.ok(st.local, JSON.stringify(st));
      assert.equal(st.undef, 0, "no 'undefined' anywhere in the table");
      assert.equal(st.nan, 0, "no NaN");
      assert.equal(st.first, "1");
      assert.ok(st.seq, "ranks 1, 2, 3, … in order");
      const total = +st.meta.match(/of ([\d,]+) players/)[1].replace(/,/g, "");
      assert.equal(st.n, total, "full list rendered");
    });
  });
});

describe("💾 browser-only names: icon toggle, hidden when empty (t360u)", () => {
  it("no title text; hidden with none; open for a few, folded for 50; remembered", { skip: !chrome, timeout: 120000 }, async () => {
    const raw = JSON.parse(fs.readFileSync(path.join(root, "data/players/brackiense.json"), "utf8"));
    const p = raw.player || raw;
    const now = Date.now();
    const mk = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => { const nm = `Zzsaved${String(i).padStart(2, "0")}`; return [nm.toLowerCase(), { name: nm, savedAt: now, fetchedAt: now, player: { ...p, display: nm, name: nm } }]; }));
    await withPage(async ({ ev, nav }) => {
      const look = () => ev(`(() => { const d = document.querySelector("#cacheChips details.cache-browser"); return { has: !!d, open: d ? d.open : null, chips: d ? d.querySelectorAll(".cache-browser-chips button.chip").length : 0, summary: d ? d.querySelector("summary").textContent : "", browserWord: /Browser/.test(document.getElementById("cacheChips").textContent) }; })()`);
      await nav("index.html");
      await ev(`new Promise((r) => setTimeout(r, 600))`);
      let st = await look();
      assert.equal(st.has, false, "no 💾 with nothing saved");
      await ev(`(localStorage.setItem("ps2-elite-kd-cache-v2", ${JSON.stringify(JSON.stringify(mk(2)))}), 1)`);
      await nav("index.html"); await ev(`new Promise((r) => setTimeout(r, 800))`);
      st = await look();
      assert.deepEqual([st.has, st.open, st.chips, st.summary, st.browserWord], [true, true, 2, "💾", false], JSON.stringify(st));
      await ev(`(localStorage.setItem("ps2-elite-kd-cache-v2", ${JSON.stringify(JSON.stringify(mk(50)))}), 1)`);
      await nav("index.html"); await ev(`new Promise((r) => setTimeout(r, 800))`);
      st = await look();
      assert.deepEqual([st.has, st.open, st.chips], [true, false, 50], "50 names → folded");
      // Open it: the chips box scrolls instead of growing past ~12rem.
      await ev(`new Promise((r) => { document.querySelector("#cacheChips details.cache-browser > summary").click(); setTimeout(() => r(1), 200); })`);
      const box = await ev(`(() => { const b = document.querySelector(".cache-browser-chips"); return { h: b.getBoundingClientRect().height, sh: b.scrollHeight, rem: parseFloat(getComputedStyle(document.documentElement).fontSize) }; })()`);
      assert.ok(box.h <= 12.5 * box.rem + 2, JSON.stringify(box));
      await nav("index.html"); await ev(`new Promise((r) => setTimeout(r, 800))`);
      assert.equal((await look()).open, true, "remembered open");
    }, { width: 390, height: 844, mobile: true });
  });
});
