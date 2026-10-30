/**
 * Outfit tags in the name field (t765u): typing "[WARP]" (a tag on its own, not "[WARP] Name") looks the outfit up
 * on Census and puts its members in as normal name chips, most recently online first, up to the free places in the
 * list. Order (owner t765u): members already in our cache first (no extra calls), then the rest by most recent
 * login, stopping at 6 months inactive; a "Fetch all" button in the note adds those too. Used by names-field.mjs.
 *
 * Census cost: 1 call to find the outfit (per server in the PlayStation room) + 1 call for its member list with
 * names and last login joined (one request even for ~7,600 members, measured 1.8 s / 550 kB on [DIG] 2026-10-30).
 * No Honu calls. The players added then load like any typed name.
 */
import { t as tr } from "./i18n.mjs";
import { escapeHtml, slugKey } from "./app-util.mjs?v=20261027-z79";
import { PS_SERVERS, nsOfBase } from "./rooms.mjs";

/** Members whose last login is this old or older are left for "Fetch all" (t765u: 6 months). */
export const INACTIVE_MS = 183 * 24 * 3600 * 1000;

/** Census member list ceiling for one outfit (the largest PC outfits have ~7,600). */
export const OUTFIT_MEMBER_LIMIT = 10000;

/* t766u (Dayset: "Yes, let outfit tags go past the 6-name limit"): players added from an outfit tag
 * don't use the 6 typed-name places. Safety cap: one list holds at most OUTFIT_MAX_NAMES of them,
 * so a huge outfit ([DIG] has 7,600+ members) can't start an hour-long run. Each new player is
 * ~8 Census calls at the polite 60/min pace (~8 s); 50 new players ≈ 7 min, saved ones are instant.
 * Honu is only a rare history fallback (≤ 1 call a player), far under its 10k a day. */
export const OUTFIT_MAX_NAMES = 50;
/** Seconds one not-yet-saved player takes at the polite Census pace (~8 calls at 60/min). */
export const SECONDS_PER_NEW_PLAYER = 8;
export const OUTFIT_ROSTER_KEY = "ps2kd.outfitNames";

/**
 * Which names in the field came from an outfit tag (lower case), kept for the tab's session so a
 * refresh keeps the big list. storage = sessionStorage (or a stub in tests).
 */
export function createOutfitRoster(storage) {
  let set = new Set();
  try { const a = JSON.parse((storage && storage.getItem(OUTFIT_ROSTER_KEY)) || "[]"); if (Array.isArray(a)) set = new Set(a.map((n) => String(n).toLowerCase())); } catch {}
  const save = () => { try { if (storage) set.size ? storage.setItem(OUTFIT_ROSTER_KEY, JSON.stringify([...set])) : storage.removeItem(OUTFIT_ROSTER_KEY); } catch {} };
  const has = (n) => set.has(String(n || "").toLowerCase());
  return {
    has,
    add(n) { set.add(String(n).toLowerCase()); save(); },
    delete(n) { if (set.delete(String(n || "").toLowerCase())) save(); },
    /** Forget names no longer in the field (a removed chip, a cleared box). */
    prune(tokens) { const keep = new Set((tokens || []).map((n) => String(n).toLowerCase())); let ch = false; for (const n of set) if (!keep.has(n)) { set.delete(n); ch = true; } if (ch) save(); },
    count(tokens) { return (tokens || []).filter(has).length; },
  };
}

/** May this name join the field? Outfit names: up to OUTFIT_MAX_NAMES; typed names: the normal limit. */
export function canTakeName({ tokens, isOutfit, outfit, typedMax, outfitMax = OUTFIT_MAX_NAMES }) {
  if (!Number.isFinite(typedMax)) return true; // debug view: no limit at all
  const nOutfit = (tokens || []).filter(isOutfit).length;
  if (outfit) return nOutfit < outfitMax;
  return (tokens || []).length - nOutfit < typedMax;
}

/** PC server names by world id (PlayStation servers come from rooms.mjs). */
export const WORLD_NAMES = Object.freeze({ 1: "Connery", 10: "Miller", 13: "Cobalt", 17: "Emerald", 19: "Jaeger", 40: "SolTech", 1000: "Genudine", 2000: "Ceres" });

