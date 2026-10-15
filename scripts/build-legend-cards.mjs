#!/usr/bin/env node
/**
 * Fact cards for the story-style player legends (issue #3).
 *
 * A card is the ONLY thing a legend writer ever sees: visible metrics only
 * (✨ Adjusted defaults + 📊 Public), each with its population percentile
 * (same rule as dist.mjs percentileOf) and a band word, plus account tenure,
 * opponent-sample size, the eligibility decision, and any owner note.
 * Writers never see raw player files or debug-only columns.
 *
 *   node scripts/build-legend-cards.mjs                  # all cards (JSON array)
 *   node scripts/build-legend-cards.mjs --slug bhorn     # one card (comma-separated)
 *   node scripts/build-legend-cards.mjs --chunk 0 --chunk-size 40
 *   node scripts/build-legend-cards.mjs --stale          # legends whose basis moved
 *   node scripts/build-legend-cards.mjs --reindex        # rebuild data/descriptions/index.json
 *
 * Chunk order (issue #3 Process): active in the last 30 days by ⚔️ iVi
 * descending, then the rest, then 🪦 (last activity over a year ago).
 *
 * `basis` is the tuple of band words plus tenure state. A legend only needs
 * rewriting when its basis changes, not when numbers drift inside a band.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { percentileOf, sortedFinite } from "../dist.mjs";
import { flairsFor, NEW_ACCOUNT_DAYS, YEAR_MS, DAY_MS, VETERAN_YEARS } from "../flairs.mjs";
import { confirmedPadderSlugs } from "../padding.mjs";
import { bareName } from "../rank-row.mjs";

/** Visible ✨ Adjusted default columns, in page order. */
export const VISIBLE_ADJUSTED = Object.freeze(["adjs", "act", "pvs", "rf", "cons", "rkd"]);
/** Visible 📊 Public columns, in page order. */
export const VISIBLE_PUBLIC = Object.freeze(["kd", "kpm", "ownKpm", "acc", "hsr", "ivi"]);
/** Every metric a card may carry, in basis order. */
export const CARD_METRICS = Object.freeze([...VISIBLE_ADJUSTED, ...VISIBLE_PUBLIC]);

const INACTIVE_DAYS = 180; // past tense below this (issue #3), distinct from the 🪦 flair at 365 days
const ACTIVE_WINDOW_MS = 30 * DAY_MS;

export const BANDS = Object.freeze([
  { key: "best", min: 99, label: "among the very best tracked" },
  { key: "top", min: 90, label: "top shelf / upper tier" },
  { key: "above", min: 75, label: "well above average" },
  { key: "mid", min: 40, label: "middle of the pack" },
  { key: "below", min: 20, label: "below average" },
  { key: "low", min: -Infinity, label: "near the bottom" },
]);

/** Population-percentile → band key (null percentile → "unknown"). */
export function bandFor(percentile) {
  if (percentile === null || percentile === undefined) return "unknown";
  for (const b of BANDS) if (percentile >= b.min) return b.key;
  return "low";
}

/** Band key → the "say something like" wording from issue #3. */
export function bandLabel(key) {
  return (BANDS.find((b) => b.key === key) || {}).label || "";
}

/**
 * Tenure state from account dates (seconds, Census `times`).
 * "new" created < 91 days ago · "grave" last activity > 1 year ago (🪦) ·
 * "inactive" last activity 180–365 days ago (past tense, no flair) ·
 * "veteran" 8+ year account, active within a year (👴🏽) · "active" otherwise ·
 * "unknown" when both dates are missing.
 */
export function tenureState(created, last, nowMs = Date.now()) {
  const c = Number(created) > 0 ? Number(created) : null;
  const l = Number(last) > 0 ? Number(last) : null;
  if (!c && !l) return "unknown";
  if (c && nowMs - c * 1000 < NEW_ACCOUNT_DAYS * DAY_MS) return "new";
  if (l && nowMs - l * 1000 > YEAR_MS) return "grave";
  if (l && nowMs - l * 1000 > INACTIVE_DAYS * DAY_MS) return "inactive";
  if (c && l && nowMs - c * 1000 >= VETERAN_YEARS * YEAR_MS && nowMs - l * 1000 <= YEAR_MS) return "veteran";
  return "active";
}

/** "YYYY-MM-DD" (UTC) for `at` / `updatedAt` fields. */
export function todayISO(nowMs = Date.now()) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** UTC year of a Census seconds timestamp, or null. */
export function yearOf(sec) {
  const n = Number(sec);
  return n > 0 ? new Date(n * 1000).getUTCFullYear() : null;
}

