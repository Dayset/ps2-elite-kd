#!/usr/bin/env node
/**
 * 🚫 Self-service removals (#61): copy what players did on the privacy page
 * (oracle Worker GET /privacy/list, proven by the in-game logout sign-in) into
 * this room's opt-out.json. "removed" adds the character (key = cid on PC,
 * us-/eu-<cid> on PlayStation) with its proof; "shown" takes it off again.
 * Owner-added entries for other characters are never touched.
 *
 * Called by refresh-cache.mjs (room pc → data/) and refresh-ps.mjs (room ps →
 * data-ps/) right before purge-removed.mjs, so a removal is applied by the next
 * run of that room's bot. Never throws: no key or no network = nothing changes.
 *   node scripts/sync-removals.mjs [--room ps]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ORACLE_URL = (process.env.ORACLE_URL || "https://ps2-oracle.dayset.workers.dev").replace(/\/+$/, "");
const IDENT = /^(?:(us|eu)-)?(\d{5,25})$/;

/** Pure: apply oracle rows to an opt-out.json object for one room. Returns { json, added, restored }. */
export function applyRemovals(optJson, rows, room = "pc") {
  const json = optJson && typeof optJson === "object" ? { ...optJson } : {};
  const players = { ...((json.players && typeof json.players === "object" && json.players) || {}) };
  const added = [], restored = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const m = IDENT.exec(String((r && r.ident) || ""));
    if (!m) continue;
    const isPs = !!m[1];
    if ((room === "ps") !== isPs) continue; // each room only writes its own file
    const key = r.ident;
    if (r.status === "removed") {
      const at = new Date((+r.at || 0) * 1000).toISOString().slice(0, 10);
      const entry = { name: String(r.name || ""), at, proof: String(r.proof || "sign-in by in-game logout"), source: "self-service" };
      const prev = players[key];
      if (!prev || prev.name !== entry.name || prev.at !== entry.at || prev.proof !== entry.proof || prev.source !== entry.source) {
        players[key] = entry;
        added.push(key);
      }
    } else if (r.status === "shown" && players[key]) {
      delete players[key];
      restored.push(key);
    }
  }
  json.players = players;
  return { json, added, restored };
}

/** Fetch the oracle list and update <dataDir>/opt-out.json. Never throws. */
export async function syncRemovals({ dataDir, room = "pc", key = process.env.ORACLE_KEY || process.env.CENSUS_PROXY_KEY || "", fetchImpl = fetch, log = console.log } = {}) {
  if (!key) {
    log("🚫 Self-service removals: no ORACLE_KEY / CENSUS_PROXY_KEY, skipped.");
    return { skipped: true };
  }
  let rows;
  try {
    const r = await fetchImpl(`${ORACLE_URL}/privacy/list`, { headers: { "X-Oracle-Key": key, Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    rows = ((await r.json()) || {}).removals || [];
  } catch (e) {
    log(`🚫 Self-service removals: oracle not reachable (${String((e && e.message) || e).slice(0, 80)}), skipped.`);
    return { skipped: true };
  }
  const file = path.join(dataDir, "opt-out.json");
  let text = null, cur = null;
  try {
    text = fs.readFileSync(file, "utf8");
    cur = JSON.parse(text);
  } catch {
    cur = { players: {} };
  }
  const { json, added, restored } = applyRemovals(cur, rows, room);
  if (added.length || restored.length) {
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(json, null, 1) + "\n");
    fs.renameSync(tmp, file);
  }
  log(`🚫 Self-service removals (${room === "ps" ? "PS" : "PC"}): ${rows.length} on the oracle, ${added.length} added, ${restored.length} shown again.`);
  return { added, restored };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const room = process.argv.includes("--room") && process.argv[process.argv.indexOf("--room") + 1] === "ps" ? "ps" : "pc";
  await syncRemovals({ dataDir: path.join(ROOT, room === "ps" ? "data-ps" : "data"), room });
}
