// Rankings must never render "NaN" (t287u: a stray unary "+" in ranks.html rowHtml —
// `… : "") + + `</td>`` — turned "</td>" into NaN after every player name).
// 1) static guard: no `+ +` string concatenation in page/app sources;
// 2) full render: headless Chrome (CDP over --remote-debugging-pipe) loads ranks.html
//    with the full data/ranks.json, waits for every progressive chunk, then re-sorts by
//    every column (debug columns on and off) and asserts no "NaN" anywhere in the table.
//    Skipped when no Chrome/Chromium is installed.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("no NaN in the Rankings", () => {
  it("no `+ +` (unary plus) string concatenation in page sources", () => {
    const files = ["ranks.html", "index.html", "build-log.html", "app.js", ...fs.readdirSync(root).filter((f) => f.endsWith(".mjs"))];
    for (const f of files) {
      const lines = fs.readFileSync(path.join(root, f), "utf8").split("\n");
      lines.forEach((l, i) => {
        assert.ok(!/\+\s+\+\s*[`"']/.test(l), `${f}:${i + 1} has "+ +" before a string: ${l.trim()}`);
      });
    }
  });

  const chrome = ["google-chrome", "chromium", "chromium-browser", "google-chrome-stable"].find((b) => {
    try { execFileSync("which", [b], { stdio: "ignore" }); return true; } catch { return false; }
  });

  it("full ranks.json renders without NaN under every sort (debug columns on/off)", { skip: !chrome && "no Chrome installed", timeout: 240000 }, async () => {
    const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
    const server = http.createServer((req, res) => {
      const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
      if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
      fs.createReadStream(p).pipe(res);
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    const proc = spawn(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-pipe", "--user-data-dir=" + fs.mkdtempSync("/tmp/ranks-nan-"), "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
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
      const expected = JSON.parse(fs.readFileSync(path.join(root, "data", "ranks.json"), "utf8")).rows.length;
      // Wait until every progressive chunk is in, then report NaN cells.
      const settle = `(async () => {
        const body = document.getElementById("ranksBody");
        for (let t = 0; t < 400; t++) {
          if (body.rows.length >= ${expected}) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        const bad = [];
        for (const tr of body.rows) for (const td of tr.cells) if (/NaN/.test(td.innerHTML)) bad.push((tr.dataset.q || "?") + " col" + td.cellIndex + ": " + td.textContent);
        const head = document.getElementById("ranksHead").innerHTML;
        return { rows: body.rows.length, bad: bad.slice(0, 10), nBad: bad.length, headNaN: /NaN/.test(head), pageNaN: /NaN/.test(document.body.innerText) };
      })()`;
      await send("Page.enable", {}, sessionId);
      await send("Page.navigate", { url: `http://127.0.0.1:${port}/ranks.html` }, sessionId);
      for (const debugOn of [false, true]) {
        await ev(`new Promise(async (res) => { for (let t = 0; t < 400 && !(window.document.getElementById("ranksHead")?.querySelector("th.sortable")); t++) await new Promise((r) => setTimeout(r, 50)); res(1); })`);
        if (debugOn) await ev(`(() => { const d = document.getElementById("debugColsToggle"); d.checked = true; d.dispatchEvent(new Event("change")); return 1; })()`);
        const keys = await ev(`[...document.querySelectorAll("#ranksHead th.sortable")].map((th) => th.getAttribute("data-key"))`);
        assert.ok(keys.length > 5, "sortable headers found");
        for (const key of keys) {
          for (let pass = 0; pass < 2; pass++) { // both sort directions
            await ev(`document.querySelector('#ranksHead th[data-key="${key}"]').click(), 1`);
            const r = await ev(settle);
            assert.equal(r.rows, expected, `all ${expected} rows rendered (sort ${key}, debug ${debugOn})`);
            assert.equal(r.nBad, 0, `NaN cells (sort ${key}, debug ${debugOn}): ${r.bad.join(" | ")}`);
            assert.ok(!r.headNaN && !r.pageNaN, `NaN on page (sort ${key}, debug ${debugOn})`);
          }
        }
      }
    } finally {
      proc.kill("SIGKILL");
      server.close();
    }
  });
});
