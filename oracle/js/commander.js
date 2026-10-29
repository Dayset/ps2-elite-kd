// PS2MapOracle dashboard — split from index.html (#15). No behaviour change.
import { S, FACS, esc, det } from "./state.js?v=20261018-scrub2";
import { voiceButton } from "./voice.js?v=20261027-say1";
import { t as tr } from "../../i18n.mjs";

/** Grayed placeholder shown between alerts so users see the panel exists. */
export function commanderIdle() {
  return `<section class="card cmd idle" style="margin-top:14px"><h2 data-sec="ai-commander">${tr("or.h.cmd", "🎖️ AI Commander")}</h2><div class="note">${tr("or.c.idle", "No live alert — the commander briefs when the next one starts.")}</div></section>`;
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
  const fx = (x) => add(x.bases[0], x.kind === "hold" || x.kind === "guard" ? "🛡️" : x.kind === "spoil" ? "🃏" : x.kind === "push" ? "🔥" : "🎯", x.hot ? `🔥${x.heat}` : sgnPct(Math.round(((x.then ?? 0) - (x.now ?? 0)) * 10) / 10));
  if (p && p.focus && !p.quiet) { fx(p.focus); (p.backups || []).forEach(fx); }
  const x = c && c.factions && c.factions[f];
  if (x && !x.eliminated) {
    for (const e of (x.attack || []).slice(0, 3)) add(e.name, "⚔️", `+${e.win_gain ?? 0}%`);
    for (const e of (x.defend || []).slice(0, 3)) add(e.name, "🛡️", `−${e.win_drop ?? 0}%`);
  }
  return out;
}

/** 🔥 Heat toggle (owner t692u): next to each faction's voice button; one setting for the page. */
export function heatButton(on) {
  const t = on ? tr("or.c.heatOn", "🔥 Heat is on: orders go to the hottest fight, ignoring the alert score. Click to turn off.") : tr("or.c.heatOff", "🔥 Heat: send orders to the hottest fight instead, ignoring the alert score");
  return ` <button type="button" class="voicebtn heatbtn${on ? " on" : ""}" data-heat="1" aria-pressed="${on}" title="${t}" aria-label="${t}">🔥</button>`;
}

