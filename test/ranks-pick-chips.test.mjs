// t314u: Rankings ✅ picks show as chips in the filter field (like the main page's
// names box); × on a chip / Backspace in an empty filter unpicks; ?pick= stays in sync.
// t313u: main page shared desktop content width (static check).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

describe("main page desktop width (t313u)", () => {
  it("one shared width from the graph's 68vh height cap, main page only", () => {
    const css = read("styles.css");
    assert.match(read("index.html"), /<body class="main-page">/);
    assert.match(css, /body\.main-page \{\s*--desk-w: calc\(68vh \* 1000 \/ 580 \+ 0\.5rem \+ 2px\);\s*max-width: calc\(var\(--desk-w\) \+ 2\.5rem\);/);
    assert.match(css, /body\.main-page \.chart-wrap,\s*body\.main-page #legend \{ max-width: none; \}/);
    const i = css.indexOf("body.main-page {");
    assert.ok(css.lastIndexOf("@media (min-width: 1400px)", i) > css.lastIndexOf("}\n}", i) - 400, "inside the ≥1400px block");
  });
});

describe("Rankings pick chips (t314u)", () => {
  it("static wiring", () => {
    const s = read("ranks.html");
    assert.match(s, /id="ranksPickBox"[\s\S]*id="ranksChips"[\s\S]*id="ranksSearch"/);
    assert.match(s, /function renderPickChips\(\)/);
    assert.match(s, /function syncPickedUi\(\) \{\s*renderPickChips\(\);/);
    assert.match(s, /e\.key === "Backspace" && !e\.target\.value && picked\.size/);
  });

  const chrome = ["google-chrome", "chromium", "chromium-browser", "google-chrome-stable"].find((b) => {
    try { execFileSync("which", [b], { stdio: "ignore" }); return true; } catch { return false; }
  });

  it("pick → chip, chip × → unpick, Backspace → unpick, ?pick= follows", { skip: !chrome && "no Chrome installed", timeout: 90000 }, async () => {
    const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css" };
    const server = http.createServer((req, res) => {
      const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
      if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
      fs.createReadStream(p).pipe(res);
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    const proc = spawn(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-pipe", "--user-data-dir=" + fs.mkdtempSync("/tmp/ranks-chips-"), "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
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
      await send("Page.enable", {}, sessionId);
      // Use the first rows the table actually shows (top of the default sort): the
      // list renders progressively, so rows deep in ranks.json's file order may not
      // be in the table yet when the test ticks them (the old test picked those).
      await send("Page.navigate", { url: `http://127.0.0.1:${port}/ranks.html` }, sessionId);
      const [q0, q1, q2] = await ev(`new Promise(async (r) => { for (let t = 0; t < 400 && document.querySelectorAll("#ranksBody tr[data-q]").length < 3; t++) await new Promise((q) => setTimeout(q, 50)); r([...document.querySelectorAll("#ranksBody tr[data-q]")].slice(0, 3).map((t) => t.dataset.q)); })`);
      assert.equal(new Set([q0, q1, q2]).size, 3);
      await send("Page.navigate", { url: `http://127.0.0.1:${port}/ranks.html?pick=${encodeURIComponent(q0)},${encodeURIComponent(q1)}` }, sessionId);
      await ev(`new Promise(async (r) => { for (let t = 0; t < 400 && !document.querySelector("#ranksBody tr[data-q]"); t++) await new Promise((q) => setTimeout(q, 50)); r(1); })`);
      const state = () => ev(`({ chips: [...document.querySelectorAll("#ranksChips .name-token")].map((b) => b.dataset.q), pick: new URL(location.href).searchParams.get("pick"), checked: [...document.querySelectorAll('#ranksBody input[type="checkbox"]:checked')].map((c) => c.closest("tr").dataset.q) })`);
      let s = await state();
      assert.deepEqual(s.chips, [q0, q1], "?pick= → chips");
      // Tick a third player in the table → chip appears, URL follows.
      await ev(`(() => { const cb = document.querySelector('#ranksBody tr[data-q="' + CSS.escape(${JSON.stringify(q2)}) + '"] input[type="checkbox"]'); cb.checked = true; cb.dispatchEvent(new Event("change", { bubbles: true })); return 1; })()`);
      s = await state();
      assert.deepEqual(s.chips, [q0, q1, q2]);
      assert.equal(s.pick, [q0, q1, q2].join(","));
      // Click the first chip → unpicked everywhere.
      await ev(`document.querySelector('#ranksChips .name-token[data-q="' + CSS.escape(${JSON.stringify(q0)}) + '"]').click(), 1`);
      s = await state();
      assert.deepEqual(s.chips, [q1, q2]);
      assert.deepEqual(s.checked.sort(), [q1, q2].sort());
      assert.equal(s.pick, [q1, q2].join(","));
      // Backspace in the empty filter → last chip goes.
      await ev(`document.getElementById("ranksSearch").focus(), 1`);
      await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 }, sessionId);
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 }, sessionId);
      s = await state();
      assert.deepEqual(s.chips, [q1]);
      assert.equal(s.pick, q1);
    } finally {
      proc.kill("SIGKILL");
      server.close();
    }
  });
});
