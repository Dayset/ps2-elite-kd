/**
 * 🎲 Just-for-fun account flairs shown next to player names (main page legend
 * + stats table, ranks.html). Not a skill rating. One list of rules
 * (FLAIR_RULES) so more flairs can be added later: each rule gets the
 * player's account times and returns a tooltip string (shown) or null.
 *
 * Data: Census `character.times` (creation, last_save, last_login), which the
 * existing character lookup already returns (no extra call). Stored compactly
 * on the cached player as `times: { created, last }` in UNIX seconds, where
 * last = max(last_save, last_login) = last activity.
 */
export const DAY_MS = 86400000;
export const YEAR_MS = 365 * DAY_MS;

export const FLAIR_NOTE = "just for fun, not a skill rating";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Apr 2014" (UTC month: plenty for a year-scale flair). */
export function monthYear(sec) {
  const d = new Date(sec * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const sec = (v) => {
  const n = Math.floor(+v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Census character → { created, last } (seconds) or null when Census sent no times. */
export function accountTimes(c) {
  const t = c && c.times;
  if (!t) return null;
  const created = sec(t.creation);
  const last = Math.max(sec(t.last_save) || 0, sec(t.last_login) || 0) || null;
  if (!created && !last) return null;
  return { created, last };
}

/** Cached/normalized `times` → clean { created, last } or null. */
export function cleanTimes(t) {
  if (!t || typeof t !== "object") return null;
  const created = sec(t.created);
  const last = sec(t.last);
  return created || last ? { created, last } : null;
}

/**
 * Rules in display order. test(times, nowMs) → tooltip text or null.
 * Thresholds: inactive = last activity > 365 days ago; veteran = created
 * ≥ 3×365 days ago AND last activity ≤ 365 days ago.
 */
export const FLAIR_RULES = Object.freeze([
  {
    id: "inactive",
    emoji: "🪦",
    test({ last }, now) {
      if (!last || now - last * 1000 <= YEAR_MS) return null;
      return `Inactive: no activity for over a year (last played ${monthYear(last)})`;
    },
  },
  {
    id: "veteran",
    emoji: "👴🏽",
    test({ created, last }, now) {
      if (!created || !last) return null;
      if (now - created * 1000 < 3 * YEAR_MS || now - last * 1000 > YEAR_MS) return null;
      const yrs = Math.floor((now - created * 1000) / YEAR_MS);
      return `Veteran: account ${yrs}+ years old (since ${monthYear(created)}) and active in the last year (last played ${monthYear(last)})`;
    },
  },
]);

/** One-line key for pages that show flairs (only when at least one is shown). */
export const FLAIR_LEGEND = "🎲 🪦 no activity for over a year · 👴🏽 3+ year old account, active in the last year (just for fun, not a skill rating)";

/** All flairs for a player's times: [{ id, emoji, tip }] (tip ends with the fun note). */
export function flairsFor(times, now = Date.now(), rules = FLAIR_RULES) {
  const t = cleanTimes(times);
  if (!t) return [];
  const out = [];
  for (const r of rules) {
    const tip = r.test(t, now);
    if (tip) out.push({ id: r.id, emoji: r.emoji, tip: `${tip} — ${FLAIR_NOTE}` });
  }
  return out;
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** <span class="flair">…</span> per flair ("" when none). */
export function flairsHtml(times, now = Date.now()) {
  return flairsFor(times, now)
    .map((f) => `<span class="flair flair-${f.id}" title="${esc(f.tip)}" aria-label="${esc(f.tip)}">${f.emoji}</span>`)
    .join("");
}
