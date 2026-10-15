#!/usr/bin/env node
/**
 * Validator for the story-style player legends (issue #3).
 *
 *   node scripts/check-legends.mjs          # all shards, human report, exit 1 on violations
 *   node scripts/check-legends.mjs --json   # same report as JSON
 *
 * Rules (issue #3 Validator): 45–90 words; no digits after removing the
 * player's own name except years 2012–2026; the player's own name forms are
 * not content, so they are stripped before the pronoun / banned / role /
 * relational word checks (a player actually named Aimbot, Tank, or Squad can
 * still be named); no he/him/his/she/her; no
 * cheating/padding/farming/flag words; no role words and no words relating
 * players to each other (teammate, squad, rival, alt, …) unless the player has
 * an owner note; no 3-word opening used by more than 1% of legends; no
 * 6-word phrase appearing more than 25 times; every key an eligible slug;
 * `basis` matches the current card. Also checks shard shape and that
 * data/descriptions/index.json is in sync with the shards on disk.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCards, readRanks, readConfirmedPadders, readNotes, readLegends, shardFileFor } from "./build-legend-cards.mjs";
import { bareName } from "../rank-row.mjs";

export const WORD_MIN = 45;
export const WORD_MAX = 90;
export const YEAR_MIN = 2012;
export const YEAR_MAX = 2026;
export const MAX_PHRASE_COUNT = 25;

const PRONOUN_RE = /\b(he|him|his|she|her)\b/i;

/** Cheating / padding / farming / flag words (whole words + common inflections). */
export const BANNED_PATTERNS = [
  /\bcheats?\b/i, /\bcheating\b/i, /\bcheaters?\b/i,
  /\bhacks?\b/i, /\bhacking\b/i, /\bhackers?\b/i,
  /\baimbots?\b/i,
  /\bexploits?\b/i, /\bexploiting\b/i, /\bexploited\b/i,
  /\bpadding\b/i, /\bpadders?\b/i,
  /\bfarms?\b/i, /\bfarming\b/i, /\bfarmed\b/i, /\bfarmers?\b/i,
  /\bflags?\b/i, /\bflagged\b/i,
  /\bsuspicious\b/i,
];

/** Role / loadout words. MAX matches uppercase only ("maximum" is fine). */
export const ROLE_PATTERNS = [
  /\bMAX\b/,
  /\binfiltrators?\b/i, /\bstalkers?\b/i, /\bsnipers?\b/i, /\bmedics?\b/i,
  /\bengineers?\b/i, /\bheavy\b/i, /\blight assault\b/i,
  /\bvehicles?\b/i, /\btanks?\b/i, /\bpilots?\b/i, /\besf\b/i,
  /\bharassers?\b/i, /\bsunderers?\b/i, /\blightnings?\b/i,
];

/**
 * Words that relate one player to another (teammates, rivals, alts, same
 * outfit/squad). Players are never related to each other in legends: no
 * comparisons, no named references, no implied relationships. Same
 * owner-note exemption as role words: a note may license "plays with …".
 */
export const RELATIONAL_PATTERNS = [
  /\bteammates?\b/i, /\bsquadmates?\b/i, /\boutfitmates?\b/i, /\bclanmates?\b/i,
  /\bsquads?\b/i, /\bduos?\b/i, /\bpartners?\b/i,
  /\brivals?\b/i, /\brivalry\b/i, /\bnemesis\b/i,
  /\balts?\b/i, /\bsame outfit\b/i, /\bsame squad\b/i,
];

