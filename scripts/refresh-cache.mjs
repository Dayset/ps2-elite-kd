#!/usr/bin/env node
/**
 * Refresh shared player cache under data/players/ and rebuild data/index.json.
 * Used by GitHub Actions (.github/workflows/refresh-cache.yml).
 *
 * Usage:
 *   node scripts/refresh-cache.mjs              # watchlist (+ existing index)
 *   node scripts/refresh-cache.mjs "JustV6me ChrisJTTR"
 *   NAMES="JustV6me" node scripts/refresh-cache.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const PLAYERS_DIR = path.join(DATA_DIR, "players");
const INDEX_PATH = path.join(DATA_DIR, "index.json");
const WATCHLIST_PATH = path.join(DATA_DIR, "watchlist.txt");

const HONU = "https://wt.honu.pw/api/character/";
const CENSUS = "https://census.daybreakgames.com/s:example/get/ps2:v2/";
const TOP_N = 50;
const OPP_CONCURRENCY = 4;
const BETWEEN_PLAYERS_MS = 1500;
const BETWEEN_BATCH_MS = 200;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function slugKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/^\[.*?\]\s*/, "")
    .replace(/[^a-z0-9]+/g, "");
}

function parseNames(text) {
  const s = String(text || "").trim();
  if (!s) return [];
  const tokens = [];
  const re = /(?:\[[^\]]*\]\s*)?[^\s,;]+/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const t = m[0].trim();
    if (t) tokens.push(t);
  }
  return tokens;
}

async function fetchJson(url, { retries = 3 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "ps2-elite-kd-cache-bot/1.0" },
      });
      if (res.status === 429 || res.status >= 500) {
        const wait = 1000 * (attempt + 1);
        console.warn(`  retry ${res.status} in ${wait}ms: ${url}`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (attempt + 1 < retries) await sleep(800 * (attempt + 1));
    }
  }
  throw lastErr || new Error(`fetch failed: ${url}`);
}

function hist(c, stat) {
  for (const row of ((c.stats || {}).stat_history) || []) {
    if (row.stat_name === stat) return +row.all_time || 0;
  }
  return 0;
}

function pooled(sl) {
  let tk = 0;
  let td = 0;
  for (const r of sl) {
    tk += r.kills || 0;
    td += r.deaths || 0;
  }
  let kd = null;
  if (td) kd = tk / td;
  else if (tk) kd = tk;
  return { kills: tk, deaths: td, kd };
}

function kpmCurve(rows, start = 2.5, end = 0.0, step = 0.05) {
  const pts = [];
  for (let t = start; t >= end - 1e-9; t -= step) {
    const cut = Math.round(t * 100) / 100;
    const sl = rows.filter((r) => (r.kpm || 0) >= cut);
    const { kills, deaths, kd } = pooled(sl);
    pts.push({ kpm: cut, kd, kills, deaths, n: sl.length });
  }
  return pts;
}

async function resolveCensus(name) {
  const raw = String(name).trim();
  let url;
  if (/^\d{16,}$/.test(raw)) {
    url = `${CENSUS}character?character_id=${encodeURIComponent(raw)}&c:resolve=outfit,stat_history`;
  } else {
    url = `${CENSUS}character?name.first_lower=${encodeURIComponent(raw.toLowerCase())}&c:resolve=outfit,stat_history`;
  }
  const data = await fetchJson(url);
  const chars = data.character_list || [];
  if (!chars.length) throw new Error(`Census: no character ${raw}`);
  return chars[0];
}

async function honuKillboard(cid) {
  return fetchJson(`${HONU}${cid}/killboard`);
}

async function honuMeta(cid) {
  try {
    return await fetchJson(`${HONU}${cid}`);
  } catch {
    return {};
  }
}

async function honuWeaponPace(cid) {
  try {
    const stats = await fetchJson(`${HONU}${cid}/stats`);
    let wk = 0;
    let wd = 0;
    let wt = 0;
    let fire = 0;
    let hitc = 0;
    let hs = 0;
    for (const row of stats) {
      const n = row.statName;
      const v = +row.valueForever || 0;
      if (n === "weapon_kills") wk = v;
      else if (n === "weapon_deaths") wd = v;
      else if (n === "weapon_play_time") wt = v;
      else if (n === "weapon_fire_count") fire = v;
      else if (n === "weapon_hit_count") hitc = v;
      else if (n === "weapon_headshots") hs = v;
    }
    const kpm = wt ? wk / (wt / 60) : 0;
    const acc = fire ? (100 * hitc) / fire : 0;
    const hsr = wk ? (100 * hs) / wk : 0;
    const ivi = acc * hsr;
    return { wk, wd, kpm, acc, hsr, ivi };
  } catch {
    return { wk: 0, wd: 0, kpm: 0, acc: 0, hsr: 0, ivi: 0 };
  }
}

