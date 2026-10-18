// PS2MapOracle dashboard — split from index.html (#15). No behaviour change.
import { S, FACS, esc, $, when, info, wide } from "./state.js";
import { get } from "./api.js";

// Benchmark slices recorded for one alert, with Brier once it settled.
export function benchPanel(a) {
  if (S.ticksFor !== a.key || !S.benchFor || !S.benchFor.slices) return "";
  const sl = S.benchFor.slices, br = S.benchFor.brier || {};
  const keys = Object.keys(sl).filter((k) => !k.endsWith("_pop"));
  Object.keys(sl).forEach((k) => { if (k.endsWith("_pop") && !(k.slice(0, -4) in sl)) keys.push(k); });
  const row = (k, label) => { const p = sl[k] || {}; return `<tr><td>${esc(label)}</td>${FACS.map((f) => `<td class="num ${f}">${p[f] != null ? Math.round(p[f] * 1000) / 10 + "%" : "—"}</td>`).join("")}<td class="num">${br[k] != null ? (+br[k]).toFixed(3) : "—"}</td></tr>`; };
  const rows = keys.map((k) => row(k, k.endsWith("_pop") ? k.slice(0, -4) + " with pop" : k) + (sl[k + "_pop"] ? row(k + "_pop", k + " with pop") : "")).join("");
  if (!rows) return "";
  return `<section class="card" style="margin-top:14px"><h2>Benchmark slices</h2><div class="scroll"><table class="slices"><thead><tr><th>Slice</th><th>VS</th><th>NC</th><th>TR</th><th>Brier</th></tr></thead><tbody>${rows}</tbody></table></div>${info("bnote", `<div class="note">Win chance recorded at each slice; Brier against the Census winner (lower is better, coin-flip 0.222).</div>`)}</section>`;
}

// Benchmark: keys ending in _pop are the population-weighted variant of the same slice.
function benchLine(sl) {
  const cell = (v) => `<b>${v.brier.toFixed(3)}</b> <span class="note">n=${v.n}</span>`;
  const keys = Object.keys(sl), out = [];
  for (const k of keys) {
    if (k.endsWith("_pop")) { if (!(k.slice(0, -4) in sl)) out.push(`${esc(k.slice(0, -4))} with pop ${cell(sl[k])}`); continue; }
    const pop = sl[k + "_pop"];
    out.push(`${esc(k)} ${cell(sl[k])}${pop ? ` <span class="note">/ with pop</span> ${cell(pop)}` : ""}`);
  }
  return out.join(" · ");
}

const HIST_MAX_WIDE = 40, HIST_MAX_PHONE = 10;   // phone: shorter card list (#16)
export function renderHist() {
  const HIST_MAX = wide() ? HIST_MAX_WIDE : HIST_MAX_PHONE;
  const list = S.histAll ? S.histRows : S.histRows.slice(0, HIST_MAX);
  const rows = list.map((a) => `<tr data-k="${esc(a.key)}" tabindex="0" role="button" aria-label="Open ${esc(a.world_name)} ${esc(a.zone_name)} alert"><td class="hend">${a.end_ts ? when(a.end_ts) : "—"}</td><td class="hsrv">${esc(a.world_name)}</td><td class="hzone">${esc(a.zone_name)}${a.kind === "meltdown" ? '<span class="melt">Meltdown</span>' : ""}</td>
      <td class="num hlen">${a.dur ? esc(a.dur) + " min" : "—"}</td>
      <td class="hwin">${a.winner ? `<b class="${a.winner}">${a.winner}</b>` : esc(a.status)}</td>
      <td class="num hfin">${a.final ? FACS.map((f) => (+a.final[f]).toFixed(1)).join(" / ") : "—"}</td>
      <td class="hbas">${a.basis === "sudden_death" ? "sudden death" : a.basis ? "Census final" : ""}</td>
      <td class="flag">${a.report && a.report.flagged ? `${a.report.confirmed ? `☠️${a.report.confirmed} ` : ""}${a.report.flagged - a.report.confirmed ? `⚠️${a.report.flagged - a.report.confirmed} ` : ""}` : ""}${(a.flags || []).map((f) => esc(f.replace(/_/g, " "))).join(", ")}</td></tr>`);
  $("hist").querySelector("tbody").innerHTML = rows.join("") || '<tr><td colspan="8" class="note">No settled alerts yet.</td></tr>';
  const more = $("histMore");
  more.hidden = S.histAll || S.histRows.length <= HIST_MAX;
  more.textContent = `Show more (${S.histRows.length - HIST_MAX})`;
}
export function initResults() {
  $("histMore").onclick = () => { histAll = true; renderHist(); };
  const histBody = $("hist").querySelector("tbody");
  histBody.addEventListener("click", (e) => { const tr = e.target.closest("tr[data-k]"); if (tr && !e.target.closest("a")) S.hooks.openAlert(tr.dataset.k); });
  histBody.addEventListener("keydown", (e) => { const tr = e.target.closest("tr[data-k]"); if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); S.hooks.openAlert(tr.dataset.k); } });
}
export async function refreshHistory() {
  try {
    const h = await get("/history?days=7");
    const b = h.benchmark || {};
    $("bench").innerHTML = Object.entries(b).map(([dur, sl]) => `<div>${dur}-min Brier: ${benchLine(sl)}</div>`).join("") +
      (Object.keys(b).length ? `<div class="note">lower is better · coin-flip = ${h.uniform}</div>` : "");
    S.histRows = h.alerts || [];
    renderHist();
  } catch {
    if (!S.histRows.length) $("hist").querySelector("tbody").innerHTML = '<tr><td colspan="8" class="note">Results are unavailable right now — retrying…</td></tr>';
  }
}
