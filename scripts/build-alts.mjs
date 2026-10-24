#!/usr/bin/env node
/**
 * 👥 Likely alts (owner t600) → data/alts.json, shown ONLY on the hidden
 * build-log (noindex, never linked). Always "likely", never proof.
 *
 *   node scripts/build-alts.mjs [--max-honu 60] [--dry]
 *
 * 1. Candidate pairs WITHOUT Honu: shared rare name part (5+ letters), or a very
 *    close stat profile in the same outfit tag; plus every pair inside the
 *    data/alt-families.json families / test sets.
 * 2. Honu sessions (1 call per character, GET /api/character/{id}/sessions) only
 *    for characters in those pairs, best candidates first, ≤ --max-honu per run,
 *    counted in data/honu-usage.json, cached in data/alt-sessions.json
 *    (≤ 365 days of [start, minutes]; re-fetched after 14 days).
 * 3. Calibration: clue bins + likelihood ratios learned from known alt pairs
 *    (Ahorn family) vs pairs of a fixed random sample of active players.
 * 4. Score = prior odds × Π clue LRs → %. Reasons per clue are stored.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  compactSessions, sessionClues, nameClue, bareName, profileVector, robustScale,
  profileDistance, jaccard, calibrate, scorePair, dropOverlapping,
  linked, handZ, groupFacts, GROUP_CLUES, GROUP_DIRECTION, LINK,
} from "./alts-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = process.env.DATA_DIR || path.join(ROOT, "data");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MAX_HONU = Math.max(0, Number(arg("--max-honu", 60)) || 0);
const DRY = process.argv.includes("--dry");
const VERBOSE = process.argv.includes("--verbose");
const NOW = Date.now();
const DAY = 86400e3;
const KEEP_DAYS = 365;
const STALE_DAYS = 14;
const ACTIVE_DAYS = 120; // a pair needs both characters seen within this many days
const NEG_SAMPLE = 150; // random active players whose sessions are fetched for "different people" pairs
const NEG_PROFILE = 300; // random active players for the no-Honu clues (name, stats, weapons, outfit tag)
// Before any clue: two random active characters. Assumption (shown on the build-log):
// a typical character has about one alt among the cached active characters → odds ≈ 1 / active count.
let PRIOR_ODDS = 1 / 14000;
const HONU = "https://wt.honu.pw/api/";
const UA = "ps2-elite-kd-cache-bot/2.0 (+https://github.com/Dayset/ps2-elite-kd; contact: github.com/Dayset)";
const HONU_CAP = Number(process.env.HONU_DAILY_CAP) > 0 ? Number(process.env.HONU_DAILY_CAP) : 10000;
const FORENSICS_RESERVE = 150;
const WORTH_MAX = 300; // candidate pairs kept for a sessions check (≤ 600 characters, refreshed every 14 days)

const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { const t = p + ".tmp"; fs.writeFileSync(t, JSON.stringify(v) + "\n"); fs.renameSync(t, p); };

// ---------- inputs ----------
const ranks = readJson(path.join(DATA, "ranks.json"));
const I = Object.fromEntries(ranks.cols.map((c, i) => [c, i]));
const fam = readJson(path.join(DATA, "alt-families.json"), { families: {}, test: {} });
const index = readJson(path.join(DATA, "index.json"), { players: [] });
const tagOf = new Map(index.players.map((p) => [p.slug, (String(p.name).match(/^\[([^\]]+)\]/) || [])[1] || ""]));
const rowBySlug = new Map(ranks.rows.map((r) => [r[I.slug], r]));
const vecs = new Map(ranks.rows.map((r) => [r[I.slug], profileVector(r, I)]));
const scale = robustScale([...vecs.values()]);
const isActive = (slug) => { const r = rowBySlug.get(slug); return r && r[I.last] * 1000 > NOW - ACTIVE_DAYS * DAY; };
const playerFile = (slug) => readJson(path.join(DATA, "players", `${slug}.json`), null);

// deterministic PRNG (sample is stable between runs → cached sessions are reused)
let seed = 20261024;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

// ---------- 1. candidate pairs ----------
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const cand = new Map(); // key → { a, b, why, pre }
const addCand = (a, b, why, pre) => {
  if (a === b) return;
  const k = pairKey(a, b);
  const c = cand.get(k);
  if (c) { if (!c.why.includes(why)) c.why.push(why); }
  else cand.set(k, { a: k.split("|")[0], b: k.split("|")[1], why: [why], pre: 0 });
};
const famSlugs = Object.values(fam.families || {}).flat();
const testSlugs = Object.values(fam.test || {}).flat();
for (const set of [...Object.values(fam.families || {}), ...Object.values(fam.test || {})]) {
  for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) addCand(set[i], set[j], "set", 99);
}
const active = ranks.rows.filter((r) => isActive(r[I.slug])).map((r) => r[I.slug]);
PRIOR_ODDS = 1 / Math.max(1000, active.length);
// a) rare shared name part (5+ letters, in ≤ 12 active names)
const grams = new Map();
for (const s of active) {
  const n = bareName(rowBySlug.get(s)[I.name]).replace(/[0-9]/g, "");
  const seen = new Set();
  for (let i = 0; i + 5 <= n.length; i++) seen.add(n.slice(i, i + 5));
  for (const g of seen) { if (!grams.has(g)) grams.set(g, []); grams.get(g).push(s); }
}
for (const [, list] of grams) {
  if (list.length < 2 || list.length > 12) continue;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const d = profileDistance(vecs.get(list[i]), vecs.get(list[j]), scale);
    addCand(list[i], list[j], "name", 10 - (d ?? 3));
  }
}
// b) same outfit tag + very close stat profile (the 2 nearest in the tag)
const byTag = new Map();
for (const s of active) { const t = tagOf.get(s); if (t) { if (!byTag.has(t)) byTag.set(t, []); byTag.get(t).push(s); } }
for (const [, list] of byTag) {
  if (list.length < 2 || list.length > 400) continue;
  for (const s of list) {
    const near = list.filter((o) => o !== s).map((o) => [o, profileDistance(vecs.get(s), vecs.get(o), scale)])
      .filter(([, d]) => d != null && d < 0.35).sort((x, y) => x[1] - y[1]).slice(0, 2);
    for (const [o, d] of near) addCand(s, o, "outfit+profile", 5 - d);
  }
}

// negatives: a fixed random sample of active players (different people, almost surely)
const cachePath = path.join(DATA, "alt-sessions.json");
const cache = readJson(cachePath, { v: 1, chars: {} });
const negPool = active.filter((s) => !famSlugs.includes(s) && !testSlugs.includes(s));
// Keep last run's sample (its sessions are cached) while those players stay active; top up at random.
// Saves Honu calls: a fresh random draw after every ranks update would need ~150 new calls.
const poolSet = new Set(negPool);
const prevSample = (cache.negSample || Object.keys(cache.chars).filter((s) => !famSlugs.includes(s) && !testSlugs.includes(s)))
  .filter((s) => poolSet.has(s)).slice(0, NEG_SAMPLE);
const negSample = [...prevSample];
for (const s of prevSample) negPool.splice(negPool.indexOf(s), 1);
while (negSample.length < NEG_SAMPLE && negPool.length) negSample.push(negPool.splice(Math.floor(rnd() * negPool.length), 1)[0]); // these also get Honu sessions
const negBig = [...negSample];
while (negBig.length < NEG_PROFILE && negPool.length) negBig.push(negPool.splice(Math.floor(rnd() * negPool.length), 1)[0]);
cache.negSample = negSample;

// ---------- 2. clues ----------
const sessOf = (s) => {
  const c = cache.chars[s];
  if (!c) return null;
  const out = [];
  for (let i = 0; i < c.sess.length; i += 2) out.push([c.sess[i], c.sess[i + 1]]);
  return out;
};
const pfCache = new Map();
const pf = (s) => { if (!pfCache.has(s)) pfCache.set(s, playerFile(s)); return pfCache.get(s); };
const weaponIds = (s) => { const p = pf(s); return p && p.player && p.player.weapons ? p.player.weapons.rows.map((r) => String(r[0])) : null; };
// Faction guns can't match across factions: compare common (faction 0) weapons, plus the
// faction's own guns only when both characters mainly play the same faction.
const CATALOG = readJson(path.join(ROOT, "assets", "weapons", "catalog.json"), { items: {} }).items || {};
const facOfWeapon = (id) => (CATALOG[id] ? +CATALOG[id][2] || 0 : null);
const mainFaction = (ids) => {
  const n = {};
  for (const id of ids) { const f = facOfWeapon(id); if (f) n[f] = (n[f] || 0) + 1; }
  const best = Object.entries(n).sort((x, y) => y[1] - x[1])[0];
  return best ? +best[0] : 0;
};
function sharedWeapons(a, b) {
  const wa = weaponIds(a), wb = weaponIds(b);
  if (!wa || !wb) return null;
  const fa = mainFaction(wa), fb = mainFaction(wb);
  const keep = (id) => { const f = facOfWeapon(id); return f === 0 || (f != null && fa === fb && f === fa); };
  return jaccard(wa.filter(keep), wb.filter(keep));
}
const nameOf = (s) => { const r = rowBySlug.get(s); return r ? r[I.name] : (pf(s)?.player?.display || s); };
// Owner t601/t602/t604: known alts that sometimes ran on a second PC at the same time.
// fam.secondPc keys: a character slug (its overlaps with anyone in its family) or a family
// name (every overlap between two members of that family). Those overlapping sessions are
// left out of CALIBRATION and family linking only; the pair rows shown use all data.
const famOf = new Map();
for (const [k, set] of Object.entries(fam.families || {})) for (const s of set) famOf.set(s, k);
const SECOND_PC = new Set(Object.keys(fam.secondPc || {}));
const secondPcPair = (a, b) => famOf.has(a) && famOf.get(a) === famOf.get(b) &&
  (SECOND_PC.has(famOf.get(a)) || SECOND_PC.has(a) || SECOND_PC.has(b));
/** Sessions of a pair for calibration: for a known second-PC pair, b loses the sessions that overlap a. */
const calibPair = (a, b) => {
  const sa = sessOf(a), sb = sessOf(b);
  if (!sa || !sb || !secondPcPair(a, b)) return [sa, sb];
  return [sa, dropOverlapping(sb, sa)];
};
/** withFiles=false: no player-file reads (cheap pre-score over thousands of pairs). calib: second-PC stretches dropped. */
function clues(a, b, withFiles = true, calib = false) {
  const ca = cache.chars[a], cb = cache.chars[b];
  const ta = tagOf.get(a), tb = tagOf.get(b);
  const outfit = ca && cb && (ca.outfits.length || cb.outfits.length) ? ca.outfits.some((o) => cb.outfits.includes(o))
    : ta && tb ? ta === tb : null;
  return {
    sess: ca && cb ? sessionClues(...(calib ? calibPair(a, b) : [sessOf(a), sessOf(b)])) : null,
    profile: vecs.has(a) && vecs.has(b) ? profileDistance(vecs.get(a), vecs.get(b), scale) : null,
    weapons: withFiles ? sharedWeapons(a, b) : null,
    name: nameClue(nameOf(a), nameOf(b)),
    outfit,
  };
}
const famPairs = [];
for (const set of Object.values(fam.families || {})) for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) famPairs.push([set[i], set[j]]);
const negPairs = [];
for (let i = 0; i < negBig.length; i++) for (let j = i + 1; j < negBig.length; j++) negPairs.push([negBig[i], negBig[j]]);
for (const set of Object.values(fam.families || {})) for (const a of set) for (const b of negSample) negPairs.push([a, b]); // other people vs the family

