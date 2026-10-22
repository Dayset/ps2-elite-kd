/**
 * 🏆 Auraxium weapons: one player's weapons with 1,160+ kills (the auraxium
 * medal: 10 + 50 + 100 + 1,000 kills). Non-auraxium weapons are left out.
 *
 * Data: Census, read live in the browser (2 calls, the same collections the
 * 🪖 Infantry split already uses; Honu's CharacterWeaponStatCollection reads
 * them the same way):
 *  - characters_weapon_stat_by_faction: weapon_kills, weapon_headshots,
 *    weapon_vehicle_kills (value_vs + value_nc + value_tr)
 *  - characters_weapon_stat: weapon_deaths, weapon_fire_count,
 *    weapon_hit_count, weapon_play_time, weapon_score
 * Rows are per item + vehicle; we add them up per item. item_id 0 is not a weapon.
 *
 * Names / categories / images: assets/weapons/catalog.json + <image_id>.webp,
 * built weekly by scripts/build-weapon-catalog.mjs. Items missing from the
 * catalog are named with one live Census item call; an image missing locally
 * falls back to the Census file, then hides.
 *
 * Shown only when exactly one player is on the page; collapsed by default and
 * loaded on first open (no Census calls for people who never open it).
 */
import { t as tr, currentLang } from "./i18n.mjs";

export const AURAXIUM_KILLS = 1160;
export const CATALOG_URL = "assets/weapons/catalog.json";
export const IMG_DIR = "assets/weapons/";
export const CENSUS_IMG = "https://census.daybreakgames.com/files/ps2/images/static/";

const FAC_STATS = ["weapon_kills", "weapon_headshots", "weapon_vehicle_kills"];
const PLAIN_STATS = ["weapon_deaths", "weapon_fire_count", "weapon_hit_count", "weapon_play_time", "weapon_score"];

export function weaponStatUrls(base, cid) {
  const id = encodeURIComponent(String(cid));
  return {
    byFaction: `${base}characters_weapon_stat_by_faction?character_id=${id}&stat_name=${FAC_STATS.join(",")}&c:show=stat_name,item_id,value_vs,value_nc,value_tr&c:limit=5000`,
    plain: `${base}characters_weapon_stat?character_id=${id}&stat_name=${PLAIN_STATS.join(",")}&c:show=stat_name,item_id,value&c:limit=5000`,
  };
}

export function itemInfoUrl(base, ids) {
  return `${base}item?item_id=${ids.join(",")}&c:show=item_id,item_category_id,faction_id,name.en,image_id&c:join=item_category^show:name.en^inject_at:category&c:limit=500`;
}

const KEY = {
  weapon_kills: "kills", weapon_headshots: "hs", weapon_vehicle_kills: "vk",
  weapon_deaths: "deaths", weapon_fire_count: "shots", weapon_hit_count: "hits",
  weapon_play_time: "secs", weapon_score: "score",
};

/**
 * Per-item totals → auraxium rows only, most kills first.
 * Derived: kpm, kd (kills per death while holding it), acc, hsr, vkpm.
 */
export function summarizeWeapons(facRows, plainRows, minKills = AURAXIUM_KILLS) {
  const by = new Map();
  const add = (r, v) => {
    const k = KEY[r && r.stat_name];
    const id = String((r && r.item_id) || "0");
    if (!k || id === "0" || !Number.isFinite(v)) return;
    let o = by.get(id);
    if (!o) by.set(id, (o = { id, kills: 0, hs: 0, vk: 0, deaths: 0, shots: 0, hits: 0, secs: 0, score: 0 }));
    o[k] += v;
  };
  for (const r of facRows || []) add(r, (+r.value_vs || 0) + (+r.value_nc || 0) + (+r.value_tr || 0));
  for (const r of plainRows || []) add(r, +r.value || 0);
  const out = [];
  for (const o of by.values()) {
    if (o.kills < minKills) continue;
    const mins = o.secs / 60;
    o.kpm = mins > 0 ? o.kills / mins : null;
    o.kd = o.deaths > 0 ? o.kills / o.deaths : null;
    o.acc = o.shots > 0 ? Math.min(1, o.hits / o.shots) : null;
    o.hsr = o.kills > 0 && o.shots > 0 ? Math.min(1, o.hs / o.kills) : null;
    o.vkpm = mins > 0 && o.vk > 0 ? o.vk / mins : null;
    out.push(o);
  }
  out.sort((a, b) => b.kills - a.kills || (+a.id) - (+b.id));
  return out;
}

/** Catalog entry: [name, category, faction_id, image_id]. */
export function catalogEntry(cat, id) {
  const e = cat && cat.items && cat.items[id];
  return Array.isArray(e) ? { name: e[0] || "", category: e[1] || "", faction: +e[2] || 0, image: e[3] ? String(e[3]) : "" } : null;
}