export function commander(c, ts, now, lead, mode = "solo", heat = false, liveName = null) {
  S.cmdOrders = []; S.cmdOn = null; S.cmdOnLive = false; S.cmdPockets = []; S.cmdMode = mode;
  const heatLive = !!(heat && c && c.focus_heat);
  S.cmdHeat = heatLive;
  if (!c || !c.factions) return "";
  // Phone: one faction at a time. Default: the signed-in player's faction, else the leader.
  const live = FACS.filter((f) => c.factions[f]);
  const mine = S.me && live.includes(S.me.faction) ? S.me.faction : null;
  const on = live.includes(S.cmdFac) ? S.cmdFac : mine || (live.includes(lead) ? lead : live[0]);
  const P0 = c.focus || {};
  const orders = mapOrders(c, on), numOf = new Map(orders.map((o) => [o.base, o.n]));
  // Pulsing rings (t688u / t692u): #1 in Solo, #1-#3 in Big squad, the 1-2 heat orders in 🔥 Heat.
  S.cmdPulse = heatLive ? (P0[on] && P0[on].focus && !P0[on].quiet ? 1 + (P0[on].backups || []).length : 0) : mode === "big" ? 3 : 1;
  S.cmdOrders = orders; S.cmdOn = on; S.cmdOnLive = true; S.cmdPockets = (c.pockets && c.pockets[on]) || [];
  const seg = `<div class="seg" role="tablist" aria-label="${tr("or.c.faction", "Faction")}">${live.map((f) => `<button type="button" role="tab" class="${f}${f === on ? " on" : ""}" aria-selected="${f === on}" data-cf="${f}">${f}</button>`).join("")}</div>`;
  const marks = (e) => `${e.heat >= 40 ? ` <span title="${tr("or.c.hot", "hot fight (heat {n})", { n: e.heat })}">🔥</span>` : ""}${e.freezing ? ` <span title="${e.cut_off ? tr("or.c.cutOff", "cut off: no lattice link back to the warpgate") : tr("or.c.almostCut", "almost cut: its only link to the warpgate runs through a chokepoint under attack")}">🥶</span>` : ""}${e.pheat >= 30 ? ` <span class="note" title="${tr("or.c.pheat", "predicted: {n}% chance it changes hands in the next 10 minutes", { n: e.pheat })}">⏳${e.pheat}%</span>` : ""}${e.cut_severs ? ` <span title="${tr("or.c.severs", "capturing this cuts off {n} enemy bases", { n: e.cut_severs })}">✂️${e.cut_severs}</span>` : ""}${e.cuts ? ` <span title="${tr("or.c.cuts", "losing it cuts off {n} of ours", { n: e.cuts })}${(e.cut_names || []).length ? `: ${esc(e.cut_names.join(", "))}${e.cuts > e.cut_names.length ? ` +${e.cuts - e.cut_names.length}` : ""}` : ""}">✂️${e.cuts}</span>` : ""}`;
  // "dead" = taking / holding it can't change the result (cut off, or the winner is locked).
  // (The P-number was just the win change × 10: dropped, owner 2026-10-24.)
  // Base names look and act like links: hover / tap highlights the base on the map.
  const bl = (n) => `<span class="blink" role="button" tabindex="0" data-base="${esc(n)}">${esc(n)}</span>`;
  const linked = (text, ns) => { let h = esc(text || ""); for (const n of [...new Set(ns.filter(Boolean))].sort((a, b) => b.length - a.length)) h = h.split(esc(n)).join(`\u0000${n}\u0001`); return h.replace(/\u0000([^\u0001]*)\u0001/g, (_, n) => bl(n)); };
  const xNames = (x) => [...(x.bases || []), ...(x.cuts || []), ...(x.reconnects || [])];
  const num = (k) => (k ? `<span class="onum" aria-label="${tr("or.c.marker", "map marker {n}", { n: k })}">${k}</span> ` : "");
  const prio = (e) => (e.priority ? "" : ` <span class="note" title="${tr("or.c.deadTip", "can't change the result: cut off, or the winner is already locked")}">${tr("or.c.dead", "dead")}</span>`);
  const sgn = (d) => `${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d).toFixed(1)}%`;
  const diff = (x) => ` <span class="note">(${sgn(Math.round((x.then - x.now) * 10) / 10)})</span>`;
  // 🎯 Focus (Worker focus.js): one move per faction, judged when it lands, cuts included.
  const P = c.focus || {};
  const odds = (f, x) => `<span class="${f}">${f} ${x.now}%</span> → <b class="${f}">${x.then}%</b>`;
  const focusLine = (f, x, main, k = 0) => {
    const cut = "";   // the text already names the cut bases
    const who = x.kind === "spoil" ? x.leader : f;
    const front = x.kind === "push" || x.kind === "guard";   // no move changes the result: the busiest front
    const tail = x.hot ? `<span class="note">${tr("or.c.heatN", "🔥 fight heat {n}", { n: x.heat })}</span>` : front ? `<span class="note">${tr("or.c.front", "{n}% chance it changes hands in the next 10 min · nothing here changes the result", { n: x.heat })}</span>` : `${x.kind === "hold" ? tr("or.c.ifLost", "if lost:") + " " : ""}${odds(who, x)}${diff(x)}`;
    const icon = x.kind === "hold" || x.kind === "guard" ? "🛡️" : x.kind === "spoil" ? "🃏" : x.kind === "push" ? "🔥" : "🎯";
    // OBS block capture (owner 2026-10-25): the All-forces box is one exact
    // rectangle — header, one facility per line, values + info — no matter
    // the names or the base count. The prose stays, below the values, so
    // nothing it carried (target, cuts, reconnects) is lost; anything past
    // the box clips inside instead of moving it.
    // No "All forces:" prefix (owner t689u): just "⚔️ Attack" / "🛡️ Defend".
    const head = front
      ? `${num(k)}${icon} <b class="fkind">${tr("or.c.busiest", "Busiest front:")}</b>`
      : `${num(k)}<b class="fkind">${x.kind === "hold" ? tr("or.c.defend", "🛡️ Defend") : tr("or.c.attack", "⚔️ Attack")}</b>`;
    const pocket = x.pocket ? ` <span class="note" title="${tr("or.c.pocketTip", "inside a pocket whose chokepoint is under attack: worth less if it gets cut")}">${tr("or.c.inPocket", "🥶 in a pocket")}</span>` : "";
    return main
      ? `<div class="focus ${esc(x.kind)}" data-base="${esc(x.bases[0])}"><div class="fhead"><div class="fkindline">${head}</div>${(x.bases || []).map((b) => `<div class="fbase">${bl(b)}</div>`).join("")}</div><div class="fodds">${tail}${pocket}<div class="ftext">${linked(x.text, xNames(x))}</div></div></div>`
      : x.hot ? `<li data-base="${esc(x.bases[0])}">${num(k)}${x.kind === "hold" ? tr("or.c.defend", "🛡️ Defend") : tr("or.c.attack", "⚔️ Attack")} ${bl(x.bases[0])} <span class="note">${tr("or.c.heatN", "🔥 fight heat {n}", { n: x.heat })}</span></li>`
      : `<li data-base="${esc(x.bases[0])}">${num(k)}${linked(x.text, xNames(x))}${cut} ${front ? ` <span class="note">⏳${x.heat}%</span>` : `<span class="note">${x.kind === "hold" ? tr("or.c.ifLost2", "if lost") + " " : ""}${x.then}%</span>${diff(x)}`}</li>`;
  };
  const focusHtml = (f) => {
    const p = P[f];
    if (!p) return "";
    if (p.quiet || !p.focus) return `<div class="focus quiet"><div class="fhead">${tr("or.c.quiet", "No decisive move right now: hold your lanes.")}</div></div>`;
    const nb = (x) => (f === on ? numOf.get(x.bases[0]) || 0 : 0);
    return (p.kept ? `<div class="note kept">${tr("or.c.kept", "📌 Kept order: stays until it is done")}</div>` : "") + focusLine(f, p.focus, true, nb(p.focus)) + ((p.backups || []).length ? `<div class="note">${tr("or.c.backup", "Backup:")}</div><ul class="fback">${p.backups.map((b) => focusLine(f, b, false, nb(b))).join("")}</ul>` : "");
  };
  const age = ts ? `<span class="note">${tr("or.c.updated", "updated {n}s ago", { n: Math.max(0, now - ts) })}</span>` : "";
  // Orders mode (owner t665u): remembered on this device; no extra requests either way.
  const mb = (m, label, tip) => `<button type="button" data-cmode="${m}" class="${m === mode ? "on" : ""}" aria-pressed="${m === mode}" title="${tip}">${label}</button>`;
  const modeNote = heatLive ? tr("or.c.heatNote", "🔥 Heat: orders go to the hottest fight right now (bases that just changed hands, and their neighbours), ignoring the alert score. One direction; two when the second fight is almost as hot.")
    : heat ? tr("or.c.bigWait", "The new orders appear with the next update.")
    : mode === "big"
    ? (c.focus_mix ? tr("or.c.bigNote", "Attacks aimed {n} min ahead, so a big squad arrives in time; defends only when a base is under attack. Three directions that can change every minute.", { n: c.ahead_min || 3 }) : tr("or.c.bigWait", "The new orders appear with the next update."))
    : tr("or.c.soloNote", "Attacks aimed {n} min ahead; defends only when a base is under attack. One order stays until it is done (base taken or lost, or about 5 min passed), unless a clearly better or urgent one appears.", { n: c.ahead_min || 3 });
  const modeBar = `<div class="cmode" role="group" aria-label="${tr("or.c.mode", "Orders for")}"><span class="note">${tr("or.c.mode", "Orders for")}</span>${mb("solo", tr("or.c.solo", "Solo"), tr("or.c.soloTip", "One steady direction for a player or a small group"))}${mb("big", tr("or.c.big", "Big squad"), tr("or.c.bigTip", "Three directions for a squad or platoon, updated every minute"))}</div><div class="note cmodenote">${modeNote}</div>`;
  return `<section class="card cmd" style="margin-top:14px"><h2 data-sec="ai-commander">${tr("or.h.cmd", "🎖️ AI Commander")} ${age}</h2>${liveName ? `<div class="note livenow" title="${esc(tr("or.f.note", "Rough crowd: players seen fighting at each base in the last 5 min, from the game's live event stream. Not used in the odds yet."))}">🔥 ${bl(liveName)}</div>` : ""}${modeBar}${seg}<div class="cmdgrid">${FACS.map((f) => {
    const x = c.factions[f]; if (!x) return "";
    if (x.eliminated) return `<div class="cf${f === on ? " on" : ""}"><h3 class="${f}">${f} · ${tr("or.c.elim", "eliminated")}</h3><div class="note">${tr("or.c.out", "Mathematically out: spoiler plays only (kingmaker below).")}</div>${(x.kingmaker || []).length ? `<ul>${x.kingmaker.slice(0, 2).map((k) => `<li>${esc(k.text || "")}</li>`).join("")}</ul>` : ""}</div>`;
    const nf = (n) => (f === on ? numOf.get(n) || 0 : 0);
    const atk = (x.attack || []).slice(0, 3).map((e) => `<li data-base="${esc(e.name)}">${num(nf(e.name))}${bl(e.name)} → <span class="${esc(e.target || "")}">${esc(e.target || "")}</span> <span class="note">+${esc(e.win_gain ?? "")}%</span>${prio(e)}${marks(e)}</li>`).join("");
    const def = (x.defend || []).slice(0, 3).map((e) => `<li data-base="${esc(e.name)}">${num(nf(e.name))}${bl(e.name)} vs <span class="${esc(e.vs || "")}">${esc(e.vs || "")}</span> <span class="note">−${esc(e.win_drop ?? "")}%</span>${prio(e)}${marks(e)}</li>`).join("");
    // 👑 Kingmaker: every line. Lines that move our odds more than the focus move sit
    // outside the "All moves" fold, right under the focus; the rest go inside it
    // (owner 2026-10-24). No focus (quiet front): all outside.
    const fx = P[f] && P[f].focus, focusSwing = fx && !fx.hot ? Math.abs(fx.then - fx.now) : 0;
    const kms = x.kingmaker || [], kmLi = (ks) => ks.map((k) => `<li>${esc(k.text || "")}</li>`).join("");
    const kmBig = kms.filter((k) => Math.abs(+k.my_swing || 0) > focusSwing), kmSmall = kms.filter((k) => !kmBig.includes(k));
    // 🥶 Pockets: our bases behind a chokepoint under attack; the order is to hold the chokepoint.
    const pks = (c.pockets && c.pockets[f]) || [];
    const pkBlock = pks.length ? `<div class="pockets">${pks.map((p) => `<div class="pocket">🥶 <b>${tr("or.c.pocket", "Pocket")}</b> ${p.bases.slice(0, 3).map(bl).join(", ")}${p.n > 3 ? ` +${p.n - 3}` : ""}: ${tr("or.c.hold", "hold {b}", { b: bl(p.chokepoint) })}${p.hold_drop ? ` <span class="note">${tr("or.c.orDrop", "or −{n}%", { n: p.hold_drop })}</span>` : ""}</div>`).join("")}</div>` : "";
    const kmBlock = kmBig.length ? `<div class="note">${tr("or.c.king", "👑 Kingmaker")}</div><ul>${kmLi(kmBig)}</ul>` : "";
    const lists = `${atk ? `<div class="note">${tr("or.c.attack", "⚔️ Attack")}</div><ul class="olist">${atk}</ul>` : ""}${def ? `<div class="note">${tr("or.c.defend", "🛡️ Defend")}</div><ul class="olist">${def}</ul>` : ""}${kmSmall.length ? `<div class="note">${tr("or.c.king", "👑 Kingmaker")}</div><ul>${kmLi(kmSmall)}</ul>` : ""}`;
    const hasFocus = !!P[f];
    return `<div class="cf${f === on ? " on" : ""}"><h3 class="${f}">${f} · ${esc(x.war_shape || "")}${voiceButton(f)}${heatButton(heat)}</h3>${focusHtml(f)}${pkBlock}${kmBlock}${hasFocus ? (lists ? det(`cmdall-${f}`, tr("or.c.allMoves", "All moves"), lists, "allmoves keep") : "") : lists}</div>`;
  }).join("")}</div>${(c.second_place_kingmaker || []).length ? `<div class="note" style="margin-top:8px">${tr("or.second", "🥈 Second place:")} ${c.second_place_kingmaker.map((k) => esc(k.text)).join(" · ")}</div>` : ""}${c.fight_up && c.fight_up.text ? det("why", tr("or.c.why", "Why"), `<pre class="note" style="margin-top:8px;white-space:pre-wrap;font-family:inherit">${esc(c.fight_up.text)}</pre>`, "why") : ""}</section>`;
}