function finiteOrNull(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** data/ranks.json → { cols, rows } (missing/broken file → empty). */
export function readRanks(dataDir) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dataDir, "ranks.json"), "utf8"));
    if (!j || !Array.isArray(j.cols) || !Array.isArray(j.rows)) return { cols: [], rows: [] };
    return j;
  } catch {
    return { cols: [], rows: [] };
  }
}

/** data/reviewed.json → Set of slugs with decision "padding" (missing file → none). */
export function readConfirmedPadders(dataDir) {
  try {
    return confirmedPadderSlugs(JSON.parse(fs.readFileSync(path.join(dataDir, "reviewed.json"), "utf8")));
  } catch {
    return new Set();
  }
}

/** data/legend-notes.json → { players: { slug: { note, at } } } (missing file → empty). */
export function readNotes(dataDir) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dataDir, "legend-notes.json"), "utf8"));
    return j && typeof j === "object" && j.players && typeof j.players === "object" ? j : { players: {} };
  } catch {
    return { players: {} };
  }
}

function rowObject(cols, row) {
  const o = {};
  cols.forEach((c, i) => { o[c] = row[i]; });
  return o;
}

/** One card from a ranks.json row object. Pools are the sorted finite values per metric. */
export function buildCard(row, { pools, padders, notes, nowMs = Date.now() } = {}) {
  const slug = String(row.slug || "");
  const thin = row.thin === 1;
  const padding = padders ? padders.has(slug) : false;
  const eligible = !thin && !padding;
  const metrics = {};
  for (const id of CARD_METRICS) {
    const value = finiteOrNull(row[id]);
    const percentile = value === null ? null : percentileOf(pools?.[id] || [], value);
    metrics[id] = { value, percentile, band: bandFor(percentile) };
  }
  const tenure = {
    created: finiteOrNull(row.created) ? Math.floor(row.created) : null,
    last: finiteOrNull(row.last) ? Math.floor(row.last) : null,
    state: tenureState(row.created, row.last, nowMs),
    flair: (flairsFor({ created: row.created, last: row.last }, nowMs)[0] || {}).emoji || null,
    createdYear: yearOf(row.created),
    lastSeenDaysAgo: finiteOrNull(row.last) ? Math.floor((nowMs - row.last * 1000) / DAY_MS) : null,
    accountAgeDays: finiteOrNull(row.created) ? Math.floor((nowMs - row.created * 1000) / DAY_MS) : null,
  };
  const top = finiteOrNull(row.top) ? row.top : null;
  const card = {
    slug,
    name: String(row.name || ""),
    query: String(row.query || ""),
    bareName: bareName(String(row.name || "")),
    eligible,
    ineligibleReason: !eligible ? (padding ? "padding" : "thin") : null,
    metrics,
    tenure,
    top,
    legacySample: top !== null && top < 200,
    ownerNote: (notes?.players?.[slug]?.note) || null,
    basis: "",
  };
  card.basis = [...CARD_METRICS.map((id) => metrics[id].band), tenure.state].join("|");
  return card;
}

/** All cards, in the issue #3 chunk order (A active-30d, B rest, C 🪦), each group by ⚔️ iVi desc. */
export function buildCards({ ranks, padders = new Set(), notes = { players: {} }, nowMs = Date.now() } = {}) {
  const cols = ranks?.cols || [];
  const pools = {};
  for (const id of CARD_METRICS) {
    pools[id] = sortedFinite((ranks?.rows || []).map((r) => r[cols.indexOf(id)]));
  }
  const cards = (ranks?.rows || []).map((r) => buildCard(rowObject(cols, r), { pools, padders, notes, nowMs }));
  const byAdjs = (a, b) => {
    const av = a.metrics.adjs.value, bv = b.metrics.adjs.value;
    if (av === null && bv === null) return a.slug < b.slug ? -1 : 1;
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv - av || (a.slug < b.slug ? -1 : 1);
  };
  // NOTE: chunk order uses the caller's nowMs via tenure.last, not wall-clock Date.now().
  const isRecent = (c) => c.tenure.last !== null && nowMs - c.tenure.last * 1000 <= ACTIVE_WINDOW_MS;
  const groupA = cards.filter((c) => isRecent(c)).sort(byAdjs);
  const groupC = cards.filter((c) => !isRecent(c) && c.tenure.state === "grave").sort(byAdjs);
  const inC = new Set(groupC.map((c) => c.slug));
  const inA = new Set(groupA.map((c) => c.slug));
  const groupB = cards.filter((c) => !inA.has(c.slug) && !inC.has(c.slug)).sort(byAdjs);
  return [...groupA, ...groupB, ...groupC];
}

