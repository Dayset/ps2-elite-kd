// t308u: clicking a 📊 Distribution bar on the Rankings sorts the table by the chart
// metric and glides to the first player of that bar's range (empty bar → nearest).
// 1) pure helper binJumpTarget (dist.mjs); 2) headless Chrome click on the real page
//    with the full data/ranks.json (skipped when no Chrome is installed).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { histogram, binIndexOf, binJumpTarget } from "../dist.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("binJumpTarget", () => {
  const vals = [];
  for (let i = 0; i < 300; i++) vals.push(i < 150 ? i / 10 : 50 + i / 10); // gap 15…65
  const h = histogram(vals);
  const desc = vals.slice().sort((a, b) => b - a).concat([null, undefined]);
  const asc = vals.slice().sort((a, b) => a - b).concat([null]);

  it("non-empty bin → first row of that bin, contiguous run, desc and asc", () => {
    for (let bi = 0; bi < h.bins.length; bi++) {
      if (!h.bins[bi].count) continue;
      const d = binJumpTarget(desc, h, bi, "desc");
      assert.equal(d.exact, true);
      assert.equal(d.count, h.bins[bi].count);
      assert.equal(binIndexOf(h, desc[d.index]), bi);
      assert.ok(d.index === 0 || binIndexOf(h, desc[d.index - 1]) !== bi);
      const a = binJumpTarget(asc, h, bi, "asc");
      assert.equal(a.count, h.bins[bi].count);
      assert.equal(binIndexOf(h, asc[a.index]), bi);
    }
  });
  it("empty bin → nearest row where that range would start", () => {
    const empty = h.bins.findIndex((b) => b.kind === "core" && b.count === 0);
    assert.ok(empty > 0, "fixture has an empty bin");
    const d = binJumpTarget(desc, h, empty, "desc");
    assert.equal(d.exact, false);
    assert.equal(d.count, 0);
    assert.ok(desc[d.index] < h.bins[empty].x0 && (d.index === 0 || desc[d.index - 1] >= h.bins[empty].x1));
    const a = binJumpTarget(asc, h, empty, "asc");
    assert.ok(asc[a.index] >= h.bins[empty].x1 && asc[a.index - 1] < h.bins[empty].x0);
  });
  it("missing values never match; nothing beyond → last ranked row; no values → -1", () => {
    const d = binJumpTarget([5, 4, null], { bins: [{ kind: "core", x0: 4, x1: 6 }, { kind: "core", x0: 6, x1: 8 }], lo: 4, hi: 8 }, 1, "asc");
    assert.deepEqual(d, { index: 1, count: 0, exact: false });
    assert.equal(binJumpTarget([null, NaN], h, 0).index, -1);
  });
});

