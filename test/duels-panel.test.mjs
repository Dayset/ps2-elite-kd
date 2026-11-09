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

describe("🤺 duels panel: crowd kills pin + opponent iVi (owner 2026-11-01)", () => {
  it("kills cells carry duel-kills and a cached opponent shows ⚔️ iVi, an unknown one shows none", { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav("index.html");
      const r = await ev(`(async () => {
        ${fixture}
        const { mountDuels } = await import("/duels-panel.mjs");
        const panel = mountDuels(s, { getJson: async () => ({ error: "stub" }), baseOf: () => "https://x/get/ps2:v2/", catalog: async () => null });
        panel.setPlayers([{ cid: "99", display: "LeGs2", rows: [
          { name: "botWaz", kills: 10, deaths: 5, kpm: 1.5 },
          { name: "NoSuchPlayerZZZ", kills: 3, deaths: 8, kpm: 0.5 },
        ] }]);
        await sleep(2500);
        const rows = [...s.querySelectorAll("tbody tr")].map((tr) => tr.innerHTML);
        const botRow = rows.find((h) => h.includes("botWaz"));
        const noRow = rows.find((h) => h.includes("NoSuchPlayerZZZ"));
        return { head: s.querySelector("thead").innerHTML, rows, botRow, noRow };
      })()`);
      assert.match(r.head, /duel-kills/, "kills header carries duel-kills");
      assert.ok(r.rows.every((h) => h.includes("duel-kills")), "every kills cell carries duel-kills");
      assert.match(r.botRow, /duel-ivi/, "cached opponent shows iVi");
      assert.match(r.botRow, /⚔️1,357/, "iVi is the ranks-lite adjs (botWaz 1357.3)");
      assert.doesNotMatch(r.noRow, /duel-ivi/, "unknown opponent shows no iVi");
    });
  });
});

describe("🤺 duels panel: ☰ Flat list (owner 2026-11-02, t844u)", () => {
  it("flat list is on by default with time last, and the choice is remembered", { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav("index.html");
      const r = await ev(`(async () => {
        ${fixture}
        localStorage.removeItem("duelFlat");
        const { mountDuels } = await import("/duels-panel.mjs");
        const t = 1792000000;
        // Two fights a day apart: 2 kills, then 1 kill.
        const reply = { v: 1, events: [[t, 1, "2", 1, 0, 2, 0, 0, 0], [t - 100, 1, "2", 1, 0, 2, 0, 0, 0], [t - 90000, 1, "2", 1, 0, 2, 0, 0, 0]], rev: 1, lo: t - 90000, hi: t, done: true, fights: 2, kills: 3, pages: 1, blocks: 1 };
        const getJson = async (u) => (u.includes("character/?character_id=") ? { character_list: [
          { character_id: "1", faction_id: "1", w: { world_id: "1" } }, { character_id: "2", faction_id: "3", w: { world_id: "1" } } ] } : { error: "stub" });
        const mk = (sec) => mountDuels(sec, { getJson, baseOf: () => "https://x/get/ps2:v2/", catalog: async () => null, pairApi: async () => reply });
        const panel = mk(s);
        panel.setPlayers([{ cid: "1", display: "Alice" }, { cid: "2", display: "Bob" }]);
        for (let i = 0; i < 30 && !s.querySelector("tr.duel-ev"); i++) await sleep(100);
        const btn = s.querySelector("button.duel-flat");
        const vis = () => [...s.querySelectorAll(".duel-table tbody tr")].filter((x) => !x.hidden);
        const before = { heads: s.querySelectorAll("tr.duel-fight").length, shown: vis().length, btnHidden: btn.hidden, pressed: btn.getAttribute("aria-pressed"), nums: vis().map((x) => x.cells[0].textContent), time: vis()[0].cells[7].textContent, head: [...s.querySelectorAll(".duel-table thead th")].map((x) => x.textContent) };
        btn.click();
        await sleep(200);
        const off = { heads: s.querySelectorAll("tr.duel-fight").length, shown: vis().length, pressed: btn.getAttribute("aria-pressed"), saved: localStorage.getItem("duelFlat") };
        btn.click();
        await sleep(200);
        const on = { heads: s.querySelectorAll("tr.duel-fight").length, shown: vis().length, pressed: btn.getAttribute("aria-pressed"), saved: localStorage.getItem("duelFlat") };
        // An explicit off survives a fresh mount: default-on must not override a stored "0".
        localStorage.setItem("duelFlat", "0");
        const s2 = document.createElement("details");
        s2.setAttribute("open", "");
        s2.innerHTML = "<summary>Duels</summary><span class=\\"duel-count\\"></span><p class=\\"duel-summary\\" hidden></p><p class=\\"duel-status\\" hidden></p><div class=\\"duel-cmp-wrap\\" hidden><table class=\\"duel-cmp\\"></table></div><div class=\\"duel-scroll\\" hidden><table class=\\"duel-table\\"><thead></thead><tbody></tbody></table></div><button type=\\"button\\" class=\\"duel-more\\" hidden>Read further back</button>";
        document.body.appendChild(s2);
        const panel2 = mk(s2);
        panel2.setPlayers([{ cid: "1", display: "Alice" }, { cid: "2", display: "Bob" }]);
        for (let i = 0; i < 30 && !s2.querySelector("tr.duel-ev"); i++) await sleep(100);
        const btn2 = s2.querySelector("button.duel-flat");
        const storedOff = { heads: s2.querySelectorAll("tr.duel-fight").length, pressed: btn2.getAttribute("aria-pressed") };
        localStorage.removeItem("duelFlat");
        return { before, off, on, storedOff };
      })()`);
      assert.equal(r.before.btnHidden, false, "button shows for a head-to-head with kills");
      assert.equal(r.before.pressed, "true", "flat is on by default");
      assert.equal(r.before.heads, 0, "default view has no fight rows");
      assert.equal(r.before.shown, 3, "every kill shows");
      assert.deepEqual(r.before.nums, ["3", "2", "1"], "strictly newest first, numbered n … 1");
      assert.deepEqual(r.before.head, ["#", "Kill by", "Weapon", "Classes", "Shots ≈", "Hits ≈", "Gap", "Time"], "time is the last column");
      assert.match(r.before.time, /\d{4}/, "flat rows carry the date (year) in the last cell");
      assert.equal(r.off.heads, 2, "switching off brings the fight rows");
      assert.equal(r.off.shown, 4, "folded view: 2 fight rows + the newest fight opened, the older one folded");
      assert.equal(r.off.pressed, "false");
      assert.equal(r.off.saved, "0", "off remembered");
      assert.equal(r.on.heads, 0, "switching back on drops the fight rows");
      assert.equal(r.on.pressed, "true");
      assert.equal(r.on.saved, "1", "on remembered");
      assert.equal(r.storedOff.pressed, "false", "a stored off stays off on a fresh mount");
      assert.equal(r.storedOff.heads, 2, "a stored off renders folded");
    });
  });
});

