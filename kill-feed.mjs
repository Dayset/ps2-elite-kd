/**
 * ⚔️ Latest 100 kills & deaths: one player's newest KILL / DEATH events.
 *
 * Data: ONE Census call (characters_event, type=KILL,DEATH, c:limit=100). Joins in
 * the same call give the other player's name, faction and outfit tag, the weapon
 * name and the vehicle name, so nothing else is fetched.
 * For a "kills" row the player is the attacker and character_id is the victim; for
 * a "deaths" row it is the other way round.
 *
 * Shown only when exactly one player is on the page; collapsed by default and
 * loaded on first open (no Census call for people who never open it).
 *
 * 🥊 PlayStation room (owner 2026-10-28): a scrim inside the 100 (scrims.mjs detectScrims) is
 * folded into ONE row with the score and the winner; it opens to its kills & deaths. Scrim rows
 * stay in the list but leave the summary numbers (same idea as the PS scrim rule in the stats).
 */
import { t as tr, currentLang } from "./i18n.mjs";
import { detectScrims, scrimResult, scrimMinutes, isOneSided } from "./scrims.mjs?v=20261028-os2";

export const FEED_LIMIT = 100;
const FAC = { 1: "vs", 2: "nc", 3: "tr", 4: "nso" };

const who = (side) =>
  `character^on:${side}^to:character_id^inject_at:${side === "character_id" ? "vic" : "att"}^show:name.first'faction_id` +
  `(outfit_member_extended^on:character_id^to:character_id^inject_at:of^show:alias)`;

/** The one Census URL (base ends with "/get/ps2:v2/" or a room namespace). */
export function killFeedUrl(base, cid) {
  return `${base}characters_event/?character_id=${encodeURIComponent(cid)}&type=KILL,DEATH&c:limit=${FEED_LIMIT}` +
    `&c:join=${who("character_id")},${who("attacker_character_id")},` +
    `item^on:attacker_weapon_id^to:item_id^inject_at:wpn^show:name.en,` +
    `vehicle^on:attacker_vehicle_id^to:vehicle_id^inject_at:veh^show:name.en`;
}

const nm = (o) => (o && o.name && (o.name.en || o.name.first)) || "";
const num = (v) => Number(v) || 0;

/** Census rows → plain rows, newest first. */
export function parseKillFeed(json, cid) {
  const list = (json && json.characters_event_list) || [];
  const me = String(cid);
  const rows = [];
  for (const e of list) {
    if (!e) continue;
    const kill = e.table_type === "kills" ? true : e.table_type === "deaths" ? false : String(e.attacker_character_id) === me;
    const otherId = String(kill ? e.character_id : e.attacker_character_id || "0");
    const other = kill ? e.vic : e.att;
    const suicide = otherId === me || otherId === "0";
    const myTeam = num(kill ? e.attacker_team_id : e.team_id), theirTeam = num(kill ? e.team_id : e.attacker_team_id);
    const fac = num(other && other.faction_id);
    rows.push({
      at: num(e.timestamp) * 1000,
      kill,
      suicide,
      teamkill: !suicide && myTeam > 0 && myTeam === theirTeam,
      headshot: e.is_headshot === "1" || e.is_headshot === 1 || e.is_headshot === true,
      otherId,
      name: suicide ? "" : (other && other.name && other.name.first) || "",
      tag: (other && other.of && other.of.alias) || "",
      fac: FAC[fac] || FAC[theirTeam] || "",
      weapon: num(e.attacker_weapon_id) ? nm(e.wpn) || `#${e.attacker_weapon_id}` : "",
      vehicle: num(e.attacker_vehicle_id) ? nm(e.veh) || "" : "",
    });
  }
  rows.sort((a, b) => b.at - a.at);
  return rows;
}

/** Summary over the rows: kills (no teamkills / suicides), deaths, K/D, headshot share of those kills. */
export function summarizeKillFeed(rows) {
  let k = 0, d = 0, hs = 0, tk = 0, sui = 0;
  for (const r of rows) {
    if (r.suicide) { sui++; if (!r.kill) d++; continue; }
    if (r.kill) { if (r.teamkill) { tk++; continue; } k++; if (r.headshot) hs++; } else d++;
  }
  return { kills: k, deaths: d, kd: d ? k / d : null, hsr: k ? hs / k : null, teamkills: tk, suicides: sui };
}

