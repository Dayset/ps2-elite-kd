/**
 * ⛑️ Heavy support runner (heavy-support.mjs, owner t760). Keeps data/heavysupport.json:
 *   node scripts/heavy-support.mjs            → re-score from data/xp + refresh marks / iVi (no network)
 *   node scripts/heavy-support.mjs --check N  → also pair-check up to N supporters on Honu
 *                                               (unchecked top-10% first, then checks older than 30 days)
 * Honu cost per supporter: 1 session list + ≤ 4 support-day XP lists + ≤ 3 partner session lists
 * (≤ 8 calls), one call every 6.5 s, counted in data/honu-usage.json (usage.heavysupport), stopped at
 * the daily cap and at HS_RULE.DAY_CAP ⛑️ calls a day. refresh-cache.yml runs --check 5 (≤ 40 calls).
 * Removal-list (opt-out.json) characters are never checked or shown. The file is only rewritten when
 * something besides the timestamp changed (no empty Pages builds).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HS_RULE, SUPPORT_EXP, supportRecipients, supportFeatures, scoreHeavySupport, percentile, supportWindows, buildCheck, familyIndex, slugOf, heavySupportRows, heavySupportCounts } from "../heavy-support.mjs";
import { hiddenList, isConfirmedCheater } from "../hidden.mjs";
import { removedList } from "../opt-out.mjs";

const USER_AGENT = "ps2-elite-kd-cache-bot/2.0 (+https://github.com/Dayset/ps2-elite-kd; contact: github.com/Dayset)";
const HONU = "https://wt.honu.pw/api/";
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };

/** Mark for a character: "OOR" (hide list exclusion), "padder" (reviewed / ranks padding) or null. */
export function markOf({ slug, cid }, { hidden, reviewed, ranksBySlug }) {
  if (isConfirmedCheater(hidden.match({ slug, cid }))) return "OOR";
  const d = reviewed && reviewed.players && reviewed.players[slug];
  if ((d && d.decision === "padding") || (ranksBySlug.get(slug) || {}).mark === "padding") return "padder";
  return null;
}

