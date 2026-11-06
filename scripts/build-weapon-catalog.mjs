#!/usr/bin/env node
/**
 * 🏆 Auraxium weapons: local weapon catalog + images (weapons.mjs reads them).
 *
 *   assets/weapons/catalog.json   { savedAt, items: { <item_id>: [name, category, faction_id, image_id] } }
 *   assets/weapons/<image_id>.webp  112 px wide (shown at 56 px), from the Census static image
 *
 * Census `item` with item_type_id=26 (weapons, infantry and vehicle). Items are
 * the same ids on PC and PlayStation; the page names anything missing with one
 * live Census call. Images that already exist are kept (only new ones are
 * downloaded), so a weekly run costs a few calls.
 *
 * Runs in .github/workflows/weapon-catalog.yml. Runners can't reach Census, so
 * JSON and images go through the cache Worker (CENSUS_PROXY + CENSUS_PROXY_KEY;
 * images via its /census/files/ps2/images/static/<id>.png route). Locally,
 * without CENSUS_PROXY, it calls Census directly.
 *
 * Needs `cwebp` (apt package "webp") for the images; without it only the catalog is written.
 */
import { mkdirSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { slimRecoil, cadenceOf } from "./weapon-slim.mjs";

const OUT = "assets/weapons";
const SID = process.env.CENSUS_SERVICE_ID || "daysetps2legends";
const HOST = "https://census.daybreakgames.com";
const PROXY = String(process.env.CENSUS_PROXY || "").replace(/\/+$/, "");
const KEY = process.env.CENSUS_PROXY_KEY || "";
const UA = "ps2-elite-kd weapon-catalog (+https://dayset.github.io/ps2-elite-kd/)";
const MAX_IMAGES = +process.env.MAX_IMAGES || 3000;
const PAGE = 1000;
// Stop downloading before the job limit so the commit step still runs; the next run continues.
const BUDGET_MS = (+process.env.TIME_BUDGET_SEC || 18 * 60) * 1000;
const T0 = Date.now();

const via = (u) => (PROXY && u.startsWith(HOST + "/") ? `${PROXY}/census${u.slice(HOST.length)}` : u);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { binary = false } = {}) {
  const headers = { "User-Agent": UA };
  if (PROXY && KEY) headers["X-Proxy-Key"] = KEY;
  for (let a = 1; a <= 5; a++) {
    try {
      const r = await fetch(via(url), { headers, signal: AbortSignal.timeout(30000) });
      if (r.status === 404) return null;
      if (r.ok) {
        if (binary) return Buffer.from(await r.arrayBuffer());
        const j = await r.json();
        if (!j.error && !j.errorCode) return j;
      }
    } catch {}
    await sleep(1500 * a);
  }
  throw new Error(`failed: ${url}`);
}

const base = `${HOST}/s:${SID}/get/ps2:v2/`;

const cats = {};
for (const c of (await get(`${base}item_category?c:limit=1000&c:show=item_category_id,name.en`)).item_category_list || []) {
  cats[c.item_category_id] = (c.name && c.name.en) || "";
}

const items = {};
for (let start = 0; ; start += PAGE) {
  const j = await get(`${base}item?item_type_id=26&c:start=${start}&c:limit=${PAGE}&c:show=item_id,item_category_id,faction_id,name.en,image_id`);
  const list = (j && j.item_list) || [];
  for (const it of list) {
    if (!it.item_id) continue;
    items[it.item_id] = [(it.name && it.name.en) || "", cats[it.item_category_id] || "", +it.faction_id || 0, it.image_id ? +it.image_id : 0];
  }
  if (list.length < PAGE) break;
  await sleep(300);
}
const n = Object.keys(items).length;
if (n < 500) throw new Error(`only ${n} weapon items from Census; keeping the old catalog`);
mkdirSync(OUT, { recursive: true });
const sorted = Object.fromEntries(Object.entries(items).sort((a, b) => +a[0] - +b[0]));
writeFileSync(join(OUT, "catalog.json"), JSON.stringify({ savedAt: new Date().toISOString(), items: sorted }) + "\n");
console.log(`catalog: ${n} weapons, ${Object.keys(cats).length} categories`);

