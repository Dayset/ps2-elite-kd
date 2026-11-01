#!/usr/bin/env node
/**
 * 🛡️ Outfits dataset (#90): data/outfits.json for outfits.html (PC room only).
 *
 *   node scripts/build-outfits.mjs [--state .cache/outfits/state.json] [--out data/outfits.json] [--offline]
 *
 * 1. Ranked PC players (data/ranks.json, ⚔️ iVi "adjs") are joined to their character ids by name
 *    (data/cid-names.json). Hidden players are already out of ranks.json; confirmed padders
 *    (data/reviewed.json "padding") are left out, as in the faction / server ratings.
 * 2. Each player's outfit is resolved with Census `outfit_member_extended?character_id=a,b,…` in batches
 *    of BATCH ids (one call gives the outfit id, tag, name and member_count, so no outfit is ever looked up
 *    that has no ranked member, and no full roster download is needed for the total).
 * 3. Resumable: answers are kept per character in the state file (not committed: it maps players to outfits,
 *    the workflow keeps it in the Actions cache). A run refreshes the oldest / missing answers first until
 *    TIME_BUDGET_SEC, so a stopped run carries on next time. Answers older than MAX_AGE_DAYS are not used.
 * 4. Stats (outfit-stats.mjs): known-of-total, median and top 10% avg ⚔️ iVi, floor 5 known members.
 *    data/outfits.json is only (re)written when at least MIN_RESOLVED of the ranked players have a fresh
 *    answer; otherwise the old file stays and the run warns.
 *
 * Runs in .github/workflows/outfits.yml through the cache Worker (CENSUS_PROXY + CENSUS_PROXY_KEY);
 * without CENSUS_PROXY it calls Census directly. --offline rebuilds from the state file only.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOutfitRows, toOutfitArrays, OUTFIT_COLS, OUTFIT_FLOOR, TOP_SHARE } from "../outfit-stats.mjs";
import { slugKey, bareName } from "../rank-row.mjs";
import { confirmedPadders } from "../padding.mjs";
import { removedList } from "../opt-out.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const DATA = path.join(ROOT, arg("--data", "data"));
const OUT = path.resolve(ROOT, arg("--out", "data/outfits.json"));
const STATE = path.resolve(ROOT, arg("--state", ".cache/outfits/state.json"));
const OFFLINE = process.argv.includes("--offline");

export const BATCH = +process.env.OUTFIT_BATCH || 100;
const RPM = +process.env.CENSUS_RPM || 60;
const BUDGET_MS = (+process.env.TIME_BUDGET_SEC || 15 * 60) * 1000;
const REFRESH_MS = (+process.env.REFRESH_HOURS || 20) * 3600e3;
const MAX_AGE_MS = (+process.env.MAX_AGE_DAYS || 14) * 86400e3;
export const MIN_RESOLVED = 0.9;

const SID = process.env.CENSUS_SERVICE_ID || "daysetps2legends";
const HOST = "https://census.daybreakgames.com";
const PROXY = String(process.env.CENSUS_PROXY || "").replace(/\/+$/, "");
const KEY = process.env.CENSUS_PROXY_KEY || "";
const UA = "ps2-elite-kd outfits (+https://dayset.github.io/ps2-elite-kd/)";
const BASE = `${HOST}/s:${SID}/get/ps2:v2/`;
const via = (u) => (PROXY && u.startsWith(HOST + "/") ? `${PROXY}/census${u.slice(HOST.length)}` : u);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const notice = (kind, msg) => console.log(process.env.GITHUB_ACTIONS ? `::${kind}::${msg}` : `${kind}: ${msg}`);

/** Ranked players with a ⚔️ iVi: { cid, slug, adjs, fac, srv }. Exported for tests. */
export function rankedPlayers({ ranks, cidNames, reviewed, optOut }) {
  const c = (ranks && ranks.cols) || [];
  const iName = c.indexOf("name"), iSlug = c.indexOf("slug"), iAdjs = c.indexOf("adjs"), iSrv = c.indexOf("srv");
  if (iName < 0 || iAdjs < 0) throw new Error("ranks.json has no name / adjs column");
  const bySlug = new Map(), dup = new Set();
  for (const [cid, v] of Object.entries(cidNames || {})) {
    const nm = Array.isArray(v) ? v[0] : v;
    const fac = Array.isArray(v) ? v[1] || null : null;
    const k = slugKey(nm);
    if (!k) continue;
    if (bySlug.has(k)) dup.add(k);
    bySlug.set(k, { cid, fac });
  }
  const pads = new Set(confirmedPadders(reviewed).map((p) => p.slug));
  const removed = removedList(optOut);
  const out = [];
  for (const r of (ranks && ranks.rows) || []) {
    const adjs = r[iAdjs];
    if (typeof adjs !== "number" || !Number.isFinite(adjs)) continue;
    const slug = iSlug >= 0 ? r[iSlug] : slugKey(r[iName]);
    if (pads.has(slug)) continue;
    const k = slugKey(bareName(r[iName]));
    if (dup.has(k)) continue;
    const hit = bySlug.get(k);
    if (!hit || removed.match({ cid: hit.cid, name: bareName(r[iName]) })) continue;
    out.push({ cid: hit.cid, slug, adjs, fac: hit.fac, srv: iSrv >= 0 ? r[iSrv] || null : null });
  }
  return out;
}

