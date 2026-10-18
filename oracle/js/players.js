// PS2MapOracle dashboard — split from index.html (#15). No behaviour change.
import { S, FACS, esc, info } from "./state.js";

const radarText = (r) => !r ? "" : !r.stored ? "Radar: no data" : r.mark ? `Radar: ${r.mark}` : r.modelTier ? `Radar: ${r.modelTier}${r.sus != null ? " · Sus " + Math.round(r.sus) : ""}` : `Radar: ${r.label || "not assessed"}`;
export function reportPanel(a) {
  const rep = a.report;
  if (!rep) return a.status === "settled" ? `<section class="card" style="margin-top:14px"><h2>Players</h2><div class="note">Per-player report arrives from Honu a few minutes after the alert ends.</div></section>` : "";
  if (rep.status !== "ok") return `<section class="card" style="margin-top:14px"><h2>Players</h2><div class="note">Waiting for Honu's per-player data (${esc(rep.status)}).</div></section>`;
  const fk = rep.faction ? FACS.map((f) => rep.faction[f] ? `<span class="${f}">${f} KD ${rep.faction[f].kd ?? "–"}</span> <span class="note">(${rep.faction[f].players} ${rep.faction[f].players === 1 ? "player" : "players"})</span>` : "").join(" · ") : "";
  const rows = (S.ticksFor === a.key && S.outliers ? S.outliers : []).map((o) => `<tr><td data-l="">${o.severity === "confirmed" || o.severity === "burst" ? "☠️" : "⚠️"}</td>
    <td class="pn"><span class="${o.faction || ""}">${esc(o.name || o.cid)}</span>${o.outfit ? ` <span class="note">[${esc(o.outfit)}]</span>` : ""}${o.severity === "burst" ? ` <span class="note">burst: ${o.kills} kills in ${o.minutes} min</span>` : ""}</td>
    <td class="num" data-l="K/D">${o.kills}/${o.deaths}</td><td class="num" data-l="KD">${o.kd}</td><td class="num" data-l="KPM">${o.kpm}</td><td class="num" data-l="Time">${o.minutes}m</td>
    <td class="note rad">${esc(radarText(o.radar))}</td>
    <td><a href="https://wt.honu.pw/c/${encodeURIComponent(o.cid)}" target="_blank" rel="noopener">Honu</a> · <a href="https://ps2radar.com/#/player/${encodeURIComponent(o.cid)}" target="_blank" rel="noopener">Radar</a></td></tr>`).join("");
  return `<section class="card" style="margin-top:14px"><h2>Players · ${rep.players} in alert</h2><div class="second">${fk}</div>
    ${rep.flagged ? `<div class="scroll" style="margin-top:8px"><table class="ptable cards"><thead><tr><th></th><th>Player</th><th>K/D</th><th>KD</th><th>KPM</th><th>Time</th><th>Second opinion</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="8" class="note">Loading…</td></tr>'}</tbody></table></div>` : `<div class="note" style="margin-top:6px">No statistical outliers.</div>`}
    ${info("prules", `<div class="note" style="margin-top:6px">⚠️ KD ≥ 5 and ≥ 2 kills/min · ☠️ ≥ 3 kills/min (at least 10 min and 25 kills) · ☠️ burst: ≥ 5 kills/min with ≥ 15 kills in ≥ 2 min (short sessions). A statistical outlier, not an accusation; PS2 Radar is an independent second opinion.</div>`, "rules")}</section>`;
}