const TAG = /^\[([A-Za-z0-9]{1,4})\]$/;

/** "[WARP]" → "warp"; anything else (a name, "[WARP] Name", "[toolong]") → null. */
export function outfitAlias(token) {
  const m = TAG.exec(String(token || "").trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * Pull stand-alone outfit tags out of raw field text. A tag followed by a name ("[WARP] Sarleyy") stays: that is the
 * old "[TAG] Name" form. A tag at the end, before a comma / semicolon, or before another tag is an outfit.
 * @returns {{ aliases: string[], rest: string }}
 */
export function extractOutfitTags(raw) {
  const s = String(raw || "");
  const aliases = [];
  const rest = s.replace(/(^|[\s,;])\[([A-Za-z0-9]{1,4})\](?=\s*(?:$|[,;]|\[))/g, (all, lead, a) => {
    const k = a.toLowerCase();
    if (!aliases.includes(k)) aliases.push(k);
    return lead;
  });
  return { aliases, rest: rest.trim() };
}

/** Census: the outfit with this alias, with its leader's server. */
export function outfitUrl(base, alias) {
  return (
    `${base}outfit?alias_lower=${encodeURIComponent(String(alias).toLowerCase())}` +
    "&c:show=outfit_id,name,alias,member_count,leader_character_id" +
    "&c:join=characters_world^on:leader_character_id^to:character_id^inject_at:leader&c:limit=10"
  );
}

/** Census: every member of an outfit with name and last login (one request). */
export function membersUrl(base, outfitId, limit = OUTFIT_MEMBER_LIMIT) {
  return (
    `${base}outfit_member?outfit_id=${encodeURIComponent(outfitId)}&c:limit=${limit}&c:show=character_id` +
    "&c:join=character^show:name.first'times.last_login^inject_at:c"
  );
}

/** Server name for an outfit row from a Census base (PS namespace) or its leader's world. */
export function outfitServer(row, base = "") {
  const ps = PS_SERVERS[nsOfBase(base)];
  if (ps) return ps.name;
  const w = row && row.leader && row.leader.world_id;
  return WORLD_NAMES[w] || "";
}

/**
 * Pick one outfit when the tag exists on several servers (only possible in the PlayStation room: PC aliases are
 * unique across all PC servers): the one with the most members. Returns { pick, others } (rows carry _base).
 */
export function pickOutfit(rows) {
  const list = (rows || []).filter((r) => r && r.outfit_id);
  if (!list.length) return { pick: null, others: [] };
  const sorted = [...list].sort((a, b) => (Number(b.member_count) || 0) - (Number(a.member_count) || 0));
  return { pick: sorted[0], others: sorted.slice(1) };
}

/**
 * Sort an outfit's members (t765u, owner): players already in our cache first (no extra calls), then the others by
 * most recent login, stopping at members inactive 6 months or more (kept apart for "Fetch all"). Skips blank names,
 * repeats, names already in the field and names on the removal list.
 * @param {object[]} members outfit_member_list rows ({ character_id, c: { name: { first }, times: { last_login } } })
 * @param {{ have?:string[], isCached?:(name:string)=>boolean, removed?:(m:{cid:string,name:string})=>boolean, now?:number }} o
 * @returns {{ cached:string[], active:string[], inactive:string[], total:number, already:number }}
 */
export function sortMembers(members, { have = [], isCached = null, removed = null, now = Date.now() } = {}) {
  const inField = new Set(have.map((n) => slugKey(n)).filter(Boolean));
  const seen = new Set();
  const cached = [], active = [], inactive = [];
  let already = 0;
  for (const m of members || []) {
    const name = String((m && m.c && m.c.name && m.c.name.first) || "").trim();
    const cid = String((m && m.character_id) || "");
    const key = slugKey(name);
    if (!name || !key || seen.has(key)) continue;
    seen.add(key);
    if (removed && removed({ cid, name })) continue;
    if (inField.has(key)) { already++; continue; }
    const last = (Number(m.c.times && m.c.times.last_login) || 0) * 1000;
    const row = { name, last };
    if (isCached && isCached(name)) cached.push(row);
    else if (now - last < INACTIVE_MS) active.push(row);
    else inactive.push(row);
  }
  const byLast = (a, b) => b.last - a.last || a.name.localeCompare(b.name);
  const names = (l) => l.sort(byLast).map((r) => r.name);
  return { cached: names(cached), active: names(active), inactive: names(inactive), total: seen.size, already };
}

/** Free places in the list right now (the 6-name limit; Infinity in the debug view, which has no limit). */
export function freePlaces(limit, used) {
  return Number.isFinite(limit) ? Math.max(0, limit - used) : Infinity;
}

/**
 * The field side. $ = names-field.mjs helpers and app.js state: addNameToField, censusJson, CENSUS_BASES, els,
 * isCached, nameTokens, outfitRoom (places left for outfit players), removedReady.
 */
export function createOutfitTags($) {
  let noteEl = null;
  function note(html, cls = "") {
    if (typeof document === "undefined") return;
    if (!noteEl) {
      noteEl = document.createElement("p");
      noteEl.id = "outfitNote";
      noteEl.className = "outfit-note";
      noteEl.setAttribute("role", "status");
      noteEl.setAttribute("aria-live", "polite");
      const box = document.getElementById("namesLimitNote") || document.getElementById("namesBox") || ($.els.namesInput && $.els.namesInput.parentElement);
      if (box && box.parentNode) box.parentNode.insertBefore(noteEl, box.nextSibling);
      else document.body.appendChild(noteEl);
      noteEl.addEventListener("click", (e) => {
        if (e.target.closest(".outfit-note-x")) noteEl.hidden = true;
        else if (e.target.closest(".outfit-fetch-all")) fetchAll();
      });
    }
    noteEl.hidden = !html;
    noteEl.className = "outfit-note" + (cls ? " " + cls : "");
    noteEl.innerHTML = html ? `${html} <button type="button" class="outfit-note-x" aria-label="${escapeHtml(tr("outfit.close", "Close"))}">×</button>` : "";
  }

  const busy = new Map(); // alias → promise (Enter + Analyze on the same tag fetch once)

  async function addOutfit(alias) {
    const tag = `[${alias.toUpperCase()}]`;
    if ($.outfitRoom() <= 0) {
      note(escapeHtml(tr("outfit.capFull", "The list already holds {max} outfit players, the most it takes. Remove some to add players from {tag}.", { tag, max: OUTFIT_MAX_NAMES })), "warn");
      return { added: 0 };
    }
    note(escapeHtml(tr("outfit.looking", "⏳ Looking up outfit {tag}…", { tag })));
    let found = [];
    try {
      const parts = await Promise.all(
        $.CENSUS_BASES.map(async (base) => {
          const j = await $.censusJson(outfitUrl(base, alias));
          return ((j && j.outfit_list) || []).map((r) => ({ ...r, _base: base }));
        })
      );
      found = parts.flat();
    } catch (e) {
      note(escapeHtml(tr("outfit.error", "Couldn't reach Daybreak Census for {tag}. Try again in a minute.", { tag })), "err");
      return { added: 0, error: true };
    }
    const { pick, others } = pickOutfit(found);
    if (!pick) {
      note(escapeHtml(tr("outfit.unknown", "No outfit with the tag {tag} was found. Check the tag, or type a player name.", { tag })), "warn");
      return { added: 0, unknown: true };
    }
    const server = outfitServer(pick, pick._base);
    const label = `[${pick.alias || alias.toUpperCase()}] ${String(pick.name || "").trim()}${server ? ` (${server})` : ""}`;
    note(escapeHtml(tr("outfit.loadingMembers", "⏳ {outfit}: loading {n} members…", { outfit: label, n: Number(pick.member_count) || 0 })));
    let members = [];
    try {
      const j = await $.censusJson(membersUrl(pick._base, pick.outfit_id));
      members = (j && j.outfit_member_list) || [];
    } catch (e) {
      note(escapeHtml(tr("outfit.error", "Couldn't reach Daybreak Census for {tag}. Try again in a minute.", { tag })), "err");
      return { added: 0, error: true };
    }
    let removed = null;
    try {
      const list = $.removedReady ? await $.removedReady() : null;
      if (list && list.size) removed = ({ cid, name }) => !!list.match({ cid, name, slug: slugKey(name), server });
    } catch {}
    const sorted = sortMembers(members, { have: $.nameTokens.slice(), isCached: (n) => $.isCached(n), removed });
    return report(label, others, sorted, addSome([...sorted.cached, ...sorted.active], sorted.cached));
  }

  /** Add names in order while there is room; returns { cached, fresh, noRoom }. */
  function addSome(names, cachedList = []) {
    const cachedSet = new Set(cachedList);
    let cached = 0, fresh = 0, noRoom = 0;
    for (const n of names) {
      if ($.outfitRoom() <= 0) { noRoom++; continue; }
      if (!$.addNameToField(n, { quiet: true, outfit: true })) { noRoom++; continue; }
      if (cachedSet.has(n)) cached++; else fresh++;
    }
    return { cached, fresh, noRoom };
  }

  function report(label, others, sorted, res, afterAll = false) {
    const added = res.cached + res.fresh;
    const parts = [];
    if (!sorted.total) parts.push(escapeHtml(tr("outfit.empty", "{outfit} has no members to add.", { outfit: label })));
    else if (!added && sorted.already && !sorted.cached.length && !sorted.active.length && !sorted.inactive.length) parts.push(escapeHtml(tr("outfit.allIn", "{outfit}: its members are already in the list.", { outfit: label })));
    else {
      parts.push(escapeHtml(tr("outfit.added", "{outfit}: added {added} of {total} members ({cached} already saved, {fresh} new).", { outfit: label, added, total: sorted.total, cached: res.cached, fresh: res.fresh })));
      if (res.noRoom > 0) parts.push(escapeHtml(tr("outfit.noRoom", "{n} more not added: a list takes at most {max} outfit players, to keep loading quick and polite to Daybreak's servers.", { n: res.noRoom, max: OUTFIT_MAX_NAMES })));
      const slowMin = Math.ceil((res.fresh * SECONDS_PER_NEW_PLAYER) / 60);
      if (res.fresh > 6) parts.push(escapeHtml(tr("outfit.slow", "Loading {n} new players takes about {min} min; ✕ stops it any time.", { n: res.fresh, min: slowMin })));
      if (!afterAll && sorted.inactive.length) parts.push(escapeHtml(tr("outfit.inactive", "{n} inactive for 6+ months skipped.", { n: sorted.inactive.length })));
    }
    if (others.length) {
      const also = others.map((o) => `[${o.alias}] ${String(o.name || "").trim()} (${outfitServer(o, o._base)})`).join(", ");
      parts.push(escapeHtml(tr("outfit.also", "Same tag also on: {list}.", { list: also })));
    }
    let html = parts.join(" ");
    const canMore = !afterAll && sorted.inactive.length && $.outfitRoom() > 0;
    if (canMore) {
      const hint = tr("outfit.fetchAllHint", "Adds the inactive members too. It might take a while.");
      html += ` <button type="button" class="outfit-fetch-all" title="${escapeHtml(hint)}">${escapeHtml(tr("outfit.fetchAll", "Fetch all"))}</button> <span class="outfit-note-sub">${escapeHtml(hint)}</span>`;
      pendingAll = () => {
        const r = addSome(sorted.inactive);
        report(label, others, { ...sorted, inactive: [] }, { cached: res.cached + r.cached, fresh: res.fresh + r.fresh, noRoom: res.noRoom + r.noRoom }, true);
        return r;
      };
    } else pendingAll = null;
    note(html, added ? "ok" : "warn");
    return { added, cached: res.cached, fresh: res.fresh, noRoom: res.noRoom, inactive: sorted.inactive.length, total: sorted.total, canMore: !!canMore };
  }

  let pendingAll = null;
  /** "Fetch all": add the inactive members the last tag skipped (button in the note). */
  function fetchAll() {
    const f = pendingAll;
    pendingAll = null;
    return f ? f() : null;
  }

  /** Expand every alias in order (each one fills what the one before left free). */
  function expand(aliases) {
    let chain = Promise.resolve([]);
    for (const a of aliases) {
      chain = chain.then(async (acc) => {
        if (!busy.has(a)) busy.set(a, addOutfit(a).finally(() => busy.delete(a)));
        acc.push(await busy.get(a));
        return acc;
      });
    }
    return chain;
  }

  return { expand, note, fetchAll };
}
