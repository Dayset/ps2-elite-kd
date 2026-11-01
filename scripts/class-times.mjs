#!/usr/bin/env node
/**
 * 🎯 Class play time (t826u, analysis for a possible Classes section; no page reads it yet).
 * Census characters_stat play_time per profile (lifetime, all servers of the room):
 *   1 Infiltrator, 3 Light Assault, 4 Combat Medic, 5 Engineer, 6 Heavy Assault, 7 MAX.
 * Census counts time in a vehicle under the class you spawned as (tankers often show as Engineer).
 * Cost: 1 Census call per 50 players (~340 PC + ~40 PS), paced 1/s. 0 Honu calls.
 * Writes data/class-times.json and data-ps/class-times.json:
 *   players: { key: [total hours, % Infiltrator, % Light Assault, % Medic, % Engineer, % Heavy Assault, % MAX] }
 * key = ranks slug (PC) or player file name (PS, e.g. "us-5428…").
 * Usage: node scripts/class-times.mjs [pc|ps|all]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CLASS_PROFILES = ["1", "3", "4", "5", "6", "7"];
export const CLASS_IDS = ["inf", "la", "med", "eng", "ha", "max"];

/** Census rows (character_id, profile_id, value_forever seconds) → Map id → compact [hours, %…]. */
export function compactClassTimes(rows) {
  const t = new Map();
  for (const r of rows || []) {
    const k = CLASS_PROFILES.indexOf(String(r.profile_id));
    if (k < 0) continue;
    const id = String(r.character_id);
    if (!t.has(id)) t.set(id, [0, 0, 0, 0, 0, 0]);
    t.get(id)[k] += +r.value_forever || 0;
  }
  const out = new Map();
  for (const [id, s] of t) {
    const tot = s.reduce((a, b) => a + b, 0);
    out.set(id, [Math.round(tot / 3600), ...s.map((x) => (tot ? Math.round((1000 * x) / tot) / 10 : 0))]);
  }
  return out;
}

/** Main class of a compact entry: { k (index in CLASS_IDS), id, share 0…1, hours } or null. */
export function mainClassOf(e) {
  if (!Array.isArray(e) || e.length < 7 || !(e[0] > 0)) return null;
  let k = 0;
  for (let i = 1; i < 6; i++) if (e[1 + i] > e[1 + k]) k = i;
  return { k, id: CLASS_IDS[k], share: e[1 + k] / 100, hours: e[0] };
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVICE = (process.env.CENSUS_SERVICE_ID || "").trim() || "daysetps2legends";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRoom(list, ns, stats) {
  const out = {};
  for (let i = 0; i < list.length; i += 50) {
    const part = list.slice(i, i + 50);
    const u = `https://census.daybreakgames.com/s:${SERVICE}/get/${ns}/characters_stat?character_id=${part.map((x) => x.cid).join(",")}&stat_name=play_time&c:show=character_id,profile_id,value_forever&c:limit=600`;
    let j = null;
    for (let t = 0; t < 4 && !j; t++) {
      stats.calls++;
      try { const r = await fetch(u); if (r.ok) { const b = await r.json(); if (b.characters_stat_list) j = b; } } catch {}
      if (!j) await sleep(4000);
    }
    if (!j) { stats.fails++; continue; }
    const m = compactClassTimes(j.characters_stat_list);
    for (const x of part) if (m.has(x.cid)) out[x.key] = m.get(x.cid);
    await sleep(1000);
  }
  return out;
}

function write(file, players, calls) {
  const body = { v: 1, fetchedAt: new Date().toISOString(), source: "Census characters_stat play_time per class profile (lifetime)", cols: ["hours", ...CLASS_IDS], calls, players };
  fs.writeFileSync(file, JSON.stringify(body) + "\n");
}

async function main(which) {
  if (which !== "ps") {
    const rk = JSON.parse(fs.readFileSync(path.join(ROOT, "data/ranks.json"), "utf8"));
    const si = rk.cols.indexOf("slug");
    const list = [];
    for (const r of rk.rows) {
      try { const j = JSON.parse(fs.readFileSync(path.join(ROOT, "data/players", r[si] + ".json"), "utf8")); const cid = (j.player || j).cid; if (cid) list.push({ key: r[si], cid: String(cid) }); } catch {}
    }
    const st = { calls: 0, fails: 0 };
    const pl = await fetchRoom(list, "ps2:v2", st);
    write(path.join(ROOT, "data/class-times.json"), pl, st.calls);
    console.log(`PC: ${Object.keys(pl).length}/${list.length} players, ${st.calls} Census calls, ${st.fails} failed batches`);
  }
  if (which !== "pc") {
    const groups = { us: [], eu: [] };
    for (const f of fs.readdirSync(path.join(ROOT, "data-ps/players"))) { const m = /^(us|eu)-(\d+)\.json$/.exec(f); if (m) groups[m[1]].push({ key: f.slice(0, -5), cid: m[2] }); }
    const st = { calls: 0, fails: 0 };
    const pl = { ...(await fetchRoom(groups.us, "ps2ps4us:v2", st)), ...(await fetchRoom(groups.eu, "ps2ps4eu:v2", st)) };
    write(path.join(ROOT, "data-ps/class-times.json"), pl, st.calls);
    console.log(`PS: ${Object.keys(pl).length} players, ${st.calls} Census calls, ${st.fails} failed batches`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv[2] || "all");