describe("🤺 duels panel: kill share, ⚔️ iVi and 🎲 vs expected (owner 2026-11-02, t845u / t847u)", () => {
  // 40 kills between them, 10 one way and 30 the other, a day apart each (separate fights).
  // noFit: duel-ivi-fit.json answers 404 → the page must fall back to the single-k formula.
  const run = (ev, noFit) => ev(`(async () => {
        ${fixture}
        localStorage.removeItem("duelFlat");
        if (${noFit}) { const f0 = window.fetch; window.fetch = (u, ...r) => (String(u).includes("duel-ivi-fit") ? Promise.resolve(new Response("", { status: 404 })) : f0(u, ...r)); }
        const { mountDuels } = await import("/duels-panel.mjs?nf=${noFit ? 1 : 0}");
        const t = 1792000000;
        const events = Array.from({ length: 40 }, (_, i) => [t - i * 90000, i < 10 ? 1 : 0, "2", 1, 0, 2, 0, 0, 0]);
        const reply = { v: 1, events, rev: 1, lo: t - 39 * 90000, hi: t, done: true, fights: 40, kills: 40, pages: 1, blocks: 1 };
        const getJson = async (u) => (u.includes("character/?character_id=") ? { character_list: [
          { character_id: "1", faction_id: "1", w: { world_id: "1" } }, { character_id: "2", faction_id: "3", w: { world_id: "1" } } ] } : { error: "stub" });
        const panel = mountDuels(s, { getJson, baseOf: () => "https://x/get/ps2:v2/", catalog: async () => null, pairApi: async () => reply });
        panel.setPlayers([{ cid: "1", display: "TolyaNo" }, { cid: "2", display: "Sarleyy" }]);
        for (let i = 0; i < 50 && !s.querySelector(".duel-cmp tr.duel-luck"); i++) await sleep(100);
        await sleep(300);
        const rows = [...s.querySelectorAll(".duel-cmp tr")].map((x) => ({ th: x.cells[0].textContent, a: x.cells[1] && x.cells[1].textContent, b: x.cells[2] && x.cells[2].textContent, tip: x.cells[0].title, ta: x.cells[1] && x.cells[1].title, tb: x.cells[2] && x.cells[2].title, html: x.innerHTML }));
        return { rows };
      })()`);
  it("comparison shows the share of kills, the iVi gap and a plain verdict, numbers in the hover", { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav("index.html");
      const r = await run(ev, false);
      const kills = r.rows.find((x) => /Kills on the other/.test(x.th));
      const ivi = r.rows.find((x) => /iVi/.test(x.th));
      const luck = r.rows.find((x) => /vs expected/.test(x.th));
      assert.ok(kills && ivi && luck, "kills, iVi and 🎲 rows present: " + JSON.stringify(r.rows.map((x) => x.th)));
      assert.deepEqual([kills.a, kills.b].map((x) => x.replace(/\s+/g, " ").trim()).sort(), ["10 25%", "30 75% +200%"], "share of the kills between them, +% on the bigger side");
      assert.match(ivi.a + ivi.b, /1,704/, "TolyaNo ranks-lite adjs");
      assert.match(ivi.a + ivi.b, /2,003 \+18%/, "Sarleyy 18% higher");
      assert.equal(luck.a.trim(), "↓ a bit worse");
      assert.equal(luck.b.trim(), "↑ a bit better");
      assert.doesNotMatch(luck.a + luck.b, /\d/, "no numbers in the cells");
      assert.match(luck.tb, /^Expected 51%, got 75% \(\+24 pts\)\.$/, "v2 (curve + vehicle kills) numbers in the cell hover");
      assert.match(luck.tip, /Expected: 49% – 51%\. Got: 25% – 75%\./);
      assert.match(luck.tip, /408,179 real player pairs/);
      assert.match(luck.tip, /kills from vehicles count in/, "v2 hover says vehicle kills count in");
      assert.doesNotMatch(JSON.stringify(r.rows), /cheat/i);
    });
  });
  it("missing fit file falls back to the single-k formula", { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav("index.html");
      const r = await run(ev, true);
      const luck = r.rows.find((x) => /vs expected/.test(x.th));
      assert.ok(luck, "🎲 row still shows without the fit file");
      assert.match(luck.tb, /^Expected 52%, got 75% \(\+23 pts\)\.$/, "single-k expectation (52%)");
      assert.doesNotMatch(luck.tip, /vehicles/, "fallback hover doesn't claim vehicle kills");
      assert.equal(luck.b.trim(), "↑ a bit better");
    });
  });
});