describe("Rankings chart bar click", () => {
  it("static wiring: pointer cursor, hint, touch double-tap, extra column", () => {
    const s = fs.readFileSync(path.join(root, "ranks.html"), "utf8");
    assert.match(s, /\.dist-chart \.dist-hit \{ cursor: pointer;/);
    assert.match(s, /to jump to players in this range/);
    assert.match(s, /Jump to players in this range/);
    assert.match(s, /lastPointer === "touch"/);
    assert.match(s, /function jumpToBin\(bi, \{ touch = false \} = \{\}\)/);
    assert.match(s, /if \(!listOnlyJump\(touch\)\)/);
  });

  const chrome = ["google-chrome", "chromium", "chromium-browser", "google-chrome-stable"].find((b) => {
    try { execFileSync("which", [b], { stdio: "ignore" }); return true; } catch { return false; }
  });

  it("click / tap on a bar sorts + scrolls to that range", { skip: !chrome && "no Chrome installed", timeout: 120000 }, async () => {
    const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
    const server = http.createServer((req, res) => {
      const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
      if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
      fs.createReadStream(p).pipe(res);
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    const proc = spawn(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-pipe", "--window-size=1400,900", "--user-data-dir=" + fs.mkdtempSync("/tmp/ranks-jump-"), "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
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
      const ev = async (expr) => {
        const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
        return r.result.value;
      };
      const sleep = (ms) => ev(`new Promise((r) => setTimeout(() => r(1), ${ms}))`);
      await send("Page.enable", {}, sessionId);
      await send("Page.navigate", { url: `http://127.0.0.1:${port}/ranks.html` }, sessionId);
      await ev(`new Promise(async (res) => { for (let t = 0; t < 400 && !document.querySelector("#distSvg .dist-hit"); t++) await new Promise((r) => setTimeout(r, 50)); res(1); })`);
      // Mouse click on a high bar (last non-empty core bar) while sorted by name.
      await ev(`document.querySelector('#ranksHead th[data-key="name"]').click(), 1`);
      const center = (sel) => ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      const pick = await ev(`(() => { const hs = [...document.querySelectorAll("#distSvg .dist-hit")]; return hs.length - 3; })()`);
      await ev(`document.querySelector('#distSvg .dist-hit[data-bin="${pick}"]').scrollIntoView({ block: "center" }), 1`);
      let c = await center(`#distSvg .dist-hit[data-bin="${pick}"]`);
      const y0 = await ev(`window.scrollY`);
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: c.x, y: c.y, button: "left", clickCount: 1 }, sessionId);
      await sleep(1500);
      assert.equal(await ev(`window.scrollY`), y0, "desktop click doesn't scroll the page (t309u)");
      const r = await ev(`(() => { const j = window.__lastBinJump; const wrap = document.getElementById("ranksScroll"); const tr = document.querySelector('#ranksBody tr[data-q="' + CSS.escape(j.q) + '"]'); const wr = wrap.getBoundingClientRect(), rr = tr.getBoundingClientRect(); const head = document.getElementById("ranksHead").getBoundingClientRect().height; return { j, sorted: document.querySelector("#ranksHead th.sorted")?.getAttribute("data-key"), visible: rr.top >= wr.top + head - 3 && rr.bottom <= wr.bottom + 3, flashed: document.querySelectorAll("#ranksBody tr.rk-flash").length, firstOfRange: tr.rowIndex }; })()`);
      assert.equal(r.sorted, "adjs", "table sorted by the chart metric");
      assert.equal(r.j.dir, "desc");
      assert.equal(r.j.bin, pick);
      assert.ok(r.visible, "target row scrolled into the list box");
      assert.ok(r.flashed >= 1, "range rows highlighted");
      // Band separators (t310u): the jump lands on the band's divider, right under the sticky header.
      const sep = await ev(`(() => { const wrap = document.getElementById("ranksScroll"); const tr = document.querySelector('#ranksBody tr[data-q="' + CSS.escape(window.__lastBinJump.q) + '"]'); const s = tr.previousElementSibling; const head = document.getElementById("ranksHead").getBoundingClientRect().height; return { isSep: !!s && s.classList.contains("rk-sep"), bin: s && s.dataset.bin, gap: s ? Math.round(s.getBoundingClientRect().top - wrap.getBoundingClientRect().top - head) : null, label: s && s.textContent, n: document.querySelectorAll("#ranksBody tr.rk-sep").length }; })()`);
      assert.ok(sep.isSep && +sep.bin === pick, "separator before the band's first player");
      assert.ok(Math.abs(sep.gap) <= 3, "separator sits under the sticky header, gap " + sep.gap);
      assert.match(sep.label, /top /);
      assert.ok(sep.n >= 3, "several separators");
      await ev(`document.querySelector('#ranksHead th[data-key="name"]').click(), 1`);
      assert.equal(await ev(`document.querySelectorAll("#ranksBody tr.rk-sep").length`), 0, "no separators when sorted by name");
      // Touch: first tap only shows details, second tap on the same bar jumps.
      await ev(`window.__lastBinJump = null, 1`);
      const tbin = 2;
      await ev(`document.querySelector('#distSvg .dist-hit[data-bin="${tbin}"]').scrollIntoView({ block: "center" }), 1`);
      c = await center(`#distSvg .dist-hit[data-bin="${tbin}"]`);
      const tap = async () => {
        await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: c.x, y: c.y }] }, sessionId);
        await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }, sessionId);
        await sleep(400);
      };
      await tap();
      const afterOne = await ev(`({ jumped: !!window.__lastBinJump, tip: !document.getElementById("distTip").hidden, hint: document.getElementById("distTip").textContent })`);
      assert.equal(afterOne.jumped, false, "first tap doesn't jump");
      assert.ok(afterOne.tip && /Tap again to jump/.test(afterOne.hint), "first tap shows the tip with the hint");
      await tap();
      const afterTwo = await ev(`window.__lastBinJump`);
      assert.ok(afterTwo && afterTwo.bin === tbin, "second tap jumps");
    } finally {
      proc.kill("SIGKILL");
      server.close();
    }
  });
});

describe("Rankings Player column width (t311u)", () => {
  it("desktop widths lift the 18ch name cap; mobile keeps it", () => {
    const s = fs.readFileSync(path.join(root, "ranks.html"), "utf8");
    assert.match(s, /@media \(min-width: 1100px\) \{ \.ranks-table td\.rk-name \.nm \{ max-width: 42ch; \} \}/);
    assert.match(s, /@media \(min-width: 601px\) \{ \.ranks-table td\.rk-name \.nm \{ max-width: 28ch; \} \}/);
  });
});
