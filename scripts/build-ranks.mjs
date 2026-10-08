#!/usr/bin/env node
/**
 * Build data/ranks.json for ranks.html: one compact row per cached player with
 * every number the main page's stats tables show, computed by the SAME code
 * (player-metrics.mjs), so ranks match the ✨ Adjusted table exactly.
 * No network: reads data/index.json + data/players/*.json only.
 *
 *   node scripts/build-ranks.mjs            # writes data/ranks.json
 *
 * Called by .github/workflows/refresh-cache.yml right before the run's single
 * data/ commit, so ranks.json is rebuilt whenever players are added/refreshed.
 *
 * Format (columnar, small): { updatedAt, count, cols: [id…], rows: [[…]…] }
 * Row = [display, query, slug, savedAt, …metric values in METRIC_COLS order].
 * Numbers are rounded to 6 decimals (display uses ≤ 3, so shown values match); missing → null.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePlayer, playerMetrics } from "../player-metrics.mjs";

/** Metric ids (same ids as the app.js stats columns). */
export const METRIC_COLS = Object.freeze([
  // ✨ Adjusted (visible by default, main-table order)
  "adjs", "rf", "act", "pvs", "rkd", "mech", "inflation",
  // older debug columns
  "adj", "ekpm", "own", "coi", "slope",
  // 📊 Public
  "kd", "kpm", "ownKpm", "acc", "hsr", "ivi",
]);
export const RANK_COLS = Object.freeze(["name", "query", "slug", "savedAt", ...METRIC_COLS]);

const round6 = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null);

/** "[TAG] Name" → "Name" (what ?names= / Analyze expects). */
export function bareName(display) {
  return String(display || "").replace(/^\s*\[[^\]]*\]\s*/, "").trim();
}

/**
 * One ranks row from a raw cached player JSON (same shape as data/players/*.json).
 * Returns null when the file has no usable player.
 */
export function rankRow(raw, { slug = "", savedAt = null } = {}) {
  if (!raw) return null;
  const p = normalizePlayer(raw);
  if (!p || !p.display || p.display === "?") return null;
  const m = playerMetrics(p);
  const t = savedAt != null ? +savedAt : +raw.savedAt || null;
  return [p.display, bareName(p.display) || p.display, slug, t, ...METRIC_COLS.map((k) => round6(m[k]))];
}

/** Build the whole ranks object from a data/ directory. */
export function buildRanks(dataDir) {
  const index = JSON.parse(fs.readFileSync(path.join(dataDir, "index.json"), "utf8"));
  const rows = [];
  const seen = new Set();
  for (const e of index.players || []) {
    const file = e && e.file;
    if (!file || seen.has(file)) continue;
    seen.add(file);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8"));
    } catch {
      continue; // listed but missing / unreadable: skip, never fail the run
    }
    const row = rankRow(raw, { slug: e.slug || path.basename(file, ".json"), savedAt: e.savedAt ?? raw.savedAt });
    if (row) rows.push(row);
  }
  return { updatedAt: new Date().toISOString(), count: rows.length, cols: RANK_COLS.slice(), rows };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dataDir = path.join(root, "data");
  const out = buildRanks(dataDir);
  fs.writeFileSync(path.join(dataDir, "ranks.json"), JSON.stringify(out) + "\n");
  console.log(`ranks.json: ${out.count} players`);
}
