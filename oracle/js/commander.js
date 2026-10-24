// PS2MapOracle dashboard — split from index.html (#15). No behaviour change.
import { S, FACS, esc, det } from "./state.js?v=20261018-scrub2";

/** Grayed placeholder shown between alerts so users see the panel exists. */
export function commanderIdle() {
  return `<section class="card cmd idle" style="margin-top:14px"><h2>🎖️ AI Commander</h2><div class="note">No live alert — the commander briefs when the next one starts.</div></section>`;
}

export function commander(c, ts, now, lead) {
  if (!c || !c.factions) return "";
  // Phone: one faction at a time. Default: the signed-in player's faction, else the leader.
  const live = FACS.filter((f) => c.factions[f]);
  const mine = S.me && live.includes(S.me.faction) ? S.me.faction : null;
  const on = live.includes(S.cmdFac) ? S.cmdFac : mine || (live.includes(lead) ? lead : live[0]);
  const seg = `<div class="seg" role="tablist" aria-label="Faction">${live.map((f) => `<button type="button" role="tab" class="${f}${f === on ? " on" : ""}" aria-selected="${f === on}" data-cf="${f}">${f}</button>`).join("")}</div>`;
  const marks = (e) => `${e.heat >= 40 ? ` <span title="hot fight (heat ${e.heat})">🔥</span>` : ""}${e.freezing ? ` <span title="${e.cut_off ? "cut off: no lattice link back to the warpgate" : "almost cut: its only link to the warpgate runs through a chokepoint under attack"}">🥶</span>` : ""}${e.cut_severs ? ` <span title="capturing this cuts off ${e.cut_severs} enemy bases">✂️${e.cut_severs}</span>` : ""}${e.cuts ? ` <span title="losing it cuts off ${e.cuts} of ours${(e.cut_names || []).length ? `: ${esc(e.cut_names.join(", "))}${e.cuts > e.cut_names.length ? ` +${e.cuts - e.cut_names.length}` : ""}` : ""}">✂️${e.cuts}</span>` : ""}`;
  const prio = (e) => `<span class="note">${e.priority ? `P${e.priority}` : "dead"}</span>`;
  // 🎯 Focus (Worker focus.js): one move per faction, judged when it lands, cuts included.
  const P = c.focus || {};
  const odds = (f, x) => `<span class="${f}">${f} ${x.now}%</span> → <b class="${f}">${x.then}%</b>`;
  const focusLine = (f, x, main) => {
    const cut = "";   // the text already names the cut bases
    const who = x.kind === "spoil" ? x.leader : f;
    const tail = x.kind === "hold" ? `if lost: ${odds(who, x)}` : `${odds(who, x)}`;
    return main
      ? `<div class="focus ${esc(x.kind)}" data-base="${esc(x.bases[0])}"><div class="fhead">${x.kind === "hold" ? "🛡️" : x.kind === "spoil" ? "🃏" : "🎯"} <b>All forces:</b> ${esc(x.text)}${cut}</div><div class="fodds">${tail}</div></div>`
      : `<li data-base="${esc(x.bases[0])}">${esc(x.text)}${cut} <span class="note">${x.kind === "hold" ? "if lost " : ""}${x.then}%</span></li>`;
  };
  const focusHtml = (f) => {
    const p = P[f];
    if (!p) return "";
    if (p.quiet || !p.focus) return `<div class="focus quiet"><div class="fhead">No decisive move right now: hold your lanes.</div></div>`;
    return focusLine(f, p.focus, true) + ((p.backups || []).length ? `<div class="note">Backup:</div><ul class="fback">${p.backups.map((b) => focusLine(f, b, false)).join("")}</ul>` : "");
  };
  const age = ts ? `<span class="note">updated ${Math.max(0, now - ts)}s ago</span>` : "";
  return `<section class="card cmd" style="margin-top:14px"><h2>🎖️ AI Commander ${age}</h2>${seg}<div class="cmdgrid">${FACS.map((f) => {
    const x = c.factions[f]; if (!x) return "";
    if (x.eliminated) return `<div class="cf${f === on ? " on" : ""}"><h3 class="${f}">${f} · eliminated</h3><div class="note">Mathematically out: spoiler plays only (kingmaker below).</div>${(x.kingmaker || []).length ? `<ul>${x.kingmaker.slice(0, 2).map((k) => `<li>${esc(k.text || "")}</li>`).join("")}</ul>` : ""}</div>`;
    const atk = (x.attack || []).slice(0, 3).map((e) => `<li data-base="${esc(e.name)}">${esc(e.name)} → <span class="${esc(e.target || "")}">${esc(e.target || "")}</span> <span class="note">+${esc(e.win_gain ?? "")}%</span> ${prio(e)}${marks(e)}</li>`).join("");
    const def = (x.defend || []).slice(0, 3).map((e) => `<li data-base="${esc(e.name)}">${esc(e.name)} vs <span class="${esc(e.vs || "")}">${esc(e.vs || "")}</span> <span class="note">−${esc(e.win_drop ?? "")}%</span> ${prio(e)}${marks(e)}</li>`).join("");
    const km = (x.kingmaker || []).slice(0, 2).map((k) => `<li>${esc(k.text || "")}</li>`).join("");
    // 👑 Kingmaker sits OUTSIDE the "All moves" fold, right under the focus
    // (owner 2026-10-23: it was hidden in ALL moves for every faction).
    const kmBlock = km ? `<div class="note">👑 Kingmaker</div><ul>${km}</ul>` : "";
    const lists = `${atk ? `<div class="note">⚔️ Attack</div><ol>${atk}</ol>` : ""}${def ? `<div class="note">🛡️ Defend</div><ol>${def}</ol>` : ""}`;
    const hasFocus = !!P[f];
    return `<div class="cf${f === on ? " on" : ""}"><h3 class="${f}">${f} · ${esc(x.war_shape || "")}</h3>${focusHtml(f)}${kmBlock}${hasFocus ? (lists ? det(`cmdall-${f}`, "All moves", lists, "allmoves keep") : "") : lists}</div>`;
  }).join("")}</div>${(c.second_place_kingmaker || []).length ? `<div class="note" style="margin-top:8px">🥈 Second place: ${c.second_place_kingmaker.map((k) => esc(k.text)).join(" · ")}</div>` : ""}${c.fight_up && c.fight_up.text ? det("why", "Why", `<pre class="note" style="margin-top:8px;white-space:pre-wrap;font-family:inherit">${esc(c.fight_up.text)}</pre>`, "why") : ""}</section>`;
}
