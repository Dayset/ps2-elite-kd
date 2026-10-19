/**
 * 🚨 Rampage gate runner (rampage-gate.mjs): checks every stored 💥 burst session with
 * ≥ RAMPAGE_RULE.MIN_KILLS kills once against Honu's kill list (GET /api/kills/session/{id}),
 * keeps the summaries in data/rampage.json, and keeps data/hidden.json in sync:
 *   - a match (not cleared by the owner) is added as "confirmed cheater — auto: rampage gate (…evidence…)";
 *   - an auto entry whose player the owner cleared (reviewed.json "burst": "cleared") is removed (un-hide).
 * Manual hidden.json entries are never touched. Run by the refresh workflow before build-ranks.
 * Honu politeness: one request every 6.5 s, ≤ RAMPAGE_MAX_CALLS (default 20) per run, counted in
 * data/honu-usage.json and stopped at its daily cap. A session is re-checked only if its stored kill
 * count grew (session was still running). No network with --offline (sync hidden.json only).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { storedSessions, isBurst } from "../burst-sessions.mjs";
import { hiddenList } from "../hidden.mjs";
import { bareName } from "../rank-row.mjs";
import { RAMPAGE_RULE, RAMPAGE_REASON_PREFIX, summarizeSessionKills, isRampage, rampageEvidence, rampageCleared, rampageRuleText } from "../rampage-gate.mjs";

const USER_AGENT = "ps2-elite-kd-cache-bot/2.0 (+https://github.com/Dayset/ps2-elite-kd; contact: github.com/Dayset)";
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const asciiJson = (j) => JSON.stringify(j, null, 2).replace(/[^\x00-\x7F]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")) + "\n";

/** Stored burst sessions with enough kills to be judged: [{ session, slug, name, cid, kills, minutes, kpm, startMs }]. */
export function gateCandidates(dataDir, rule = RAMPAGE_RULE) {
  const index = readJson(path.join(dataDir, "index.json"), { players: [] });
  const out = [];
  const seen = new Set();
  for (const e of index.players || []) {
    if (!e || !e.file || seen.has(e.file)) continue;
    seen.add(e.file);
    const raw = readJson(path.join(dataDir, e.file));
    if (!raw) continue;
    const pl = raw.player || raw;
    const slug = e.slug || path.basename(e.file, ".json");
    const xp = readJson(path.join(dataDir, "xp", `${slug}.json`));
    for (const [id, s] of Object.entries(storedSessions(pl.assists, xp))) {
      if (!isBurst(s) || s.kills < rule.MIN_KILLS || !pl.cid) continue;
      out.push({ session: id, slug, name: pl.display || e.name || slug, cid: String(pl.cid), kills: s.kills,
        minutes: Math.round(s.seconds / 6) / 10, kpm: Math.round((s.kills / (s.seconds / 60)) * 100) / 100, startMs: s.startMs || null });
    }
  }
  return out;
}

/**
 * Pure: sync hidden.json players with the gate results. Returns { players, added, removed }.
 * sessions: rampage.json sessions; reviewed: reviewed.json; today: "YYYY-MM-DD".
 */
export function applyRampage(hiddenJson, sessions, reviewed, today) {
  const players = { ...((hiddenJson && hiddenJson.players) || {}) };
  const added = [], removed = [];
  const bySlug = new Map();
  for (const s of Object.values(sessions || {})) if (s && s.match && !bySlug.has(s.slug)) bySlug.set(s.slug, s);
  // Un-hide: auto entries of players the owner cleared.
  for (const [k, v] of Object.entries(players)) {
    if (!v || !String(v.reason || "").startsWith(RAMPAGE_REASON_PREFIX)) continue;
    const slug = String(v.slug || k).toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (rampageCleared(reviewed, slug) || rampageCleared(reviewed, k)) { delete players[k]; removed.push(k); }
  }
  const hidden = hiddenList({ players });
  for (const [slug, s] of bySlug) {
    if (rampageCleared(reviewed, slug)) continue;
    if (hidden.match({ slug, name: s.name, cid: s.cid })) continue; // already hidden (owner or earlier run)
    const key = bareName(s.name) || slug;
    if (players[key]) continue;
    players[key] = { reason: `${RAMPAGE_REASON_PREFIX} (${rampageEvidence(s)})`, at: today };
    added.push(key);
  }
  return { players, added, removed };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dataDir = path.join(root, "data");
  const offline = process.argv.includes("--offline");
  const maxCalls = Number(process.env.RAMPAGE_MAX_CALLS) > 0 ? Number(process.env.RAMPAGE_MAX_CALLS) : 20;
  const rpPath = path.join(dataDir, "rampage.json");
  const rp = readJson(rpPath, {}) || {};
  rp.sessions = rp.sessions || {};
  const usagePath = path.join(dataDir, "honu-usage.json");
  const day = new Date().toISOString().slice(0, 10);
  let usage = readJson(usagePath, null);
  if (!usage || usage.day !== day) usage = { ...(usage || {}), day, calls: 0, forensics: 0 };
  const cap = Number(process.env.HONU_DAILY_CAP) > 0 ? Number(process.env.HONU_DAILY_CAP) : usage.cap || 10000;
  const cands = gateCandidates(dataDir);
  const todo = cands.filter((c) => { const o = rp.sessions[c.session]; return !o || o.error || (o.storedKills || 0) < c.kills; });
  let calls = 0;
  for (const c of todo) {
    if (offline || calls >= maxCalls || usage.calls >= cap) break;
    if (calls) await new Promise((r) => setTimeout(r, 6500));
    calls++; usage.calls++; usage.rampage = (usage.rampage || 0) + 1;
    try {
      const res = await fetch(`https://wt.honu.pw/api/kills/session/${encodeURIComponent(c.session)}`, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const sum = summarizeSessionKills(await res.json(), c.cid);
      const s = { ...c, storedKills: c.kills, ...sum, kills: sum.kills, at: day };
      s.match = isRampage(s);
      rp.sessions[c.session] = s;
      console.log(`rampage gate: ${c.name} session ${c.session}: ${sum.inf} inf kills, HS ${sum.inf ? Math.round((100 * sum.hs) / sum.inf) : 0}%, hip ${sum.inf ? Math.round((100 * sum.hip) / sum.inf) : 0}%${s.match ? " → MATCH" : ""}`);
    } catch (err) {
      rp.sessions[c.session] = { ...c, storedKills: 0, error: String(err.message || err), at: day };
      console.warn(`rampage gate: ${c.name} session ${c.session}: ${err.message || err}`);
    }
  }
  rp.rule = rampageRuleText();
  rp.checkedAt = new Date().toISOString();
  rp.pending = cands.filter((c) => { const o = rp.sessions[c.session]; return !o || o.error || (o.storedKills || 0) < c.kills; }).length;
  fs.writeFileSync(rpPath, JSON.stringify(rp, null, 1) + "\n");
  if (calls) fs.writeFileSync(usagePath, JSON.stringify(usage) + "\n");
  const hiddenPath = path.join(dataDir, "hidden.json");
  const hiddenJson = readJson(hiddenPath, { players: {} });
  const { players, added, removed } = applyRampage(hiddenJson, rp.sessions, readJson(path.join(dataDir, "reviewed.json")), day);
  if (added.length || removed.length) {
    fs.writeFileSync(hiddenPath, asciiJson({ ...hiddenJson, players }));
    console.log(`rampage gate: hidden +${added.length} (${added.join(", ")}) −${removed.length} (${removed.join(", ")})`);
  }
  console.log(`rampage gate: ${cands.length} candidate session(s), ${calls} checked now, ${rp.pending} pending`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
