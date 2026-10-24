// PS2MapOracle dashboard — split from index.html (#15). No behaviour change.
import { S, FACS, esc, det } from "./state.js?v=20261018-scrub2";
import { voiceButton } from "./voice.js?v=20261024-v2";

/** Grayed placeholder shown between alerts so users see the panel exists. */
export function commanderIdle() {
  return `<section class="card cmd idle" style="margin-top:14px"><h2>🎖️ AI Commander</h2><div class="note">No live alert — the commander briefs when the next one starts.</div></section>`;
}

const sgnPct = (d) => `${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d).toFixed(1)}%`;

/**
 * Numbered orders for the map (owner 2026-10-24): the selected faction's focus,
 * backups, then its attack and defend lists; one number per base (first wins), at
 * most 9. Each: {n, base, emoji, short} — short is what the map shows ("🛡️ −5.0%").
 */
export function mapOrders(c, f) {
  const out = [], seen = new Set();
  const add = (base, emoji, short) => { if (!base || seen.has(base) || out.length >= 9) return; seen.add(base); out.push({ n: out.length + 1, base, emoji, short }); };
  const p = c && c.focus && c.focus[f];
  const fx = (x) => add(x.bases[0], x.kind === "hold" ? "🛡️" : x.kind === "spoil" ? "🃏" : "🎯", sgnPct(Math.round(((x.then ?? 0) - (x.now ?? 0)) * 10) / 10));
  if (p && p.focus && !p.quiet) { fx(p.focus); (p.backups || []).forEach(fx); }
  const x = c && c.factions && c.factions[f];
  if (x && !x.eliminated) {
    for (const e of (x.attack || []).slice(0, 3)) add(e.name, "⚔️", `+${e.win_gain ?? 0}%`);
    for (const e of (x.defend || []).slice(0, 3)) add(e.name, "🛡️", `−${e.win_drop ?? 0}%`);
  }
  return out;
}