/** Live Census item rows → the same shape. */
export function itemsFromCensus(list) {
  const out = {};
  for (const it of list || []) {
    if (!it || !it.item_id) continue;
    out[it.item_id] = {
      name: (it.name && it.name.en) || "",
      category: (it.category && it.category.name && it.category.name.en) || "",
      faction: +it.faction_id || 0,
      image: it.image_id ? String(it.image_id) : "",
    };
  }
  return out;
}

const FACTION_TAG = { 1: "VS", 2: "NC", 3: "TR", 4: "NSO" };

/* ------------------------------------------------------------- UI */

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lang = () => { try { return currentLang() || undefined; } catch { return undefined; } };
const n0 = (v) => (v == null ? "–" : Math.round(v).toLocaleString(lang()));
const n2 = (v) => (v == null ? "–" : v.toFixed(2));
const pc = (v) => (v == null ? "–" : `${(v * 100).toFixed(1)}%`);
const hrs = (s) => (!(s > 0) ? "–" : tr("wp.hours", "{n}h", { n: (s >= 36000 ? Math.round(s / 3600) : +(s / 3600).toFixed(1)).toLocaleString(lang()) }));

function columns() {
  return [
    { id: "kills", label: tr("wp.kills", "Kills"), hint: tr("wp.killsTip", "Kills with this weapon (auraxium at 1,160)."), fn: (w) => w.kills, fmt: n0 },
    { id: "kpm", label: "KPM", hint: tr("wp.kpmTip", "Kills per minute while holding this weapon."), fn: (w) => w.kpm, fmt: n2 },
    { id: "kd", label: "K/D", hint: tr("wp.kdTip", "Kills per death while holding this weapon."), fn: (w) => w.kd, fmt: n2 },
    { id: "acc", label: tr("wp.acc", "Acc"), hint: tr("wp.accTip", "Accuracy: hits / shots fired."), fn: (w) => w.acc, fmt: pc },
    { id: "hsr", label: "HSR", hint: tr("wp.hsrTip", "Headshot kills / kills."), fn: (w) => w.hsr, fmt: pc },
    { id: "vk", label: tr("wp.vk", "🚜 Veh kills"), hint: tr("wp.vkTip", "Vehicles destroyed with this weapon."), fn: (w) => w.vk || null, fmt: n0 },
    { id: "secs", label: tr("wp.time", "Time"), hint: tr("wp.timeTip", "Time spent holding this weapon."), fn: (w) => w.secs, fmt: hrs },
    { id: "score", label: tr("wp.score", "Score"), hint: tr("wp.scoreTip", "Score earned with this weapon."), fn: (w) => w.score || null, fmt: n0 },
  ];
}

function imgHtml(info) {
  if (!info || !info.image) return `<span class="wp-img wp-img-none" aria-hidden="true"></span>`;
  const id = esc(info.image);
  // Local copy first, Census second, then nothing.
  return `<img class="wp-img" loading="lazy" decoding="async" alt="" src="${IMG_DIR}${id}.webp" ` +
    `onerror="if(!this.dataset.f){this.dataset.f=1;this.src='${CENSUS_IMG}${id}.png'}else{this.style.visibility='hidden'}" />`;
}

/**
 * Mount the block. opts:
 *  - getJson(url) → Census JSON (app.js censusJson: pacing, retries)
 *  - baseOf(player) → Census base URL for that player's namespace
 *  - sortScroll(wrap, th, prevLeft) (optional, keeps the sorted column visible)
 */
