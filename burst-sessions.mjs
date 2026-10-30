/**
 * 💥 Burst sessions (build-log review signal, same rule as the oracle's #21 burst tier):
 * a stored session with KPM >= 5 AND kills >= 15 AND >= 2 minutes, no 10-minute floor.
 *
 * Reads only sessions we already store (player assists tuples
 * [assists, kills, seconds, startMs, …] and data/xp/<slug>.json sessions {s, sec, k}),
 * so it costs no Honu calls. It is a REVIEW SIGNAL ONLY: it never changes a player's
 * public stats, never adds * or †, never hides anyone. Human review wins: players in
 * outlier-guard.mjs KNOWN_EXTREMES (owner-reviewed / explained) are listed as cleared.
 * 🛡️ Established players (outlier-guard.mjs CARVE_OUT, owner 2026-10-30) are listed
 * as cleared automatically, so no pro player needs a manual clear when a burst trips.
 */
import { KNOWN_EXTREMES, CARVE_OUT, carveOutReason } from "./outlier-guard.mjs";

export const BURST_RULE = Object.freeze({ KPM: 5, KILLS: 15, MIN_SECONDS: 120, MAX_LISTED: 200 });
/** Own-normal margin (owner t630): an unreviewed burst is skipped from review when the player has
 *  >= MIN_SESSIONS other stored sessions of >= MIN_SECONDS, the burst KPM is <= MAX_RATIO x their own
 *  median KPM over those sessions, and career K/D < MAX_KD (skilled top performers, e.g. A2G). */
export const OWN_NORMAL = Object.freeze({ MIN_SESSIONS: 5, MIN_SECONDS: 600, MAX_RATIO: 2, MAX_KD: 10 });
export const burstRuleText = (r = BURST_RULE) => `KPM ≥ ${r.KPM} and ≥ ${r.KILLS} kills in ≥ ${r.MIN_SECONDS / 60} min (one stored session, no 10-minute floor); skipped when within the player's own normal (≥ ${OWN_NORMAL.MIN_SESSIONS} other sessions of ≥ ${OWN_NORMAL.MIN_SECONDS / 60} min, ≤ ${OWN_NORMAL.MAX_RATIO}× their median KPM, career K/D < ${OWN_NORMAL.MAX_KD}); 🛡️ established players (account ≥ 1 year, eKPM ≥ ${CARVE_OUT.MIN_EKPM}, ≥ ${CARVE_OUT.MIN_SESSIONS} stored sessions) show as cleared automatically`;

/** Stored sessions of one player → { id: { kills, seconds, startMs } } (assists tuples + XP detail). */
export function storedSessions(assists, xp) {
  const out = {};
  const put = (id, kills, seconds, startMs) => {
    if (!id || !Number.isFinite(kills) || !Number.isFinite(seconds)) return;
    const prev = out[id];
    if (!prev || kills > prev.kills) out[id] = { kills, seconds, startMs: Number.isFinite(startMs) ? startMs : (prev && prev.startMs) || null };
  };
  for (const [id, t] of Object.entries((assists && assists.sessions) || {})) if (Array.isArray(t)) put(String(id), +t[1], +t[2], +t[3]);
  for (const [id, s] of Object.entries((xp && xp.sessions) || {})) if (s) put(String(id), +s.k, +s.sec, +s.s);
  return out;
}

export function isBurst(s, r = BURST_RULE) {
  return !!s && s.seconds >= r.MIN_SECONDS && s.kills >= r.KILLS && s.kills / (s.seconds / 60) >= r.KPM;
}

/**
 * players: [{ slug, name, cid, assists, xp, hidden?, established? }] → { rule, items, … }.
 * items: one row per burst session, still-to-review first, worst KPM first.
 * status: "review" | "cleared" (KNOWN_EXTREMES legit/explained, or 🛡️ established) | "cheater" (KNOWN_EXTREMES
 * says confirmed cheater) ; `hidden` = already on the 🙈 hide list.
 */
/**
 * Owner burst decisions from data/reviewed.json ("burst": "cleared" | "excluded", note, at)
 * → slug → reason text in the KNOWN_EXTREMES style ("Confirmed cheater …" = status cheater).
 */
export function burstReviewed(reviewedJson) {
  const out = {};
  for (const [slug, e] of Object.entries((reviewedJson && reviewedJson.players) || {})) {
    if (!e || (e.burst !== "cleared" && e.burst !== "excluded" && e.burst !== "cheater")) continue; // "cheater" = pre-#61 spelling
    const when = e.at ? " " + e.at : "";
    out[slug] = (e.burst !== "cleared" ? "Excluded after review" + when + " (burst review)" : "Owner cleared" + when + " (burst review)") + (e.note ? ": " + e.note : "");
  }
  return out;
}

/** True when burst session `id` is within the player's own normal (see OWN_NORMAL). */
export function withinOwnNormal(sessions, id, kd, o = OWN_NORMAL) {
  const s = sessions[id];
  if (!s || !(Number.isFinite(+kd) && +kd < o.MAX_KD)) return false;
  const k = Object.entries(sessions).filter(([i, x]) => i !== id && x.seconds >= o.MIN_SECONDS).map(([, x]) => x.kills / (x.seconds / 60)).sort((a, b) => a - b);
  if (k.length < o.MIN_SESSIONS) return false;
  const med = k.length % 2 ? k[k.length >> 1] : (k[k.length / 2 - 1] + k[k.length / 2]) / 2;
  return med > 0 && s.kills / (s.seconds / 60) <= o.MAX_RATIO * med;
}

export function burstSessions(players, { rule = BURST_RULE, reviewed = KNOWN_EXTREMES, ownNormal = OWN_NORMAL } = {}) {
  const items = [];
  let ownNormalSkipped = 0;
  for (const p of players || []) {
    const all = storedSessions(p.assists, p.xp);
    for (const [id, s] of Object.entries(all)) {
      if (!isBurst(s, rule)) continue;
      const why = reviewed[p.slug] || (p.established ? carveOutReason() : null);
      if (!why && ownNormal && withinOwnNormal(all, id, p.kd, ownNormal)) { ownNormalSkipped++; continue; } // human review wins; 🛡️ established shows as cleared, never skipped silently
      const status = !why ? "review" : /^\s*(confirmed cheater|excluded after review)/i.test(why) ? "cheater" : "cleared"; // "not a cheater" / "rampage cheaters" in a note = cleared
      items.push({
        slug: p.slug, name: p.name || p.slug, cid: p.cid ? String(p.cid) : "", session: id,
        kills: s.kills, minutes: Math.round(s.seconds / 6) / 10, kpm: Math.round((s.kills / (s.seconds / 60)) * 100) / 100,
        startMs: s.startMs || null, status, cleared: status === "cleared", hidden: !!p.hidden, reason: why,
      });
    }
  }
  const ord = (i) => (i.status === "review" ? (i.hidden ? 1 : 0) : i.status === "cheater" ? 2 : 3);
  items.sort((a, b) => ord(a) - ord(b) || b.kpm - a.kpm);
  const players1 = (pred) => new Set(items.filter(pred).map((i) => i.slug)).size;
  return {
    rule: burstRuleText(rule), checkedAt: new Date().toISOString(),
    sessions: items.length, ownNormalSkipped, flaggedPlayers: players1((i) => i.status === "review" && !i.hidden), clearedPlayers: players1((i) => i.cleared),
    hiddenPlayers: players1((i) => i.status !== "cleared" && (i.hidden || i.status === "cheater")),
    items: items.slice(0, rule.MAX_LISTED),
  };
}
