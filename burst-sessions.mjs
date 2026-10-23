/**
 * 💥 Burst sessions (build-log review signal, same rule as the oracle's #21 burst tier):
 * a stored session with KPM >= 5 AND kills >= 15 AND >= 2 minutes, no 10-minute floor.
 *
 * Reads only sessions we already store (player assists tuples
 * [assists, kills, seconds, startMs, …] and data/xp/<slug>.json sessions {s, sec, k}),
 * so it costs no Honu calls. It is a REVIEW SIGNAL ONLY: it never changes a player's
 * public stats, never adds * or †, never hides anyone. Human review wins: players in
 * outlier-guard.mjs KNOWN_EXTREMES (owner-reviewed / explained) are listed as cleared.
 */
import { KNOWN_EXTREMES } from "./outlier-guard.mjs";

export const BURST_RULE = Object.freeze({ KPM: 5, KILLS: 15, MIN_SECONDS: 120, MAX_LISTED: 200 });
export const burstRuleText = (r = BURST_RULE) => `KPM ≥ ${r.KPM} and ≥ ${r.KILLS} kills in ≥ ${r.MIN_SECONDS / 60} min (one stored session, no 10-minute floor)`;

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
 * players: [{ slug, name, cid, assists, xp, hidden? }] → { rule, items, … }.
 * items: one row per burst session, still-to-review first, worst KPM first.
 * status: "review" | "cleared" (KNOWN_EXTREMES legit/explained) | "cheater" (KNOWN_EXTREMES
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

export function burstSessions(players, { rule = BURST_RULE, reviewed = KNOWN_EXTREMES } = {}) {
  const items = [];
  for (const p of players || []) {
    for (const [id, s] of Object.entries(storedSessions(p.assists, p.xp))) {
      if (!isBurst(s, rule)) continue;
      const why = reviewed[p.slug] || null;
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
    sessions: items.length, flaggedPlayers: players1((i) => i.status === "review" && !i.hidden), clearedPlayers: players1((i) => i.cleared),
    hiddenPlayers: players1((i) => i.status !== "cleared" && (i.hidden || i.status === "cheater")),
    items: items.slice(0, rule.MAX_LISTED),
  };
}