// ---- fire profiles (issue #94) -------------------------------------------
// Bulk-join the six Census collections locally (one query per weapon would be
// ~400 calls; paged bulk fetches are ~20). Primary fire mode = fire_mode.type
// "primary", first by fire_mode_index; reload/damage/pellets from fire_mode,
// refire + head bonus from fire_mode_2 on the same fire_mode_id, mag =
// weapon_ammo_slot slot 0 clip_size. Mode from description.en (Pump -> semi,
// documented approximation; unknown -> the fire_mode_2 automatic flag).
// Only INF_CATS items are written; the rest is logged. Kept in sync with
// scripts/build-replay.mjs INF_CATS.
const INF_CATS = new Set(['Pistol', 'LMG', 'Assault Rifle', 'SMG', 'Carbine', 'Sniper Rifle', 'Scout Rifle', 'Shotgun', 'Heavy Weapon', 'Battle Rifle', 'Crossbow', 'Infantry Weapons', 'Hybrid Rifle']);
async function paged(coll, show) {
  const out = [];
  for (let start = 0; ; start += PAGE) {
    const j = await get(`${base}${coll}?c:start=${start}&c:limit=${PAGE}&c:show=${show}`);
    const list = (j && j[`${coll}_list`]) || [];
    out.push(...list);
    if (list.length < PAGE) break;
    await sleep(300);
  }
  return out;
}
const weaponOf = new Map((await paged('item_to_weapon', 'item_id,weapon_id')).map((r) => [r.item_id, r.weapon_id]));
const groupsOf = new Map();
for (const r of await paged('weapon_to_fire_group', 'weapon_id,fire_group_id')) {
  if (!groupsOf.has(r.weapon_id)) groupsOf.set(r.weapon_id, []);
  groupsOf.get(r.weapon_id).push(r.fire_group_id);
}
const modesOf = new Map();
for (const r of await paged('fire_group_to_fire_mode', 'fire_group_id,fire_mode_id,fire_mode_index')) {
  if (!modesOf.has(r.fire_group_id)) modesOf.set(r.fire_group_id, []);
  modesOf.get(r.fire_group_id).push({ id: r.fire_mode_id, idx: +r.fire_mode_index || 0 });
}
const fmById = new Map((await paged('fire_mode', 'fire_mode_id,type,description.en,player_state_group_id,cof_recoil,pellet_spread,reload_time_ms,pellets_per_shot,damage_max,damage_min,damage_max_range,damage_min_range')).map((r) => [r.fire_mode_id, r]));
const fm2ById = new Map((await paged('fire_mode_2', 'fire_mode_id,fire_refire_ms,damage_head_multiplier,automatic,max_damage,min_damage,max_damage_range,min_damage_range,fire_pellets_per_shot,reload_time_ms')).map((r) => [r.fire_mode_id, r]));
const magOf = new Map(), capOf = new Map();
for (const r of await paged('weapon_ammo_slot', 'weapon_id,weapon_slot_index,clip_size,capacity')) {
  if (r.weapon_slot_index === '0') { magOf.set(r.weapon_id, +r.clip_size); capOf.set(r.weapon_id, +r.capacity || 0); }
}
const modeOf = (en, auto) => {
  if (!en) return auto === '1' ? 'auto' : 'semi';
  if (/burst/i.test(en)) return 'burst';
  if (/bolt/i.test(en)) return 'bolt';
  if (/semi/i.test(en) || /pump/i.test(en)) return 'semi';
  if (/auto/i.test(en)) return 'auto';
  return auto === '1' ? 'auto' : 'semi';
};
const profiles = {}, uncovered = [];
for (const [id, e] of Object.entries(items)) {
  if (!INF_CATS.has(e[1])) continue;
  const w = weaponOf.get(id), groups = w ? groupsOf.get(w) || [] : [];
  let mode = null;
  for (const g of groups) {
    const ms = (modesOf.get(g) || []).map((x) => ({ m: fmById.get(x.id), idx: x.idx })).filter((x) => x.m)
      .sort((a, b) => a.idx - b.idx).map((x) => x.m);
    mode = ms.find((m) => m.type === 'primary') || ms[0] || null;
    if (mode) break;
  }
  const f2 = mode ? fm2ById.get(mode.fire_mode_id) : null;
  const refire = f2 ? +f2.fire_refire_ms : 0, mag = w ? magOf.get(w) : undefined;
  // damage usually lives on fire_mode; 26 weapons (Jackhammer, Tomoe, Thumper,
  // Soakers, ...) carry it only on fire_mode_2, with min/range 0 = falloff not
  // recorded -> flat max damage. Pellets/reload fall back the same way.
  const dmgMax = mode?.damage_max ?? f2?.max_damage;
  let dmgMin = mode?.damage_min ?? f2?.min_damage;
  if (dmgMax != null && !+dmgMin) dmgMin = dmgMax;
  const rangeMax = mode?.damage_max_range ?? f2?.max_damage_range ?? 0;
  const rangeMin = mode?.damage_min_range ?? f2?.min_damage_range ?? 0;
  const pellets = mode?.pellets_per_shot ?? f2?.fire_pellets_per_shot;
  const reloadMs = mode?.reload_time_ms ?? f2?.reload_time_ms;
  if (!mode || !refire || mag == null || dmgMax == null) { uncovered.push(id); continue; }
  profiles[id] = [Math.round(60000 / refire), mag, +reloadMs, +dmgMax, +dmgMin,
    +rangeMax, +rangeMin, 1 + (+f2.damage_head_multiplier || 0),
    +pellets || 1, modeOf(mode.description?.en, f2.automatic)];
}
writeFileSync(join(OUT, "profiles.json"), JSON.stringify({ savedAt: new Date().toISOString(), profiles }) + "\n");
console.log(`::notice::weapon profiles: ${Object.keys(profiles).length} infantry, ${uncovered.length} uncovered: ${uncovered.join(',') || 'none'}`);

