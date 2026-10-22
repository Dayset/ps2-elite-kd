// 🖼️ PC background-image toggle: button next to 🗑️, persisted, PC-only.
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

async function withPage(fn, { width = 1280, height = 900, mobile = false } = {}) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css" };
  const server = http.createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  // Headless Chromium reports no hover / no fine pointer, so the PC-only
  // "(hover: hover) and (pointer: fine)" rules never matched (issue #35). Blink
  // settings give the desktop runs a mouse (fine pointer = 4, hover = 2) and the
  // phone runs a touchscreen (coarse = 2, no hover = 1). HEADFUL=1 still runs a
  // real window (e.g. under xvfb-run).
  const input = mobile
    ? "primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1"
    : "primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2";
  const headless = mobile || !process.env.HEADFUL;
  const proc = spawn(chrome, [...(headless ? ["--headless=new"] : []), "--blink-settings=" + input, "--no-sandbox", "--disable-gpu", "--remote-debugging-pipe", "--user-data-dir=" + fs.mkdtempSync("/tmp/bg-toggle-"), "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
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

const state = () => `(() => { const b = document.getElementById("bgToggleBtn"); return { pc: matchMedia("(hover: hover) and (pointer: fine)").matches, btnDisplay: b ? getComputedStyle(b).display : null, off: document.documentElement.classList.contains("no-bg-image"), img: getComputedStyle(document.documentElement).backgroundImage, stored: localStorage.getItem("ps2-elite-kd-bg-image"), btnOff: b ? b.classList.contains("off") : null, title: b ? b.title : null }; })()`;
const ready = `new Promise(async (r) => { for (let t = 0; t < 400; t++) { if (window.__ps2EliteKd) return r(1); await new Promise((q) => setTimeout(q, 50)); } r(0); })`;

describe("🖼️ background-image toggle (PC, next to 🗑️)", () => {
  it("desktop: image on by default, click hides it, reload keeps it off, click again restores", { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav("index.html");
      assert.equal(await ev(ready), 1, "app module loaded");
      await ev(`document.getElementById("settingsMenu").open = true`); // t490u: the toggle lives in the ⚙️ Settings menu now
      let st = await ev(state());
      assert.equal(st.pc, true, "desktop matches the PC media query");
      assert.notEqual(st.btnDisplay, "none", "🖼️ button visible on PC (Settings menu open)");
      assert.equal(st.off, false, "image on by default");
      assert.ok(st.img.includes("imgur"), `html carries the background image: ${st.img}`);
      await ev(`document.getElementById("bgToggleBtn").click()`);
      st = await ev(state());
      assert.equal(st.off, true, "click hides the image");
      assert.equal(st.img, "none", "no background image once off");
      assert.equal(st.stored, "0", "off persisted");
      assert.equal(st.btnOff, true, "button dims when off");
      assert.match(st.title, /off/, "button label flips to off");
      await nav("index.html");
      assert.equal(await ev(ready), 1, "app module loaded after reload");
      st = await ev(state());
      assert.equal(st.off, true, "still off after reload");
      assert.equal(st.img, "none", "still no image after reload");
      await ev(`document.getElementById("bgToggleBtn").click()`);
      st = await ev(state());
      assert.equal(st.off, false, "second click restores the image");
      assert.ok(st.img.includes("imgur"), "image back after second click");
      assert.equal(st.stored, "1", "on persisted");
    }, { width: 1500, height: 900 });
  });

  it("narrow PC window (<1400px): image auto-hidden, button hidden — nothing shows beyond the tables (Dayset 2026-10-21)", { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav("index.html");
      assert.equal(await ev(ready), 1, "app module loaded");
      const st = await ev(state());
      assert.equal(st.pc, true, "still a PC (hover + fine pointer)");
      assert.equal(st.img, "none", "no background image in a narrow window");
      assert.equal(st.btnDisplay, "none", "🖼️ button hidden — nothing to toggle");
    }, { width: 1280, height: 900 });
  });

  it("mobile: button hidden, no image", { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav("index.html");
      assert.equal(await ev(ready), 1, "app module loaded");
      const st = await ev(state());
      assert.equal(st.pc, false, "phone does not match the PC media query");
      assert.equal(st.btnDisplay, "none", "🖼️ button hidden on mobile");
      assert.equal(st.img, "none", "no background image on mobile");
    }, { width: 390, height: 844, mobile: true });
  });
});
