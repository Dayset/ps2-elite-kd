// build-log.html must compute every card without a JS error (t327u: a copy-pasted
// `fa.confirmed` in the 🌱 sprout rows — `fa` only exists in the 🤖 farm-account
// renderer — threw "fa is not defined" and the page showed
// "Couldn't compute red flags (fa is not defined)").
// Headless Chrome (CDP over --remote-debugging-pipe) loads build-log.html from a local
// static server (or BUILD_LOG_BASE=https://… to check the live site), waits for the
// cards to finish, and asserts no "Couldn't compute/load" text, no page exceptions and
// no console errors. Skipped when no Chrome/Chromium is installed.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chrome = ["google-chrome", "chromium", "chromium-browser", "google-chrome-stable"].find((b) => {
  try { execFileSync("which", [b], { stdio: "ignore" }); return true; } catch { return false; }
});

describe("build-log renders without errors", () => {
  it("red flags, sprouts, farm accounts, padding all compute (no ReferenceError)", { skip: !chrome && "no Chrome installed", timeout: 300000 }, async () => {
    const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
    let server = null, base = process.env.BUILD_LOG_BASE;
    if (!base) {
      server = http.createServer((req, res) => {
        const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
        if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
        fs.createReadStream(p).pipe(res);
      });
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      base = `http://127.0.0.1:${server.address().port}`;
    }
    const proc = spawn(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-pipe", "--user-data-dir=" + fs.mkdtempSync("/tmp/buildlog-"), "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
    let id = 0, buf = "";
    const pending = new Map();
    const errors = [];
    proc.stdio[4].on("data", (d) => {
      buf += d.toString("utf8");
      let i;
      while ((i = buf.indexOf("\0")) >= 0) {
        const msg = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
        else if (msg.method === "Runtime.exceptionThrown") errors.push("exception: " + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
        else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push("console.error: " + msg.params.args.map((a) => a.value ?? a.description).join(" "));
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
      await send("Runtime.enable", {}, sessionId);
      await send("Page.enable", {}, sessionId);
      await send("Page.navigate", { url: `${base}/build-log.html` }, sessionId);
      const ev = async (expr) => {
        const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
        return r.result.value;
      };
      const ids = ["flags", "sprouts", "farmAcct", "adjusted", "padding"];
      const r = await ev(`(async () => {
        const ids = ${JSON.stringify(ids)};
        const txt = () => ids.map((i) => (document.getElementById(i) || {}).textContent || "");
        for (let t = 0; t < 2400; t++) {
          if (txt().every((s) => s && !/^(Loading|Scoring)/.test(s.trim()))) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        return { cards: txt().map((s) => s.slice(0, 160)), body: (() => { const b = document.body.cloneNode(true); b.querySelectorAll("script,style").forEach((n) => n.remove()); return b.textContent; })() };
      })()`);
      r.cards.forEach((s, i) => {
        assert.ok(!/^(Loading|Scoring)/.test(s.trim()), `#${ids[i]} finished loading: ${s}`);
        assert.ok(!/Couldn.t|is not defined/.test(s), `#${ids[i]} computed without error: ${s}`);
      });
      assert.ok(!/Couldn.t compute/.test(r.body), "no compute error on page: " + (r.body.match(/Couldn.t compute[^\n]*/) || [""])[0]);
      assert.ok(!/is not defined/.test(r.body), "no ReferenceError text on page");
      const bad = errors.filter((e) => /ReferenceError|TypeError|SyntaxError|is not defined/.test(e));
      assert.deepEqual(bad, [], "no JS errors: " + bad.join(" | "));
    } finally {
      proc.kill("SIGKILL");
      if (server) server.close();
    }
  });
});