/** Lowercase alphanumeric words (apostrophes kept): the repetition-guard alphabet. */
export function normWords(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function wordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

/** Text with the player's own name forms removed (the name is not content). */
export function stripNameForms(text, { name = "", query = "", slug = "" } = {}) {
  let t = String(text || "");
  for (const form of [name, bareName(name), query, slug]) {
    if (form) t = t.split(form).join("");
  }
  return t;
}

/** Digit runs left after removing the player's own name forms; each must be a year. */
export function badDigits(text, { name = "", query = "", slug = "" } = {}) {
  const t = stripNameForms(text, { name, query, slug });
  const out = [];
  for (const m of t.match(/\d+/g) || []) {
    const n = Number(m);
    if (!/^\d{4}$/.test(m) || n < YEAR_MIN || n > YEAR_MAX) out.push(m);
  }
  return out;
}

function firstMatch(text, patterns) {
  for (const re of patterns) {
    const m = String(text || "").match(re);
    if (m) return m[0];
  }
  return null;
}

/**
 * Violations for one legend. `card` is the current card for the slug
 * (undefined when the slug is not in ranks.json at all).
 */
export function validateLegend({ slug, text, basis, card, hasOwnerNote = false }) {
  const v = [];
  if (typeof text !== "string" || !text.trim()) {
    v.push("empty text");
    return v;
  }
  const words = wordCount(text);
  if (words < WORD_MIN) v.push(`only ${words} words (min ${WORD_MIN})`);
  if (words > WORD_MAX) v.push(`${words} words (max ${WORD_MAX})`);
  const digits = badDigits(text, { name: card?.name || "", query: card?.query || "", slug });
  if (digits.length) v.push(`digits other than years ${YEAR_MIN}–${YEAR_MAX}: ${[...new Set(digits)].join(", ")}`);
  // The player's own name is not content: strip its forms before the word checks.
  const content = stripNameForms(text, { name: card?.name || "", query: card?.query || "", slug });
  if (PRONOUN_RE.test(content)) v.push(`gendered pronoun (${(content.match(PRONOUN_RE) || [])[0]})`);
  const banned = firstMatch(content, BANNED_PATTERNS);
  if (banned) v.push(`banned word: "${banned}"`);
  if (!hasOwnerNote) {
    const role = firstMatch(content, ROLE_PATTERNS);
    if (role) v.push(`role word without owner note: "${role}"`);
    const rel = firstMatch(content, RELATIONAL_PATTERNS);
    if (rel) v.push(`relates players to each other without owner note: "${rel}"`);
  }
  if (!card) {
    v.push("slug is not in ranks.json");
  } else {
    if (!card.eligible) v.push(`player is not eligible (${card.ineligibleReason})`);
    if (basis !== card.basis) v.push(`basis mismatch (stored ${JSON.stringify(basis)} ≠ current ${JSON.stringify(card.basis)})`);
  }
  return v;
}

/** Repetition-guard violations across all legends. */
export function repetitionViolations(legends) {
  const v = [];
  const total = legends.length;
  if (!total) return v;
  const openings = new Map();
  for (const { text } of legends) {
    const key = normWords(text).slice(0, 3).join(" ");
    openings.set(key, (openings.get(key) || 0) + 1);
  }
  for (const [opening, count] of [...openings.entries()].sort((a, b) => b[1] - a[1])) {
    // Floor of 1: an opening used by a single legend is not "reused". At full
    // scale (10k legends) the 1% rule governs; at pilot scale any duplicate does.
    if (count > Math.max(1, total * 0.01)) v.push(`opening "${opening}" used by ${count} legends (> 1%)`);
  }
  const phrases = new Map();
  for (const { text } of legends) {
    const words = normWords(text);
    for (let i = 0; i + 6 <= words.length; i++) {
      const key = words.slice(i, i + 6).join(" ");
      phrases.set(key, (phrases.get(key) || 0) + 1);
    }
  }
  for (const [phrase, count] of [...phrases.entries()].sort((a, b) => b[1] - a[1])) {
    if (count > MAX_PHRASE_COUNT) v.push(`6-word phrase "${phrase}" appears ${count} times (> ${MAX_PHRASE_COUNT})`);
  }
  return v;
}

/** Full report over the shards on disk: { legendCount, violations: [{slug, messages}] }. */
export function checkShards(dataDir) {
  const ranks = readRanks(dataDir);
  const padders = readConfirmedPadders(dataDir);
  const notes = readNotes(dataDir);
  const cards = buildCards({ ranks, padders, notes });
  const bySlug = new Map(cards.map((c) => [c.slug, c]));
  const legends = readLegends(dataDir);
  const violations = [];
  const entries = [];
  for (const [slug, legend] of [...legends.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const card = bySlug.get(slug);
    const messages = validateLegend({
      slug,
      text: legend.text,
      basis: legend.basis,
      card,
      hasOwnerNote: Boolean(notes?.players?.[slug]?.note),
    });
    if (typeof legend.text !== "string" || !legend.text.trim()) messages.unshift("missing text");
    if (typeof legend.basis !== "string") messages.push("missing basis");
    if (typeof legend.at !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(legend.at)) messages.push("missing/invalid at date");
    if (legend.shard !== shardFileFor(slug)) messages.push(`stored in wrong shard (${legend.shard}, expected ${shardFileFor(slug)})`);
    if (messages.length) violations.push({ slug, messages });
    entries.push({ slug, text: legend.text || "" });
  }
  for (const message of repetitionViolations(entries)) {
    violations.push({ slug: "(all)", messages: [message] });
  }
  // index.json must list exactly the shards on disk, with the max shard updatedAt.
  const dir = path.join(dataDir, "descriptions");
  let shardFiles = [];
  try {
    shardFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json").sort();
  } catch {
    shardFiles = [];
  }
  let maxUpdatedAt = null;
  for (const file of shardFiles) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      if (typeof j?.updatedAt === "string" && (!maxUpdatedAt || j.updatedAt > maxUpdatedAt)) maxUpdatedAt = j.updatedAt;
      if (!j || typeof j !== "object" || typeof j.players !== "object") {
        violations.push({ slug: `(shard ${file})`, messages: ["shard is not { updatedAt, players }"] });
      }
    } catch {
      violations.push({ slug: `(shard ${file})`, messages: ["shard is not valid JSON"] });
    }
  }
  let index = null;
  try {
    index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
  } catch {
    violations.push({ slug: "(index)", messages: ["data/descriptions/index.json missing or invalid (run build-legend-cards.mjs --reindex)"] });
  }
  if (index) {
    if (JSON.stringify(index.shards || []) !== JSON.stringify(shardFiles)) {
      violations.push({ slug: "(index)", messages: [`shard list ${JSON.stringify(index.shards || [])} ≠ files on disk ${JSON.stringify(shardFiles)}`] });
    }
    if (index.updatedAt !== maxUpdatedAt) {
      violations.push({ slug: "(index)", messages: [`updatedAt ${JSON.stringify(index.updatedAt)} ≠ max shard updatedAt ${JSON.stringify(maxUpdatedAt)}`] });
    }
  }
  return { legendCount: legends.size, violations };
}

function main(argv) {
  const asJson = argv.includes("--json");
  const dataIdx = argv.indexOf("--data");
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const dataDir = dataIdx >= 0 && argv[dataIdx + 1] ? argv[dataIdx + 1] : path.join(root, "data");
  const report = checkShards(dataDir);
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else if (!report.violations.length) {
    console.log(`check-legends: OK — ${report.legendCount} legends, no violations`);
  } else {
    console.log(`check-legends: ${report.violations.length} violation groups over ${report.legendCount} legends`);
    for (const { slug, messages } of report.violations) {
      for (const m of messages) console.log(`  ${slug}: ${m}`);
    }
  }
  if (report.violations.length) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