describe("🤺 duels panel: replay duel links hidden (owner 2026-11-07)", () => {
  it("pair summary + crowd rows show no replay links; PS still shows none", { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav("index.html");
      const r = await ev(`(async () => {
        ${fixture}
        const { mountDuels } = await import("/duels-panel.mjs");
        const replyFor = (q) => { const t = 1792000000; return { v: 1, events: [[t, 1, String(q), 1, 0, 2, 0, 0, 0], [t - 100, 1, String(q), 1, 0, 2, 0, 0, 0]], rev: 1, lo: t - 100, hi: t, done: true, fights: 1, kills: 2, pages: 1, blocks: 1 }; };
        const getJson = async (u) => {
          if (u.includes("character/?character_id=")) return { character_list: [
            { character_id: "1", faction_id: "1", w: { world_id: "1" } },
            { character_id: "2", faction_id: "3", w: { world_id: "1" } } ] };
          return { error: "stub" };
        };
        const opts = (isPS) => ({ getJson, baseOf: () => "https://x/get/ps2:v2/", catalog: async () => null, pairApi: async (args) => replyFor(args.q), isPS });
        const panel = mountDuels(s, opts(false));
        panel.setPlayers([{ cid: "1", display: "Alice" }, { cid: "2", display: "Bob" }]);
        for (let i = 0; i < 60 && !s.querySelector(".duel-summary").textContent.includes("Alice"); i++) await sleep(100);
        const pairSummary = s.querySelector(".duel-summary").textContent;
        const pairLinks = s.querySelectorAll(".duel-summary a.replay-link").length;
        panel.setPlayers([{ cid: "1", display: "Alice", rows: [{ name: "Bob", kills: 5, deaths: 3 }, { name: "Carol", kills: 2, deaths: 7 }] }]);
        for (let i = 0; i < 60 && s.querySelectorAll(".duel-table tbody tr").length < 2; i++) await sleep(100);
        const crowdLinks = s.querySelectorAll(".duel-table tbody a.replay-link").length;
        const crowdRows = s.querySelectorAll(".duel-table tbody tr").length;
        const s2 = document.createElement("details");
        s2.setAttribute("open", "");
        s2.innerHTML = "<summary>Duels</summary><span class=\\"duel-count\\"></span><p class=\\"duel-summary\\" hidden></p><p class=\\"duel-status\\" hidden></p><div class=\\"duel-cmp-wrap\\" hidden><table class=\\"duel-cmp\\"></table></div><div class=\\"duel-scroll\\" hidden><table class=\\"duel-table\\"><thead></thead><tbody></tbody></table></div><button type=\\"button\\" class=\\"duel-more\\" hidden>Read further back</button>";
        document.body.appendChild(s2);
        const psPanel = mountDuels(s2, opts(true));
        psPanel.setPlayers([{ cid: "1", display: "Alice" }, { cid: "2", display: "Bob" }]);
        for (let i = 0; i < 30 && !s2.querySelector(".duel-summary").textContent.includes("Alice"); i++) await sleep(100);
        const psPairLinks = s2.querySelectorAll("a.replay-link").length;
        psPanel.setPlayers([{ cid: "1", display: "Alice", rows: [{ name: "Bob", kills: 5, deaths: 3 }] }]);
        for (let i = 0; i < 30 && !s2.querySelectorAll(".duel-table tbody tr").length; i++) await sleep(100);
        const psCrowdLinks = s2.querySelectorAll("a.replay-link").length;
        return { pairSummary, pairLinks, crowdLinks, crowdRows, psPairLinks, psCrowdLinks };
      })()`);
      assert.match(r.pairSummary, /Alice/, "pair summary still renders");
      assert.match(r.pairSummary, /Bob/, "pair summary still renders");
      assert.equal(r.pairLinks, 0, "no replay link in the pair summary");
      assert.equal(r.crowdRows, 2, "crowd rows still render");
      assert.equal(r.crowdLinks, 0, "no replay links in the crowd rows");
      assert.equal(r.psPairLinks, 0, "PS still shows no pair link");
      assert.equal(r.psCrowdLinks, 0, "PS still shows no crowd links");
    });
  });
});

