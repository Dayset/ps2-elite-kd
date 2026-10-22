/**
 * PlayStation room 🤝 assists (#60): pull the sessions the cache Worker's PS
 * stream collector closed (worker/src/ps-assists.js, POST /ps-assists/export)
 * and merge them into data-ps/players/<us|eu>-<cid>.json → player.assists, in
 * the same shape the PC pipeline stores Honu-counted sessions (mergeAssists),
 * so build-ranks fills 🤝 apk and 🪳 Zerg with no further changes.
 *
 * Forward-only: the stream is the only PS source, nothing to backfill.
 * Cursor (Worker row id) in data-ps/assists-state.json. Players already in the
 * index are asked once for everything the collector kept (≤ 45 days) — marked
 * `asst` in refresh-state.json — then only new rows. Rows of characters not in
 * the index are skipped (they come back via the "fresh" ask once added).
 * Never throws: on any problem the run goes on without assists.
 */
import fs from "node:fs";
import path from "node:path";
import { psKey, psPlayerFile } from "../rooms.mjs";
import { mergeAssists } from "./refresh-cache.mjs";

export const PS_ASSIST_SOURCE = "ps-stream";
const FRESH_PER_CALL = 50;
const MAX_CALLS = 60;

/** Export row (cols from the Worker) → mergeAssists "counted" entry. */
export function rowToCounted(r) {
  return { id: `ps-${r.st}`, assists: r.a, kills: r.k, deaths: r.d, seconds: r.sec, startMs: r.st, shareSum: r.ss, shareN: r.sn, mult: r.mult };
}

/** Rows → { key: [counted…] } (PS namespaces only). */
export function groupRows(cols, rows) {
  const out = {};
  for (const arr of rows || []) {
    const r = {};
    cols.forEach((c, i) => { r[c] = arr[i]; });
    if (r.ns !== "ps2ps4us" && r.ns !== "ps2ps4eu") continue;
    let key;
    try { key = psKey(r.ns, String(r.cid)); } catch { continue; }
    (out[key] ||= []).push(rowToCounted(r));
  }
  return out;
}

/** Merge counted sessions into a player payload in place; true when it changed. */
export function mergeIntoPayload(payload, counted) {
  const pl = payload && payload.player;
  if (!pl || !counted || !counted.length) return false;
  const prev = pl.assists && pl.assists.source === PS_ASSIST_SOURCE ? pl.assists : null;
  const merged = mergeAssists(prev, counted);
  if (!merged) return false;
  merged.source = PS_ASSIST_SOURCE;
  const before = JSON.stringify(pl.assists || null);
  pl.assists = merged;
  return JSON.stringify(merged) !== before;
}

export async function pullPsAssists({ dataDir, index, state, proxy, key, fetchImpl = fetch, log = console.log, writeFile }) {
  const res = { calls: 0, rows: 0, players: 0, skipped: 0, error: null };
  if (!proxy || !key) { res.error = "no CENSUS_PROXY / CENSUS_PROXY_KEY"; return res; }
  const stFile = path.join(dataDir, "assists-state.json");
  let st = {};
  try { st = JSON.parse(fs.readFileSync(stFile, "utf8")) || {}; } catch {}
  let cursor = +st.cursor || 0;
  const known = new Set(index.players.map((p) => p.key));
  const fresh = index.players.map((p) => p.key).filter((k) => !(state.players[k] && state.players[k].asst));
  const byKey = {};
  const add = (g) => { for (const [k, v] of Object.entries(g)) (byKey[k] ||= []).push(...v); };
  const call = async (body) => {
    res.calls++;
    const r = await fetchImpl(`${proxy}/ps-assists/export`, { method: "POST", headers: { "Content-Type": "application/json", "X-Proxy-Key": key }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`export HTTP ${r.status}`);
    return r.json();
  };
  const askedNow = [];
  try {
    let more = true;
    for (let i = 0; i < MAX_CALLS && (more || fresh.length); i++) {
      const batch = fresh.splice(0, FRESH_PER_CALL);
      const j = await call({ since: cursor, fresh: batch });
      // Worker storage reset (row ids restarted): read from the start next time.
      if (+j.maxRid < cursor) { cursor = 0; more = true; fresh.unshift(...batch); continue; }
      add(groupRows(j.cols, j.rows));
      add(groupRows(j.cols, j.fresh));
      res.rows += (j.rows || []).length + (j.fresh || []).length;
      askedNow.push(...batch);
      cursor = Math.max(cursor, +j.next || 0);
      more = !!j.more;
    }
  } catch (e) {
    res.error = String((e && e.message) || e).slice(0, 160);
    log(`PS assists: pull stopped (${res.error}); merging what arrived.`);
  }
  for (const [k, counted] of Object.entries(byKey)) {
    if (!known.has(k)) { res.skipped += counted.length; continue; }
    const [srv, cid] = k.split("-");
    const file = path.join(dataDir, psPlayerFile(srv === "us" ? "ps2ps4us" : "ps2ps4eu", cid));
    let payload;
    try { payload = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
    // Idempotent: mergeAssists keys sessions by start time, so a repeated row changes nothing.
    if (mergeIntoPayload(payload, counted)) { writeFile(file, JSON.stringify(payload) + "\n"); res.players++; }
  }
  for (const k of askedNow) { if (state.players[k]) state.players[k].asst = 1; }
  writeFile(stFile, JSON.stringify({ _about: "PS 🤝 assists pull cursor (#60): last Worker /ps-assists/export row id merged.", cursor, updatedAt: new Date().toISOString(), last: res }, null, 1) + "\n");
  log(`PS assists: ${res.calls} call(s), ${res.rows} session row(s), ${res.players} player file(s) updated, ${res.skipped} row(s) for players not in the index${res.error ? `, error: ${res.error}` : ""}.`);
  return res;
}
