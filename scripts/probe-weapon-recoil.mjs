#!/usr/bin/env node
/**
 * One-off probe (weapon comparison page): which recoil / cone-of-fire / attachment
 * fields does Census really carry? Dumps the full records of a few weapons and the
 * key list of candidate attachment collections to assets/weapons/recoil-probe.json.
 * Runs in .github/workflows/weapon-recoil-probe.yml (runners reach Census through the cache Worker).
 */
import { readFileSync, writeFileSync } from "node:fs";

const SID = process.env.CENSUS_SERVICE_ID || "daysetps2legends";
const HOST = "https://census.daybreakgames.com";
const PROXY = String(process.env.CENSUS_PROXY || "").replace(/\/+$/, "");
const KEY = process.env.CENSUS_PROXY_KEY || "";
const via = (u) => (PROXY && u.startsWith(HOST + "/") ? `${PROXY}/census${u.slice(HOST.length)}` : u);
const base = `${HOST}/s:${SID}/get/ps2:v2/`;
const headers = { "User-Agent": "ps2-elite-kd weapon-recoil-probe (+https://dayset.github.io/ps2-elite-kd/)" };
if (PROXY && KEY) headers["X-Proxy-Key"] = KEY;

async function get(path) {
  for (let a = 1; a <= 4; a++) {
    try {
      const r = await fetch(via(base + path), { headers, signal: AbortSignal.timeout(30000) });
      const text = await r.text();
      try { return { status: r.status, json: JSON.parse(text) }; } catch { return { status: r.status, text: text.slice(0, 200) }; }
    } catch (e) { if (a === 4) return { error: String(e) }; }
    await new Promise((r) => setTimeout(r, 1500 * a));
  }
}
const list = (res, coll) => (res && res.json && res.json[`${coll}_list`]) || [];

const catalog = JSON.parse(readFileSync("assets/weapons/catalog.json", "utf8")).items;
const wanted = ["NSX Naginata", "NC1 Gauss Rifle", "T1 Cycler", "Pulsar VS1", "NC6 Gauss SAW"];
const ids = wanted.map((n) => Object.entries(catalog).find(([, v]) => v[0] === n)?.[0]).filter(Boolean);

const out = { savedAt: new Date().toISOString(), weapons: {}, collections: {}, attachments: {} };
// fire_mode_2 has no usable single-key filter: page it whole and pick our ids locally
const wantModes = new Set();
const pre = {};
for (const id of ids) {
  const w = {};
  const iw = await get(`item_to_weapon?item_id=${id}`);
  const weaponId = list(iw, "item_to_weapon")[0]?.weapon_id;
  w.weapon_id = weaponId;
  w.weapon = list(await get(`weapon?weapon_id=${weaponId}`), "weapon")[0];
  w.datasheet = list(await get(`weapon_datasheet?item_id=${id}`), "weapon_datasheet")[0] || null;
  const groups = list(await get(`weapon_to_fire_group?weapon_id=${weaponId}`), "weapon_to_fire_group").map((r) => r.fire_group_id);
  w.fire_groups = groups;
  w.fire_modes = [];
  for (const g of groups.slice(0, 1)) {
    const fm = list(await get(`fire_group_to_fire_mode?fire_group_id=${g}`), "fire_group_to_fire_mode");
    for (const m of fm.slice(0, 2)) {
      const mode = list(await get(`fire_mode?fire_mode_id=${m.fire_mode_id}`), "fire_mode")[0];
      const psg = mode?.player_state_group_id ? list(await get(`player_state_group_2?player_state_group_id=${mode.player_state_group_id}&c:limit=20`), "player_state_group_2") : [];
      wantModes.add(String(m.fire_mode_id));
      w.fire_modes.push({ fire_mode_id: m.fire_mode_id, fire_mode: mode, player_state_group_2: psg, fire_mode_2: null });
    }
  }
  // attachments: weapon item -> attachment items (+ their names)
  const att = list(await get(`item_attachment?item_id=${id}&c:limit=50`), "item_attachment");
  w.attachments = [];
  for (const a of att.slice(0, 20)) {
    const it = list(await get(`item?item_id=${a.attachment_item_id}&c:show=item_id,name.en,description.en,item_category_id`), "item")[0];
    w.attachments.push({ attachment_item_id: a.attachment_item_id, item: it || null });
  }
  out.weapons[catalog[id][0]] = w;
}
for (let start = 0; ; start += 1000) {
  const rows = list(await get(`fire_mode_2?c:start=${start}&c:limit=1000`), "fire_mode_2");
  for (const r of rows) if (wantModes.has(String(r.fire_mode_id))) for (const w of Object.values(out.weapons)) for (const m of w.fire_modes) if (String(m.fire_mode_id) === String(r.fire_mode_id)) m.fire_mode_2 = r;
  if (rows.length < 1000) break;
}
for (const c of ["item_attachment", "weapon_to_attachment", "weapon_datasheet", "attachment", "player_state", "player_state_group_2", "firing_mode_modifier", "weapon_modifier", "item_modifier"]) {
  const r = await get(`${c}?c:limit=2`);
  const rows = list(r, c);
  out.collections[c] = { status: r.status, count: rows.length, sample: rows[0] || null, note: rows.length ? undefined : (r.json && (r.json.error || r.json.errorMessage)) || r.text || r.error };
}
writeFileSync("assets/weapons/recoil-probe.json", JSON.stringify(out, null, 1) + "\n");
console.log(`::notice::recoil probe: ${Object.keys(out.weapons).length} weapons, collections ${Object.entries(out.collections).map(([k, v]) => `${k}=${v.count}`).join(" ")}`);
