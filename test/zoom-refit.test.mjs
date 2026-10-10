// t328u: 3 normal players + manimami → user zoomed, removed manimami's chip,
// pressed Analyze → graph kept the old zoom. Now a changed set of graphed
// players resets to Auto zoom (axes refit); the same set keeps manual zoom.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

describe("Auto zoom when the analyzed set changes (t328u)", () => {
  it("static wiring", () => {
    assert.match(read("app.js"), /if \(namesSetKey\(successNames\) !== namesSetKey\(lastLoadedNames\)\) resetYZoom\(\{ redraw: false \}\);\s*lastAnalyzedNames = clean\.slice\(\);/);
  });

  const chrome = ["google-chrome", "chromium", "chromium-browser", "google-chrome-stable"].find((b) => {
    try { execFileSync("which", [b], { stdio: "ignore" }); return true; } catch { return false; }
  });
  const need = ["shlodog", "justv6me", "yeezy", "manimami"];
  const haveData = need.every((n) => fs.existsSync(path.join(root, "data/players", n + ".json")));

  it("4 names incl. manimami → zoom → remove manimami → Analyze → axes refit", { skip: (!chrome && "no Chrome installed") || (!haveData && "player files missing"), timeout: 120000 }, async () => {
    const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css" };
    const server = http.createServer((req, res) => {
      const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
      if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
      fs.createReadStream(p).pipe(res);
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    const proc = spawn(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-pipe", "--user-data-dir=" + fs.mkdtempSync("/tmp/zoom-refit-"), "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
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
      await send("Page.navigate", { url: `http://127.0.0.1:${port}/index.html?names=${need.join(",")}` }, sessionId);
      const waitPlayers = (n) => ev(`new Promise(async (r) => { for (let t = 0; t < 600; t++) { const a = window.__ps2EliteKd; if (a && !a.isAnalyzing() && a.getPlayerNames().length === ${n}) return r(1); await new Promise((q) => setTimeout(q, 50)); } r(0); })`);
      assert.equal(await waitPlayers(4), 1, "4 players graphed");
      const api = "window.__ps2EliteKd";
      const auto4 = await ev(`${api}.getChartScale()`);
      // Manual zoom out (slider below middle), like a user trying to see the small lines.
      await ev(`${api}.setYZoom(0.5), 1`);
      const zoomed4 = await ev(`${api}.getChartScale()`);
      assert.notDeepEqual(zoomed4, auto4);
      // Same set again via Fetch fresh path isn't exercised (network); Raw/Smooth toggle keeps zoom:
      await ev(`${api}.setChartMode(${api}.getChartMode() === "banded" ? "cumulative" : "banded"), 1`);
      assert.equal(await ev(`${api}.getYZoom()`), 0.5, "mode toggle keeps manual zoom");
      // Remove manimami's chip, press Analyze.
      const removed = await ev(`(() => { const b = [...document.querySelectorAll("#nameTokens .name-token, .name-token")].find((x) => /manimami/i.test(x.textContent)); if (!b) return 0; b.click(); return 1; })()`);
      assert.equal(removed, 1, "manimami chip found");
      await ev(`document.getElementById("analyzeBtn").click(), 1`);
      assert.equal(await waitPlayers(3), 1, "3 players graphed");
      assert.equal(await ev(`${api}.getYZoom()`), 1, "zoom back to Auto");
      const s3 = await ev(`${api}.getChartScale()`);
      assert.ok(s3.hi < zoomed4.hi, `axis refit: hi ${s3.hi} < ${zoomed4.hi}`);
      // Fresh auto-fit for the 3 players equals what Auto would give.
      await ev(`${api}.setYZoom(1), 1`);
      assert.deepEqual(await ev(`${api}.getChartScale()`), s3);
      assert.equal(await ev(`document.getElementById("yZoomSlider").value`), "0");
    } finally {
      proc.kill("SIGKILL");
      server.close();
    }
  });
});
