#!/usr/bin/env node
/**
 * 🆓 Available outfit names: verify the curated candidates and write data/outfit-names.json.
 *
 *   node scripts/verify-outfit-names.mjs [--candidates scripts/outfit-name-candidates.json]
 *     [--out data/outfit-names.json] [--per-faction 15] [--offline]
 *
 * 1. Local check: a candidate whose normalised name or tag collides with
 *    data/outfits.json (the 347 listed outfits, ≥5 known members) is out.
 * 2. Live check (unless --offline): Census `outfit?name_lower=` for the name and
 *    `outfit?alias_lower=` for the tag, one call each, ~1.2 s apart (polite
 *    60/min pace, same service ID as the site). Any hit, or any failed lookup,
 *    drops the candidate — a failed check must never report "available".
 * 3. Keeps the first PER-FACTION available candidates per faction (vs/nc/tr/nso),
 *    in file order, and writes data/outfit-names.json with verifiedAt.
 *
 * The page re-checks on demand in the browser; this file is the build-time
 * provenance for the shipped list, not a guarantee — someone can take a name
 * after it was verified (the page says so).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeName, normalizeTag, localTaken, isNameTakenLocal, isTagTakenLocal,
  nameLookupUrl, tagLookupUrl, parseLookup, OUTFIT_CENSUS_BASE,
  OUTFIT_NAME_COLS, toNameArrays, NAME_FACTIONS,
} from "../outfit-names.mjs";
import { readOutfitRows } from "../outfit-stats.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const CANDIDATES = path.resolve(ROOT, arg("--candidates", "scripts/outfit-name-candidates.json"));
const OUT = path.resolve(ROOT, arg("--out", "data/outfit-names.json"));
const PER_FAC = +arg("--per-faction", "15") || 15;
const OFFLINE = process.argv.includes("--offline");
const GAP_MS = 1200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };

async function censusLookup(url) {
  const r = await fetch(url, { headers: { "User-Agent": "ps2-elite-kd verify-outfit-names (+https://dayset.github.io/ps2-elite-kd/)", Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return parseLookup(await r.json());
}

async function main() {
  const candidates = readJson(CANDIDATES, []);
  const outfits = readOutfitRows(readJson(path.join(ROOT, "data/outfits.json"), {}));
  const taken = localTaken(outfits);
  const kept = [], rejected = [];
  const perFac = Object.fromEntries(NAME_FACTIONS.map((f) => [f, 0]));
  const seenNames = new Set(), seenTags = new Set();
  for (const c of candidates) {
    const name = String(c.name || ""), tag = String(c.tag || ""), fac = String(c.fac || ""), srv = String(c.srv || "");
    const why = [];
    if (!NAME_FACTIONS.includes(fac)) why.push("bad faction");
    if (!["osprey", "wainwright"].includes(srv)) why.push("bad server");
    if (!name || !tag) why.push("missing name/tag");
    if (normalizeName(name) && seenNames.has(normalizeName(name))) why.push("duplicate name in list");
    if (normalizeTag(tag) && seenTags.has(normalizeTag(tag))) why.push("duplicate tag in list");
    if (isNameTakenLocal(name, taken)) why.push("name in data/outfits.json");
    if (isTagTakenLocal(tag, taken)) why.push("tag in data/outfits.json");
    if (perFac[fac] >= PER_FAC) why.push("faction full");
    if (why.length) { rejected.push([name, tag, fac, why.join("; ")]); continue; }
    if (!OFFLINE) {
      try {
        const n = await censusLookup(nameLookupUrl(OUTFIT_CENSUS_BASE, name));
        await sleep(GAP_MS);
        if (n.taken === null) why.push("name lookup failed");
        else if (n.taken) why.push(`name taken on Census (${n.rows.map((r) => `[${r.tag}] ${r.name}`).join(", ")})`);
        if (!why.length && tag) {
          const t = await censusLookup(tagLookupUrl(OUTFIT_CENSUS_BASE, tag));
          await sleep(GAP_MS);
          if (t.taken === null) why.push("tag lookup failed");
          else if (t.taken) why.push(`tag taken on Census (${t.rows.map((r) => `[${r.tag}] ${r.name}`).join(", ")})`);
        }
      } catch (e) { why.push(`Census error: ${e.message}`); }
    }
    if (why.length) { rejected.push([name, tag, fac, why.join("; ")]); continue; }
    kept.push({ name, tag, fac, srv });
    seenNames.add(normalizeName(name));
    seenTags.add(normalizeTag(tag));
    perFac[fac]++;
    console.log(`  ok [${tag}] ${name} (${fac}, ${srv})`);
  }
  console.log(`\nKept ${kept.length} (${NAME_FACTIONS.map((f) => `${f} ${perFac[f]}`).join(", ")}); rejected ${rejected.length}:`);
  for (const [n, t, f, w] of rejected) console.log(`  no [${t}] ${n} (${f}): ${w}`);
  if (kept.length < PER_FAC * NAME_FACTIONS.length) {
    console.log(`warning: only ${kept.length} of ${PER_FAC * NAME_FACTIONS.length} wanted — add more candidates`);
  }
  const out = {
    v: 1,
    verifiedAt: new Date().toISOString(),
    checkedVia: OFFLINE ? "local-only (data/outfits.json)" : "Census outfit?name_lower / alias_lower (PC-wide)",
    cols: [...OUTFIT_NAME_COLS],
    rows: toNameArrays(kept),
  };
  fs.writeFileSync(OUT, JSON.stringify(out) + "\n");
  console.log(`Wrote ${path.relative(ROOT, OUT)}: ${kept.length} names`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`verify-outfit-names: ${e.message}`); process.exit(1); });
}
