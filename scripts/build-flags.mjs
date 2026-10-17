#!/usr/bin/env node
/**
 * Build data/flags.json for build-log.html: the per-player 🚩 / 🌱 / 🤖 / 🌾 / † rows,
 * computed ONCE here (same code: ../flags-summary.mjs) instead of in every visitor's
 * browser over thousands of player files. No network.
 *
 * Incremental: data/.flags-cache.json (git-ignored; restored by actions/cache in CI)
 * keeps each player's row keyed by savedAt + a hash of the rule code and the
 * farm / not-farm lists; only new or changed players are recomputed.
 *
 *   node scripts/build-flags.mjs [--full]
 *
 * Format: { builtAt, total, errors, rows: [row…] }; rows = only players build-log can show.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { summarize, keepRow } from "../flags-summary.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RULE_FILES = ["flags-summary.mjs", "player-metrics.mjs", "red-flags.mjs", "sprouts.mjs", "padding.mjs", "bins.mjs", "census-fetch.mjs", "flairs.mjs", "math.mjs", "session-stats.mjs", "data/farm.json", "data/not-farm.json"];

export function rulesHash(root = ROOT) {
  const h = crypto.createHash("sha1");
  for (const f of RULE_FILES) { try { h.update(f + "\0" + fs.readFileSync(path.join(root, f))); } catch { h.update(f + "\0missing"); } }
  return h.digest("hex").slice(0, 16);
}

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };

/** Slugs a later overlay in build-log may tag (🧪 session, 🔎 forensics, reviewed padding). */
export function overlaySlugs(dataDir) {
  const s = new Set();
  const st = readJson(path.join(dataDir, "status.json"), {}) || {};
  for (const f of (st.sessionStats && st.sessionStats.flagged) || []) if (f.slug) s.add(f.slug);
  for (const f of (st.forensics && st.forensics.players) || []) if (f.slug) s.add(f.slug);
  for (const k of Object.keys((readJson(path.join(dataDir, "reviewed.json"), {}) || {}).players || {})) s.add(k);
  return s;
}

export function buildFlags({ root = ROOT, full = false } = {}) {
  const dataDir = path.join(root, "data");
  const index = readJson(path.join(dataDir, "index.json"), { players: [] });
  const entries = (index.players || []).filter((e) => e && e.file && e.name);
  const hash = rulesHash(root);
  const cachePath = path.join(dataDir, ".flags-cache.json");
  const old = full ? null : readJson(cachePath);
  const prev = old && old.hash === hash ? old.byFile || {} : {};
  const byFile = {};
  let computed = 0, errors = 0;
  for (const e of entries) {
    const c = prev[e.file];
    if (c && c.savedAt === (e.savedAt || 0) && c.name === e.name && c.slug === (e.slug || "")) { byFile[e.file] = c; continue; }
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dataDir, e.file), "utf8"));
      byFile[e.file] = { savedAt: e.savedAt || 0, name: e.name, slug: e.slug || "", row: summarize(e, raw) };
      computed += 1;
    } catch { errors += 1; }
  }
  const extra = overlaySlugs(dataDir);
  const rows = entries.map((e) => byFile[e.file] && byFile[e.file].row).filter((r) => keepRow(r, extra));
  fs.writeFileSync(cachePath, JSON.stringify({ hash, byFile }));
  const sproutCount = entries.reduce((n, e) => n + (byFile[e.file] && byFile[e.file].row && byFile[e.file].row.sprout ? 1 : 0), 0);
  const out = { builtAt: new Date().toISOString(), total: entries.length, errors, sproutCount, rows };
  fs.writeFileSync(path.join(dataDir, "flags.json"), JSON.stringify(out) + "\n");
  return { total: entries.length, computed, errors, kept: rows.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const t0 = Date.now();
  const r = buildFlags({ full: process.argv.includes("--full") });
  console.log(`flags.json: ${r.kept} rows of ${r.total} players; recomputed ${r.computed}, errors ${r.errors}; ${Date.now() - t0} ms`);
}