// ---------- 3. pre-score (no Honu) → who is worth a sessions call ----------
const preModel = calibrate(famPairs.map(([a, b]) => clues(a, b, false, true)), negPairs.map(([a, b]) => clues(a, b, false)));
for (const c of cand.values()) c.pre = c.why.includes("set") ? 1 : scorePair(clues(c.a, c.b, false), preModel, PRIOR_ODDS).p;
const usagePath = path.join(DATA, "honu-usage.json");
const today = new Date().toISOString().slice(0, 10);
const usage = (() => { const u = readJson(usagePath, null); return u && u.day === today ? u : { day: today, calls: 0, forensics: 0, cap: HONU_CAP }; })();
const honuLeft = () => Math.max(0, HONU_CAP - usage.calls - Math.max(0, FORENSICS_RESERVE - (usage.forensics || 0)));
let honuUsed = 0, honuRequests = 0;
const fresh = (s, days = STALE_DAYS) => cache.chars[s] && cache.chars[s].at > NOW - days * DAY;

// curl with a hard time limit: Node's fetch sometimes never settled on a stalled Honu reply
// (seen on the dev box; even an abort signal / timeout race did not end it).
const execFileP = promisify(execFile);
async function honuGet(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) { usage.calls++; honuRequests++; } // a retry is one more request to Honu
    try {
      const { stdout } = await execFileP("curl", ["-sS", "-f", "-m", "25", "--compressed", "-H", "Accept: application/json", "-A", UA, url], { maxBuffer: 64 << 20 });
      return JSON.parse(stdout);
    } catch (e) {
      if (/\b404\b/.test(String(e && e.stderr))) return [];
    }
    await new Promise((res) => setTimeout(res, 4000 * (attempt + 1)));
  }
  return null;
}
/** Fetch sessions for slugs (in order) not fetched in the last STALE_DAYS, within the run + daily caps. */
async function fetchSessions(slugs, staleDays = STALE_DAYS) {
  let left = 0;
  for (const s of slugs) {
    if (VERBOSE) console.log('next', s, new Date().toISOString());
    if (fresh(s, staleDays)) continue;
    if (DRY || honuUsed >= MAX_HONU || honuLeft() < 1) { left++; continue; }
    const cid = pf(s)?.player?.cid;
    if (!/^\d+$/.test(String(cid || ""))) continue;
    honuUsed++; honuRequests++; usage.calls++;
    const list = await honuGet(`${HONU}character/${cid}/sessions`);
    if (VERBOSE) console.log(`honu ${honuUsed}: ${s} → ${list ? list.length + ' sessions' : 'failed'} ${new Date().toISOString()}`);
    if (list) {
      const c = compactSessions(list, { sinceMs: NOW - KEEP_DAYS * DAY, nowMs: NOW });
      cache.chars[s] = { cid: String(cid), at: NOW, sess: c.sess.flat(), outfits: c.outfits, teams: c.teams };
    }
    if (honuUsed % 5 === 0) { writeJson(usagePath, usage); writeJson(cachePath, cache); }
    await new Promise((res) => setTimeout(res, 6000)); // ≤ 10 calls / minute, like refresh-cache
  }
  return left;
}