// ---- recoil / cone of fire (weapon comparison page) --------------------------
// assets/weapons/recoil.json: { savedAt, weapons: { <item_id>: [hip fire_mode_id, hip player_state_group_id,
//   ammo pool, ADS fire_mode_id, ADS player_state_group_id] }, handling: { <item_id>: {equip_ms, to_iron_sights_ms,
//   ..., projectile_speed} }, states: { <player_state_id>: Census stance name },
//   fm2: { <fire_mode_id>: {recoil_*, cof_*, sway_*, fire_*, reload_* numbers} },
//   groups: { <player_state_group_id>: [ {player_state_id, cof_*, ...} per stance ] } }
// Census collections fire_mode_2 and player_state_group_2 (the cache Worker must allow
// digits in collection names). Only numeric fields whose name starts with recoil_, cof_,
// sway_, fire_ or move_ are kept; everything else stays in Census. A failure here never
// stops the catalog or the images: it is logged as a warning and the old file stays.
try {
  // Every fire group holds a hip-fire mode (iron_sights 0) and an aim-down-sights mode
  // (iron_sights 1), each with its own player_state_group (cone per stance). The first group
  // with modes is the weapon's main one (same rule as Izubrr/planetside_weapon_compare).
  const groupModes = new Map();   // item id -> [fire_mode_id, ...] of the first group
  for (const id of Object.keys(profiles)) {
    const w = weaponOf.get(id), groups = w ? groupsOf.get(w) || [] : [];
    for (const g of groups) {
      const ms = (modesOf.get(g) || []).filter((x) => fmById.get(x.id)).sort((a, b) => a.idx - b.idx).map((x) => x.id);
      if (ms.length) { groupModes.set(id, ms); break; }
    }
  }
  const modeIds = new Set([...groupModes.values()].flat());
  const keep = (row) => {
    const o = {};
    for (const [k, v] of Object.entries(row)) {
      if (!/^(recoil_|cof_|sway_|fire_|move_|reload_|bullet_|zoom_|iron_|charge_|damage_head|damage_legs)/.test(k) || /_id$/.test(k)) continue;
      const n = Number(v);
      if (v !== '' && Number.isFinite(n)) o[k] = n;
    }
    return o;
  };
  async function pagedAll(coll, want) {
    const out = [];
    for (let start = 0; ; start += 500) {
      const j = await get(`${base}${coll}?c:start=${start}&c:limit=500`);
      const list = (j && j[`${coll}_list`]) || [];
      for (const r of list) if (want(r)) out.push(r);
      if (list.length < 500) break;
      await sleep(300);
    }
    return out;
  }
  const fm2 = {};
  for (const r of await pagedAll('fire_mode_2', (r) => modeIds.has(r.fire_mode_id))) {
    const fm = fmById.get(r.fire_mode_id) || {};
    fm2[r.fire_mode_id] = { ...keep(r), ...(+fm.cof_recoil ? { cof_recoil: +fm.cof_recoil } : {}), ...(+fm.pellet_spread ? { pellet_spread: +fm.pellet_spread } : {}), psg: +(r.player_state_group_id || fm.player_state_group_id || 0) };
  }
  const pick = (id) => {
    const ms = (groupModes.get(id) || []).filter((m) => fm2[m]);
    const hip = ms.find((m) => fm2[m].iron_sights === 0) || ms[0];
    const ads = ms.find((m) => fm2[m].iron_sights === 1) || null;
    return { hip, ads };
  };
  const groupIds = new Set();
  for (const id of Object.keys(profiles)) {
    const { hip, ads } = pick(id);
    for (const m of [hip, ads]) if (m && fm2[m].psg) groupIds.add(String(fm2[m].psg));
  }
  const groups = {};
  for (const r of await pagedAll('player_state_group_2', (r) => groupIds.has(r.player_state_group_id))) {
    (groups[r.player_state_group_id] ||= []).push({ player_state_id: +r.player_state_id, ...keep(r) });
  }
  // handling (weapon) and projectile speed / gravity of the hip mode
  const handlingOf = new Map();
  for (const r of await paged('weapon', 'weapon_id,equip_ms,unequip_ms,to_iron_sights_ms,from_iron_sights_ms,sprint_recovery_ms,move_modifier,turn_modifier')) {
    const o = {};
    for (const k of ['equip_ms', 'unequip_ms', 'to_iron_sights_ms', 'from_iron_sights_ms', 'sprint_recovery_ms', 'move_modifier', 'turn_modifier']) if (r[k] !== undefined && r[k] !== '') o[k] = +r[k];
    handlingOf.set(r.weapon_id, o);
  }
  const projOfMode = new Map();
  for (const r of await paged('fire_mode_to_projectile', 'fire_mode_id,projectile_id')) if (modeIds.has(r.fire_mode_id) && !projOfMode.has(r.fire_mode_id)) projOfMode.set(r.fire_mode_id, r.projectile_id);
  const projIds = new Set(projOfMode.values());
  const proj = new Map();
  for (const r of await pagedAll('projectile', (r) => projIds.has(r.projectile_id))) proj.set(r.projectile_id, { speed: +r.speed || 0, gravity: +r.gravity || 0, drag: +r.drag || 0, lifespan: +r.lifespan || 0 });
  const weapons = {}, handling = {};
  for (const id of Object.keys(profiles)) {
    const { hip, ads } = pick(id);
    if (!hip) continue;
    weapons[id] = [+hip, +(fm2[hip].psg || 0), capOf.get(weaponOf.get(id)) || 0, ads ? +ads : 0, ads ? +(fm2[ads].psg || 0) : 0];
    const h = { ...(handlingOf.get(weaponOf.get(id)) || {}) };
    const pr = proj.get(projOfMode.get(hip));
    if (pr) Object.assign(h, { projectile_speed: pr.speed, projectile_gravity: pr.gravity });
    if (Object.keys(h).length) handling[id] = h;
  }
  if (Object.keys(weapons).length < 100 || !Object.keys(groups).length) throw new Error(`only ${Object.keys(weapons).length} weapons / ${Object.keys(groups).length} state groups`);
  // every attachment a weapon can mount (item_attachment -> item name + item category). Numeric
  // effects are NOT in Census: weapon-sim.mjs ATTACHMENTS holds the hand-typed ones.
  const attRows = await pagedAll('item_attachment', (r) => profiles[r.item_id]);
  const attIds = [...new Set(attRows.map((r) => r.attachment_item_id))];
  const attName = {}, attCatId = {}, attDesc = {};
  for (let i = 0; i < attIds.length; i += 60) {
    const j = await get(`${base}item?item_id=${attIds.slice(i, i + 60).join(',')}&c:show=item_id,name.en,item_category_id,item_type_id,description.en&c:limit=100`);
    for (const it of (j && j.item_list) || []) {
      attName[it.item_id] = (it.name && it.name.en) || '';
      attCatId[it.item_id] = +it.item_category_id || 0;
      if (it.description && it.description.en) attDesc[it.item_id] = it.description.en;
    }
    await sleep(200);
  }
  const catIds = new Set(Object.values(attCatId));
  const catName = {};
  for (const r of await pagedAll('item_category', (r) => catIds.has(+r.item_category_id))) catName[r.item_category_id] = (r.name && r.name.en) || '';
  const attCat = {};
  for (const [id, c] of Object.entries(attCatId)) attCat[id] = catName[c] || String(c);
  const att = {}, attDefault = {};
  for (const r of attRows) {
    if (!attName[r.attachment_item_id]) continue;
    (att[r.item_id] ||= []).push(+r.attachment_item_id);
    if (String(r.is_default) === '1') (attDefault[r.item_id] ||= []).push(+r.attachment_item_id);
  }
  const states = {};
  for (const r of await pagedAll('player_state', () => true)) states[r.player_state_id] = (r.description && (r.description.en || r.description)) || '';
  // the page reads the slim form (scripts/weapon-slim.mjs: only used fields, attachment names and texts once)
  const slim = slimRecoil({ savedAt: new Date().toISOString(), weapons, fm2, groups, states, handling, attNames: attName, attCat, attDesc, att, attDefault });
  writeFileSync(join(OUT, "recoil.json"), JSON.stringify(slim) + "\n");
  writeFileSync(join(OUT, "cadence.json"), JSON.stringify({ savedAt: slim.savedAt, cadence: cadenceOf(slim) }) + "\n");
  console.log(`::notice::weapon recoil: ${Object.keys(weapons).length} weapons, ${Object.keys(fm2).length} fire modes, ${Object.keys(groups).length} state groups`);
} catch (e) {
  console.log(`::warning::weapon recoil not updated: ${e.message}`);
}

