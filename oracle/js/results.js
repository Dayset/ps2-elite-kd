// PS2MapOracle dashboard — split from index.html (#15). No behaviour change.
import { S, FACS, esc, $, when, info, wide } from "./state.js?v=20261018-scrub2";
import { get } from "./api.js?v=20261018-scrub2";
import { t as tr } from "../../i18n.mjs";

// Benchmark slices recorded for one alert, with Brier once it settled.
export function benchPanel(a) {
  if (S.ticksFor !== a.key || !S.benchFor || !S.benchFor.slices) return "";
  const sl = S.benchFor.slices, br = S.benchFor.brier || {};
  const keys = Object.keys(sl).filter((k) => !k.endsWith("_pop"));
  Object.keys(sl).forEach((k) => { if (k.endsWith("_pop") && !(k.slice(0, -4) in sl)) keys.push(k); });
  const row = (k, label) => { const p = sl[k] || {}; return `<tr><td>${esc(label)}</td>${FACS.map((f) => `<td class="num ${f}">${p[f] != null ? Math.round(p[f] * 1000) / 10 + "%" : "—"}</td>`).join("")}<td class="num">${br[k] != null ? (+br[k]).toFixed(3) : "—"}</td></tr>`; };
  const rows = keys.map((k) => row(k, k.endsWith("_pop") ? tr("or.withPop", "{k} with pop", { k: k.slice(0, -4) }) : k) + (sl[k + "_pop"] ? row(k + "_pop", tr("or.withPop", "{k} with pop", { k })) : "")).join("");
  if (!rows) return "";
  return `<section class="card" style="margin-top:14px"><h2 data-sec="benchmark-slices">${tr("or.h.bench", "Benchmark slices")}</h2><div class="scroll"><table class="slices"><thead><tr><th>${tr("or.slice", "Slice")}</th><th>VS</th><th>NC</th><th>TR</th><th>Brier</th></tr></thead><tbody>${rows}</tbody></table></div>${info("bnote", `<div class="note">${tr("or.benchNote", "Win chance recorded at each slice; Brier against the Census winner (lower is better, coin-flip 0.222).")}</div>`)}</section>`;
}

// Benchmark: keys ending in _pop are the population-weighted variant of the same slice.
function benchLine(sl) {
  const cell = (v) => `<b>${v.brier.toFixed(3)}</b> <span class="note">n=${v.n}</span>`;
  const keys = Object.keys(sl), out = [];
  for (const k of keys) {
    if (k.endsWith("_pop")) { if (!(k.slice(0, -4) in sl)) out.push(`${tr("or.withPop", "{k} with pop", { k: esc(k.slice(0, -4)) })} ${cell(sl[k])}`); continue; }
    const pop = sl[k + "_pop"];
    out.push(`${esc(k)} ${cell(sl[k])}${pop ? ` <span class="note">/ ${tr("or.withPopShort", "with pop")}</span> ${cell(pop)}` : ""}`);
  }
  return out.join(" · ");
}

const HIST_MAX_WIDE = 40, HIST_MAX_PHONE = 10;   // phone: shorter card list (#16)
export function renderHist() {
  const HIST_MAX = wide() ? HIST_MAX_WIDE : HIST_MAX_PHONE;
  const list = S.histAll ? S.histRows : S.histRows.slice(0, HIST_MAX);
  const rows = list.map((a) => `<tr data-k="${esc(a.key)}" tabindex="0" role="button" aria-label="${tr("or.openAlert", "Open {a} alert", { a: `${esc(a.world_name)} ${esc(a.zone_name)}` })}"><td class="hend">${a.end_ts ? when(a.end_ts) : "—"}</td><td class="hsrv">${esc(a.world_name)}</td><td class="hzone">${esc(a.zone_name)}${a.kind === "meltdown" ? `<span class="melt">${tr("or.meltdown", "Meltdown")}</span>` : ""}</td>
      <td class="num hlen">${a.dur ? tr("or.nMin", "{n} min", { n: esc(a.dur) }) : "—"}</td>
      <td class="hwin">${a.winner ? `<b class="${a.winner}">${a.winner}</b>` : esc(a.status === "unresolved" ? tr("or.badge.unresolved", "unresolved") : a.status)}</td>
      <td class="num hfin">${a.final ? FACS.map((f) => (+a.final[f]).toFixed(1)).join(" / ") : "—"}</td>
      <td class="hbas">${a.basis === "sudden_death" ? tr("or.st.sd", "sudden death") : a.basis === "snapshot" ? tr("or.basisSnap", "map snapshot") : a.basis ? tr("or.basisFinal", "Census final") : ""}</td>
      <td class="flag">${a.report && a.report.flagged ? `${a.report.confirmed ? `☠️${a.report.confirmed} ` : ""}${a.report.flagged - a.report.confirmed ? `⚠️${a.report.flagged - a.report.confirmed} ` : ""}` : ""}${(a.flags || []).map((f) => esc(f.replace(/_/g, " "))).join(", ")}</td></tr>`);
  $("hist").querySelector("tbody").innerHTML = rows.join("") || `<tr><td colspan="8" class="note">${tr("or.noHist", "No settled alerts yet.")}</td></tr>`;
  const more = $("histMore");
  more.hidden = S.histAll || S.histRows.length <= HIST_MAX;
  more.textContent = tr("or.showMore", "Show more ({n})", { n: S.histRows.length - HIST_MAX });
}
export function initResults() {
  $("histMore").onclick = () => { S.histAll = true; renderHist(); };
  const histBody = $("hist").querySelector("tbody");
  histBody.addEventListener("click", (e) => { const tr = e.target.closest("tr[data-k]"); if (tr && !e.target.closest("a")) S.hooks.openAlert(tr.dataset.k); });
  histBody.addEventListener("keydown", (e) => { const tr = e.target.closest("tr[data-k]"); if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); S.hooks.openAlert(tr.dataset.k); } });
}
export async function refreshHistory() {
  try {
    const h = await get("/history?days=7");
    const b = h.benchmark || {};
    $("bench").innerHTML = Object.entries(b).map(([dur, sl]) => `<div>${tr("or.brierDur", "{n}-min Brier:", { n: dur })} ${benchLine(sl)}</div>`).join("") +
      (Object.keys(b).length ? `<div class="note">${tr("or.lowerBetter", "lower is better · coin-flip = {n}", { n: h.uniform })}</div>` : "");
    S.histRows = h.alerts || [];
    renderHist();
  } catch {
    if (!S.histRows.length) $("hist").querySelector("tbody").innerHTML = `<tr><td colspan="8" class="note">${tr("or.histErr", "Results are unavailable right now — retrying…")}</td></tr>`;
  }
}