/* ------------------------------------------------------------- UI */

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lang = () => { try { return currentLang() || undefined; } catch { return undefined; } };

export function relTime(ms, now = Date.now()) {
  const s = Math.round((ms - now) / 1000);
  const a = Math.abs(s);
  const [v, u] = a < 60 ? [s, "second"] : a < 3600 ? [Math.round(s / 60), "minute"] : a < 86400 ? [Math.round(s / 3600), "hour"]
    : a < 86400 * 30 ? [Math.round(s / 86400), "day"] : a < 86400 * 365 ? [Math.round(s / (86400 * 30)), "month"] : [Math.round(s / (86400 * 365)), "year"];
  try { return new Intl.RelativeTimeFormat(lang(), { numeric: "auto", style: "short" }).format(v, u); } catch { return new Date(ms).toLocaleString(); }
}

/**
 * Opponent ⚔️ iVi next to the name (owner steering after t747u): only from data the
 * page already has (ranks.json / ranks-lite.json of this room, hidden.json), never a
 * new Census / Honu call. info = { adjs, tier, tierLabel, mark, markTip, poop, poopTip,
 * oor, oorTip } or null → nothing shown. Same number as the ✨ table: 0 digits, ≤ 0 → 0.
 */
export function iviHtml(info) {
  if (!info) return "";
  if (info.oor) return ` <span class="kf-oor" title="${esc(info.oorTip || "")}">OOR</span>`;
  const n = typeof info.adjs === "number" && Number.isFinite(info.adjs) ? Math.round(Math.max(0, info.adjs)) : null;
  const mark = info.mark ? `<span class="kf-pad" title="${esc(info.markTip || "")}">${esc(info.mark)}</span>` : "";
  const poop = info.poop ? `<span class="poop-mark" title="${esc(info.poopTip || "")}">💩</span>` : "";
  if (n == null) return mark || poop ? `${mark}${poop}` : "";
  const tip = tr("kf.iviTip", "⚔️ iVi {n} · {tier}. {about}", { n: n.toLocaleString(lang()), tier: info.tierLabel || "", about: tr("tip.adjs", "Rating vs the ~200 players you fight most. Stronger foes count more; fast kills add, slow safe play costs.") });
  const emo = /^\p{Extended_Pictographic}/u.test(info.tierLabel || "") ? String(info.tierLabel).split(" ")[0] : "";
  return `${mark}${poop} <span class="kf-ivi${info.tier ? ` kf-t-${esc(info.tier)}` : ""}" title="${esc(tip)}">${emo ? `${emo}\u2009` : ""}${n.toLocaleString(lang())}</span>`;
}

/** Table head (owner 2026-10-28: "more like a table with proper alignment"). */
export function feedHeadHtml() {
  return `<tr><th class="rk-num" scope="col">#</th><th class="kf-c-time" scope="col">${esc(tr("kf.colWhen", "When"))}</th>` +
    `<th class="kf-c-mark" scope="col">${esc(tr("kf.colWhat", "Result"))}</th><th class="kf-c-who" scope="col">${esc(tr("kf.colPlayer", "Player"))}</th>` +
    `<th class="kf-c-ivi" scope="col" title="${esc(tr("tip.adjs", "Rating vs the ~200 players you fight most. Stronger foes count more; fast kills add, slow safe play costs."))}">⚔️ iVi</th>` +
    `<th class="kf-c-gear" scope="col">${esc(tr("kf.colWeapon", "Weapon"))}</th></tr>`;
}

const timeCell = (ms, now, titleMs = ms) => {
  const when = titleMs ? new Date(titleMs).toLocaleString(lang(), { dateStyle: "medium", timeStyle: "short" }) : "";
  return `<td class="kf-c-time"><time datetime="${ms ? new Date(ms).toISOString() : ""}" title="${esc(when)}">${esc(ms ? relTime(ms, now) : "")}</time></td>`;
};

