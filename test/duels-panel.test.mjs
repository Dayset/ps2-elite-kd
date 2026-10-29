// 🤺 Duels panel behaviour (owner 2026-10-28): switching pairs mid-load, cross-server gate.
// The panel module is imported in-page with stubs: no Census, no Worker, no network.
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

async function withPage(fn) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css" };
  const server = http.createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const userDir = fs.mkdtempSync("/tmp/duels-panel-");
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
  try {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Page.enable", {}, sessionId);
    const ev = async (expr) => {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
      return r.result.value;
    };
    const nav = async (u) => {
      await send("Page.navigate", { url: `http://127.0.0.1:${port}/${u}` }, sessionId);
      // The fixture mounts on document.body: navigation can leave it null briefly.
      for (let i = 0; i < 100; i++) {
        try { if (await ev("document.body ? 1 : 0")) return; } catch { /* mid-navigation: retry */ }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("page body never appeared");
    };
    await fn({ ev, nav });
  } finally {
    proc.kill("SIGKILL");
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch { /* ignore */ }
    server.close();
  }
}

const fixture = `
  const s = document.createElement("details");
  s.setAttribute("open", "");
  s.innerHTML = "<summary>Duels</summary><span class=\\"duel-count\\"></span><p class=\\"duel-summary\\" hidden></p><p class=\\"duel-status\\" hidden></p><div class=\\"duel-cmp-wrap\\" hidden><table class=\\"duel-cmp\\"></table></div><div class=\\"duel-scroll\\" hidden><table class=\\"duel-table\\"><thead></thead><tbody></tbody></table></div><button type=\\"button\\" class=\\"duel-more\\" hidden>Read further back</button>";
  document.body.appendChild(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const status = () => s.querySelector(".duel-status").textContent;
  const summary = () => s.querySelector(".duel-summary").textContent;
`;

const replyFor = (q) => {
  const t = 1792000000;
  return { v: 1, events: [[t, 1, String(q), 1, 0, 2, 0, 0, 0], [t - 100, 1, String(q), 1, 0, 2, 0, 0, 0]], rev: 1, lo: t - 100, hi: t, done: true, fights: 1, kills: 2, pages: 1, blocks: 1 };
};

describe("🤺 duels panel: pair switching and the cross-server gate", () => {
  it("switching pairs mid-load starts the new pair at once, no toggle needed", { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav("index.html");
      const r = await ev(`(async () => {
        ${fixture}
        const { mountDuels } = await import("/duels-panel.mjs");
        const replyFor = (q) => { const t = 1792000000; return { v: 1, events: [[t, 1, String(q), 1, 0, 2, 0, 0, 0], [t - 100, 1, String(q), 1, 0, 2, 0, 0, 0]], rev: 1, lo: t - 100, hi: t, done: true, fights: 1, kills: 2, pages: 1, blocks: 1 }; };
        let calls = 0, hold2 = null, hold2Args = null;
        const pairApi = (args) => {
          calls++;
          if (calls === 1) return new Promise(() => {}); // first pair's load never settles
          return new Promise((r) => { hold2 = r; hold2Args = args; }); // second pair held until the test releases it
        };
        const getJson = async (u) => {
          if (u.includes("character/?character_id=")) return { character_list: [
            { character_id: "1", faction_id: "1", w: { world_id: "1" } },
            { character_id: "2", faction_id: "3", w: { world_id: "1" } },
            { character_id: "3", faction_id: "2", w: { world_id: "1" } } ] };
          return { error: "stub" };
        };
        const panel = mountDuels(s, { getJson, baseOf: () => "https://x/get/ps2:v2/", catalog: async () => null, pairApi });
        const A = { cid: "1", display: "Alice" }, B = { cid: "2", display: "Bob" }, C = { cid: "3", display: "Carol" };
        panel.setPlayers([A, B]);
        await sleep(300);
        const duringFirst = status();
        panel.setPlayers([A, C]);
        await sleep(300);
        const duringSwitch = status();
        hold2(replyFor(hold2Args.q));
        let sum = "";
        for (let i = 0; i < 30 && !sum.includes("Carol"); i++) { await sleep(100); sum = summary(); }
        return { duringFirst, duringSwitch, sum, calls };
      })()`);
      assert.match(r.duringFirst, /Reading/, "first pair shows its loading text");
      assert.match(r.duringSwitch, /Reading/, "new pair shows loading text at once, not an empty panel");
      assert.match(r.sum, /Carol/, "new pair loads without closing and reopening the section");
      assert.equal(r.calls, 2, "both pairs asked the cache, none stuck behind the first");
    });
  });

  it("cross-server pair fetches no history: no pair API call, no Census paging, servers message", { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav("index.html");
      const r = await ev(`(async () => {
        ${fixture}
        const { mountDuels } = await import("/duels-panel.mjs");
        let apiCalls = 0;
        const jsonUrls = [];
        const pairApi = () => { apiCalls++; return Promise.resolve(${JSON.stringify(replyFor("2"))}); };
        const getJson = async (u) => {
          jsonUrls.push(u);
          if (u.includes("character/?character_id=")) return { character_list: [
            { character_id: "1", faction_id: "1", w: { world_id: "1" } },
            { character_id: "2", faction_id: "3", w: { world_id: "10" } } ] };
          return { error: "stub" };
        };
        const panel = mountDuels(s, { getJson, baseOf: () => "https://x/get/ps2:v2/", catalog: async () => null, pairApi });
        panel.setPlayers([{ cid: "1", display: "Alice" }, { cid: "2", display: "Bob" }]);
        let st = "";
        for (let i = 0; i < 30 && !st.includes("different servers"); i++) { await sleep(100); st = status(); }
        return { st, apiCalls, jsonUrls };
      })()`);
      assert.match(r.st, /different servers/, "servers message shows");
      assert.equal(r.apiCalls, 0, "pair cache never asked for a cross-server pair");
      assert.equal(r.jsonUrls.length, 1, "only the one character lookup that detects the worlds");
      assert.match(r.jsonUrls[0], /character\/\?character_id=/, "that lookup is the world detector, not history paging");
    });
  });

  it("same-server pair still fetches history (control)", { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav("index.html");
      const r = await ev(`(async () => {
        ${fixture}
        const { mountDuels } = await import("/duels-panel.mjs");
        let apiCalls = 0;
        const pairApi = (args) => { apiCalls++; return Promise.resolve(${JSON.stringify(replyFor("2"))}); };
        const getJson = async (u) => {
          if (u.includes("character/?character_id=")) return { character_list: [
            { character_id: "1", faction_id: "1", w: { world_id: "1" } },
            { character_id: "2", faction_id: "3", w: { world_id: "1" } } ] };
          return { error: "stub" };
        };
        const panel = mountDuels(s, { getJson, baseOf: () => "https://x/get/ps2:v2/", catalog: async () => null, pairApi });
        panel.setPlayers([{ cid: "1", display: "Alice" }, { cid: "2", display: "Bob" }]);
        let sum = "";
        for (let i = 0; i < 30 && !sum.includes("Bob"); i++) { await sleep(100); sum = summary(); }
        return { sum, apiCalls, st: status() };
      })()`);
      assert.match(r.sum, /Bob/, "same-server pair loads its history");
      assert.ok(r.apiCalls >= 1, "pair cache asked");
      assert.doesNotMatch(r.st, /different servers/, "no servers message for a same-server pair");
    });
  });
});