/** Shard filename for a slug: data/descriptions/<first char>.json */
export function shardFileFor(slug) {
  const first = String(slug || "").charAt(0).toLowerCase() || "_";
  return `${first}.json`;
}

/** All stored legends: Map slug → { text, basis, at, shard }. Missing dir → empty. */
export function readLegends(dataDir) {
  const out = new Map();
  const dir = path.join(dataDir, "descriptions");
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json").sort();
  } catch {
    return out;
  }
  for (const file of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      for (const [slug, entry] of Object.entries(j?.players || {})) {
        out.set(slug, { text: entry?.text, basis: entry?.basis, at: entry?.at, shard: file });
      }
    } catch {
      // A broken shard is the validator's problem; skip it here.
    }
  }
  return out;
}

/**
 * Legends that need attention: stored basis ≠ current card basis, legends
 * for players who are now ineligible / gone from ranks, and stored entries
 * with no basis at all.
 */
export function findStale(cards, legends) {
  const bySlug = new Map(cards.map((c) => [c.slug, c]));
  const out = [];
  for (const [slug, legend] of legends) {
    const card = bySlug.get(slug);
    if (!card) {
      out.push({ slug, name: "", status: "not-ranked", storedBasis: legend.basis ?? null, currentBasis: null });
    } else if (!card.eligible) {
      out.push({ slug, name: card.name, status: "ineligible", reason: card.ineligibleReason, storedBasis: legend.basis ?? null, currentBasis: card.basis });
    } else if (legend.basis !== card.basis) {
      out.push({ slug, name: card.name, status: "stale", storedBasis: legend.basis ?? null, currentBasis: card.basis });
    }
  }
  return out.sort((a, b) => (a.slug < b.slug ? -1 : 1));
}

/** Rebuild data/descriptions/index.json from the shards on disk. */
export function reindex(dataDir, nowMs = Date.now()) {
  const dir = path.join(dataDir, "descriptions");
  fs.mkdirSync(dir, { recursive: true });
  const shards = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json").sort();
  let updatedAt = null;
  for (const file of shards) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      if (typeof j?.updatedAt === "string" && (!updatedAt || j.updatedAt > updatedAt)) updatedAt = j.updatedAt;
    } catch {
      // Broken shard: validator reports it; reindex keeps the others.
    }
  }
  const index = { updatedAt: updatedAt || todayISO(nowMs), shards };
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(index, null, 2) + "\n");
  return index;
}

function parseArgs(argv) {
  const out = { slugs: [], chunk: null, chunkSize: 40, stale: false, reindex: false, data: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--slug" && argv[i + 1]) out.slugs.push(...argv[++i].split(",").map((s) => s.trim()).filter(Boolean));
    else if (a === "--chunk" && argv[i + 1]) out.chunk = Number(argv[++i]);
    else if (a === "--chunk-size" && argv[i + 1]) out.chunkSize = Number(argv[++i]);
    else if (a === "--stale") out.stale = true;
    else if (a === "--reindex") out.reindex = true;
    else if (a === "--data" && argv[i + 1]) out.data = argv[++i];
  }
  return out;
}

function main(argv) {
  const opts = parseArgs(argv);
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const dataDir = opts.data || path.join(root, "data");
  if (opts.reindex) {
    console.log(JSON.stringify(reindex(dataDir), null, 2));
    return;
  }
  const ranks = readRanks(dataDir);
  const padders = readConfirmedPadders(dataDir);
  const notes = readNotes(dataDir);
  const cards = buildCards({ ranks, padders, notes });
  if (opts.stale) {
    console.log(JSON.stringify(findStale(cards, readLegends(dataDir)), null, 2));
    return;
  }
  let out = cards;
  if (opts.slugs.length) {
    const want = new Set(opts.slugs.map((s) => s.toLowerCase()));
    out = cards.filter((c) => want.has(c.slug) || want.has(c.bareName.toLowerCase()));
  } else if (opts.chunk !== null) {
    const eligible = cards.filter((c) => c.eligible);
    const start = opts.chunk * opts.chunkSize;
    out = eligible.slice(start, start + opts.chunkSize);
  }
  console.log(JSON.stringify(out, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
