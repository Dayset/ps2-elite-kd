// PS2MapOracle dashboard — split from index.html (#15). No behaviour change.
import { S, FACS, esc, det } from "./state.js";

export function commander(c, ts, now, lead) {
  if (!c || !c.factions) return "";
  // Phone: one faction at a time. Default: the signed-in player's faction, else the leader.
  const live = FACS.filter((f) => c.factions[f]);
  const mine = S.me && live.includes(S.me.faction) ? S.me.faction : null;
  const on = live.includes(S.cmdFac) ? S.cmdFac : mine || (live.includes(lead) ? lead : live[0]);
  const seg = `<div class="seg" role="tablist" aria-label="Faction">${live.map((f) => `<button type="button" role="tab" class="${f}${f === on ? " on" : ""}" aria-selected="${f === on}" data-cf="${f}">${f}</button>`).join("")}</div>`;
  const marks = (e) => `${e.heat >= 40 ? ` <span title="hot fight (heat ${e.heat})">🔥</span>` : ""}${e.freezing ? ' <span title="supply line runs through a threatened chokepoint">🥶</span>' : ""}${e.cut_severs ? ` <span title="capturing this cuts off ${e.cut_severs} enemy bases">✂️${e.cut_severs}</span>` : ""}`;
  const prio = (e) => `<span class="note">${e.priority ? `P${e.priority}` : "dead"}</span>`;
  const age = ts ? `<span class="note">updated ${Math.max(0, now - ts)}s ago</span>` : "";
  return `<section class="card cmd" style="margin-top:14px"><h2>AI Commander ${age}</h2>${seg}<div class="cmdgrid">${FACS.map((f) => {
    const x = c.factions[f]; if (!x) return "";
    if (x.eliminated) return `<div class="cf${f === on ? " on" : ""}"><h3 class="${f}">${f} · eliminated</h3><div class="note">Mathematically out: spoiler plays only (kingmaker below).</div>${(x.kingmaker || []).length ? `<ul>${x.kingmaker.slice(0, 2).map((k) => `<li>${esc(k.text || "")}</li>`).join("")}</ul>` : ""}</div>`;
    const atk = (x.attack || []).slice(0, 3).map((e) => `<li>${esc(e.name)} → <span class="${esc(e.target || "")}">${esc(e.target || "")}</span> <span class="note">+${esc(e.win_gain ?? "")}%</span> ${prio(e)}${marks(e)}</li>`).join("");
    const def = (x.defend || []).slice(0, 3).map((e) => `<li>${esc(e.name)} vs <span class="${esc(e.vs || "")}">${esc(e.vs || "")}</span> <span class="note">−${esc(e.win_drop ?? "")}%</span> ${prio(e)}${marks(e)}</li>`).join("");
    const km = (x.kingmaker || []).slice(0, 2).map((k) => `<li>${esc(k.text || "")}</li>`).join("");
    return `<div class="cf${f === on ? " on" : ""}"><h3 class="${f}">${f} · ${esc(x.war_shape || "")}</h3>${atk ? `<div class="note">Attack</div><ol>${atk}</ol>` : ""}${def ? `<div class="note">Defend</div><ol>${def}</ol>` : ""}${km ? `<div class="note">Kingmaker</div><ul>${km}</ul>` : ""}</div>`;
  }).join("")}</div>${(c.second_place_kingmaker || []).length ? `<div class="note" style="margin-top:8px">Second place: ${c.second_place_kingmaker.map((k) => esc(k.text)).join(" · ")}</div>` : ""}${c.fight_up && c.fight_up.text ? det("why", "Why", `<pre class="note" style="margin-top:8px;white-space:pre-wrap;font-family:inherit">${esc(c.fight_up.text)}</pre>`, "why") : ""}</section>`;
}
