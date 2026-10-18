// PS2MapOracle dashboard — split from index.html (#15). No behaviour change.
import { FACS, esc } from "./state.js";

export function commander(c, ts, now) {
  if (!c || !c.factions) return "";
  const marks = (e) => `${e.heat >= 40 ? ` <span title="hot fight (heat ${e.heat})">🔥</span>` : ""}${e.freezing ? ' <span title="supply line runs through a threatened chokepoint">🥶</span>' : ""}${e.cut_severs ? ` <span title="capturing this cuts off ${e.cut_severs} enemy bases">✂️${e.cut_severs}</span>` : ""}`;
  const prio = (e) => `<span class="note">${e.priority ? `P${e.priority}` : "dead"}</span>`;
  const age = ts ? `<span class="note">updated ${Math.max(0, now - ts)}s ago</span>` : "";
  return `<section class="card cmd" style="margin-top:14px"><h2>AI Commander ${age}</h2><div class="cmdgrid">${FACS.map((f) => {
    const x = c.factions[f]; if (!x) return "";
    if (x.eliminated) return `<div><h3 class="${f}">${f} · eliminated</h3><div class="note">Mathematically out: spoiler plays only (kingmaker below).</div>${(x.kingmaker || []).length ? `<ul>${x.kingmaker.slice(0, 2).map((k) => `<li>${esc(k.text || "")}</li>`).join("")}</ul>` : ""}</div>`;
    const atk = (x.attack || []).slice(0, 3).map((e) => `<li>${esc(e.name)} → <span class="${esc(e.target || "")}">${esc(e.target || "")}</span> <span class="note">+${esc(e.win_gain ?? "")}%</span> ${prio(e)}${marks(e)}</li>`).join("");
    const def = (x.defend || []).slice(0, 3).map((e) => `<li>${esc(e.name)} vs <span class="${esc(e.vs || "")}">${esc(e.vs || "")}</span> <span class="note">−${esc(e.win_drop ?? "")}%</span> ${prio(e)}${marks(e)}</li>`).join("");
    const km = (x.kingmaker || []).slice(0, 2).map((k) => `<li>${esc(k.text || "")}</li>`).join("");
    return `<div><h3 class="${f}">${f} · ${esc(x.war_shape || "")}</h3>${atk ? `<div class="note">Attack</div><ol>${atk}</ol>` : ""}${def ? `<div class="note">Defend</div><ol>${def}</ol>` : ""}${km ? `<div class="note">Kingmaker</div><ul>${km}</ul>` : ""}</div>`;
  }).join("")}</div>${(c.second_place_kingmaker || []).length ? `<div class="note" style="margin-top:8px">Second place: ${c.second_place_kingmaker.map((k) => esc(k.text)).join(" · ")}</div>` : ""}${c.fight_up && c.fight_up.text ? `<pre class="note" style="margin-top:8px;white-space:pre-wrap;font-family:inherit">${esc(c.fight_up.text)}</pre>` : ""}</section>`;
}