// A) calibration sets first (families, test sets, random sample) …
let queueLeft = await fetchSessions([...new Set([...famSlugs, ...testSlugs])]);
// the random "different people" sample only calibrates: a 60-day-old copy is good enough
queueLeft += await fetchSessions(negSample.filter((s) => !famSlugs.includes(s) && !testSlugs.includes(s)), 60);
// B) … then a candidate pair is worth Honu calls only if the session clues COULD lift it past
// 50 %: no-Honu odds × the strongest session evidence the calibration has seen ≥ 1.
const SESS_CLUES = ["together", "handoff", "hours"];
const sessModel = calibrate(famPairs.map(([a, b]) => clues(a, b, true, true)), negPairs.map(([a, b]) => clues(a, b)));
const maxSessLR = SESS_CLUES.reduce((m, k) => m * (sessModel[k] ? Math.max(...sessModel[k].lr) : 1), 1);
const preOdds = (p) => p / (1 - p);
const worth = [...cand.values()].filter((c) => !c.why.includes("set") && preOdds(c.pre) * maxSessLR >= 1).sort((x, y) => y.pre - x.pre)
  .slice(0, WORTH_MAX); // best-first, so Honu calls go to the most promising pairs
const need = new Set([...famSlugs, ...testSlugs, ...negSample, ...worth.flatMap((c) => [c.a, c.b])]);
queueLeft += await fetchSessions([...new Set(worth.flatMap((c) => [c.a, c.b]))]);
if (!DRY) {
  writeJson(usagePath, usage);
  for (const [s, v] of Object.entries(cache.chars)) if (!need.has(s) && v.at < NOW - 60 * DAY) delete cache.chars[s];
  writeJson(cachePath, cache);
}