export function commander(c, ts, now, lead) {
  S.cmdOrders = [];
  if (!c || !c.factions) return "";
  // Phone: one faction at a time. Default: the signed-in player's faction, else the leader.
  const live = FACS.filter((f) => c.factions[f]);
  const mine = S.me && live.includes(S.me.faction) ? S.me.faction : null;
  const on = live.includes(S.cmdFac) ? S.cmdFac : mine || (live.includes(lead) ? lead : live[0]);
  const orders = mapOrders(c, on), numOf = new Map(orders.map((o) => [o.base, o.n]));
  S.cmdOrders = orders;
  const seg = `<div class="seg" role="tablist" aria-label="Faction">${live.map((f) => `<button type="button" role="tab" class="${f}${f === on ? " on" : ""}" aria-selected="${f === on}" data-cf="${f}">${f}</button>`).join("")}</div>`;
  const marks = (e) => `${e.heat >= 40 ? ` <span title="hot fight (heat ${e.heat})">🔥</span>` : ""}${e.freezing ? ` <span title="${e.cut_off ? "cut off: no lattice link back to the warpgate" : "almost cut: its only link to the warpgate runs through a chokepoint under attack"}">🥶</span>` : ""}${e.cut_severs ? ` <span title="capturing this cuts off ${e.cut_severs} enemy bases">✂️${e.cut_severs}</span>` : ""}${e.cuts ? ` <span title="losing it cuts off ${e.cuts} of ours${(e.cut_names || []).length ? `: ${esc(e.cut_names.join(", "))}${e.cuts > e.cut_names.length ? ` +${e.cuts - e.cut_names.length}` : ""}` : ""}">✂️${e.cuts}</span>` : ""}`;
  // "dead" = taking / holding it can't change the result (cut off, or the winner is locked).
  // (The P-number was just the win change × 10: dropped, owner 2026-10-24.)
  // Base names look and act like links: hover / tap highlights the base on the map.
  const bl = (n) => `<span class="blink" role="button" tabindex="0" data-base="${esc(n)}">${esc(n)}</span>`;
  const linked = (text, ns) => { let h = esc(text || ""); for (const n of [...new Set(ns.filter(Boolean))].sort((a, b) => b.length - a.length)) h = h.split(esc(n)).join(`\u0000${n}\u0001`); return h.replace(/\u0000([^\u0001]*)\u0001/g, (_, n) => bl(n)); };
  const xNames = (x) => [...(x.bases || []), ...(x.cuts || []), ...(x.reconnects || [])];
  const num = (k) => (k ? `<span class="onum" aria-label="map marker ${k}">${k}</span> ` : "");
  const prio = (e) => (e.priority ? "" : ` <span class="note" title="can't change the result: cut off, or the winner is already locked">dead</span>`);
  const sgn = (d) => `${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d).toFixed(1)}%`;
  const diff = (x) => ` <span class="note">(${sgn(Math.round((x.then - x.now) * 10) / 10)})</span>`;
  // 🎯 Focus (Worker focus.js): one move per faction, judged when it lands, cuts included.
  const P = c.focus || {};
  const odds = (f, x) => `<span class="${f}">${f} ${x.now}%</span> → <b class="${f}">${x.then}%</b>`;
  const focusLine = (f, x, main, k = 0) => {
    const cut = "";   // the text already names the cut bases
    const who = x.kind === "spoil" ? x.leader : f;
    const tail = `${x.kind === "hold" ? "if lost: " : ""}${odds(who, x)}${diff(x)}`;
    return main
      ? `<div class="focus ${esc(x.kind)}" data-base="${esc(x.bases[0])}"><div class="fhead">${num(k)}${x.kind === "hold" ? "🛡️" : x.kind === "spoil" ? "🃏" : "🎯"} <b>All forces:</b> ${linked(x.text, xNames(x))}${cut}</div><div class="fodds">${tail}</div></div>`
      : `<li data-base="${esc(x.bases[0])}">${num(k)}${linked(x.text, xNames(x))}${cut} <span class="note">${x.kind === "hold" ? "if lost " : ""}${x.then}%</span>${diff(x)}</li>`;
  };
  const focusHtml = (f) => {
    const p = P[f];
    if (!p) return "";
    if (p.quiet || !p.focus) return `<div class="focus quiet"><div class="fhead">No decisive move right now: hold your lanes.</div></div>`;
    const nb = (x) => (f === on ? numOf.get(x.bases[0]) || 0 : 0);
    return focusLine(f, p.focus, true, nb(p.focus)) + ((p.backups || []).length ? `<div class="note">Backup:</div><ul class="fback">${p.backups.map((b) => focusLine(f, b, false, nb(b))).join("")}</ul>` : "");
  };
  const age = ts ? `<span class="note">updated ${Math.max(0, now - ts)}s ago</span>` : "";
  return `<section class="card cmd" style="margin-top:14px"><h2>🎖️ AI Commander ${age}</h2>${seg}<div class="cmdgrid">${FACS.map((f) => {
    const x = c.factions[f]; if (!x) return "";
    if (x.eliminated) return `<div class="cf${f === on ? " on" : ""}"><h3 class="${f}">${f} · eliminated</h3><div class="note">Mathematically out: spoiler plays only (kingmaker below).</div>${(x.kingmaker || []).length ? `<ul>${x.kingmaker.slice(0, 2).map((k) => `<li>${esc(k.text || "")}</li>`).join("")}</ul>` : ""}</div>`;
    const nf = (n) => (f === on ? numOf.get(n) || 0 : 0);
    const atk = (x.attack || []).slice(0, 3).map((e) => `<li data-base="${esc(e.name)}">${num(nf(e.name))}${bl(e.name)} → <span class="${esc(e.target || "")}">${esc(e.target || "")}</span> <span class="note">+${esc(e.win_gain ?? "")}%</span>${prio(e)}${marks(e)}</li>`).join("");
    const def = (x.defend || []).slice(0, 3).map((e) => `<li data-base="${esc(e.name)}">${num(nf(e.name))}${bl(e.name)} vs <span class="${esc(e.vs || "")}">${esc(e.vs || "")}</span> <span class="note">−${esc(e.win_drop ?? "")}%</span>${prio(e)}${marks(e)}</li>`).join("");
    // 👑 Kingmaker: every line. Lines that move our odds more than the focus move sit
    // outside the "All moves" fold, right under the focus; the rest go inside it
    // (owner 2026-10-24). No focus (quiet front): all outside.
    const fx = P[f] && P[f].focus, focusSwing = fx ? Math.abs(fx.then - fx.now) : 0;
    const kms = x.kingmaker || [], kmLi = (ks) => ks.map((k) => `<li>${esc(k.text || "")}</li>`).join("");
    const kmBig = kms.filter((k) => Math.abs(+k.my_swing || 0) > focusSwing), kmSmall = kms.filter((k) => !kmBig.includes(k));
    const kmBlock = kmBig.length ? `<div class="note">👑 Kingmaker</div><ul>${kmLi(kmBig)}</ul>` : "";
    const lists = `${atk ? `<div class="note">⚔️ Attack</div><ul class="olist">${atk}</ul>` : ""}${def ? `<div class="note">🛡️ Defend</div><ul class="olist">${def}</ul>` : ""}${kmSmall.length ? `<div class="note">👑 Kingmaker</div><ul>${kmLi(kmSmall)}</ul>` : ""}`;
    const hasFocus = !!P[f];
    return `<div class="cf${f === on ? " on" : ""}"><h3 class="${f}">${f} · ${esc(x.war_shape || "")}${voiceButton(f)}</h3>${focusHtml(f)}${kmBlock}${hasFocus ? (lists ? det(`cmdall-${f}`, "All moves", lists, "allmoves keep") : "") : lists}</div>`;
  }).join("")}</div>${(c.second_place_kingmaker || []).length ? `<div class="note" style="margin-top:8px">🥈 Second place: ${c.second_place_kingmaker.map((k) => esc(k.text)).join(" · ")}</div>` : ""}${c.fight_up && c.fight_up.text ? det("why", "Why", `<pre class="note" style="margin-top:8px;white-space:pre-wrap;font-family:inherit">${esc(c.fight_up.text)}</pre>`, "why") : ""}</section>`;
}
