/**
 * One player's build-log row (🚩 red flags, 🌱 sprouts, 🤖 farm accounts, 🌾 / † lists).
 * Shared by scripts/build-flags.mjs (precomputes data/flags.json in the refresh
 * workflow) and build-log.html, so both use the exact same rules.
 */
import { normalizePlayer, playerMetrics } from "./player-metrics.mjs?v=20261022-ps1";
import { reviewFlags } from "./red-flags.mjs?v=20261010-sav1";
import { sprout, sampleEvents, farmAccount } from "./sprouts.mjs?v=20261010-sav1";
import { isNotFarm, farmListEntry } from "./padding.mjs?v=20261020-i18n2";

/** Small, JSON-safe summary of one player (what the tables + rules need). */
export function summarize(entry, raw) {
  const np = normalizePlayer(raw);
  const m = playerMetrics(np);
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const f = reviewFlags(m);
  const sp = sprout(m.raw || m, sampleEvents(np.rawRows || np.rows));
  const listed = farmListEntry({ name: np.display, cid: np.cid });
  const fa = (sp.sprout || listed) && !isNotFarm({ name: np.display, cid: np.cid }) ? farmAccount(np.rawRows || np.rows, m.ownKpm) : null;
  const farmAcct = fa && (fa.farm || listed) ? { share: fa.share, deaths: fa.deaths, feeders: fa.feeders.slice(0, 3), confirmed: !!listed } : null;
  const pad = m.farm && m.farm.victims && m.farm.victims.length ? m.farm : null;
  return {
    name: entry.name, slug: entry.slug || "", cid: String(m.p.cid || ""), savedAt: entry.savedAt || 0,
    adj: num((m.raw || m).adj), ivi: num(m.ivi), pvs: num((m.raw || m).pvs), inflation: num((m.raw || m).inflation),
    kd: num(m.kd), acc: num(m.acc), hsr: num(m.hsr),
    flagged: f.flagged, red: !!f.red, patterns: f.patterns, tier: f.skill.tier, basis: f.skill.basis,
    adjs: num((m.raw || m).adjs), kpm: num(m.ownKpm) ?? num(m.kpm), events: sp.events, sprout: sp.sprout && !farmAcct, farmAcct,
    padding: pad ? { share: pad.share, kills: pad.kills, victims: pad.victims.map((v) => ({ name: v.name, kills: v.kills, deaths: v.deaths })) } : null,
  };
}

/** Rows build-log can ever show: any pattern / flag / 🤖 (🌱 is a count only, t368u), or a slug a later overlay (session, forensics, review) may tag. */
export function keepRow(r, extraSlugs) {
  return !!r && !!(r.red || r.flagged || (r.patterns || []).length > 0 || !!r.farmAcct || (extraSlugs && extraSlugs.has(r.slug)));
}