// ---------- 4. full calibration (with sessions) + scores ----------
const pos = famPairs.map(([a, b]) => clues(a, b, true, true));
const neg = negPairs.map(([a, b]) => clues(a, b));
const model = calibrate(pos, neg);
const fmtPair = (a, b, c) => {
  const { p, why } = scorePair(c, model, PRIOR_ODDS);
  const s = c.sess && c.sess.shared ? c.sess : null;
  return {
    a, b, na: nameOf(a), nb: nameOf(b), p: +(100 * p).toFixed(1), why,
    facts: {
      sessions: !!(cache.chars[a] && cache.chars[b]), shared: !!s,
      weeks: s ? s.weeks : null, together: s ? s.overlap : null, togetherN: s ? s.overlapN : null, expTogether: s ? Math.round(s.expOverlap) : null,
      hand: s ? s.hand : null, expHand: s ? s.expHand : null, coDays: s ? s.coDays : null, nA: s ? s.nA : null, nB: s ? s.nB : null,
      hours: s && s.hours != null ? +s.hours.toFixed(2) : null, profile: c.profile != null ? +c.profile.toFixed(2) : null,
      weapons: c.weapons != null ? +c.weapons.toFixed(2) : null, namePart: c.name.len >= 3 ? c.name.part : "", outfit: c.outfit,
    },
  };
};
const tests = {};
for (const [k, set] of [...Object.entries(fam.families || {}), ...Object.entries(fam.test || {})]) {
  const rows = [];
  for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) rows.push(fmtPair(set[i], set[j], clues(set[i], set[j])));
  rows.sort((x, y) => y.p - x.p);
  tests[k] = rows;
}
const found = [];
for (const c of worth) {
  if ( !cache.chars[c.a] || !cache.chars[c.b]) continue;
  const r = fmtPair(c.a, c.b, clues(c.a, c.b));
  r.via = c.why;
  if (r.p >= 50) found.push(r);
}
found.sort((x, y) => y.p - x.p);
// ---------- 5. 👪 groups: chains of hand-offs ----------
// Link two characters when one repeatedly logs on within 10 min of the other logging off
// (≥ 2 times, ≥ 3 SD above chance) AND they are (almost) never online together. Linked
// characters form a family; a character is also added when its hand-offs with the whole
// family pass the same test. The family then gets one "likely" % from two group clues
// (time together vs expected, hand-offs vs expected, summed over all member pairs),
// calibrated the same way: Ahorn sub-groups vs random groups of other players.
const pfMemo = new Map();
const pairFacts = (a, b, calib = true) => {
  const k = (calib ? "c:" : "") + pairKey(a, b);
  if (!pfMemo.has(k)) {
    const [A, B] = calib ? calibPair(a, b) : [sessOf(a), sessOf(b)];
    pfMemo.set(k, A && B && A.length && B.length ? sessionClues(A, B, { expand: true }) : null);
  }
  return pfMemo.get(k);
};
const withSess = Object.keys(cache.chars).filter((s) => cache.chars[s].sess.length >= 2);
const parent = new Map(withSess.map((s) => [s, s]));
const root = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
let links = 0;
const linkList = [];
for (let i = 0; i < withSess.length; i++) for (let j = i + 1; j < withSess.length; j++) {
  const c = pairFacts(withSess[i], withSess[j]);
  if (c && c.shared && linked(c)) { links++; linkList.push([withSess[i], withSess[j]]); parent.set(root(withSess[i]), root(withSess[j])); }
}
let comps = new Map();
for (const s of withSess) { const r = root(s); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(s); }
// grow: a character joins a family when its hand-offs with ALL members together pass the link test
let groups = [...comps.values()].filter((g) => g.length >= 2);
for (let pass = 0; pass < 3; pass++) {
  let grew = false;
  for (const g of groups) {
    for (const s of withSess) {
      if (g.includes(s) || groups.some((h) => h !== g && h.includes(s) && h.length >= g.length)) continue;
      const f = groupFacts([s, ...g], (a, b) => (a === s || b === s ? pairFacts(a, b) : null));
      if (f.pairs && linked(f, cache.chars[s].sess.length / 2)) { for (const h of groups) { const i = h.indexOf(s); if (i >= 0) h.splice(i, 1); } g.push(s); grew = true; }
    }
  }
  groups = groups.filter((g) => g.length >= 2);
  if (!grew) break;
}
// prune: hand-offs also happen between friends (one goes off, the squad-mate comes on). A member
// who is online together with the rest of the family more than a few brief minutes beyond
// 20 % of what chance predicts is a friend, not an alt: drop the worst one until all pass.
const dropped = [];
for (const g of groups) {
  for (;;) {
    let worst = null, worstR = 0;
    for (const s of g) {
      const f = groupFacts([s, ...g.filter((x) => x !== s)], (a, b) => (a === s || b === s ? pairFacts(a, b) : null));
      const lim = LINK.overlapFloor + LINK.overlapShare * f.expOverlap;
      const r = f.overlap / lim;
      if (r > 1 && r > worstR) { worst = s; worstR = r; }
    }
    if (!worst) break;
    g.splice(g.indexOf(worst), 1);
    dropped.push(worst);
  }
}
groups = groups.filter((g) => g.length >= 2);
// (pairFacts drops declared second-PC stretches by default: the owner told us those are one person on two PCs)
// calibration: random Ahorn sub-groups (second-PC stretches dropped) vs random groups of the stranger sample
const sub = (pool, k) => { const p = [...pool], o = []; while (o.length < k && p.length) o.push(p.splice(Math.floor(rnd() * p.length), 1)[0]); return o; };
const famSess = Object.values(fam.families || {}).map((set) => set.filter((s) => cache.chars[s]));
const negSess = negSample.filter((s) => cache.chars[s]);
const gPos = [], gNeg = [];
for (let k = 3; k <= 9; k++) {
  for (const set of famSess) if (set.length >= k) for (let t = 0; t < 40; t++) gPos.push(groupFacts(sub(set, k), (a, b) => pairFacts(a, b, true)));
  for (let t = 0; t < 400; t++) gNeg.push(groupFacts(sub(negSess, k), (a, b) => pairFacts(a, b)));
}
const gModel = calibrate(gPos, gNeg, GROUP_CLUES, GROUP_DIRECTION);
const nameList = (g) => g.map(nameOf);
const fmtGroup = (g) => {
  const f = groupFacts(g, (a, b) => pairFacts(a, b));
  const { p, why } = scorePair(f, gModel, PRIOR_ODDS, GROUP_CLUES);
  const memberLinks = linkList.filter(([a, b]) => g.includes(a) && g.includes(b)).length;
  return { members: g, names: nameList(g), p: +(100 * p).toFixed(1), why, facts: { ...f, links: memberLinks } };
};
const groupOut = groups.map(fmtGroup).sort((x, y) => y.p - x.p || y.members.length - x.members.length);
// the known / test sets as one group each (all members, linked or not)
const groupTests = {};
for (const [k, set] of [...Object.entries(fam.families || {}), ...Object.entries(fam.test || {})]) {
  const have = set.filter((s) => cache.chars[s]);
  const whole = fmtGroup(have);
  const found = groupOut.filter((g) => g.members.some((m) => set.includes(m))).map((g) => ({ ...g, inSet: g.members.filter((m) => set.includes(m)).length }));
  groupTests[k] = { whole, found };
}
const gHit = (xs) => +(xs.filter((g) => scorePair(g, gModel, PRIOR_ODDS, GROUP_CLUES).p >= 0.5).length / (xs.length || 1)).toFixed(3);

