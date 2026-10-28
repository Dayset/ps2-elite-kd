#!/usr/bin/env node
/**
 * 🚫 Apply the removal list (opt-out.mjs, #61) to one room's data folder.
 *
 * Deletes each removed character's cached player file and every machine-built
 * record of them (index, refresh state, watchlist line, request / fetch / Honu
 * caches, legends, xp), and blanks their name in other players' opponent
 * lists (same server only on PS). Owner-edited files (hidden, reviewed, farm,
 * not-farm, legend-notes) are never changed: matches there are only reported.
 * ranks.json / names.json / flags.json drop them on the next rebuild, which the
 * refresh workflows run right after the refresh.
 *
 * The scan over every player file runs only when opt-out.json changed since the
 * last purge (opt-out-state.json keeps its hash), so a normal run costs one
 * small file read. Called at the start of refresh-cache.mjs / refresh-ps.mjs,
 * or by hand:  node scripts/purge-removed.mjs [--room ps] [--force]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { removedList, removedKey } from "../opt-out.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/** Owner-edited files: reported, never rewritten. */
export const OWNER_FILES = ["hidden.json", "reviewed.json", "farm.json", "not-farm.json", "legend-notes.json"];

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function readJson(file) {
  const t = readText(file);
  if (t == null) return { text: null, json: null };
  try {
    return { text: t, json: JSON.parse(t) };
  } catch {
    return { text: t, json: null };
  }
}

/** Write JSON with the same indentation the file already used (keeps git diffs small). */
function writeLike(file, json, oldText) {
  let indent = 0;
  const m = /^\{\r?\n( +|\t)/.exec(oldText || "");
  if (m) indent = m[1] === "\t" ? "\t" : m[1].length;
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(json, null, indent) + "\n");
  fs.renameSync(tmp, file);
}

const sha = (t) => crypto.createHash("sha256").update(String(t || "")).digest("hex").slice(0, 16);

/** Drop the given keys from an object map in place; returns how many went. */
function dropKeys(map, keys) {
  if (!map || typeof map !== "object") return 0;
  let n = 0;
  for (const k of keys) {
    if (k && Object.prototype.hasOwnProperty.call(map, k)) {
      delete map[k];
      n++;
    }
  }
  return n;
}

/**
 * Remove, anywhere inside a JSON value, items that are a removed character:
 * array items or map values that are objects whose slug / key / cid / name
 * match, array strings equal to a removed name, and map keys that are a
 * removed character id ("5428…" / "us-5428…"). Map keys that only look like a
 * slug are left alone (a player called "Burst" must not delete status.burst).
 * Returns the number of things removed.
 */
export function scrubDeep(value, gone) {
  let n = 0;
  const hit = (v) => {
    if (typeof v === "string") return gone.names.has(removedKey(v)) && gone.strict.has(v.trim().toLowerCase());
    if (!v || typeof v !== "object" || Array.isArray(v)) return false;
    if (v.cid != null && gone.cids.has(String(v.cid))) return true;
    if (v.key != null && gone.keys.has(String(v.key))) return true;
    if (v.slug != null && gone.slugs.has(String(v.slug))) return true;
    if (typeof v.name === "string" && gone.strict.has(v.name.trim().toLowerCase())) return true;
    return false;
  };
  const walk = (v) => {
    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) {
        if (hit(v[i])) {
          v.splice(i, 1);
          n++;
        } else walk(v[i]);
      }
    } else if (v && typeof v === "object") {
      for (const k of Object.keys(v)) {
        if (gone.keys.has(k) || gone.cids.has(k) || (typeof v[k] === "object" && hit(v[k]))) {
          delete v[k];
          n++;
        } else walk(v[k]);
      }
    }
  };
  walk(value);
  return n;
}

/**
 * Apply opt-out.json to <dataDir>.
 * @returns {{ skipped?:boolean, removed:object[], blanked:number, cleaned:object, owner:object[] }}
 */
