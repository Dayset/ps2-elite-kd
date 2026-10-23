// t356u (was t314u): one page — Rankings ✅ ticks ARE the names box chips:
// a tick adds a chip (graph + ?names= follow), removing a chip unticks.
// t313u: main page shared desktop content width (static check).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { rankingsSource } from "./rankings-src.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

describe("main page desktop width (t313u)", () => {
  it("one shared width from the graph's 68vh height cap, main page only", () => {
    const css = read("styles.css");
    assert.match(read("index.html"), /<body class="main-page">/);
    // #29: the width is the shared --page-w token (site-layout.css), same math as before.
    assert.match(css, /^@import url\("site-layout\.css/);
    assert.match(read("site-layout.css"), /--page-w: calc\(68vh \* 1000 \/ 564 \+ 0\.5 \* var\(--site-root\) \+ 2px \+ 2 \* var\(--page-gutter\)\);/);
    assert.match(css, /body\.main-page, body\.site-page \{\s*--desk-w: calc\(var\(--page-w\) - 2 \* var\(--page-gutter\)\);\s*max-width: var\(--page-w\);/);
    assert.match(css, /body\.main-page \.chart-wrap \{ max-width: none; \}/);
    const i = css.indexOf("body.main-page, body.site-page {");
    assert.ok(css.lastIndexOf("@media (min-width: 1400px)", i) > css.lastIndexOf("}\n}", i) - 400, "inside the ≥1400px block");
  });
});

describe("Rankings ✅ ↔ names box (t356u)", () => {
  it("static wiring", () => {
    const s = rankingsSource();
    assert.doesNotMatch(s, /id="ranksPickBox"|id="ranksChips"|id="ranksCompare"|id="backLink"/);
    assert.match(s, /host\.toggleName\(q, inp, want\)/);
    // t376u: still syncs the Rankings, but on the next frame so the chip paints first.
    assert.match(read("app.js"), /function rankingsSync\(\) \{(?=[\s\S]{0,500}?rankingsApi\.syncPicks\(\))(?=[\s\S]{0,500}?requestAnimationFrame)/);
  });

  const chrome = ["google-chrome", "chromium", "chromium-browser", "google-chrome-stable"].find((b) => {
    try { execFileSync("which", [b], { stdio: "ignore" }); return true; } catch { return false; }
  });

  it("tick → chip + graph + ?names=, chip × → untick", { skip: !chrome && "no Chrome installed", timeout: 90000 }, async () => {
    const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css" };
    const server = http.createServer((req, res) => {
      const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
      if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
      fs.createReadStream(p).pipe(res);
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    const proc = spawn(chrome, [...(process.env.HEADFUL ? [] : ["--headless=new"]), "--no-sandbox", "--disable-gpu", "--remote-debugging-pipe", "--user-data-dir=" + fs.mkdtempSync("/tmp/ranks-chips-"), "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
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
      // t358u: the table is folded by default — open it so rows render.
      // t371u: the default ⚔️ iVi sort groups rows into collapsed tiers — open the
      // first tier so its data rows appear.
      await send("Page.navigate", { url: `http://127.0.0.1:${port}/index.html#rankings` }, sessionId);
      await ev(`new Promise(async (r) => { for (let t = 0; t < 200; t++) { const d = document.getElementById("ranksTableSection"); if (d) { d.open = true; return r(1); } await new Promise((q) => setTimeout(q, 50)); } r(0); })`);
      await ev(`new Promise(async (r) => { for (let t = 0; t < 200; t++) { const b = document.querySelector("#ranksBody tr.rk-tier .rk-tier-btn"); if (b) { b.click(); return r(1); } await new Promise((q) => setTimeout(q, 50)); } r(0); })`);
      const [q0, q1, q2] = await ev(`new Promise(async (r) => { for (let t = 0; t < 400 && document.querySelectorAll("#ranksBody tr[data-q]").length < 3; t++) await new Promise((q) => setTimeout(q, 50)); r([...document.querySelectorAll("#ranksBody tr[data-q]")].slice(0, 3).map((t) => t.dataset.q)); })`);
      assert.equal(new Set([q0, q1, q2]).size, 3);
      // Tick two checkboxes directly (the ?names= URL flow doesn't reliably
      // render chips in the test environment; the checkbox→chip path is what
      // this test verifies).
      const tick = (q) => ev(`(() => { const cb = document.querySelector('#ranksBody tr[data-q="' + CSS.escape(${JSON.stringify(q)}) + '"] input[type="checkbox"]'); if (!cb) return 0; cb.click(); return 1; })()`);
      assert.equal(await tick(q0), 1, "q0 checkbox found");
      assert.equal(await tick(q1), 1, "q1 checkbox found");
      await ev(`new Promise(async (r) => { for (let t = 0; t < 200 && document.querySelectorAll("#nameTokens .name-token").length < 2; t++) await new Promise((q) => setTimeout(q, 50)); r(1); })`);
      const settle = () => new Promise((r) => setTimeout(r, 900));
      const state = () => ev(`({ chips: [...document.querySelectorAll("#nameTokens .name-token")].map((b) => { const c = b.cloneNode(true); c.querySelector(".name-token-num")?.remove(); return c.textContent.trim().toLowerCase(); }), names: (new URL(location.href).searchParams.get("names") || "").toLowerCase(), stats: document.querySelectorAll('#statsPanel th[scope="row"].stats-name').length, checked: [...document.querySelectorAll('#ranksBody input[type="checkbox"]:checked')].map((c) => c.closest("tr").dataset.q) })`);
      const lc = (a) => a.map((x) => String(x).toLowerCase());
      let s = await state();
      assert.deepEqual(s.chips.sort(), lc([q0, q1]).sort(), "tick → chips");
      assert.deepEqual(s.checked.sort(), [q0, q1].sort(), "chips → ✅");
      // Tick a third player in the table → chip appears, graph + URL follow (no Analyze).
      await ev(`(() => { const cb = document.querySelector('#ranksBody tr[data-q="' + CSS.escape(${JSON.stringify(q2)}) + '"] input[type="checkbox"]'); cb.click(); return 1; })()`);
      await settle();
      s = await state();
      assert.deepEqual(s.chips.sort(), lc([q0, q1, q2]).sort());
      assert.equal(s.stats, 3, "graph follows the tick");
      assert.equal(s.names, lc([q0, q1, q2]).join(","));
      // Untick it in the table → chip goes.
      await ev(`document.querySelector('#ranksBody tr[data-q="' + CSS.escape(${JSON.stringify(q2)}) + '"] input[type="checkbox"]').click(), 1`);
      await settle();
      s = await state();
      assert.deepEqual(s.chips.sort(), lc([q0, q1]).sort());
      assert.equal(s.stats, 2);
      // Remove the first chip in the names box → unticked in the table.
      await ev(`[...document.querySelectorAll("#nameTokens .name-token")][0].click(), 1`);
      await settle();
      s = await state();
      assert.deepEqual(s.chips, lc([q1]));
      assert.deepEqual(s.checked, [q1]);
      assert.equal(s.names, lc([q1]).join(","));
    } finally {
      proc.kill("SIGKILL");
      server.close();
    }
  });
});

describe("Hide adjusted-iVi ≤ 0 players (footer checkbox)", () => {
  it("checkbox under the debug box; table browse hides, name search still finds", () => {
    const index = read("index.html");
    const dbgAt = index.indexOf('id="debugColsToggle"');
    const hideAt = index.indexOf('id="hideZeroIviToggle"');
    assert.ok(dbgAt >= 0 && hideAt > dbgAt, "hide checkbox sits under the debug checkbox");
    assert.match(index, /hide players with adjusted iVi ≤ 0/);
    const s = rankingsSource();
    assert.match(s, /LS_HIDE_ZERO_IVI = "ps2-elite-kd-hide-zero-ivi"/);
    // Browse filter: a name query skips the drop (search finds them), otherwise
    // rows with a real adjusted iVi ≤ 0 are left out of the table list.
    assert.match(s, /if \(hideZeroIvi\) \{/);
    assert.match(s, /!\(fin\(r\.adjs\) && r\.adjs <= 0\)/);
    assert.match(read("app.js"), /hideZeroIviToggle/);
    assert.match(read("app.js"), /LS_HIDE_ZERO_IVI/);
  });
});

describe("Skill graph section: no placeholder, collapsible, pops on analyze (owner 2026-10-22)", () => {
  it("placeholder gone; graph lives in a folded-by-default details section", () => {
    const index = read("index.html");
    assert.doesNotMatch(index, /id="chartPlaceholder"/);
    assert.doesNotMatch(index, /id="phAnalyzeBtn"/);
    assert.doesNotMatch(index, /chart-placeholder/);
    assert.match(index, /<details id="chartSection" class="dist-section chart-section" hidden>/);
    assert.doesNotMatch(index, /<details id="chartSection"[^>]*\sopen[\s>]/);
    assert.match(index, /data-i18n="chart\.title"/);
    assert.match(index, /id="chartSectionNames"/);
    assert.match(read("i18n/en.json"), /"chart\.title": "📈 Skill graph"/);
  });

  it("draw pops the section open on a new analysis; idle folds it; app.js has no placeholder code left", () => {
    const app = read("app.js");
    assert.doesNotMatch(app, /chartPlaceholder|setPlaceholderVisible|phAnalyzeBtn|analyzeFromPlaceholder/);
    assert.match(app, /function popChartSection\(list\)/);
    assert.match(app, /sec\.open = true/);
    assert.match(app, /popChartSection\(list\)/);
    assert.match(app, /function foldChartSection\(\)/);
    assert.match(app, /foldChartSection\(\)/);
    // A fresh Analyze re-pops even the same names (analyze sequence guard).
    assert.match(app, /analyzeSeq \+= 1/);
    assert.match(app, /analyzeSeq !== prevSeq/);
  });

  it("Distribution block carries a title on PC, bare 📊 on phones (owner 2026-10-22)", () => {
    const index = read("index.html");
    const css = read("styles.css");
    assert.match(index, /<span class="dist-title" data-i18n="ranks\.distribution">Distribution<\/span>/);
    assert.match(css, /\.dist-title \{ display: none; \}/);
    assert.match(css, /@media \(hover: hover\) and \(pointer: fine\) and \(min-width: 761px\) \{\s*\.dist-title \{ display: inline; \}/);
  });

  it("both player boxes are unavailable while nothing is graphed (owner 2026-10-22)", () => {
    const app = read("app.js");
    const index = read("index.html");
    // The graph box starts hidden in the markup (no empty frame to open)…
    assert.match(index, /<details id="chartSection"[^>]*\shidden>/);
    // …and the idle state keeps it hidden; drawing a graph reveals it.
    assert.match(app, /els\.chartSection\.setAttribute\("hidden", ""\)/);
    assert.match(app, /els\.chartSection\.removeAttribute\("hidden"\)/);
    // Going idle also empties the 🏆 weapons box (one-player box).
    assert.match(app, /syncWeapons\(\[\]\); \/\/ 🏆 one-player box: unavailable while nothing is graphed/);
    assert.match(index, /<details id="weaponsSection"[^>]*\shidden>/);
  });

  it("deleting names never springs the section open; adding one still pops (owner 2026-10-22)", () => {
    const app = read("app.js");
    // Header/bookkeeping sync without opening, used on removal redraws.
    assert.match(app, /function syncChartSectionNames\(list\)/);
    assert.match(app, /else syncChartSectionNames\(list\);/);
    // The chip-follow redraw pops only when the set gained a name.
    assert.match(app, /const hasNew = names\.some\(\(n\) => !prevKeys\.has\(slugKey\(n\)\)\);/);
    assert.match(app, /drawChart\(players, \{ pop: hasNew \}\);/);
  });

  it("default name + empty-box dice draw from the top five tiers only (both rooms)", () => {
    const app = read("app.js");
    assert.match(app, /function topTierFloorAdjs\(\)/);
    assert.match(app, /let DEFAULT_PLACEHOLDER_NAME = "";/);
    assert.doesNotMatch(app, /DEFAULT_PLACEHOLDER_NAME = IS_PS/);
    // Default picker: random pick from rows at/above the floor.
    assert.match(app, /r\[iA\] >= floor/);
    assert.match(app, /pool\[Math\.floor\(Math\.random\(\) \* pool\.length\)\]/);
    // Dice on an empty box: same floor on the cached-values pool.
    assert.match(app, /v\.adjs >= floor/);
  });
});

describe("Max account age cut (Settings stepper, owner 2026-10-22)", () => {
  it("one-line settings row: − / + steppers around a whole-months input", () => {
    const index = read("index.html");
    const themeAt = index.indexOf('id="themeToggle"');
    const ageAt = index.indexOf('id="maxAgeInput"');
    const wipeAt = index.indexOf('id="wipeLocalBtn"');
    assert.ok(themeAt >= 0 && ageAt > themeAt && wipeAt > ageAt, "age row sits between Theme and Clear local data");
    assert.match(index, /id="maxAgeMinus"/);
    assert.match(index, /id="maxAgePlus"/);
    assert.match(index, /id="maxAgeInput" type="number" class="age-input" min="0" step="1"/);
    assert.match(index, /data-i18n="age\.label"/);
    assert.match(read("i18n/en.json"), /"age\.label": "Max account age"/);
  });

  it("shared saved key; browse drops accounts older than the value, search keeps them", () => {
    const s = rankingsSource();
    assert.match(s, /LS_MAX_AGE_MONTHS = "ps2-elite-kd-max-age-months"/);
    assert.match(s, /let maxAgeMonths = readMaxAgeMonths\(\)/);
    assert.match(s, /if \(maxAgeMonths\) \{/);
    assert.match(s, /!\(fin\(r\.created\) && r\.created > 0 && r\.created < cutoff\)/);
    // First-ship decimal-years values convert ×12 in the reader too.
    assert.match(s, /Math\.round\(yrs \* 12\)/);
    const app = read("app.js");
    assert.match(app, /LS_MAX_AGE_MONTHS = "ps2-elite-kd-max-age-months"/);
    // Steppers: 1 month per step, press-and-hold repeats (accelerating).
    assert.match(app, /holdStep\(els\.maxAgeMinus, -1\)/);
    assert.match(app, /holdStep\(els\.maxAgePlus, 1\)/);
    assert.match(app, /addEventListener\("pointerdown"/);
    assert.match(app, /setTimeout\(tick, 400\)/);
    // 0 = max age (Dayset 2026-10-22): clamps to the ceiling, never to 1.
    assert.match(app, /return r <= 0 \? ageCeil\(\) : Math\.min\(ageCeil\(\), r\);/);
  });
});