describe("🤺 duels panel: 1-vs-many Glicko table (#113)", () => {
  it("3 names open the multi table: one row per opponent, ladder + pairwise side by side", { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav("index.html");
      const r = await ev(`(async () => {
        ${fixture}
        const { mountDuels } = await import("/duels-panel.mjs");
        const t = 1792000000;
        // 25 infantry kills between the subject and each opponent: 20 won, 5 lost.
        const replyFor = (q) => {
          const evs = [];
          for (let i = 0; i < 25; i++) evs.push([t - i * 100, i < 20 ? 1 : 0, String(q), 1, 0, 2, 0, 0, 0]);
          return { v: 1, events: evs, rev: 1, lo: t - 2400, hi: t, done: true, fights: 1, kills: 25, pages: 1, blocks: 1 };
        };
        const getJson = async (u) => {
          if (u.includes("character/?character_id=")) return { character_list: [
            { character_id: "11", faction_id: "1", w: { world_id: "10" } },
            { character_id: "22", faction_id: "3", w: { world_id: "10" } },
            { character_id: "33", faction_id: "2", w: { world_id: "10" } } ] };
          return { error: "stub" };
        };
        const panel = mountDuels(s, { getJson, baseOf: () => "https://x/get/ps2:v2/", catalog: async () => null, pairApi: async (args) => replyFor(args.q) });
        const F = { cid: "11", display: "Fantom220TR", rows: [
          { name: "Sarleyy", kills: 120, deaths: 90, kpm: 1 },
          { name: "BlackRodger", kills: 80, deaths: 70, kpm: 1 } ] };
        panel.setPlayers([F, { cid: "22", display: "Sarleyy" }, { cid: "33", display: "BlackRodger" }]);
        let done = null;
        for (let i = 0; i < 60 && !done; i++) {
          await sleep(100);
          if (status().includes("disagree")) done = {
            hidden: s.hidden,
            sum: summary(),
            head: [...s.querySelectorAll(".duel-table thead th")].map((x) => x.textContent),
            rows: [...s.querySelectorAll(".duel-table tbody tr")].map((tr) => [...tr.cells].map((c) => c.textContent)),
            titles: [...s.querySelectorAll(".duel-table tbody tr")].map((tr) => [...tr.cells].map((c) => c.title)),
            multi: s.querySelector(".duel-table").classList.contains("duel-multi"),
            count: s.querySelector(".duel-count").textContent,
          };
        }
        return done;
      })()`);
      assert.ok(r, "multi table settles (status note appears)");
      assert.equal(r.hidden, false, "section shows for 3 names");
      assert.equal(r.multi, true, "table carries duel-multi");
      assert.equal(r.count, "(2)", "count is the opponent count");
      assert.match(r.sum, /Fantom220TR vs 2 opponents/, "summary names the subject and the opponent count");
      assert.deepEqual(r.head, ["#", "Opponent", "Kills", "🌐 Ladder", "📈 Pairwise", "Last fight"], "five columns, ladder before pairwise");
      assert.equal(r.rows.length, 2, "one row per opponent, input order");
      assert.match(r.rows[0][1], /Sarleyy/, "first row is the first opponent");
      assert.match(r.rows[0][2], /120–90/, "kills cell is the killboard split, subject first");
      assert.match(r.rows[0][3], /1,712 ±38 · 52%/, "ladder cell: Fantom's ladder rating vs Sarleyy (1712 ±38, 52%)");
      assert.match(r.rows[0][4], /1,\d{3} ±\d+ · \d+%/, "pairwise cell carries a Glicko rating ± RD · win%");
      assert.match(r.titles[0][4], /Next kill \d+% · 25 counted infantry kills since/, "pairwise hover names the win%, the counted kills and the last fight");
      assert.match(r.rows[0][5], /2026/, "last-fight cell carries the last kill's date");
      assert.match(r.rows[1][2], /80–70/, "second row's kill split");
      assert.match(r.rows[1][3], /1,712 ±38 · 60%/, "ladder cell: Fantom vs BlackRodger (1712 ±38, 60%)");
      assert.match(r.rows[1][4], /1,\d{3} ±\d+ · \d+%/, "second row's pairwise verdict");
    });
  });

  it("cross-server opponent: pairwise —, ladder still shows, pair cache never asked", { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav("index.html");
      const r = await ev(`(async () => {
        ${fixture}
        const { mountDuels } = await import("/duels-panel.mjs");
        let apiCalls = 0;
        const getJson = async (u) => {
          if (u.includes("character/?character_id=")) return { character_list: [
            { character_id: "11", faction_id: "1", w: { world_id: "10" } },
            { character_id: "22", faction_id: "3", w: { world_id: "1" } },
            { character_id: "33", faction_id: "2", w: { world_id: "1" } } ] };
          return { error: "stub" };
        };
        const panel = mountDuels(s, { getJson, baseOf: () => "https://x/get/ps2:v2/", catalog: async () => null, pairApi: async () => { apiCalls++; return { v: 1, events: [], rev: 1, done: true, fights: 0, kills: 0, pages: 0, blocks: 0 }; } });
        const F = { cid: "11", display: "Fantom220TR", rows: [{ name: "Sarleyy", kills: 120, deaths: 90, kpm: 1 }] };
        panel.setPlayers([F, { cid: "22", display: "Sarleyy" }, { cid: "33", display: "BlackRodger" }]);
        let done = null;
        for (let i = 0; i < 60 && !done; i++) {
          await sleep(100);
          if (status().includes("disagree")) done = {
            rows: [...s.querySelectorAll(".duel-table tbody tr")].map((tr) => [...tr.cells].map((c) => c.textContent)),
            titles: [...s.querySelectorAll(".duel-table tbody tr")].map((tr) => [...tr.cells].map((c) => c.title)),
          };
        }
        return { ...done, apiCalls };
      })()`);
      assert.ok(r.rows, "multi table settles");
      assert.equal(r.apiCalls, 0, "pair cache never asked for a cross-server opponent");
      assert.match(r.rows[0][3], /52%/, "ladder column still works cross-server");
      assert.equal(r.rows[0][4], "—", "pairwise column is — cross-server");
      assert.match(r.titles[0][4], /different servers/, "pairwise — explains the server gate");
    });
  });

  it("too few infantry kills: pairwise shows the floor message, ladder still shows", { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav("index.html");
      const r = await ev(`(async () => {
        ${fixture}
        const { mountDuels } = await import("/duels-panel.mjs");
        const t = 1792000000;
        const few = { v: 1, events: [[t, 1, "22", 1, 0, 2, 0, 0, 0], [t - 100, 1, "22", 1, 0, 2, 0, 0, 0], [t - 200, 0, "22", 1, 0, 2, 0, 0, 0], [t - 300, 1, "22", 1, 0, 2, 0, 0, 0], [t - 400, 0, "22", 1, 0, 2, 0, 0, 0]], rev: 1, lo: t - 400, hi: t, done: true, fights: 1, kills: 5, pages: 1, blocks: 1 };
        const getJson = async (u) => {
          if (u.includes("character/?character_id=")) return { character_list: [
            { character_id: "11", faction_id: "1", w: { world_id: "10" } },
            { character_id: "22", faction_id: "3", w: { world_id: "10" } },
            { character_id: "33", faction_id: "2", w: { world_id: "10" } } ] };
          return { error: "stub" };
        };
        const panel = mountDuels(s, { getJson, baseOf: () => "https://x/get/ps2:v2/", catalog: async () => null, pairApi: async (args) => (args.q === "22" ? few : { v: 1, events: [], rev: 1, done: true, fights: 0, kills: 0, pages: 0, blocks: 0 }) });
        const F = { cid: "11", display: "Fantom220TR", rows: [
          { name: "Sarleyy", kills: 120, deaths: 90, kpm: 1 },
          { name: "BlackRodger", kills: 80, deaths: 70, kpm: 1 } ] };
        panel.setPlayers([F, { cid: "22", display: "Sarleyy" }, { cid: "33", display: "BlackRodger" }]);
        let done = null;
        for (let i = 0; i < 60 && !done; i++) {
          await sleep(100);
          if (status().includes("disagree")) done = { rows: [...s.querySelectorAll(".duel-table tbody tr")].map((tr) => [...tr.cells].map((c) => c.textContent)) };
        }
        return done;
      })()`);
      assert.ok(r.rows, "multi table settles");
      assert.match(r.rows[0][4], /too few infantry kills/, "5 kills is below the 20-kill floor");
      assert.match(r.rows[0][3], /52%/, "ladder column unaffected by the floor");
      assert.equal(r.rows[0][5], "—", "no last fight below the floor");
    });
  });

  it("a subject with no ladder rating shows — there, but still gets a pairwise verdict", { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav("index.html");
      const r = await ev(`(async () => {
        ${fixture}
        const { mountDuels } = await import("/duels-panel.mjs");
        const t = 1792000000;
        const replyFor = (q) => {
          const evs = [];
          for (let i = 0; i < 25; i++) evs.push([t - i * 100, i < 20 ? 1 : 0, String(q), 1, 0, 2, 0, 0, 0]);
          return { v: 1, events: evs, rev: 1, lo: t - 2400, hi: t, done: true, fights: 1, kills: 25, pages: 1, blocks: 1 };
        };
        const getJson = async (u) => {
          if (u.includes("character/?character_id=")) return { character_list: [
            { character_id: "44", faction_id: "1", w: { world_id: "10" } },
            { character_id: "11", faction_id: "3", w: { world_id: "10" } } ] };
          return { error: "stub" };
        };
        const panel = mountDuels(s, { getJson, baseOf: () => "https://x/get/ps2:v2/", catalog: async () => null, pairApi: async (args) => replyFor(args.q) });
        // TolyaNo has not played since 2026-10-08, so the tip's ladder.json (built 2026-11-06,
        // ~5 days of stored kills) carries no rating for him — the ladder cell must be —.
        const T = { cid: "44", display: "TolyaNo", rows: [{ name: "Fantom220TR", kills: 537, deaths: 794, kpm: 1 }] };
        panel.setPlayers([T, { cid: "11", display: "Fantom220TR" }, { cid: "22", display: "Sarleyy" }]);
        let done = null;
        for (let i = 0; i < 60 && !done; i++) {
          await sleep(100);
          if (status().includes("disagree")) done = { rows: [...s.querySelectorAll(".duel-table tbody tr")].map((tr) => [...tr.cells].map((c) => c.textContent)) };
        }
        return done;
      })()`);
      assert.ok(r.rows, "multi table settles");
      assert.match(r.rows[0][2], /537–794/, "kills cell is the real killboard split");
      assert.equal(r.rows[0][3], "—", "no ladder rating for TolyaNo in the tip's ladder.json");
      assert.match(r.rows[0][4], /1,\d{3} ±\d+ · \d+%/, "pairwise verdict still renders from the head-to-head history");
    });
  });

  it("mode switch: 6 names hide the section, 2 names still open the pair view, 1 name the crowd", { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav("index.html");
      const r = await ev(`(async () => {
        ${fixture}
        const { mountDuels } = await import("/duels-panel.mjs");
        const t = 1792000000;
        const replyFor = (q) => {
          const evs = [];
          for (let i = 0; i < 25; i++) evs.push([t - i * 100, i < 20 ? 1 : 0, String(q), 1, 0, 2, 0, 0, 0]);
          return { v: 1, events: evs, rev: 1, lo: t - 2400, hi: t, done: true, fights: 1, kills: 25, pages: 1, blocks: 1 };
        };
        const getJson = async (u) => {
          if (u.includes("character/?character_id=")) return { character_list: [
            { character_id: "11", faction_id: "1", w: { world_id: "10" } },
            { character_id: "22", faction_id: "3", w: { world_id: "10" } },
            { character_id: "33", faction_id: "2", w: { world_id: "10" } },
            { character_id: "44", faction_id: "1", w: { world_id: "10" } },
            { character_id: "55", faction_id: "2", w: { world_id: "10" } },
            { character_id: "66", faction_id: "3", w: { world_id: "10" } } ] };
          return { error: "stub" };
        };
        const panel = mountDuels(s, { getJson, baseOf: () => "https://x/get/ps2:v2/", catalog: async () => null, pairApi: async (args) => replyFor(args.q) });
        const F = { cid: "11", display: "Fantom220TR", rows: [
          { name: "Sarleyy", kills: 120, deaths: 90, kpm: 1 },
          { name: "BlackRodger", kills: 80, deaths: 70, kpm: 1 } ] };
        const S = { cid: "22", display: "Sarleyy" }, B = { cid: "33", display: "BlackRodger" };
        panel.setPlayers([F, S, B]);
        let multi = null;
        for (let i = 0; i < 60 && !multi; i++) { await sleep(100); if (status().includes("disagree")) multi = s.querySelector(".duel-table").classList.contains("duel-multi"); }
        panel.setPlayers([F, S, B, { cid: "44", display: "Cepn" }, { cid: "55", display: "Frag38ruVS" }, { cid: "66", display: "Buzdovan" }]);
        await sleep(200);
        const sixHidden = s.hidden;
        panel.setPlayers([F, S]);
        let pair = null;
        for (let i = 0; i < 60 && !pair; i++) { await sleep(100); if (summary().includes("Sarleyy")) pair = { cmp: !s.querySelector(".duel-cmp-wrap").hidden, glk: s.querySelector(".duel-cmp").textContent.includes("📈"), multiClass: s.querySelector(".duel-table").classList.contains("duel-multi") }; }
        panel.setPlayers([F]);
        let crowd = null;
        for (let i = 0; i < 60 && !crowd; i++) { await sleep(100); if (s.querySelectorAll(".duel-table tbody tr").length) crowd = s.querySelector(".duel-table").classList.contains("duel-crowd"); }
        return { multi, sixHidden, pair, crowd };
      })()`);
      assert.equal(r.multi, true, "3 names open the multi table");
      assert.equal(r.sixHidden, true, "6 names hide the section");
      assert.ok(r.pair, "2 names open the pair view");
      assert.equal(r.pair.cmp, true, "pair comparison shows");
      assert.equal(r.pair.glk, true, "pair view keeps its 📈 Glicko row");
      assert.equal(r.pair.multiClass, false, "pair view drops the duel-multi class");
      assert.equal(r.crowd, true, "1 name opens the crowd view");
    });
  });
});