/** Census outfit_member_extended rows → state entries. ids asked but absent = in no outfit ("0"). Exported for tests. */
export function applyBatch(state, ids, list, nowSec) {
  const seen = new Set();
  for (const m of list || []) {
    const cid = String(m.character_id || "");
    const oid = String(m.outfit_id || "");
    if (!cid || !/^\d+$/.test(oid)) continue;
    seen.add(cid);
    state.chars[cid] = [oid, nowSec];
    state.outfits[oid] = [String(m.alias || ""), String(m.name || ""), +m.member_count || 0, nowSec];
  }
  for (const cid of ids) if (!seen.has(cid)) state.chars[cid] = ["0", nowSec];
}

/** Ids to look up, missing first, then oldest; fresh ones skipped. Exported for tests. */
export function lookupOrder(cids, state, nowMs, refreshMs = REFRESH_MS) {
  const age = (cid) => { const e = state.chars[cid]; return e ? nowMs - e[1] * 1000 : Infinity; };
  return cids.filter((cid) => age(cid) >= refreshMs).sort((a, b) => age(b) - age(a));
}

/** Membership + outfit info from fresh state entries. Exported for tests. */
export function freshMaps(state, nowMs, maxAgeMs = MAX_AGE_MS) {
  const membership = new Map(), outfits = new Map();
  for (const [cid, [oid, t]] of Object.entries(state.chars || {})) if (nowMs - t * 1000 <= maxAgeMs) membership.set(cid, oid);
  for (const [oid, [tag, name, total]] of Object.entries(state.outfits || {})) outfits.set(oid, { tag, name, total });
  return { membership, outfits };
}

async function census(url) {
  const headers = { "User-Agent": UA, Accept: "application/json" };
  if (PROXY && KEY) headers["X-Proxy-Key"] = KEY;
  let last = "";
  for (let a = 1; a <= 4; a++) {
    try {
      const r = await fetch(via(url), { headers, signal: AbortSignal.timeout(45000) });
      if (r.ok) {
        const j = await r.json();
        if (j && Array.isArray(j.outfit_member_extended_list)) return j.outfit_member_extended_list;
        last = String((j && (j.error || j.errorCode)) || "no list").slice(0, 80);
      } else last = `HTTP ${r.status}`;
    } catch (e) { last = String(e && e.message).slice(0, 80); }
    await sleep(2000 * 2 ** a);
  }
  throw new Error(last);
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE + ".tmp", JSON.stringify(state));
  fs.renameSync(STATE + ".tmp", STATE);
}