/** One kill / death as a table row. num: the # shown (sub-rows of a scrim have none). */
export function rowHtml(r, now = Date.now(), iviOf = null, num = "", sub = false) {
  const mark = r.suicide
    ? `<span class="kf-mark kf-sui">${esc(tr("kf.suicide", "Suicide"))}</span>`
    : r.kill ? `<span class="kf-mark kf-kill">${esc(tr("kf.kill", "Kill"))}</span>` : `<span class="kf-mark kf-death">${esc(tr("kf.death", "Death"))}</span>`;
  const tk = r.teamkill ? ` <span class="kf-tk">${esc(tr("kf.teamkill", "Teamkill"))}</span>` : "";
  const tag = r.tag ? `<span class="kf-tag">[${esc(r.tag)}]</span> ` : "";
  const who = r.suicide ? "" : r.name
    ? `${tag}<button type="button" class="kf-name${r.fac ? ` fac-${r.fac}` : ""}" data-name="${esc(r.name)}" title="${esc(tr("kf.addTip", "Add {name} to the names", { name: r.name }))}">${esc(r.name)}</button>`
    : `<span class="kf-name kf-unknown">${esc(tr("kf.unknown", "Unknown player"))}</span>`;
  const ivi = !r.suicide && r.name && iviOf ? iviHtml(iviOf(r.name)) : "";
  const gearTxt = [r.weapon, r.vehicle ? `🚜 ${r.vehicle}` : ""].filter(Boolean).join(" · ");
  const hs = r.headshot ? `<span class="kf-hs" title="${esc(tr("kf.headshot", "Headshot"))}">🎯</span> ` : "";
  return `<tr class="kf-row${r.kill ? " is-kill" : " is-death"}${r.teamkill ? " is-tk" : ""}${r.suicide ? " is-sui" : ""}${sub ? " kf-sub-row" : ""}"${sub ? " hidden" : ""}>` +
    `<td class="rk-num">${esc(num)}</td>${timeCell(r.at, now)}<td class="kf-c-mark">${mark}${tk}</td>` +
    `<td class="kf-c-who">${who}</td><td class="kf-c-ivi">${ivi}</td>` +
    `<td class="kf-c-gear" title="${esc(gearTxt)}">${hs}${esc(gearTxt)}</td></tr>`;
}

/**
 * 🥊 Scrims inside the feed (PlayStation room). rows: parseKillFeed rows, newest first.
 * → { items: [{ r } | { scrim, rows }], scrims, inScrim }: a scrim sits where its newest row was;
 * rows of other players during the scrim stay outside it, in time order.
 */
export function groupFeedScrims(rows, cid) {
  const me = String(cid);
  const list = rows || [];
  const sec = (r) => Math.floor((r.at || 0) / 1000);
  const ev = list.map((r) => [sec(r), r.kill ? 1 : 0, r.suicide ? me : String(r.otherId || "0"), 0, r.headshot ? 1 : 0, 0, 0, 0, 0]);
  const scrims = detectScrims(ev, me);
  if (!scrims.length) return { items: list.map((r) => ({ r })), scrims, inScrim: 0 };
  const owner = new Map();
  scrims.forEach((s, si) => {
    const ids = new Set(s.opp.map((o) => o.id));
    list.forEach((r, i) => {
      const t = sec(r);
      if (!r.suicide && !owner.has(i) && ids.has(String(r.otherId)) && t >= s.t0 && t <= s.t1) owner.set(i, si);
    });
  });
  const items = [];
  const placed = new Set();
  list.forEach((r, i) => {
    if (!owner.has(i)) { items.push({ r }); return; }
    const si = owner.get(i);
    if (placed.has(si)) return;
    placed.add(si);
    items.push({ scrim: scrims[si], rows: list.filter((_, j) => owner.get(j) === si) });
  });
  return { items, scrims, inScrim: owner.size };
}

export const scrimResultLabel = (res) => (res === "won" ? tr("scr.won", "Won") : res === "lost" ? tr("scr.lost", "Lost") : tr("scr.draw", "Draw"));

const nameBtn = (r, iviOf) => {
  if (!r || !r.name) return `<span class="kf-name kf-unknown">${esc(tr("kf.unknown", "Unknown player"))}</span>`;
  const tag = r.tag ? `<span class="kf-tag">[${esc(r.tag)}]</span> ` : "";
  return `${tag}<button type="button" class="kf-name${r.fac ? ` fac-${r.fac}` : ""}" data-name="${esc(r.name)}" title="${esc(tr("kf.addTip", "Add {name} to the names", { name: r.name }))}">${esc(r.name)}</button>${iviOf ? iviHtml(iviOf(r.name)) : ""}`;
};