describe("🤺 duels panel: first open reads the whole history when the killboard says 20+ kills (owner 2026-11-09)", () => {
  it("67 kills on the killboard, 6 in the first 5 pages: first open fetches all 67, luck and Glicko show", { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav("index.html");
      const r = await ev(`(async () => {
        ${fixture}
        const { mountDuels } = await import("/duels-panel.mjs");
        const t0 = Math.floor(Date.now() / 1000) - 100;
        const pid = "1", qid = "2";
        // 40 kills by botWaz, 27 by Sabin3r; 6 of them in the first 5 pages, the rest past page 5.
        const pairAt = new Map([[100, 1], [900, 1], [1500, 0], [2400, 1], [3300, 1], [4900, 0]]);
        for (let j = 0; j < 61; j++) pairAt.set(5030 + j * 32, j < 36 ? 1 : 0);
        const rows = [];
        for (let i = 0; i < 7000; i++) {
          const ts = t0 - i, pk = pairAt.get(i);
          if (pk === undefined) {
            const kill = i % 2 === 0;
            rows.push(kill
              ? { timestamp: ts, table_type: "kills", character_id: "9", attacker_character_id: pid, attacker_weapon_id: "1", is_headshot: "0", zone_id: "2", attacker_loadout_id: "10", character_loadout_id: "17", attacker_vehicle_id: "0" }
              : { timestamp: ts, table_type: "deaths", character_id: pid, attacker_character_id: "9", attacker_weapon_id: "1", is_headshot: "0", zone_id: "2", attacker_loadout_id: "10", character_loadout_id: "17", attacker_vehicle_id: "0" });
          } else if (pk) {
            rows.push({ timestamp: ts, table_type: "kills", character_id: qid, attacker_character_id: pid, attacker_weapon_id: "1", is_headshot: "0", zone_id: "2", attacker_loadout_id: "10", character_loadout_id: "17", attacker_vehicle_id: "0" });
          } else {
            rows.push({ timestamp: ts, table_type: "deaths", character_id: pid, attacker_character_id: qid, attacker_weapon_id: "1", is_headshot: "0", zone_id: "2", attacker_loadout_id: "17", character_loadout_id: "10", attacker_vehicle_id: "0" });
          }
        }
        let eventCalls = 0;
        const getJson = async (u) => {
          if (u.includes("character/?character_id=")) return { character_list: [
            { character_id: "1", faction_id: "1", w: { world_id: "1" } },
            { character_id: "2", faction_id: "3", w: { world_id: "1" } } ] };
          if (u.includes("characters_event/")) {
            eventCalls++;
            const m = /[?&]before=([0-9]+)/.exec(u);
            const before = m ? Number(m[1]) : Infinity;
            return { characters_event_list: rows.filter((e) => e.timestamp < before).slice(0, 1000) };
          }
          return { error: "stub" };
        };
        const panel = mountDuels(s, { getJson, baseOf: () => "https://x/get/ps2:v2/", catalog: async () => null });
        panel.setPlayers([{ cid: "1", display: "botWaz", rows: [{ name: "Sabin3r", kills: 40, deaths: 27, kpm: 1 }] }, { cid: "2", display: "Sabin3r" }]);
        let done = null;
        for (let i = 0; i < 120 && !done; i++) {
          await sleep(100);
          if (summary().includes("40 – 27") && s.querySelector(".duel-cmp").textContent.includes("vs expected")) done = {
            sum: summary(), st: status(), count: s.querySelector(".duel-count").textContent,
            cmp: s.querySelector(".duel-cmp").textContent,
            luckTitle: (s.querySelector("tr.duel-luck th") || {}).title || "", eventCalls,
          };
        }
        return done;
      })()`);
      assert.ok(r, "pair settles with the full split and the luck row");
      assert.equal(r.eventCalls, 7, "first open reads past page 5: 7 event pages for all 67 kills");
      assert.match(r.sum, /botWaz 40 – 27 Sabin3r/, "summary is the full killboard split, not the first 5 pages");
      assert.equal(r.count, "(67)", "count is all 67 kills");
      assert.match(r.st, /History read back to/, "status no longer reports a partial read");
      assert.doesNotMatch(r.st, /of the 67 kills/, "no 'N of the 67 kills found' anymore");
      assert.match(r.cmp, /🎲 vs expected/, "luck row shows");
      assert.match(r.cmp, /📈 Glicko/, "Glicko row shows");
      assert.doesNotMatch(r.cmp, /too few kills/, "no 'too few kills' with 67 loaded");
      assert.doesNotMatch(r.cmp, /too few infantry kills/, "no 'too few infantry kills' with 67 infantry kills");
      assert.doesNotMatch(r.luckTitle, /killboard/i, "luck comes from the loaded kills once they are in, not the killboard");
    });
  });

  it("under 20 kills on the killboard: first open still stops at 5 pages", { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav("index.html");
      const r = await ev(`(async () => {
        ${fixture}
        const { mountDuels } = await import("/duels-panel.mjs");
        const t0 = Math.floor(Date.now() / 1000) - 100;
        const pid = "1", qid = "2";
        const pairAt = new Map([[100, 1], [1500, 0], [3000, 1]]);
        const rows = [];
        for (let i = 0; i < 7000; i++) {
          const ts = t0 - i, pk = pairAt.get(i);
          if (pk === undefined) {
            const kill = i % 2 === 0;
            rows.push(kill
              ? { timestamp: ts, table_type: "kills", character_id: "9", attacker_character_id: pid, attacker_weapon_id: "1", is_headshot: "0", zone_id: "2", attacker_loadout_id: "10", character_loadout_id: "17", attacker_vehicle_id: "0" }
              : { timestamp: ts, table_type: "deaths", character_id: pid, attacker_character_id: "9", attacker_weapon_id: "1", is_headshot: "0", zone_id: "2", attacker_loadout_id: "10", character_loadout_id: "17", attacker_vehicle_id: "0" });
          } else if (pk) {
            rows.push({ timestamp: ts, table_type: "kills", character_id: qid, attacker_character_id: pid, attacker_weapon_id: "1", is_headshot: "0", zone_id: "2", attacker_loadout_id: "10", character_loadout_id: "17", attacker_vehicle_id: "0" });
          } else {
            rows.push({ timestamp: ts, table_type: "deaths", character_id: pid, attacker_character_id: qid, attacker_weapon_id: "1", is_headshot: "0", zone_id: "2", attacker_loadout_id: "17", character_loadout_id: "10", attacker_vehicle_id: "0" });
          }
        }
        let eventCalls = 0;
        const getJson = async (u) => {
          if (u.includes("character/?character_id=")) return { character_list: [
            { character_id: "1", faction_id: "1", w: { world_id: "1" } },
            { character_id: "2", faction_id: "3", w: { world_id: "1" } } ] };
          if (u.includes("characters_event/")) {
            eventCalls++;
            const m = /[?&]before=([0-9]+)/.exec(u);
            const before = m ? Number(m[1]) : Infinity;
            return { characters_event_list: rows.filter((e) => e.timestamp < before).slice(0, 1000) };
          }
          return { error: "stub" };
        };
        const panel = mountDuels(s, { getJson, baseOf: () => "https://x/get/ps2:v2/", catalog: async () => null });
        panel.setPlayers([{ cid: "1", display: "botWaz", rows: [{ name: "Sabin3r", kills: 5, deaths: 3, kpm: 1 }] }, { cid: "2", display: "Sabin3r" }]);
        let done = null;
        for (let i = 0; i < 60 && !done; i++) {
          await sleep(100);
          if (summary().includes("2 – 1")) done = { sum: summary(), st: status(), eventCalls };
        }
        return done;
      })()`);
      assert.ok(r, "pair settles with the 5-page window");
      assert.equal(r.eventCalls, 5, "first open stops at 5 pages under the floor");
      assert.match(r.sum, /botWaz 2 – 1 Sabin3r/, "summary is the loaded window only");
      assert.match(r.st, /3 of the 8 kills/, "status still reports the partial read honestly");
    });
  });

  it("restored short cache: reopening a pair stopped at 6 of 67 reads back from its saved cursor", { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav("index.html");
      const r = await ev(`(async () => {
        ${fixture}
        const { mountDuels } = await import("/duels-panel.mjs");
        const t0 = Math.floor(Date.now() / 1000) - 100;
        const pid = "3", qid = "4";
        const pairAt = new Map([[100, 1], [900, 1], [1500, 0], [2400, 1], [3300, 1], [4900, 0]]);
        for (let j = 0; j < 61; j++) pairAt.set(5030 + j * 32, j < 36 ? 1 : 0);
        const rows = [];
        for (let i = 0; i < 7000; i++) {
          const ts = t0 - i, pk = pairAt.get(i);
          if (pk === undefined) {
            const kill = i % 2 === 0;
            rows.push(kill
              ? { timestamp: ts, table_type: "kills", character_id: "9", attacker_character_id: pid, attacker_weapon_id: "1", is_headshot: "0", zone_id: "2", attacker_loadout_id: "10", character_loadout_id: "17", attacker_vehicle_id: "0" }
              : { timestamp: ts, table_type: "deaths", character_id: pid, attacker_character_id: "9", attacker_weapon_id: "1", is_headshot: "0", zone_id: "2", attacker_loadout_id: "10", character_loadout_id: "17", attacker_vehicle_id: "0" });
          } else if (pk) {
            rows.push({ timestamp: ts, table_type: "kills", character_id: qid, attacker_character_id: pid, attacker_weapon_id: "1", is_headshot: "0", zone_id: "2", attacker_loadout_id: "10", character_loadout_id: "17", attacker_vehicle_id: "0" });
          } else {
            rows.push({ timestamp: ts, table_type: "deaths", character_id: pid, attacker_character_id: qid, attacker_weapon_id: "1", is_headshot: "0", zone_id: "2", attacker_loadout_id: "17", character_loadout_id: "10", attacker_vehicle_id: "0" });
          }
        }
        // The cache entry a 5-page first open would have saved: every event of pages 1-5.
        const toCompact = (e) => {
          const kill = e.table_type === "kills" ? 1 : 0;
          const other = kill ? e.character_id : e.attacker_character_id;
          return [e.timestamp, kill, String(other), Number(e.attacker_weapon_id) || 0, e.is_headshot === "1" ? 1 : 0, Number(e.zone_id) || 0,
            Number(kill ? e.attacker_loadout_id : e.character_loadout_id) || 0,
            Number(kill ? e.character_loadout_id : e.attacker_loadout_id) || 0,
            Number(e.attacker_vehicle_id) || 0];
        };
        localStorage.removeItem("ps2_duels_cache");
        localStorage.setItem("ps2_duels_cache", JSON.stringify({ "3|4": { v: 1, pid: "3", qid: "4", base: "https://x/get/ps2:v2/",
          all: rows.slice(0, 5000).map(toCompact), cursor: t0 - 4998, done: false, pages: 5, oldest: t0 - 4999, stats: [], savedAt: Date.now() } }));
        let eventCalls = 0;
        const getJson = async (u) => {
          if (u.includes("character/?character_id=")) return { character_list: [
            { character_id: "3", faction_id: "1", w: { world_id: "1" } },
            { character_id: "4", faction_id: "3", w: { world_id: "1" } } ] };
          if (u.includes("characters_event/")) {
            eventCalls++;
            const m = /[?&]before=([0-9]+)/.exec(u);
            const before = m ? Number(m[1]) : Infinity;
            return { characters_event_list: rows.filter((e) => e.timestamp < before).slice(0, 1000) };
          }
          return { error: "stub" };
        };
        const panel = mountDuels(s, { getJson, baseOf: () => "https://x/get/ps2:v2/", catalog: async () => null });
        panel.setPlayers([{ cid: "3", display: "botWaz", rows: [{ name: "Sabin3r", kills: 40, deaths: 27, kpm: 1 }] }, { cid: "4", display: "Sabin3r" }]);
        let done = null;
        for (let i = 0; i < 60 && !done; i++) {
          await sleep(100);
          if (summary().includes("40 – 27")) done = { sum: summary(), count: s.querySelector(".duel-count").textContent, eventCalls };
        }
        return done;
      })()`);
      assert.ok(r, "reopened pair completes to the full split");
      assert.equal(r.eventCalls, 3, "one newer check plus two pages back from the saved cursor");
      assert.match(r.sum, /botWaz 40 – 27 Sabin3r/, "summary is the full killboard split");
      assert.equal(r.count, "(67)", "count is all 67 kills");
    });
  });
});

