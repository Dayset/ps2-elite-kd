// 🧘 Pure graph view (owner 2026-10-29): the skill graph's third view — one
// solid line anchored to 🧘‍♂️ Pure iVi plus one dashed line with every point
// dropped by the 🪳 charge, the dashed drawn thicker so it carries the focus.
// Unknown 🪳 draws nothing (never an unscaled line standing in for a Pure one).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { anchorScale } from "../chart.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("anchorScale: slider percentile lands exactly on the target", () => {
  near(anchorScale([1, 2, 3], 600, 50), 300);
  near(anchorScale([1, 2, 3], 600, 100), 200);
  near(anchorScale([1, 2, 3], 600, 0), 600, 1e-6);
  near(anchorScale([1, 2, 3, 4], 1000, 50), 400);
  near(anchorScale([5], 500, 50), 100);
  assert.equal(anchorScale([1, 2, 3], 600, 50) * 2, 600);
});

test("anchorScale: nothing sane to anchor to → null", () => {
  assert.equal(anchorScale([], 600, 50), null);
  assert.equal(anchorScale([1, 2, 3], 0, 50), null);
  assert.equal(anchorScale([1, 2, 3], -5, 50), null);
  assert.equal(anchorScale([1, 2, 3], NaN, 50), null);
  assert.equal(anchorScale([0, 0], 600, 50), null);
});

test("chart: pure branch anchors like ivi, and omits unknown 🪳 outright", () => {
  const src = read("chart.mjs");
  assert.ok(src.includes('$.yScaleMode === "pure"'), "pure mode branch exists");
  assert.ok(src.includes("anchorScale(sorted, ivi, $.yScalePct)"), "ivi mode kept its anchor (refactor did not change it)");
  assert.ok(src.includes("anchorScale(sorted, g.pure, $.yScalePct)"), "pure mode anchors to Pure iVi");
  assert.ok(src.includes("if (!g || !isFiniteNum(g.pure) || g.pure <= 0) return []"), "unknown 🪳 or Pure iVi ≤ 0 draws nothing");
  assert.ok(src.includes("function pureScalePoints(p)"), "dashed companion exists");
  assert.ok(src.includes("1 - PURE_IVI_CHARGE.RATE * g.zerg"), "dashed line drops every point by the charge");
  assert.ok(src.includes('dpath.setAttribute("stroke-dasharray", "5 4")'), "companion is dashed");
  assert.ok(src.includes('stroke-width", lightLines ? "1.6" : "1.4"'), "dashed drawn thicker than the solid");
  assert.ok(src.includes('tr("chart.ylabPure"'), "pure Y label key");
  assert.ok(src.includes('getElementById("chartPureNote")') && src.includes('tr("chart.pureHidden"'), "hidden-players note");
  assert.ok(src.includes("function pureAvailable()"), "bar/flip availability helper");
  assert.ok(src.includes('querySelector(\'[data-yscale="pure-btn"]\')'), "pure button wired in UI sync");
});

test("chart: Y fit includes the dashed companion so it never clips", () => {
  const src = read("chart.mjs");
  assert.ok(src.includes("pureScaleByPlayer"), "per-player scale lines computed on draw");
  assert.ok(src.includes("for (const pts of validScaleCurves) for (const pt of pts) yvals.push(pt.kd)"), "scale levels join the Y fit");
});

test("chart: mode bar re-syncs on every draw, so the 🧘 button appears after analysis", () => {
  const src = read("chart.mjs");
  const draw = src.slice(src.indexOf("function drawChart("), src.indexOf("function drawGhostRuns("));
  assert.ok(draw.includes("syncChartModeUi();"), "drawChart re-syncs the mode bar (setup-time sync alone leaves the button hidden)");
});

test("app: flip is 💀 ⇄ 🧘, gated on a usable Pure value, 🎯 stays off", () => {
  const src = read("app.js");
  assert.ok(src.includes('setYScaleMode(yScaleMode === "pure" ? "kd" : "pure")'), "flip cycles kd ⇄ pure");
  assert.ok(!src.includes('? "ivi" : "kd"'), "no kd ⇄ ivi flip left");
  assert.ok(src.includes("const pureAvailable = ()"), "availability helper defined");
  assert.ok(src.includes("if (!pureAvailable()) return;"), "flip + wheel gated");
  assert.ok(src.includes("canStart: () => pureAvailable()"), "drag gated");
  assert.ok(src.includes('pick === "skill" && pureAvailable()'), "keys gated");
  assert.ok(src.includes('querySelector(\'[data-yscale="pure-btn"]\')'), "pure button click handler");
  assert.ok(src.includes("setYScaleMode(yScaleMode, v);"), "slider keeps the current scale");
  assert.ok(src.includes('setYScaleMode("kd")') && src.includes('setYScaleMode("pure")'), "buttons select their mode outright");
});

test("wave: ivi still needs AIM_VIEW, pure does not", () => {
  const src = read("chart-wave.mjs");
  assert.ok(src.includes('(mode === "ivi" && !$.AIM_VIEW) ? "kd" : mode'), "only ivi is forced to kd while the 🎯 view is off");
  assert.ok(!src.includes('$.yScaleMode = $.AIM_VIEW ? mode : "kd"'), "old blanket gate gone");
});

test("stats lookup: graph reads the table's own values, never a 0", () => {
  const src = read("stats-table.mjs");
  assert.ok(src.includes("function pureGraphFor(display)"), "lookup defined");
  assert.ok(src.includes("pureGraphFor,") || src.includes("pureGraphFor }"), "lookup exposed");
  assert.ok(src.includes("$.lastStatsList"), "lookup reads the rendered stats rows");
  assert.ok(src.includes("if (!display || $.IS_PS) return null"), "PC only, no display → no value");
});