async function main() {
  const t0 = Date.now();
  const ranks = readJson(path.join(DATA, "ranks.json"));
  const players = rankedPlayers({
    ranks,
    cidNames: readJson(path.join(DATA, "cid-names.json"), {}),
    reviewed: readJson(path.join(DATA, "reviewed.json")),
    optOut: readJson(path.join(DATA, "opt-out.json")),
  });
  const state = readJson(STATE) || {};
  if (state.v !== 1) { state.v = 1; state.chars = {}; state.outfits = {}; }
  const cids = players.map((p) => p.cid);
  const todo = OFFLINE ? [] : lookupOrder(cids, state, Date.now());
  console.log(`Ranked players with a score: ${players.length}; to look up: ${todo.length} (batches of ${BATCH}, ${RPM}/min)`);

  let calls = 0, done = 0, fails = 0, streak = 0;
  const gap = 60000 / RPM;
  for (let i = 0; i < todo.length; i += BATCH) {
    if (Date.now() - t0 > BUDGET_MS) { notice("notice", `Time budget reached: ${todo.length - done} lookups left for the next run`); break; }
    const ids = todo.slice(i, i + BATCH);
    const url = `${BASE}outfit_member_extended?character_id=${ids.join(",")}&c:show=character_id,outfit_id,alias,name,member_count&c:limit=${ids.length}`;
    const tc = Date.now();
    try {
      const list = await census(url);
      applyBatch(state, ids, list, Math.floor(Date.now() / 1000));
      done += ids.length;
      streak = 0;
    } catch (e) {
      fails++;
      streak++;
      console.warn(`  batch ${i / BATCH + 1} failed: ${e.message}`);
      if (streak >= 5) { notice("warning", `Census failing (${e.message}); stopping, the next run carries on`); break; }
    }
    calls++;
    if (calls % 10 === 0) { saveState(state); console.log(`  ${done}/${todo.length} looked up`); }
    const wait = gap - (Date.now() - tc);
    if (wait > 0) await sleep(wait);
  }
  saveState(state);

  const now = Date.now();
  const { membership, outfits } = freshMaps(state, now);
  const resolved = cids.filter((c) => membership.has(c)).length;
  const share = players.length ? resolved / players.length : 0;
  const rows = buildOutfitRows(players, membership, outfits);
  const inOutfits = cids.filter((c) => { const o = membership.get(c); return o && o !== "0"; }).length;
  const seen = new Set(cids.map((c) => membership.get(c)).filter((o) => o && o !== "0"));
  const summary = `${calls} Census calls (${fails} failed); ${resolved}/${players.length} players resolved (${Math.round(share * 100)}%), ${inOutfits} in ${seen.size} outfits, ${rows.length} listed (≥ ${OUTFIT_FLOOR} known)`;
  notice("notice", summary);
  if (share < MIN_RESOLVED) {
    notice("warning", `Only ${Math.round(share * 100)}% of ranked players resolved (< ${MIN_RESOLVED * 100}%): data/outfits.json kept as it was`);
    return;
  }
  const out = {
    v: 1,
    updatedAt: new Date(now).toISOString(),
    ranksAt: (ranks && ranks.updatedAt) || null,
    floor: OUTFIT_FLOOR,
    topShare: TOP_SHARE,
    ranked: players.length,
    resolved,
    inOutfits,
    outfitsSeen: seen.size,
    cols: [...OUTFIT_COLS],
    rows: toOutfitArrays(rows),
  };
  fs.writeFileSync(OUT, JSON.stringify(out) + "\n");
  const top = rows.slice(0, 3).map((r) => `[${r.tag}] ${r.med} (${r.known}/${r.total})`).join(", ");
  notice("notice", `Wrote ${path.relative(ROOT, OUT)}: ${rows.length} outfits; top by median: ${top}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { notice("error", `build-outfits: ${e.message}`); process.exit(1); });
}