describe("🤺 duels panel: luck from the killboard totals while the kills are still loading (owner 2026-11-09)", () => {
  it("history ends at 6 kills, killboard says 67: luck shows from the killboard, Glicko still waits", { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
    await withPage(async ({ ev, nav }) => {
      await nav("index.html");
      const r = await ev(`(async () => {
        ${fixture}
        const { mountDuels } = await import("/duels-panel.mjs");
        const t0 = Math.floor(Date.now() / 1000) - 100;
        const pid = "1", qid = "2";
        // One short page, always: 4 kills by botWaz, 2 by Sabin3r, plus filler. That is the whole history.
        const page = [];
        for (let i = 0; i < 10; i++) {
          const ts = t0 - i;
          if (i < 4) page.push({ timestamp: ts, table_type: "kills", character_id: qid, attacker_character_id: pid, attacker_weapon_id: "1", is_headshot: "0", zone_id: "2", attacker_loadout_id: "10", character_loadout_id: "17", attacker_vehicle_id: "0" });
          else if (i < 6) page.push({ timestamp: ts, table_type: "deaths", character_id: pid, attacker_character_id: qid, attacker_weapon_id: "1", is_headshot: "0", zone_id: "2", attacker_loadout_id: "17", character_loadout_id: "10", attacker_vehicle_id: "0" });
          else page.push({ timestamp: ts, table_type: "kills", character_id: "9", attacker_character_id: pid, attacker_weapon_id: "1", is_headshot: "0", zone_id: "2", attacker_loadout_id: "10", character_loadout_id: "17", attacker_vehicle_id: "0" });
        }
        let eventCalls = 0;
        const getJson = async (u) => {
          if (u.includes("character/?character_id=")) return { character_list: [
            { character_id: "1", faction_id: "1", w: { world_id: "1" } },
            { character_id: "2", faction_id: "3", w: { world_id: "1" } } ] };
          if (u.includes("characters_event/")) { eventCalls++; return { characters_event_list: page }; }
          return { error: "stub" };
        };
        const panel = mountDuels(s, { getJson, baseOf: () => "https://x/get/ps2:v2/", catalog: async () => null });
        panel.setPlayers([{ cid: "1", display: "botWaz", rows: [{ name: "Sabin3r", kills: 40, deaths: 27, kpm: 1 }] }, { cid: "2", display: "Sabin3r" }]);
        let done = null;
        for (let i = 0; i < 120 && !done; i++) {
          await sleep(100);
          if (summary().includes("4 – 2") && s.querySelector(".duel-cmp").textContent.includes("vs expected")) done = {
            sum: summary(), st: status(), count: s.querySelector(".duel-count").textContent,
            cmp: s.querySelector(".duel-cmp").textContent,
            luckTitle: (s.querySelector("tr.duel-luck th") || {}).title || "", eventCalls,
          };
        }
        return done;
      })()`);
      assert.ok(r, "pair settles with 6 loaded kills and the luck row");
      assert.equal(r.eventCalls, 2, "short page plus its corroborating retry, then history is done");
      assert.match(r.sum, /botWaz 4 – 2 Sabin3r/, "table shows only the 6 loaded kills");
      assert.equal(r.count, "(6)", "count is the loaded kills");
      assert.match(r.st, /Whole history read/, "history is done, nothing more to fetch");
      assert.match(r.cmp, /🎲 vs expected/, "luck row shows");
      assert.match(r.cmp, /as expected/, "killboard 40–27 reads as expected against the near-even iVi");
      assert.doesNotMatch(r.cmp, /too few kills/, "no 'too few kills' — the killboard totals carry the verdict");
      assert.match(r.cmp, /too few infantry kills/, "Glicko still waits: it cannot run on totals, only on loaded kills");
      assert.match(r.luckTitle, /killboard totals/, "luck hover says the verdict comes from the killboard totals");
    });
  });
});