test("html + i18n: 🧘 button, note slot, keys with the {names} placeholder", () => {
  const html = read("index.html");
  assert.ok(html.includes('data-yscale="pure-btn"'), "pure button in the mode bar");
  assert.ok(html.includes('data-i18n-title="chart.modePure"') && html.includes('data-i18n-tip="chart.modePureTip"'), "button keys");
  assert.ok(html.includes('id="chartPureNote"'), "note slot in the chart row");
  const pureBtn = html.slice(html.indexOf('data-yscale="pure-btn"') - 200, html.indexOf('data-yscale="pure-btn"') + 400);
  assert.ok(!pureBtn.includes("Muse's"), "no solo credit in the button");
  const en = JSON.parse(read("i18n/en.json"));
  for (const k of ["chart.modePure", "chart.modePureTip", "chart.ylabPure", "chart.pureHidden"]) assert.ok(en[k], `${k} in en.json`);
  assert.ok(en["chart.pureHidden"].includes("{names}"), "hidden note carries the names placeholder");
});

test("one module = one ?v= tag across all importers", () => {
  const tag = (mod, files) => {
    const found = new Set();
    for (const f of files) {
      for (const m of read(f).matchAll(new RegExp(`${mod.replace(".", "\\.")}\\?v=([A-Za-z0-9_.-]+)`, "g"))) found.add(m[1]);
    }
    return found;
  };
  const appFiles = ["app.js"];
  assert.equal(tag("chart.mjs", appFiles).size, 1); // one tag; later bumps (e.g. t781 ⛑️) need not edit this test
  assert.equal(tag("stats-table.mjs", appFiles).size, 1);
  assert.deepEqual([...tag("chart-wave.mjs", appFiles)], ["20261029-puregraph1"]);
  assert.deepEqual([...tag("pure-ivi.mjs", ["app.js", "stats-table.mjs", "rankings.mjs", "chart.mjs"])], ["20261029-purevis1"]);
  const htmlTag = (f) => [...read(f).matchAll(/app\.js\?v=([A-Za-z0-9_.-]+)/g)].map((m) => m[1]);
  // t765u: app.js tag moves on with later work; both pages must just agree on one tag.
  assert.equal(htmlTag("index.html").length, 1);
  assert.deepEqual(htmlTag("live.html"), htmlTag("index.html"));
});

test("#86: graph lookup finds PLAYERS in lastStatsList (not rows)", async () => {
  const { findPlayerByDisplay } = await import("../stats-table.mjs");
  const list = [{ display: "[TAG] ShloDog" }, { name: "JustV6me" }];
  assert.equal(findPlayerByDisplay(list, "shlodog"), list[0]);
  assert.equal(findPlayerByDisplay(list, "[X] JustV6me"), list[1]);
  assert.equal(findPlayerByDisplay(list, "nobody"), null);
  assert.equal(findPlayerByDisplay(null, "shlodog"), null);
  const src = read("stats-table.mjs");
  assert.ok(src.includes("findPlayerByDisplay($.lastStatsList, display)"), "pureGraphFor uses the player lookup");
});

test("#86: an empty mode bar is display: none (not a dot), and the table re-syncs it", () => {
  assert.ok(read("chart.mjs").includes('$.els.chartModeBar.style.display = show ? "" : "none";'));
  const st = read("stats-table.mjs");
  const at = st.indexOf("$.lastStatsList = list;");
  assert.ok(at > 0 && st.slice(at, at + 300).includes("$.syncChartModeUi()"), "renderStatsTable re-syncs the bar");
  assert.ok(read("app.js").includes("get syncChartModeUi() { return syncChartModeUi; }, // #86"));
});

test("pure dashed: anchored like the solid, then dropped by the charge (owner 2026-10-29)", async () => {
  const { createChart } = await import("../chart.mjs");
  const curve = [];
  for (let i = 0; i <= 8; i++) curve.push({ kpm: i * 0.25, kd: 0.5 + i * 0.2, deaths: 50, n: 10 });
  const p = { display: "Test", own_kpm: 1.0, curve };
  const $ = { chartMode: "smooth", yScaleMode: "pure", yScalePct: 50, pureGraphFor: () => ({ pure: 1000, zerg: 50 }) };
  const chart = createChart($);
  const solid = chart.chartPoints(p);
  const dashed = chart.pureScalePoints(p);
  const factor = 1 - 0.00436 * 50;
  assert.equal(dashed.length, solid.length, "same points");
  for (let i = 0; i < solid.length; i++) {
    if (!solid[i].valid) continue;
    assert.ok(Math.abs(dashed[i].kd - solid[i].kd * factor) < 1e-9, `point ${i}: dashed = solid × charge`);
    assert.ok(dashed[i].kd < solid[i].kd, "dashed sits under the solid");
  }
  // Unknown 🪳 or unusable Pure → no dashed at all, like the solid.
  const $noZerg = { ...$, pureGraphFor: () => ({ pure: 1000, zerg: null }) };
  assert.deepEqual(createChart($noZerg).pureScalePoints(p), [], "unknown zerg → no dashed");
  const $noPure = { ...$, pureGraphFor: () => ({ pure: 0, zerg: 50 }) };
  assert.deepEqual(createChart($noPure).pureScalePoints(p), [], "pure ≤ 0 → no dashed");
});
