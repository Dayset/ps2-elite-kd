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

export { AURAXIUM_KILLS, summarizeWeapons, weaponStatUrls, itemInfoUrl, catalogEntry, itemsFromCensus, packWeapons, unpackWeapons, fetchWeapons } from "./weapons-data.mjs?v=20261022-wpc1";
import { AURAXIUM_KILLS, summarizeWeapons, weaponStatUrls, itemInfoUrl, catalogEntry, itemsFromCensus, unpackWeapons, packWeapons } from "./weapons-data.mjs?v=20261022-wpc1";
export const CATALOG_URL = "assets/weapons/catalog.json";
export const IMG_DIR = "assets/weapons/";
export const CENSUS_IMG = "https://census.daybreakgames.com/files/ps2/images/static/";

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
    { id: "ivi", label: "IvI", hint: tr("wp.iviTip", "Aim score: accuracy % × headshot %."), fn: (w) => w.ivi, fmt: (v) => (v == null ? "–" : Math.round(v).toLocaleString(lang())) },
    { id: "hs", label: tr("wp.hs", "HS"), hint: tr("wp.hsTip", "Headshot kills."), fn: (w) => w.hs || null, fmt: n0 },
    { id: "spk", label: "SPK", hint: tr("wp.spkTip", "Shots per kill (lower = fewer shots needed)."), fn: (w) => w.spk, fmt: (v) => (v == null ? "–" : v.toFixed(1)), asc: true },
    { id: "dph", label: "DPH", hint: tr("wp.dphTip", "Damage per hit."), fn: (w) => w.dph, fmt: (v) => (v == null ? "–" : v.toFixed(1)) },
    { id: "vk", label: tr("wp.vk", "🚜 Veh kills"), hint: tr("wp.vkTip", "Vehicles destroyed with this weapon."), fn: (w) => w.vk || null, fmt: n0 },
    { id: "killedBy", label: tr("wp.killedBy", "☠️ Killed by"), hint: tr("wp.killedByTip", "Times enemies killed you with this weapon."), fn: (w) => w.killedBy || null, fmt: n0 },
    { id: "secs", label: tr("wp.time", "Time"), hint: tr("wp.timeTip", "Time spent holding this weapon."), fn: (w) => w.secs, fmt: hrs },
    { id: "score", label: tr("wp.score", "Score"), hint: tr("wp.scoreTip", "Score earned with this weapon."), fn: (w) => w.score || null, fmt: n0 },
    { id: "spm", label: "SPM", hint: tr("wp.spmTip", "Score per minute with this weapon."), fn: (w) => w.spm, fmt: (v) => (v == null ? "–" : Math.round(v).toLocaleString(lang())) },
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
export function mountWeapons(section, { getJson, baseOf, sortScroll, isFresh = () => false, lsKey = (cid) => `ps2-elite-kd-weapons:${cid}` } = {}) {
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

  // Browser copy per character (owner 2026-10-22: Census is slow / busy, so the
  // page reads the bot's copy in the player file and asks Census only when
  // there is none, or once after "Fetch fresh data").
  const lsGet = (cid) => { try { return JSON.parse(localStorage.getItem(lsKey(cid)) || "null"); } catch { return null; } };
  const lsSet = (cid, v) => { try { localStorage.setItem(lsKey(cid), JSON.stringify(v)); } catch {} };
  const liveDone = new Set();

  async function names(p, rows) {
    const cat = await loadCatalog();
    const info = {};
    const missing = [];
    for (const w of rows) {
      const e = catalogEntry(cat, w.id);
      if (e && e.name) info[w.id] = e;
      else missing.push(w.id);
    }
    if (missing.length) {
      try {
        const j = await getJson(itemInfoUrl(baseOf(p), missing));
        Object.assign(info, itemsFromCensus(j && j.item_list));
      } catch (e) { /* names stay as ids */ }
    }
    return info;
  }

  async function load(p) {
    const saved = [p.weapons, lsGet(p.cid)].filter((x) => x && x.v === 1).sort((a, b) => (b.at || 0) - (a.at || 0))[0] || null;
    const wantLive = !saved || (isFresh(p) && !liveDone.has(p.cid));
    let packed = saved, note = "";
    if (wantLive) {
      try {
        const u = weaponStatUrls(baseOf(p), p.cid);
        const [fac, plain] = await Promise.all([getJson(u.byFaction), getJson(u.plain)]);
        packed = packWeapons(summarizeWeapons(
          (fac && fac.characters_weapon_stat_by_faction_list) || [],
          (plain && plain.characters_weapon_stat_list) || [],
        ));
        liveDone.add(p.cid);
        lsSet(p.cid, packed);
      } catch (e) {
        if (!saved) throw e;
        note = tr("wp.staleNote", "Census is busy: showing the saved copy.");
      }
    }
    const rows = unpackWeapons(packed) || [];
    return { rows, info: await names(p, rows), at: packed.at, note };
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
    const ck = `${p.cid}:${isFresh(p) ? 1 : 0}`;
    if (shown && shown.ck === ck) return;
    let job = cache.get(ck);
    if (!job) {
      job = load(p);
      cache.set(ck, job);
      job.catch(() => cache.delete(ck));
    }
    setStatus(tr("wp.loading", "Loading weapons…"));
    try {
      const r = await job;
      if (player !== p) return;
      shown = { cid: p.cid, ck, ...r };
      count.textContent = `(${r.rows.length})`;
      const when = r.at ? new Date(r.at).toLocaleDateString(lang(), { day: "numeric", month: "short", year: "numeric" }) : "";
      const savedLine = when ? tr("wp.saved", "Saved {date}. Tick “{btn}” and Analyze to update.", { date: when, btn: tr("fresh.label", "Fetch fresh data") }) : "";
      setStatus([r.note, r.rows.length ? savedLine : tr("wp.none", "No auraxium weapons yet (1,160 kills with one weapon).")].filter(Boolean).join(" "));
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
    else { const col = columns().find((c) => c.id === k); sortKey = k; sortDir = k === "name" || (col && col.asc) ? "asc" : "desc"; }
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