/** Re-score + refresh everything derived (pure apart from the inputs). */
export function rebuild(store, { xpFiles, ranks, hiddenJson, reviewed, optOut, altFamilies, alts }) {
  const hidden = hiddenList(hiddenJson);
  const removed = removedList(optOut);
  const cols = (ranks && ranks.cols) || [];
  const ranksBySlug = new Map(((ranks && ranks.rows) || []).map((r) => { const o = {}; cols.forEach((c, i) => { o[c] = r[i]; }); return [o.slug, o]; }));
  const ctx = { hidden, reviewed, ranksBySlug };
  const feats = [];
  for (const xp of xpFiles) {
    const slug = xp.slug;
    if (!slug || removed.match({ cid: xp.cid, slug })) continue;
    const f = supportFeatures(xp);
    if (f) feats.push({ slug, cid: xp.cid ? String(xp.cid) : null, ...f });
  }
  const sc = scoreHeavySupport(feats);
  const nTop = Math.floor(sc.n * HS_RULE.TOP_SHARE);
  const r1 = (x, d = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
  store.top = sc.rows.slice(0, nTop).map((f) => {
    const R = ranksBySlug.get(f.slug) || {};
    return { slug: f.slug, cid: f.cid, name: R.name || f.slug, rank: f.rank, hs: r1(f.hs), spm: r1(f.spm, 2), sxs: r1(f.sxs, 3), dpm: r1(f.dpm, 3),
      kd: r1(R.kd, 2), ivi: r1(R.ivi, 0), inf: R.inf ?? null, mark: markOf(f, ctx) };
  });
  const strongIvi = percentile([...ranksBySlug.values()].map((r) => r.ivi), HS_RULE.STRONG_PCT);
  // refresh partner iVi / K/D / marks, drop removed characters
  const checks = store.checks || {};
  for (const [slug, c] of Object.entries(checks)) {
    if (removed.match({ cid: c.cid, slug })) { delete checks[slug]; continue; }
    c.mark = markOf({ slug, cid: c.cid }, ctx);
    c.parts = (c.parts || []).filter((p) => !removed.match({ cid: p.cid, slug: p.slug, name: p.name }));
    for (const p of c.parts) {
      const R = ranksBySlug.get(p.slug) || {};
      p.ivi = r1(R.ivi, 0); p.kd = r1(R.kd, 2); p.mark = markOf(p, ctx);
    }
  }
  store.checks = checks;
  const idx = familyIndex({ altFamilies, alts, extra: store.families });
  const used = new Set();
  for (const [slug, c] of Object.entries(checks)) { used.add(slug); for (const p of c.parts || []) used.add(p.slug); }
  store.familyOf = Object.fromEntries([...used].filter((s) => idx[s]).map((s) => [s, idx[s]]).sort());
  store.stats = { scored: sc.n, top10: nTop, cut10: r1(sc.cut10), cut20: r1(sc.cut20), top20: Math.floor(sc.n * 0.2), strongIvi: r1(strongIvi, 0),
    checked: Object.keys(checks).length };
  const rows = heavySupportRows(store);
  store.stats.rows = rows.length;
  store.stats.labels = heavySupportCounts(rows);
  return store;
}

/** Who to check next: unchecked top-10% (passing K/D + infantry) first, then the oldest checks. */
export function nextCandidates(store, n, today = new Date()) {
  const old = new Date(today.getTime() - HS_RULE.RECHECK_DAYS * 86400000).toISOString().slice(0, 10);
  const ok = (store.top || []).filter((t) => t.cid && (t.kd ?? 0) >= HS_RULE.CHECK_MIN_KD && (t.inf ?? 0) >= HS_RULE.CHECK_MIN_INF);
  const fresh = ok.filter((t) => !(store.checks || {})[t.slug]);
  const stale = ok.filter((t) => (store.checks || {})[t.slug] && String(store.checks[t.slug].at) < old).sort((a, b) => String(store.checks[a.slug].at).localeCompare(String(store.checks[b.slug].at)));
  return [...fresh, ...stale].slice(0, n);
}

const stable = (s) => JSON.stringify({ ...s, v: undefined, at: undefined, lastRun: undefined });

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dataDir = path.join(root, "data");
  const hsPath = path.join(dataDir, "heavysupport.json");
  const store = readJson(hsPath, {}) || {};
  const before = stable(store);
  const xpDir = path.join(dataDir, "xp");
  const xpFiles = fs.existsSync(xpDir) ? fs.readdirSync(xpDir).filter((f) => f.endsWith(".json")).map((f) => {
    const d = readJson(path.join(xpDir, f));
    if (d) d.slug = d.slug || f.slice(0, -5);
    return d;
  }).filter(Boolean) : [];
  const inputs = {
    xpFiles, ranks: readJson(path.join(dataDir, "ranks.json"), {}), hiddenJson: readJson(path.join(dataDir, "hidden.json"), {}),
    reviewed: readJson(path.join(dataDir, "reviewed.json"), {}), optOut: readJson(path.join(dataDir, "opt-out.json"), {}),
    altFamilies: readJson(path.join(dataDir, "alt-families.json"), {}), alts: readJson(path.join(dataDir, "alts.json"), {}),
  };
  rebuild(store, inputs);
  const i = process.argv.indexOf("--check");
  const want = i > 0 ? Math.max(0, Math.min(20, Number(process.argv[i + 1]) || 0)) : 0;
  let calls = 0;
  const checked = [];
  if (want) {
    const usagePath = path.join(dataDir, "honu-usage.json");
    const day = new Date().toISOString().slice(0, 10);
    let usage = readJson(usagePath, null);
    if (!usage || usage.day !== day) usage = { ...(usage || {}), day, calls: 0, forensics: 0, heavysupport: 0 };
    const cap = Number(process.env.HONU_DAILY_CAP) > 0 ? Number(process.env.HONU_DAILY_CAP) : usage.cap || 10000;
    const budgetMs = (Number(process.env.HS_BUDGET_SEC) || 300) * 1000;
    const t0 = Date.now();
    const get = async (u) => {
      if (usage.calls >= cap) throw new Error("Honu daily cap reached");
      if ((usage.heavysupport || 0) >= HS_RULE.DAY_CAP) throw new Error("⛑️ daily cap reached");
      if (calls) await new Promise((r) => setTimeout(r, 6500));
      calls++; usage.calls++; usage.heavysupport = (usage.heavysupport || 0) + 1;
      const res = await fetch(HONU + u, { headers: { Accept: "application/json", "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    };
    const sinceMs = Date.now() - HS_RULE.SINCE_DAYS * 86400000;
    const q = SUPPORT_EXP.map((x) => "&interestedEvents=" + x).join("");
    for (const c of nextCandidates(store, want)) {
      if (Date.now() - t0 > budgetMs) break;
      try {
        const sessions = (await get(`character/${c.cid}/sessions`)) || [];
        const blocks = [];
        for (const w of supportWindows(sessions, { sinceMs })) {
          const j = await get(`exp/${c.cid}/period2?start=${w.start}&end=${w.end}&includeCharacters=true&includeExpTypes=false${q}`);
          if (j) blocks.push({ events: j.events || [], characters: j.characters || [] });
        }
        const { picks } = supportRecipients(c.cid, blocks);
        const partnerSessions = {};
        for (const o of picks) partnerSessions[o] = (await get(`character/${o}/sessions`)) || [];
        store.checks = store.checks || {};
        store.checks[c.slug] = buildCheck({ cid: c.cid, name: c.name, sessions, blocks, partnerSessions, sinceMs });
        checked.push(c.name);
      } catch (e) { console.warn(`heavy support: ${c.name}: ${e.message || e}`); if (/cap/.test(String(e.message))) break; }
    }
    if (calls) fs.writeFileSync(usagePath, JSON.stringify(usage) + "\n");
    if (checked.length) rebuild(store, inputs);
  }
  store.lastRun = { at: new Date().toISOString(), calls, checked };
  if (stable(store) === before && !checked.length) { console.log(`heavy support: no change (${calls} Honu call(s))`); return; }
  store.v = 1;
  store.at = new Date().toISOString();
  fs.writeFileSync(hsPath, JSON.stringify(store, null, 1) + "\n");
  const s = store.stats;
  console.log(`heavy support: ${s.scored} scored, top 10% ${s.top10} (≥ ${s.cut10}), ${s.checked} checked, rows ${s.rows} ${JSON.stringify(s.labels)}, ${calls} Honu call(s), checked: ${checked.join(", ") || "none"}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