export function purgeRemoved({ dataDir, room = "pc", force = false, log = console.log } = {}) {
  const ps = room === "ps";
  const optPath = path.join(dataDir, "opt-out.json");
  const statePath = path.join(dataDir, "opt-out-state.json");
  const { text: optText, json: optJson } = readJson(optPath);
  const list = removedList(optJson);
  const hash = sha(optText || "");
  const prev = readJson(statePath).json || {};
  const report = { removed: [], blanked: 0, cleaned: {}, owner: [] };
  if (!force && prev.hash === hash) return { ...report, skipped: true };
  if (!list.size) {
    if (optText != null || prev.hash) writeLike(statePath, { _about: "Last applied removal list (scripts/purge-removed.mjs). Machine-written.", hash, appliedAt: new Date().toISOString(), entries: 0, removedFiles: 0, blanked: 0 }, readText(statePath));
    return { ...report, skipped: !optText };
  }

  // 1) Player files: delete removed characters, blank them in everyone else's opponents.
  const playersDir = path.join(dataDir, "players");
  const gone = { slugs: new Set(), keys: new Set(), cids: new Set(), names: new Set(), strict: new Set(), files: new Set() };
  const remember = (e, { slug = "", key = "", cid = "", display = "", file = "" }) => {
    if (slug) gone.slugs.add(slug);
    if (key) gone.keys.add(key);
    if (cid) gone.cids.add(String(cid));
    if (display) {
      gone.names.add(removedKey(display));
      gone.strict.add(display.trim().toLowerCase());
      gone.strict.add(display.replace(/^\[[^\]]*\]\s*/, "").trim().toLowerCase());
    }
    if (file) gone.files.add(file);
    report.removed.push({ id: e.id, file, name: display || e.name });
  };
  let files = [];
  try {
    files = fs.readdirSync(playersDir).filter((f) => f.endsWith(".json"));
  } catch {
    files = [];
  }
  for (const f of files) {
    const full = path.join(playersDir, f);
    const { text, json } = readJson(full);
    if (!json || !json.player) continue;
    const p = json.player;
    const server = ps ? json.server || p.server || f.slice(0, 2) : "";
    const slug = ps ? "" : f.replace(/\.json$/, "");
    const key = ps ? f.replace(/\.json$/, "") : "";
    const e = list.match({ cid: p.cid, server, slug, name: p.display || json.query });
    if (e) {
      fs.unlinkSync(full);
      remember(e, { slug: ps ? "" : slug, key, cid: p.cid, display: String(p.display || json.query || ""), file: `players/${f}` });
      continue;
    }
    const n = list.blankOpponents(p.rows, server);
    if (n) {
      report.blanked += n;
      fs.writeFileSync(full, JSON.stringify(json) + (text.endsWith("\n") ? "\n" : ""));
    }
  }
  // Entries with a name only (no cached file) still clean the records below.
  for (const e of list.entries) {
    if (e.slug && !e.server) gone.slugs.add(e.slug);
    if (e.cid && !e.server) gone.cids.add(e.cid);
    if (e.cid && e.server) gone.keys.add(`${e.server}-${e.cid}`);
    if (e.name) {
      gone.names.add(removedKey(e.name));
      gone.strict.add(e.name.trim().toLowerCase());
      gone.strict.add(e.name.replace(/^\[[^\]]*\]\s*/, "").trim().toLowerCase());
    }
  }

  // 2) index.json: entries whose file went, or that match by name / key.
  const idxPath = path.join(dataDir, "index.json");
  const idx = readJson(idxPath);
  if (idx.json && Array.isArray(idx.json.players)) {
    const before = idx.json.players.length;
    idx.json.players = idx.json.players.filter((x) => {
      if (gone.files.has(x.file)) return false;
      if (ps) return !(x.key && gone.keys.has(x.key));
      return !gone.slugs.has(x.slug) && !list.match({ slug: x.slug, name: x.name });
    });
    const n = before - idx.json.players.length;
    if (n) {
      idx.json.updatedAt = new Date().toISOString();
      writeLike(idxPath, idx.json, idx.text);
      report.cleaned["index.json"] = n;
    }
  }

  // 3) Machine-built records keyed by slug / key / cid.
  const clean = (name, fn) => {
    const fp = path.join(dataDir, name);
    const r = readJson(fp);
    if (!r.json) return;
    const n = fn(r.json);
    if (n) {
      writeLike(fp, r.json, r.text);
      report.cleaned[name] = n;
    }
  };
  const ids = [...gone.slugs, ...gone.keys, ...gone.cids];
  clean("refresh-state.json", (j) => dropKeys(j.players, ids));
  clean("requested.json", (j) => dropKeys(j.requested, ids) + dropKeys(j.checked, ids));
  clean("fetch-counts.json", (j) => dropKeys(j.counts, ids));
  clean("forensics.json", (j) => dropKeys(j.players, ids) + scrubDeep(j, gone));
  clean("radar.json", (j) => dropKeys(j.players, ids) + scrubDeep(j.players, gone));
  clean("legends-departed.json", (j) => dropKeys(j.players, ids));
  clean("rampage.json", (j) => scrubDeep(j, gone));
  clean("discovery.json", (j) => scrubDeep(j.queue || (j.servers ? Object.values(j.servers).map((s) => s.queue || []) : []), gone));
  clean("status.json", (j) => scrubDeep(j, gone));
  clean("names.json", (j) => {
    if (!Array.isArray(j.players)) return 0;
    const before = j.players.length;
    j.players = j.players.filter((r) => {
      const row = Array.isArray(r) ? r : [r];
      if (ps) return !(row[2] && gone.files.has(String(row[2])));
      return !gone.slugs.has(removedKey(row[0]));
    });
    j.count = j.players.length;
    return before - j.players.length;
  });
  if (ps) {
    // 🥊 Scrim records (scripts/ps-scrims.mjs): the removed player's file and cursor go; their name
    // as an opponent in other files is blanked by the next scrims run (it re-reads the list).
    for (const k of gone.keys) {
      const f = path.join(dataDir, "scrims", `${k}.json`);
      if (fs.existsSync(f)) {
        fs.unlinkSync(f);
        report.cleaned["scrims/"] = (report.cleaned["scrims/"] || 0) + 1;
      }
    }
    clean("scrims-state.json", (j) => dropKeys(j.players, ids));
  }
  if (!ps) {
    for (const s of gone.slugs) {
      const xp = path.join(dataDir, "xp", `${s}.json`);
      if (fs.existsSync(xp)) {
        fs.unlinkSync(xp);
        report.cleaned["xp/"] = (report.cleaned["xp/"] || 0) + 1;
      }
      const shard = `descriptions/${s.charAt(0)}.json`;
      clean(shard, (j) => dropKeys(j.players, [s]));
    }
    // Watchlist: drop lines that are exactly one removed name.
    const wl = path.join(dataDir, "watchlist.txt");
    const t = readText(wl);
    if (t != null) {
      const lines = t.split("\n");
      const kept = lines.filter((l) => {
        const v = l.replace(/#.*$/, "").trim();
        return !v || !gone.slugs.has(removedKey(v)) || /[,]/.test(v);
      });
      if (kept.length !== lines.length) {
        fs.writeFileSync(wl, kept.join("\n"));
        report.cleaned["watchlist.txt"] = lines.length - kept.length;
      }
    }
  }

  // 4) Owner files: report only.
  for (const name of OWNER_FILES) {
    const j = readJson(path.join(dataDir, name)).json;
    const map = j && j.players && typeof j.players === "object" ? j.players : j && typeof j === "object" ? j : null;
    if (!map) continue;
    for (const k of Object.keys(map)) {
      const kk = String(k);
      if (gone.cids.has(kk) || gone.keys.has(kk) || gone.slugs.has(removedKey(kk))) report.owner.push({ file: name, key: kk });
    }
  }

  writeLike(
    statePath,
    {
      _about: "Last applied removal list (scripts/purge-removed.mjs). Machine-written.",
      hash,
      appliedAt: new Date().toISOString(),
      entries: list.size,
      removedFiles: report.removed.length,
      blanked: report.blanked,
    },
    readText(statePath)
  );
  log(
    `🚫 Removal list (${ps ? "PS" : "PC"}): ${list.size} entr${list.size === 1 ? "y" : "ies"}, ` +
      `${report.removed.length} cached file(s) deleted, ${report.blanked} opponent name(s) blanked` +
      (Object.keys(report.cleaned).length ? `, cleaned ${Object.entries(report.cleaned).map(([k, v]) => `${k} ${v}`).join(", ")}` : "") +
      "."
  );
  for (const o of report.owner) log(`  note: ${o.file} still lists ${o.key} (owner file, not changed)`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const room = process.argv.includes("--room") ? String(process.argv[process.argv.indexOf("--room") + 1] || "pc") : "pc";
  const r = purgeRemoved({ dataDir: path.join(ROOT, room === "ps" ? "data-ps" : "data"), room, force: process.argv.includes("--force") });
  if (r.skipped) console.log("🚫 Removal list unchanged since the last purge; nothing to do (use --force to re-run).");
}