const oneSidedHtml = (s) => (isOneSided(s) ? ` <span class="scr-group scr-one" title="${esc(tr("scr.oneSidedTip", "Almost no kills back (2% or less): not a fair fight."))}">${esc(tr("scr.oneSided", "One-sided"))}</span>` : "");

/**
 * One folded scrim: a header row (▸ · time · 🥊 Scrim · vs NAME · opponent iVi · Won 15–14 · 36 min)
 * and its kills & deaths as hidden rows right under it (data-scr ties them; ▸ opens them).
 */
export function scrimChunkHtml(item, now = Date.now(), iviOf = null, num = "", idx = 0) {
  const s = item.scrim;
  const by = new Map();
  for (const r of item.rows) if (!by.has(String(r.otherId))) by.set(String(r.otherId), r);
  const first = by.get(s.opp[0].id);
  const more = s.opp.length - 1;
  const all = s.opp.map((o) => { const r = by.get(o.id); return `${(r && r.name) || "?"} ${o.k}–${o.d}`; }).join(", ");
  const who = `<span class="kf-vs">${esc(tr("kf.vs", "vs"))}</span> ${nameBtn(first, null)}${more ? ` <span class="kf-more" title="${esc(all)}">+${more}</span>` : ""}`;
  const res = scrimResult(s);
  const end = s.t1 * 1000;
  const kind = s.kind === "group" ? tr("kf.groupScrim", "Group scrim") : tr("kf.scrim", "Scrim");
  const open = tr("kf.scrimOpen", "Show the scrim's kills & deaths");
  return `<tr class="kf-scr-row kf-scr-${res}" data-scr="${idx}"><td class="rk-num"><button type="button" class="kf-caret" aria-expanded="false" aria-label="${esc(open)}" title="${esc(open)}">${esc(num)}</button></td>` +
    timeCell(end, now, s.t0 * 1000) +
    `<td class="kf-c-mark"><span class="kf-mark kf-scr" title="${esc(tr("scr.ruleTip", "Scrim: 10+ kills and deaths in a row with one opponent (no 10-minute break), and that opponent is 60%+ of all kills and deaths in that time. Small groups (2–6 players) count too."))}">🥊 ${esc(kind)}</span></td>` +
    `<td class="kf-c-who">${who}</td><td class="kf-c-ivi">${first && first.name && iviOf && !more ? iviHtml(iviOf(first.name)) : ""}</td>` +
    `<td class="kf-c-gear"><span class="scr-res scr-${res}">${esc(scrimResultLabel(res))}</span> ${s.k.toLocaleString(lang())}–${s.d.toLocaleString(lang())} · ${esc(tr("scr.min", "{n} min", { n: scrimMinutes(s).toLocaleString(lang()) }))}${oneSidedHtml(s)}</td></tr>` +
    item.rows.map((r) => rowHtml(r, now, iviOf, "", true).replace("<tr ", `<tr data-of="${idx}" `)).join("");
}

export function scrimsNoteText(n, rows) {
  return tr("kf.scrimsNote", "🥊 Scrims folded below: {n} ({rows} kills & deaths), not counted in these numbers.", { n: n.toLocaleString(lang()), rows: rows.toLocaleString(lang()) });
}

export function summaryText(s) {
  return tr("kf.summary", "{k} kills · {d} deaths · K/D {kd} · headshots {hs} of kills", {
    k: s.kills.toLocaleString(lang()), d: s.deaths.toLocaleString(lang()),
    kd: s.kd == null ? "–" : s.kd.toFixed(2), hs: s.hsr == null ? "–" : `${(s.hsr * 100).toFixed(1)}%`,
  });
}

/**
 * @param section the <details id="killFeedSection">
 * @param opts getJson(url) → Promise<json>, baseOf(player) → Census base, addName(name, anchor),
 *   ratings(cb): optional; calls cb(iviOf) each time a (better) cached-rating lookup is ready.
 */