let hasCwebp = true;
try { execFileSync("cwebp", ["-version"], { stdio: "ignore" }); } catch { hasCwebp = false; }
if (!hasCwebp) {
  console.log("::warning::cwebp missing: catalog written, images skipped");
  process.exit(0);
}

const imgs = [...new Set(Object.values(items).map((e) => e[3]).filter(Boolean))].filter((id) => !existsSync(join(OUT, `${id}.webp`)));
const tmp = join(tmpdir(), "wp-img.png");
let ok = 0, miss = 0, done = 0;
for (const id of imgs.slice(0, MAX_IMAGES)) {
  if (Date.now() - T0 > BUDGET_MS) break;
  done++;
  let buf = null;
  try { buf = await get(`${HOST}/files/ps2/images/static/${id}.png`, { binary: true }); } catch {}
  if (!buf || buf.length < 100) { miss++; continue; }
  writeFileSync(tmp, buf);
  try {
    execFileSync("cwebp", ["-quiet", "-q", "82", "-alpha_q", "90", "-resize", "112", "0", tmp, "-o", join(OUT, `${id}.webp`)]);
    ok++;
  } catch { miss++; }
  await sleep(120);
}
try { rmSync(tmp); } catch {}
console.log(`::notice::weapon catalog: ${n} weapons; images ${ok} new, ${miss} unavailable, ${imgs.length - done} left for next run`);
