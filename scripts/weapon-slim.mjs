#!/usr/bin/env node
/**
 * Weapon comparison data, slim form (pure helpers + a CLI that converts the file on disk).
 *
 * scripts/build-weapon-catalog.mjs collects the full Census rows; the page only needs a few fields.
 * The full file was 2.8 MB, mostly 8,157 attachment items (cosmetic copies of ~60 parts, each with
 * its own copy of ~80 descriptions). slimRecoil() keeps:
 *   - fm2: only the fire modes the weapons use, only the fields the page reads;
 *   - groups: only the four stances the page shows, only the cone fields;
 *   - attachments: the parts with a slot (weapon-sim.mjs slotOf), each name + description once:
 *     atts = [[name, descIndex | -1]], descs = [text], att[itemId] = [index into atts].
 * cadenceOf() = { itemId: [burstCount, autoFireMs, refireMs, delayMs] } for weapons that fire bursts
 * or wind up before the first shot (fire_mode_2 fire_burst_count / fire_auto_fire_ms / fire_delay_ms).
 *
 * CLI: node scripts/weapon-slim.mjs  -> rewrites assets/weapons/recoil.json (slim) and cadence.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { slotOf } from "../weapon-sim.mjs";

const FM_KEEP = /^(recoil_|cof_recoil$|cof_pellet_spread$|pellet_spread$|fire_refire_ms$|fire_burst_count$|fire_auto_fire_ms$|fire_delay_ms$|reload_chamber_ms$|zoom_default$|move_modifier$|iron_sights$|psg$)/;
const ROW_KEEP = ["player_state_id", "cof_min", "cof_max", "cof_recovery_rate", "cof_recovery_delay_ms"];
const STANCES = new Set([0, 1, 2, 5]);

/** Full (old) or slim recoil object -> slim object. Idempotent. */
export function slimRecoil(full) {
  if (full.v === 2) return full;
  const usedFm = new Set(), usedPsg = new Set();
  for (const w of Object.values(full.weapons || {})) {
    for (const i of [0, 3]) if (w[i]) usedFm.add(String(w[i]));
    for (const i of [1, 4]) if (w[i]) usedPsg.add(String(w[i]));
  }
  const fm2 = {};
  for (const [id, row] of Object.entries(full.fm2 || {})) {
    if (!usedFm.has(id)) continue;
    fm2[id] = Object.fromEntries(Object.entries(row).filter(([k]) => FM_KEEP.test(k)));
  }
  const groups = {};
  for (const [id, rows] of Object.entries(full.groups || {})) {
    if (!usedPsg.has(id)) continue;
    groups[id] = rows.filter((r) => STANCES.has(r.player_state_id)).map((r) => Object.fromEntries(ROW_KEEP.filter((k) => r[k] !== undefined).map((k) => [k, r[k]])));
  }
  const atts = [], descs = [], attIdx = new Map(), descIdx = new Map(), att = {};
  for (const [wid, ids] of Object.entries(full.att || {})) {
    if (!full.weapons || !full.weapons[wid]) continue;
    const list = [];
    for (const a of ids) {
      const name = String((full.attNames || {})[a] || "").trim();
      if (!name || !slotOf(name)) continue;
      const desc = (full.attDesc || {})[a] || "";
      let d = -1;
      if (desc) { if (!descIdx.has(desc)) { descIdx.set(desc, descs.length); descs.push(desc); } d = descIdx.get(desc); }
      const key = name + "\u0000" + d;
      if (!attIdx.has(key)) { attIdx.set(key, atts.length); atts.push([name, d]); }
      const i = attIdx.get(key);
      if (!list.includes(i)) list.push(i);
    }
    if (list.length) att[wid] = list;
  }
  return { savedAt: full.savedAt, v: 2, weapons: full.weapons, fm2, groups, states: full.states, handling: full.handling, atts, descs, att };
}

/** { itemId: [burstCount, autoFireMs, refireMs, delayMs] } for burst / wind-up weapons (hip fire mode). */
export function cadenceOf(rec) {
  const out = {};
  for (const [id, w] of Object.entries(rec.weapons || {})) {
    const f = (rec.fm2 || {})[w[0]];
    if (!f) continue;
    const n = Math.round(f.fire_burst_count || 1), delay = f.fire_delay_ms || 0;
    if (n > 1 || delay > 0) out[id] = [Math.max(1, n), f.fire_auto_fire_ms || 0, f.fire_refire_ms || 0, delay];
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = new URL("../assets/weapons/", import.meta.url);
  const full = JSON.parse(readFileSync(new URL("recoil.json", dir), "utf8"));
  const slim = slimRecoil(full);
  writeFileSync(new URL("recoil.json", dir), JSON.stringify(slim) + "\n");
  writeFileSync(new URL("cadence.json", dir), JSON.stringify({ savedAt: slim.savedAt, cadence: cadenceOf(slim) }) + "\n");
  console.log(`recoil.json ${JSON.stringify(slim).length} bytes, ${slim.atts.length} attachment parts, ${slim.descs.length} descriptions; cadence ${Object.keys(cadenceOf(slim)).length} weapons`);
}