export function mountWeapons(section, { getJson, baseOf, sortScroll } = {}) {
  if (!section) return { setPlayers() {} };
  const count = section.querySelector(".wp-count");
  const wrap = section.querySelector(".wp-scroll");
  const table = section.querySelector(".wp-table");
  const status = section.querySelector(".wp-status");
  const cache = new Map(); // cid → Promise<{rows, info}>
  let catalog = null;
  let player = null;
  let shown = null; // { cid, rows, info }
  let sortKey = "kills", sortDir = "desc";

  const loadCatalog = () =>
    catalog || (catalog = fetch(CATALOG_URL, { cache: "force-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null));

  async function load(p) {
    const base = baseOf(p);
    const u = weaponStatUrls(base, p.cid);
    const [fac, plain, cat] = await Promise.all([getJson(u.byFaction), getJson(u.plain), loadCatalog()]);
    const rows = summarizeWeapons(
      (fac && fac.characters_weapon_stat_by_faction_list) || [],
      (plain && plain.characters_weapon_stat_list) || [],
    );
    const info = {};
    const missing = [];
    for (const w of rows) {
      const e = catalogEntry(cat, w.id);
      if (e && e.name) info[w.id] = e;
      else missing.push(w.id);
    }
    if (missing.length) {
      try {
        const j = await getJson(itemInfoUrl(base, missing));
        Object.assign(info, itemsFromCensus(j && j.item_list));
      } catch (e) { /* names stay as ids */ }
    }
    return { rows, info };
  }

  function sorted(rows) {
    const col = columns().find((c) => c.id === sortKey);
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (w) => (sortKey === "name" ? null : col ? col.fn(w) : w.kills);
    return rows.slice().sort((a, b) => {
      if (sortKey === "name") {
        const an = (shown.info[a.id] && shown.info[a.id].name) || a.id, bn = (shown.info[b.id] && shown.info[b.id].name) || b.id;
        return dir * an.localeCompare(bn);
      }
      const x = val(a), y = val(b);
      if (x == null && y == null) return b.kills - a.kills;
      if (x == null) return 1;
      if (y == null) return -1;
      return dir * (x - y) || b.kills - a.kills;
    });
  }

  function render() {
    if (!shown) return;
    const cols = columns();
    const ind = (id) => `<span class="sort-ind${sortKey === id ? " active" : ""}">${sortKey === id ? (sortDir === "asc" ? "▲" : "▼") : "▼"}</span>`;
    const head =
      `<tr><th class="rk-num" scope="col">#</th>` +
      `<th class="wp-name sortable${sortKey === "name" ? " sorted" : ""}" data-sort="name" scope="col">${esc(tr("wp.weapon", "Weapon"))}${ind("name")}</th>` +
      cols.map((c) => `<th class="sortable${sortKey === c.id ? " sorted" : ""}" data-sort="${c.id}" scope="col" title="${esc(c.hint)}">${esc(c.label)}${ind(c.id)}</th>`).join("") +
      `</tr>`;
    const rows = sorted(shown.rows).map((w, i) => {
      const info = shown.info[w.id] || {};
      const name = info.name || `#${w.id}`;
      const sub = [info.category, FACTION_TAG[info.faction]].filter(Boolean).join(" · ");
      return `<tr><td class="rk-num">${i + 1}</td>` +
        `<td class="wp-name" title="${esc(name)}${sub ? ` (${esc(sub)})` : ""}"><div class="wp-cell">${imgHtml(info)}<span class="wp-label"><span class="wp-nm">${esc(name)}</span>${sub ? `<span class="wp-cat">${esc(sub)}</span>` : ""}</span></div></td>` +
        cols.map((c) => `<td>${c.fmt(c.fn(w))}</td>`).join("") + `</tr>`;
    }).join("");
    table.querySelector("thead").innerHTML = head;
    table.querySelector("tbody").innerHTML = rows;
  }

  function setStatus(text) {
    status.textContent = text || "";
    status.hidden = !text;
  }

  async function show() {
    const p = player;
    if (!p || !p.cid || !section.open) return;
    if (shown && shown.cid === p.cid) return;
    let job = cache.get(p.cid);
    if (!job) {
      job = load(p);
      cache.set(p.cid, job);
      job.catch(() => cache.delete(p.cid));
    }
    setStatus(tr("wp.loading", "Loading weapons from Census…"));
    try {
      const r = await job;
      if (player !== p) return;
      shown = { cid: p.cid, ...r };
      count.textContent = `(${r.rows.length})`;
      setStatus(r.rows.length ? "" : tr("wp.none", "No auraxium weapons yet (1,160 kills with one weapon)."));
      wrap.hidden = !r.rows.length;
      render();
    } catch (e) {
      if (player !== p) return;
      setStatus(tr("wp.error", "Census is busy: close and open this block to try again."));
    }
  }

  section.addEventListener("toggle", () => { if (section.open) show(); });
  table.addEventListener("click", (e) => {
    const th = e.target.closest("th[data-sort]");
    if (!th || !shown) return;
    const k = th.dataset.sort;
    if (sortKey === k) sortDir = sortDir === "asc" ? "desc" : "asc";
    else { sortKey = k; sortDir = k === "name" ? "asc" : "desc"; }
    const prevLeft = wrap.scrollLeft;
    render();
    if (sortScroll) sortScroll(wrap, table.querySelector(`th[data-sort="${k}"]`), prevLeft);
  });

  // Same header pin as the Rankings table: when the page is scrolled past the
  // box top while rows are still on screen, the column names follow the window top.
  {
    let queued = false, last = -1;
    const pin = () => {
      queued = false;
      if (wrap.hidden || !section.open) return;
      const r = wrap.getBoundingClientRect();
      const headH = table.tHead ? table.tHead.getBoundingClientRect().height : 0;
      let off = 0;
      if (r.top < 0 && r.bottom > headH) off = Math.min(-r.top, Math.max(0, wrap.clientHeight - headH));
      off = Math.round(off);
      if (off !== last) { last = off; table.style.setProperty("--rk-head-top", off + "px"); }
    };
    const q = () => { if (!queued) { queued = true; requestAnimationFrame(pin); } };
    window.addEventListener("scroll", q, { passive: true });
    window.addEventListener("resize", q, { passive: true });
  }

  return {
    /** Loaded players on the page; the block shows for exactly one. */
    setPlayers(list) {
      const one = list && list.length === 1 && list[0] && list[0].cid ? list[0] : null;
      section.hidden = !one;
      if (!one) { player = null; return; }
      if (player && player.cid === one.cid) return;
      player = one;
      shown = null;
      count.textContent = "";
      wrap.hidden = true;
      table.querySelector("thead").innerHTML = "";
      table.querySelector("tbody").innerHTML = "";
      setStatus("");
      show();
    },
  };
}
