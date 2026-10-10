// t324u: typing into the Rankings filter (the field that also holds ✅ pick chips)
// must be smooth: debounced filtering, the input is never re-created/refocused,
// the table isn't touched between fast keystrokes, no per-key chart redraw,
// no mobile autocapitalize/autocorrect, held Backspace doesn't eat chips.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

describe("Rankings filter typing (t324u)", () => {
  it("static wiring", () => {
    const s = read("ranks.html");
    const inp = s.match(/<input id="ranksSearch"[^>]*>/)[0];
    for (const a of ['autocapitalize="off"', 'autocorrect="off"', 'spellcheck="false"', 'autocomplete="off"']) assert.ok(inp.includes(a), a);
    assert.match(s, /searchTimer = setTimeout\(applyFilter, 150\)/);
    assert.match(s, /if \(bare\(next\) === bare\(filter\)\) \{ filter = next; return; \}/);
    assert.match(s, /if \(sig !== hlSig\)/);
    assert.match(s, /TYPING_QUIET_MS - \(performance\.now\(\) - lastTypeAt\)/);
    assert.match(s, /!e\.repeat && !e\.isComposing/);
    // The filter handler never rebuilds the field or its box.
    assert.doesNotMatch(s, /ranksPickBox"\)\.innerHTML|ranksSearch"\)\.outerHTML/);
  });

  const chrome = ["google-chrome", "chromium", "chromium-browser", "google-chrome-stable"].find((b) => {
    try { execFileSync("which", [b], { stdio: "ignore" }); return true; } catch { return false; }
  });

  for (const mode of ["desktop", "mobile"]) {
    it(`type a name key by key (${mode})`, { skip: !chrome && "no Chrome installed", timeout: 90000 }, async () => {
      const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css" };
      const server = http.createServer((req, res) => {
        const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
        if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
        fs.createReadStream(p).pipe(res);
      });
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      const port = server.address().port;
      const proc = spawn(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-pipe", "--user-data-dir=" + fs.mkdtempSync("/tmp/ranks-typing-"), "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
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
        if (mode === "mobile") {
          await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }, sessionId);
          await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, sessionId);
        } else {
          await send("Emulation.setDeviceMetricsOverride", { width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false }, sessionId);
        }
        await send("Page.enable", {}, sessionId);
        const { rows, cols } = JSON.parse(read("data/ranks.json"));
        const qi = cols.indexOf("query");
        // A lowercase-only name of 6+ letters, like "manimami" (fallback: the first row).
        const word = (rows.map((r) => String(r[qi])).find((q) => /^[a-z]{6,}$/.test(q)) || String(rows[0][qi])).toLowerCase();
        const q0 = rows[0][qi], q1 = rows[1][qi];
        await send("Page.navigate", { url: `http://127.0.0.1:${port}/ranks.html?pick=${encodeURIComponent(q0)},${encodeURIComponent(q1)}` }, sessionId);
        await ev(`new Promise(async (r) => { for (let t = 0; t < 400 && !document.querySelector("#ranksBody tr[data-q]"); t++) await new Promise((q) => setTimeout(q, 50)); r(1); })`);
        // Let the initial progressive render finish (row count stable).
        await ev(`new Promise(async (r) => { let n = -1; for (let t = 0; t < 100; t++) { await new Promise((q) => setTimeout(q, 150)); const m = document.querySelectorAll("#ranksBody tr").length; if (m === n) break; n = m; } r(1); })`);
        await ev(`(() => { const el = document.getElementById("ranksSearch"); window.__el = el; el.focus(); window.__mut = 0; new MutationObserver(() => { __mut++; }).observe(document.getElementById("ranksBody"), { childList: true }); return 1; })()`);
        for (const ch of word) {
          const code = /[a-z]/.test(ch) ? "Key" + ch.toUpperCase() : "";
          await send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, code, windowsVirtualKeyCode: ch.toUpperCase().charCodeAt(0) }, sessionId);
          await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch, code, windowsVirtualKeyCode: ch.toUpperCase().charCodeAt(0) }, sessionId);
          await new Promise((r) => setTimeout(r, 30));
        }
        const mid = await ev(`({ v: __el.value, mut: __mut })`);
        assert.equal(mid.v, word, "every keystroke landed");
        assert.equal(mid.mut, 0, "table untouched while typing fast (debounced)");
        await new Promise((r) => setTimeout(r, 700));
        const s = await ev(`({ v: __el.value, same: document.getElementById("ranksSearch") === __el, focused: document.activeElement === __el, caret: __el.selectionStart, rows: [...document.querySelectorAll("#ranksBody tr[data-q]")].map((t) => t.dataset.q.toLowerCase()), chips: document.querySelectorAll("#ranksChips .name-token").length })`);
        assert.equal(s.v, word);
        assert.ok(s.same, "input element never re-created");
        assert.ok(s.focused, "focus stays in the field");
        assert.equal(s.caret, word.length, "caret at the end");
        assert.ok(s.rows.length >= 1 && s.rows.every((q) => q.includes(word)), "filtered to the typed name");
        assert.equal(s.chips, 2, "chips untouched by typing");
        // Clear the field with a held Backspace (auto-repeat): chips must survive.
        for (let i = 0; i < word.length + 3; i++) {
          await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, autoRepeat: i > 0 }, sessionId);
        }
        await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 }, sessionId);
        const after = await ev(`({ v: __el.value, chips: document.querySelectorAll("#ranksChips .name-token").length })`);
        assert.equal(after.v, "");
        assert.equal(after.chips, 2, "held Backspace stops at the empty field");
      } finally {
        proc.kill("SIGKILL");
        server.close();
      }
    });
  }
});