const posS = pos.filter((c) => c.sess && c.sess.shared), negS = neg.filter((c) => c.sess && c.sess.shared);
const hit = (xs) => +(xs.filter((c) => scorePair(c, model, PRIOR_ODDS).p >= 0.5).length / (xs.length || 1)).toFixed(3);
const out = {
  v: 1, at: NOW, prior: PRIOR_ODDS, handoffMin: 10,
  calib: { pos: pos.length, neg: neg.length, posSess: posS.length, negSess: negS.length, posHit: hit(posS), negHit: hit(negS) },
  model,
  candidates: cand.size, worth: worth.length, worthChars: new Set(worth.flatMap((c) => [c.a, c.b])).size,
  cached: Object.keys(cache.chars).length, honuCalls: honuUsed, honuRequests, queueLeft, maxSessLR: Math.round(maxSessLR),
  tests, found: found.slice(0, 60),
  secondPc: fam.secondPc || {},
  groups: {
    link: LINK, links, dropped: dropped.length, gModel, calib: { pos: gPos.length, neg: gNeg.length, posHit: gHit(gPos), negHit: gHit(gNeg) },
    found: groupOut.filter((g) => g.members.length >= 3).slice(0, 40), tests: groupTests,
  },
};
if (!DRY) writeJson(path.join(DATA, "alts.json"), out);
console.log(`alts: ${cand.size} candidate pairs, ${worth.length} worth sessions (${out.worthChars} chars), ${out.cached} cached, ${honuUsed} Honu call(s), ${found.length} pair(s) ≥ 50 %, queue left ${queueLeft}`);
console.log(`calibration: ${pos.length} alt / ${neg.length} different pairs (with sessions ${posS.length} / ${negS.length}); ≥ 50 %: alts ${out.calib.posHit}, different ${out.calib.negHit}`);
console.log(`groups: ${links} link(s), ${groups.length} famil(ies); calibration ${gPos.length} Ahorn sub-groups / ${gNeg.length} random groups, ≥ 50 %: ${out.groups.calib.posHit} / ${out.groups.calib.negHit}`);
if (process.argv.includes("--verbose")) console.log(JSON.stringify(preModel), "\n", JSON.stringify(model));
