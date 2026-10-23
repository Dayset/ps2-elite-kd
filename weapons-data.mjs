/**
 * 🏆 Auraxium weapons: Census weapon stats → auraxium-only rows (no DOM, no
 * i18n), shared by the page (weapons.mjs) and the refresh bots, which store a
 * packed copy in each player file (player.weapons) so the page rarely asks Census.
 */
export const AURAXIUM_KILLS = 1160;

const FAC_STATS = ["weapon_kills", "weapon_headshots", "weapon_vehicle_kills", "weapon_killed_by", "weapon_damage_given"];
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
  weapon_kills: "kills", weapon_headshots: "hs", weapon_vehicle_kills: "vk", weapon_killed_by: "killedBy", weapon_damage_given: "dmg",
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
    if (!o) by.set(id, (o = { id, kills: 0, hs: 0, vk: 0, killedBy: 0, dmg: 0, deaths: 0, shots: 0, hits: 0, secs: 0, score: 0 }));
    o[k] += v;
  };
  for (const r of facRows || []) add(r, (+r.value_vs || 0) + (+r.value_nc || 0) + (+r.value_tr || 0));
  for (const r of plainRows || []) add(r, +r.value || 0);
  const out = [];
  for (const o of by.values()) {
    if (o.kills < minKills) continue;
    out.push(derive(o));
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


function derive(o) {
    const mins = o.secs / 60;
    o.kpm = mins > 0 ? o.kills / mins : null;
    o.kd = o.deaths > 0 ? o.kills / o.deaths : null;
    o.acc = o.shots > 0 ? Math.min(1, o.hits / o.shots) : null;
    o.hsr = o.kills > 0 && o.shots > 0 ? Math.min(1, o.hs / o.kills) : null;
    o.vkpm = mins > 0 && o.vk > 0 ? o.vk / mins : null;
    // IvI = accuracy % × headshot % (same aim score as the site's public IvI).
    o.ivi = o.acc != null && o.hsr != null ? o.acc * 100 * o.hsr * 100 : null;
    o.spk = o.shots > 0 ? o.shots / o.kills : null;
    o.dph = o.hits > 0 && o.dmg > 0 ? o.dmg / o.hits : null;
    o.spm = mins > 0 && o.score > 0 ? o.score / mins : null;
    return o;
}

/** Fields kept in player files; derived stats are recomputed on read. */
const PACK = ["kills", "hs", "vk", "killedBy", "dmg", "deaths", "shots", "hits", "secs", "score"];

/** Rows → { v, at, rows: [[id, ...PACK]] } for player files / the browser cache. */
export function packWeapons(rows, at = Date.now()) {
  return { v: 1, at, rows: (rows || []).map((w) => [w.id, ...PACK.map((k) => w[k] || 0)]) };
}

/** Stored copy → rows with derived stats (same as summarizeWeapons), or null. */
export function unpackWeapons(packed) {
  if (!packed || packed.v !== 1 || !Array.isArray(packed.rows)) return null;
  return packed.rows.map((r) => derive(Object.fromEntries([["id", String(r[0])], ...PACK.map((k, i) => [k, +r[i + 1] || 0])])));
}

/** Both Census calls → packed auraxium rows. Throws on Census errors (caller keeps the old copy). */
export async function fetchWeapons(cid, { base, getJson, now = Date.now() }) {
  const u = weaponStatUrls(base, cid);
  const fac = await getJson(u.byFaction);
  const plain = await getJson(u.plain);
  if (!fac || !plain || fac.error || plain.error) throw new Error("Census weapon stats unavailable");
  return packWeapons(summarizeWeapons(fac.characters_weapon_stat_by_faction_list || [], plain.characters_weapon_stat_list || []), now);
}
