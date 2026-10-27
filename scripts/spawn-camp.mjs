/**
 * ⛺ Spawn camp check runner (spawn-camp.mjs). Keeps data/spawncamp.json:
 *   node scripts/spawn-camp.mjs              → re-measure the bar from the stored sample (no network)
 *   node scripts/spawn-camp.mjs --sample N   → add N random PC sessions with 60+ kills to the sample
 *                                              (worlds 1 + 10, last 12 h), then re-measure.
 * Honu cost of --sample N: 2 history calls + 2 calls per session (kill list + XP list), one call every
 * 6.5 s, counted in data/honu-usage.json and stopped at its daily cap. The weekly workflow
 * (.github/workflows/spawn-camp.yml) runs --sample 20 = 42 calls a week.
 * Ongoing candidates also come from 🔎 session forensics (scripts/refresh-cache.mjs): 1 extra XP call
 * for a forensics session with 60+ kills, never re-checked. Those are judged against the bar, they don't move it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SPAWNCAMP_RULE, analyzeSpawnCamp, measureSpawnCampBar, spawnCampRuleText } from "../spawn-camp.mjs";

const USER_AGENT = "ps2-elite-kd-cache-bot/2.0 (+https://github.com/Dayset/ps2-elite-kd; contact: github.com/Dayset)";
const HONU = "https://wt.honu.pw/api/";
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };

/** Re-measure stats + rule text in place. */
export function remeasure(store, reviewed) {
  store.sessions = store.sessions || {};
  store.stats = { ...measureSpawnCampBar(store.sessions, reviewed), measuredAt: new Date().toISOString() };
  store.rule = spawnCampRuleText(store.stats);
  return store;
}

/** Add one analyzed session to the store (pure). Returns the row or null. */
export function addSpawnCampSession(store, { session, cid, name, world, killRows, expEvents, sample = false, at }) {
  const a = analyzeSpawnCamp(killRows, expEvents, cid);
  if (!a) return null;
  const row = { session: String(session), name, slug: String(name || "").replace(/^\[[^\]]*\]\s*/, "").toLowerCase().replace(/[^a-z0-9]+/g, ""),
    cid: String(cid), world: world ?? ((killRows || []).map((x) => x && x.event && x.event.worldID).find((w) => w != null) ?? null), ...a, crowd: "unknown", sample: !!sample, at: at || new Date().toISOString().slice(0, 10) };
  store.sessions = store.sessions || {};
  store.sessions[row.session] = row;
  return row;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dataDir = path.join(root, "data");
  const scPath = path.join(dataDir, "spawncamp.json");
  const store = readJson(scPath, {}) || {};
  const reviewed = readJson(path.join(dataDir, "reviewed.json"), {});
  const i = process.argv.indexOf("--sample");
  const want = i > 0 ? Math.max(0, Math.min(50, Number(process.argv[i + 1]) || 0)) : 0;
  let calls = 0;
  if (want) {
    const usagePath = path.join(dataDir, "honu-usage.json");
    const day = new Date().toISOString().slice(0, 10);
    let usage = readJson(usagePath, null);
    if (!usage || usage.day !== day) usage = { ...(usage || {}), day, calls: 0, forensics: 0 };
    const cap = Number(process.env.HONU_DAILY_CAP) > 0 ? Number(process.env.HONU_DAILY_CAP) : usage.cap || 10000;
    const get = async (u) => {
      if (usage.calls >= cap) throw new Error("Honu daily cap reached");
      if (calls) await new Promise((r) => setTimeout(r, 6500));
      calls++; usage.calls++; usage.spawncamp = (usage.spawncamp || 0) + 1;
      const res = await fetch(HONU + u, { headers: { Accept: "application/json", "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    };
    const pool = [];
    const t = Math.floor(Date.now() / 1000) - 12 * 3600;
    for (const w of [1, 10]) {
      try {
        for (const x of (await get(`session/history/${t}?worldID=${w}`)) || []) {
          const s = x && x.session;
          if (s && s.end && s.kills >= SPAWNCAMP_RULE.MIN_KILLS && !store.sessions?.[String(s.id)])
            pool.push({ session: String(s.id), cid: String(s.characterID), name: (x.character && x.character.name) || s.characterID, world: (x.character && x.character.worldID) ?? w });
        }
      } catch (e) { console.warn(`spawn camp: history world ${w}: ${e.message || e}`); }
    }
    for (let k = pool.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [pool[k], pool[j]] = [pool[j], pool[k]]; }
    let added = 0;
    for (const c of pool.slice(0, want)) {
      try {
        const killRows = await get(`kills/session/${c.session}`);
        const exp = await get(`exp/sessions/${c.session}`);
        if (addSpawnCampSession(store, { ...c, killRows, expEvents: (exp && exp.events) || [], sample: true })) added++;
      } catch (e) { console.warn(`spawn camp: session ${c.session}: ${e.message || e}`); if (/cap/.test(String(e.message))) break; }
    }
    fs.writeFileSync(usagePath, JSON.stringify(usage) + "\n");
    console.log(`spawn camp: ${pool.length} new 60+ kill session(s) seen, ${added} added to the sample, ${calls} Honu call(s)`);
  }
  remeasure(store, reviewed);
  fs.writeFileSync(scPath, JSON.stringify(store, null, 1) + "\n");
  const s = store.stats;
  console.log(`spawn camp: sample ${s.n}, median ${s.median}%, bar ${s.bar}% (top 10%), top 5% ${s.p95}%, top 1% ${s.p99}%, max ${s.max}%`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
