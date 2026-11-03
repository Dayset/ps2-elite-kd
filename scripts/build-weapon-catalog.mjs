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
const fmById = new Map((await paged('fire_mode', 'fire_mode_id,type,description.en,reload_time_ms,pellets_per_shot,damage_max,damage_min,damage_max_range,damage_min_range')).map((r) => [r.fire_mode_id, r]));
const fm2ById = new Map((await paged('fire_mode_2', 'fire_mode_id,fire_refire_ms,damage_head_multiplier,automatic,max_damage,min_damage,max_damage_range,min_damage_range,fire_pellets_per_shot,reload_time_ms')).map((r) => [r.fire_mode_id, r]));
const magOf = new Map();
for (const r of await paged('weapon_ammo_slot', 'weapon_id,weapon_slot_index,clip_size')) {
  if (r.weapon_slot_index === '0') magOf.set(r.weapon_id, +r.clip_size);
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
