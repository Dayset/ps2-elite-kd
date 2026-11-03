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

describe("🤺 duels panel: replay links (#102)", () => {
  it("pair summary + crowd rows link to replay/?name=A&vs=B; PS hides them", { skip: !chrome && "no Chrome", timeout: 120000 }, async () => {
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
        let pairLink = null;
        for (let i = 0; i < 60 && !pairLink; i++) { await sleep(100); const a = s.querySelector(".duel-summary a.replay-link"); if (a) pairLink = { href: a.getAttribute("href"), text: a.textContent }; }
        panel.setPlayers([{ cid: "1", display: "Alice", rows: [{ name: "Bob", kills: 5, deaths: 3 }, { name: "Carol", kills: 2, deaths: 7 }] }]);
        let crowdLinks = [];
        for (let i = 0; i < 60 && crowdLinks.length < 2; i++) { await sleep(100); crowdLinks = [...s.querySelectorAll(".duel-table tbody a.replay-link")].map(a => a.getAttribute("href")); }
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
        return { pairLink, crowdLinks, psPairLinks, psCrowdLinks };
      })()`);
      assert.equal(r.pairLink.href, "replay/?name=Alice&vs=Bob");
      assert.match(r.pairLink.text, /Replay this duel/);
      assert.deepEqual(r.crowdLinks.sort(), ["replay/?name=Alice&vs=Bob", "replay/?name=Alice&vs=Carol"]);
      assert.equal(r.psPairLinks, 0, "PS hides the pair link");
      assert.equal(r.psCrowdLinks, 0, "PS hides the crowd links");
    });
  });
});