async function loadLive(name) {
  const c = await resolveCensus(name);
  const cid = c.character_id;
  const outfit = c.outfit || {};
  const gk = hist(c, "kills");
  const gd = hist(c, "deaths");
  const gt = hist(c, "time");
  const gkd = gd ? gk / gd : gk;
  const gkpm = gt ? gk / (gt / 60) : 0;
  const tag = outfit.alias ? `[${outfit.alias}] ` : "";
  const display = `${tag}${c.name.first}`;

  const own = await honuWeaponPace(cid);
  await sleep(BETWEEN_BATCH_MS);
  const board = await honuKillboard(cid);
  board.sort((a, b) => b.kills + b.deaths - (a.kills + a.deaths));
  const sample = board.slice(0, TOP_N);

  const rows = [];
  let i = 0;
  async function worker() {
    while (i < sample.length) {
      const idx = i++;
      const pair = sample[idx];
      const oid = String(pair.otherCharacterID);
      const [meta, pace] = await Promise.all([honuMeta(oid), honuWeaponPace(oid)]);
      const etag = meta.outfitTag ? `[${meta.outfitTag}] ` : "";
      rows[idx] = {
        name: etag + (meta.name || oid),
        kills: +pair.kills || 0,
        deaths: +pair.deaths || 0,
        kpm: pace.kpm || 0,
      };
      if (idx % OPP_CONCURRENCY === 0) await sleep(BETWEEN_BATCH_MS);
    }
  }
  await Promise.all(Array.from({ length: OPP_CONCURRENCY }, () => worker()));

  const curve = kpmCurve(rows);
  return {
    query: String(name).trim(),
    top: TOP_N,
    savedAt: Date.now(),
    player: {
      display,
      cid,
      global_kd: gkd,
      global_kpm: gkpm,
      own_kpm: own.kpm || gkpm,
      acc: own.acc,
      hsr: own.hsr,
      ivi: own.ivi,
      n_scored: rows.length,
      honu: `https://wt.honu.pw/c/${cid}/killboard`,
      rows,
      curve,
    },
  };
}

function readWatchlist() {
  if (!fs.existsSync(WATCHLIST_PATH)) return [];
  const lines = fs.readFileSync(WATCHLIST_PATH, "utf8").split(/\r?\n/);
  const names = [];
  for (const line of lines) {
    const t = line.replace(/#.*$/, "").trim();
    if (!t) continue;
    names.push(...parseNames(t));
  }
  return names;
}

function readIndex() {
  if (!fs.existsSync(INDEX_PATH)) {
    return { updatedAt: null, players: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
    // migrate legacy { demos: [...] }
    if (Array.isArray(raw.demos) && !raw.players) {
      return {
        updatedAt: null,
        players: raw.demos.map((d) => ({
          name: d.name,
          file: d.file?.startsWith("players/") ? d.file : `players/${d.file}`,
          slug: slugKey(d.name),
          savedAt: 0,
          aliases: d.aliases || [],
        })),
      };
    }
    return {
      updatedAt: raw.updatedAt || null,
      players: Array.isArray(raw.players) ? raw.players : [],
    };
  } catch {
    return { updatedAt: null, players: [] };
  }
}

function writeIndex(index) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + "\n");
}

function upsertIndexEntry(index, { name, display, slug, file, savedAt, aliases }) {
  const players = index.players.slice();
  const i = players.findIndex((p) => p.slug === slug || slugKey(p.name) === slug);
  const entry = {
    name: display || name,
    file,
    slug,
    savedAt,
    aliases: aliases && aliases.length ? aliases : [slug, String(name).trim().toLowerCase()].filter(
      (v, idx, a) => v && a.indexOf(v) === idx
    ),
  };
  if (i >= 0) players[i] = { ...players[i], ...entry };
  else players.push(entry);
  players.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  index.players = players;
  index.updatedAt = new Date().toISOString();
}

function collectNames(cliArgs) {
  const fromEnv = process.env.NAMES || "";
  const fromCli = cliArgs.join(" ");
  const explicit = parseNames(fromCli || fromEnv);
  if (explicit.length) return explicit;

  const watch = readWatchlist();
  const index = readIndex();
  const fromIndex = index.players.map((p) => p.name).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const n of [...watch, ...fromIndex]) {
    const k = slugKey(n);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}

async function main() {
  fs.mkdirSync(PLAYERS_DIR, { recursive: true });
  const names = collectNames(process.argv.slice(2));
  if (!names.length) {
    console.error("No names to refresh. Add data/watchlist.txt or pass names.");
    process.exit(1);
  }

  console.log(`Refreshing ${names.length} name(s): ${names.join(", ")}`);
  const index = readIndex();
  let ok = 0;
  let fail = 0;

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const slug = slugKey(name);
    if (!slug) {
      console.warn(`Skip empty slug for ${JSON.stringify(name)}`);
      fail++;
      continue;
    }
    console.log(`[${i + 1}/${names.length}] ${name} (${slug})…`);
    try {
      const payload = await loadLive(name);
      const fileRel = `players/${slug}.json`;
      const fileAbs = path.join(DATA_DIR, fileRel);
      fs.writeFileSync(fileAbs, JSON.stringify(payload) + "\n");
      upsertIndexEntry(index, {
        name,
        display: payload.player.display,
        slug,
        file: fileRel,
        savedAt: payload.savedAt,
      });
      writeIndex(index);
      ok++;
      console.log(`  wrote data/${fileRel} (${payload.player.display})`);
    } catch (e) {
      fail++;
      console.error(`  FAIL ${name}: ${e.message || e}`);
    }
    if (i + 1 < names.length) await sleep(BETWEEN_PLAYERS_MS);
  }

  writeIndex(index);
  console.log(`Done. ok=${ok} fail=${fail} index=${index.players.length}`);
  if (ok === 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
