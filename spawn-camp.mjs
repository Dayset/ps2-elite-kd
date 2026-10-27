/**
 * ⛺ Spawn camp check (owner t704–t713, 2026-10-26): a PRIVATE review hint on the hidden
 * build-log only. Never shown on the main site, Analyze or Rankings, never hides or flags anyone.
 *
 * Spawn kill = a kill with no matching base kill XP (Kill Player, MAX, Priority, gunner
 * "Player Kill by …", infantry Kill Share) for that victim within WINDOW_S seconds. The game sends
 * no XP for killing a player who just spawned, so the missing XP is the signature (research 2026-10-26:
 * those victims had died a median ~21 s earlier vs ~64 s for normal kills).
 *
 * A session gets ⛺ when, on PC:
 *   - it has ≥ MIN_KILLS kills,
 *   - its spawn-kill share is ≥ the measured bar (top 10% of the random PC sample, re-measured
 *     every time the sample grows; stored in data/spawncamp.json "stats", never hand-set),
 *   - the player is not a confirmed stat padder (data/reviewed.json decision "padding"),
 *   - its spawn kills are spread out: the top 2 victims take < TOP2_MAX of them (with ≥ TOP2_MIN_SK
 *     spawn kills). Kills piled on 1–2 victims are bot padding, not spawn camping.
 * Crowd status ("crowd" = 3+ teammates also spawn-killing on the same continent within ±2 min) is
 * only known from live recordings; Honu sessions alone show "unknown".
 *
 * Sources: Honu GET /api/kills/session/{id} + GET /api/exp/sessions/{id}. DOM-free.
 */
export const SPAWNCAMP_RULE = Object.freeze({ MIN_KILLS: 60, PICK: 0.9, WINDOW_S: 2, TOP2_MAX: 0.5, TOP2_MIN_SK: 5, MIN_SAMPLE: 30 });

/** Census experience ids that pay for a normal player kill (1 Kill Player, 29 MAX, 278/279 Priority,
 *  gunner "Player Kill by …", infantry Kill Share; 277 "Spawn Kill" is listed but the game never sends it). */
export const BASE_KILL_XP = Object.freeze(new Set([1, 29, 146, 148, 149, 150, 154, 155, 277, 278, 279, 314, 373, 405, 515, 681, 816, 817, 818, 819, 820, 836, 837, 838, 839, 840, 841, 861, 1003, 1023, 1037, 1057, 1089, 1109, 1167, 1187, 1351, 1365, 1466, 1510, 1572, 1597, 1616, 1704, 2074, 2075, 2076]));

const ts = (s) => (typeof s === "number" ? (s > 1e12 ? s / 1000 : s) : Date.parse(s) / 1000);

/**
 * Honu kill rows + exp events → { kills, sk, skVictims, top2 } for character cid, or null when the
 * session has no XP data (can't tell spawn kills apart then).
 */
export function analyzeSpawnCamp(killRows, expEvents, cid, rule = SPAWNCAMP_RULE) {
  const me = String(cid);
  const kills = [];
  for (const x of killRows || []) {
    const e = x && (x.event || x);
    if (!e || String(e.attackerCharacterID) !== me || String(e.killedCharacterID) === me) continue;
    if (e.attackerTeamID != null && e.attackerTeamID === e.killedTeamID) continue;
    kills.push(e);
  }
  if (!kills.length) return null;
  const base = new Map();
  let anyBase = false;
  for (const x of expEvents || []) {
    if (!x || String(x.sourceID) !== me || !BASE_KILL_XP.has(Number(x.experienceID))) continue;
    const k = String(x.otherID);
    if (!base.has(k)) base.set(k, []);
    base.get(k).push(ts(x.timestamp));
    anyBase = true;
  }
  if (!anyBase) return null;
  const vict = new Map();
  let sk = 0;
  for (const e of kills) {
    const t = ts(e.timestamp);
    const v = String(e.killedCharacterID);
    if ((base.get(v) || []).some((u) => Math.abs(u - t) <= rule.WINDOW_S)) continue;
    sk++;
    vict.set(v, (vict.get(v) || 0) + 1);
  }
  const top = [...vict.values()].sort((a, b) => b - a);
  return { kills: kills.length, sk, skVictims: vict.size, top2: sk ? Math.round(((top[0] || 0) + (top[1] || 0)) / sk * 1000) / 1000 : 0 };
}

const slugOf = (name) => String(name || "").replace(/^\[[^\]]*\]\s*/, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Why a session is left out of the bar and the ⛺ list, or null. */
export function spawnCampExcluded(s, reviewed, rule = SPAWNCAMP_RULE) {
  if (!s || !(s.kills >= rule.MIN_KILLS)) return "under " + rule.MIN_KILLS + " kills";
  const p = reviewed && reviewed.players && reviewed.players[s.slug || slugOf(s.name)];
  if (p && (p.decision === "padding" || p.padding)) return "confirmed stat padder";
  if (s.sk >= rule.TOP2_MIN_SK && s.top2 >= rule.TOP2_MAX) return "spawn kills on 1–2 victims (padding pattern)";
  return null;
}

/** Same quantile as the 2026-10-26 research: sorted[floor(p·n)]. */
const q = (s, p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
const r1 = (v) => Math.round(v * 1000) / 10;

/** Measure median / top 10 / 5 / 1% / max (in %) from the random-sample sessions. */
export function measureSpawnCampBar(sessions, reviewed, rule = SPAWNCAMP_RULE) {
  const s = Object.values(sessions || {}).filter((x) => x && x.sample && !spawnCampExcluded(x, reviewed, rule))
    .map((x) => x.sk / x.kills).sort((a, b) => a - b);
  if (!s.length) return { n: 0 };
  const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return { n: s.length, median: r1(med), bar: r1(q(s, rule.PICK)), p95: r1(q(s, 0.95)), p99: r1(q(s, 0.99)), max: r1(s[s.length - 1]), enough: s.length >= rule.MIN_SAMPLE };
}

/** Rows for the build-log ⛺ tab: every kept session at or above the bar, highest share first. */
export function spawnCampRows(store, reviewed, rule = SPAWNCAMP_RULE) {
  const st = (store && store.stats) || measureSpawnCampBar(store && store.sessions, reviewed, rule);
  if (!st || st.bar == null) return [];
  return Object.values((store && store.sessions) || {})
    .filter((x) => x && !spawnCampExcluded(x, reviewed, rule) && r1(x.sk / x.kills) >= st.bar)
    .map((x) => ({ ...x, pct: r1(x.sk / x.kills), crowd: x.crowd || "unknown" }))
    .sort((a, b) => b.pct - a.pct || b.sk - a.sk);
}

export const spawnCampRuleText = (st, rule = SPAWNCAMP_RULE) =>
  `PC sessions with ≥ ${rule.MIN_KILLS} kills whose spawn-kill share (kills with no matching kill XP within ${rule.WINDOW_S} s) is at or above the top-10% bar of a random PC sample` +
  (st && st.bar != null ? ` (now ${st.bar}%, median ${st.median}%, ${st.n} sessions)` : "") +
  `. Left out: confirmed stat padders, and sessions where the top 2 victims take ${Math.round(rule.TOP2_MAX * 100)}%+ of ${rule.TOP2_MIN_SK}+ spawn kills (padding pattern).`;