export function mountKillFeed(section, { getJson, baseOf, addName, ratings, scrims = () => false } = {}) {
  if (!section) return { setPlayers() {} };
  const status = section.querySelector(".kf-status");
  const sum = section.querySelector(".kf-summary");
  const list = section.querySelector(".kf-list"); // <tbody>
  const wrap = section.querySelector(".kf-scroll");
  const head = section.querySelector(".kf-table thead");
  const opened = new Set(); // scrim rows the reader opened (kept across repaints)
  const cache = new Map();
  let player = null, shownCid = null, shownRows = null, shownItems = null, iviOf = null, ratingsAsked = false;
  const paint = () => {
    if (!shownRows) return;
    const now = Date.now();
    if (head && !head.innerHTML) head.innerHTML = feedHeadHtml();
    let n = 0, k = 0;
    list.innerHTML = (shownItems || shownRows.map((r) => ({ r }))).map((it) => {
      n++;
      return it.scrim ? scrimChunkHtml(it, now, iviOf, String(n), k++) : rowHtml(it.r, now, iviOf, String(n));
    }).join("");
    for (const i of opened) setOpen(i, true);
  };

  function setStatus(text) { status.textContent = text || ""; status.hidden = !text; }
  function setOpen(i, on) {
    const row = list.querySelector(`tr.kf-scr-row[data-scr="${i}"]`);
    if (!row) return;
    row.classList.toggle("is-open", on);
    const b = row.querySelector(".kf-caret");
    if (b) b.setAttribute("aria-expanded", on ? "true" : "false");
    for (const r of list.querySelectorAll(`tr[data-of="${i}"]`)) r.hidden = !on;
    if (on) opened.add(i); else opened.delete(i);
  }

  async function show() {
    const p = player;
    if (!p || !p.cid || !section.open || shownCid === p.cid) return;
    if (ratings && !ratingsAsked) { ratingsAsked = true; try { ratings((fn) => { iviOf = fn; paint(); }); } catch (_) {} }
    let job = cache.get(p.cid);
    if (!job) {
      job = Promise.resolve().then(() => getJson(killFeedUrl(baseOf(p), p.cid))).then((j) => {
        if (!j || !Array.isArray(j.characters_event_list)) throw new Error("bad census reply");
        return parseKillFeed(j, p.cid);
      });
      cache.set(p.cid, job);
      job.catch(() => cache.delete(p.cid));
    }
    setStatus(tr("kf.loading", "Loading kills & deaths…"));
    try {
      const rows = await job;
      if (player !== p) return;
      shownCid = p.cid;
      if (!rows.length) { setStatus(tr("kf.none", "No kills or deaths found for this player.")); sum.hidden = true; wrap.hidden = true; return; }
      setStatus("");
      const g = scrims(p) ? groupFeedScrims(rows, p.cid) : null;
      if (g && g.scrims.length) {
        const inScrim = new Set(g.items.filter((it) => it.scrim).flatMap((it) => it.rows));
        sum.textContent = `${summaryText(summarizeKillFeed(rows.filter((r) => !inScrim.has(r))))} · ${scrimsNoteText(g.scrims.length, g.inScrim)}`;
        shownItems = g.items;
      } else {
        sum.textContent = summaryText(summarizeKillFeed(rows));
        shownItems = null;
      }
      sum.hidden = false;
      shownRows = rows;
      opened.clear();
      paint();
      wrap.hidden = false;
    } catch (_) {
      if (player !== p) return;
      setStatus(tr("kf.error", "Census is busy: close and open this block to try again."));
    }
  }

  section.addEventListener("toggle", () => { if (section.open) show(); });
  list.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("button.kf-name[data-name]");
    if (b) { if (addName) addName(b.dataset.name, b); return; }
    const row = e.target.closest && e.target.closest("tr.kf-scr-row");
    if (row) setOpen(row.dataset.scr, !row.classList.contains("is-open"));
  });

  return {
    /** Loaded players on the page; the block shows for exactly one. */
    setPlayers(players) {
      const one = players && players.length === 1 && players[0] && players[0].cid ? players[0] : null;
      section.hidden = !one;
      if (!one) { player = null; return; }
      if (player && player.cid === one.cid) return;
      player = one;
      shownCid = null;
      sum.hidden = true; sum.textContent = "";
      wrap.hidden = true; list.innerHTML = ""; shownRows = null; shownItems = null; opened.clear();
      setStatus("");
      show();
    },
  };
}
