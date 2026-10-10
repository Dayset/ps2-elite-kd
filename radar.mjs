/**
 * 🛰️ PS2 Radar second opinion (https://ps2radar.com, independent community
 * cheat radar; public read-only API v1, no token). Build-log only, never public.
 *
 * The refresh pipeline (scripts/radar-lookup.mjs) looks up ONLY the players in
 * our review lists (🚩, 📉 🌾/†/🧪, 🔎, 🤖, 🙈) once per UTC day, at most
 * RADAR_RULE.DAILY_CAP lookups, one request every 2–3 s, rechecking a player
 * at most every RADAR_RULE.RECHECK_DAYS, and caches the answers in
 * data/radar.json. A Radar "confirmed" / "banned" moderator mark only moves a
 * player up in build-log's review order and shows a badge: it never hides or
 * flags anyone by itself (owner decisions stay in hidden.json / reviewed.json).
 *
 * Strictly optional (t333u): PS2 Radar is a third-party community site that
 * may change or disappear. Nothing in our flags / hide list / review lists /
 * rankings reads it; only build-log's Radar link + badge + sort hint read
 * data/radar.json. If the API fails or vanishes, the pipeline skips it for the
 * day, records "unavailableSince", and the last cached answers stay as a record.
 *
 * DOM-free; used by build-log.html, scripts/radar-lookup.mjs and tests.
 */

export const RADAR_RULE = Object.freeze({
  DAILY_CAP: 50,        // lookups per UTC day
  RECHECK_DAYS: 3,      // never re-ask about a player sooner than this
  MIN_GAP_MS: 2000,     // ≥ 2 s between requests …
  MAX_GAP_MS: 3000,     // … ≤ 3 s (jittered)
  MAX_RETRIES: 3,       // per player on 429 / 503 / 5xx (Retry-After honoured, exponential backoff)
  MAX_BACKOFF_MS: 60000,
  STOP_AFTER_FAILS: 2,  // players in a row that failed (429/503 after retries, network, odd reply) → skip the rest of today
});

export const RADAR_ORIGIN = "https://ps2radar.com";
export const RADAR_USER_AGENT = "ps2-elite-kd/1.0 (+https://dayset.github.io/ps2-elite-kd/; github.com/dayset/ps2-elite-kd; daily second-opinion lookups for flagged players, max 50/day)";


/** Public profile link (character id); "" when no id. */
export function radarProfileUrl(cid) {
  const id = String(cid || "").trim();
  return /^\d{5,25}$/.test(id) ? RADAR_ORIGIN + "/#/player/" + id : "";
}

/** API URL for one player (id preferred, exact name as fallback). */
export function radarApiUrl({ cid, name }) {
  const id = String(cid || "").trim();
  if (/^\d{5,25}$/.test(id)) return RADAR_ORIGIN + "/api/v1/players/" + id;
  const n = String(name || "").replace(/^\s*\[[^\]]*\]\s*/, "").trim();
  return n ? RADAR_ORIGIN + "/api/v1/players/" + encodeURIComponent(n) : "";
}

const str = (v) => (typeof v === "string" && v ? v : null);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Compact cache entry from an API v1 player response (or a 404).
 * Only what build-log needs: tier, Sus score, moderator mark, dates.
 */
export function radarEntry(body, { status = 200, checkedAt = new Date().toISOString(), slug = "", name = "", cid = "" } = {}) {
  if (status === 404) return { slug, name, cid: String(cid || ""), checkedAt, stored: false };
  const p = (body && body.player) || {};
  const cls = p.classification || {};
  const model = p.model || {};
  const mark = p.mark || null;
  return {
    slug, name: str(p.name) || name, cid: str(p.character_id) || String(cid || ""), checkedAt, stored: true,
    tier: str(cls.tier), label: str(cls.label), source: str(cls.source),
    modelTier: str(model.tier), blatant: typeof model.blatant === "boolean" ? model.blatant : null, sus: num(model.sus_score),
    assessedAt: num(model.assessedAt) ?? num(model.assessed_at),
    mark: mark && str(mark.kind) ? mark.kind : null, markAt: mark ? num(mark.at) : null,
    server: (p.server && str(p.server.name)) || null,
  };
}

/** Moderator mark that moves a player up in review order (never hides / flags). */
export function radarPriority(e) {
  return !!(e && e.stored && (e.mark === "confirmed" || e.mark === "banned"));
}

/** Badge for build-log: { text, cls, tip } or null when never checked. */
export function radarBadge(e) {
  if (!e) return null;
  const when = e.checkedAt ? String(e.checkedAt).slice(0, 10) : "?";
  if (!e.stored) return { text: "not stored", cls: "", tip: "PS2 Radar has no saved data for this player (checked " + when + ")" };
  const sus = e.sus != null ? " · Sus " + Math.round(e.sus) : "";
  const model = e.modelTier ? "model " + e.modelTier + (e.blatant ? " (blatant)" : "") + sus : "not assessed by the model";
  const tip = "PS2 Radar second opinion (checked " + when + "): " + (e.label || e.tier || "?") + "; " + model +
    (e.mark ? "; moderator mark " + e.mark + (e.markAt ? " " + new Date(e.markAt * 1000).toISOString().slice(0, 10) : "") : "") +
    ". Sus score = finding strength, not a probability. A second opinion only: it never hides or flags anyone here.";
  if (e.mark === "confirmed" || e.mark === "banned") return { text: e.mark === "banned" ? "Banned" : "Confirmed", cls: "hot", tip };
  if (e.mark === "cleared") return { text: "Cleared", cls: "ok", tip };
  if (e.modelTier) return { text: e.modelTier + sus, cls: e.modelTier === "blatant" || e.blatant ? "warn" : "", tip };
  return { text: e.label || "not assessed", cls: "", tip };
}

/** UTC day "YYYY-MM-DD". */
export const utcDay = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

/**
 * Pick today's lookups from the review list (status.json review.players, already
 * in priority order): never checked first, then the oldest checks, skipping any
 * player checked within RECHECK_DAYS; at most `left` players.
 */
export function pickDue(review, cache, { now = Date.now(), left = RADAR_RULE.DAILY_CAP, rule = RADAR_RULE } = {}) {
  const players = (cache && cache.players) || {};
  const due = [];
  (review || []).forEach((r, i) => {
    if (!r || !r.slug || (!r.cid && !r.name)) return;
    const e = players[r.slug];
    const t = e && Date.parse(e.checkedAt);
    if (Number.isFinite(t) && now - t < rule.RECHECK_DAYS * 86400000) return;
    due.push({ r, i, t: Number.isFinite(t) ? t : -1 });
  });
  due.sort((a, b) => (a.t < 0) !== (b.t < 0) ? (a.t < 0 ? -1 : 1) : a.t - b.t || a.i - b.i);
  return due.slice(0, Math.max(0, left)).map((d) => d.r);
}

/** Retry-After (seconds or HTTP date) → ms, or null. */
export function retryAfterMs(v, now = Date.now()) {
  if (v == null || v === "") return null;
  const s = Number(v);
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - now) : null;
}

/** A 404 we trust as "player not stored" (their documented reply), not a vanished API. */
export function isNotStored(status, body) {
  return status === 404 && !!body && typeof body.detail === "string" && /not stored/i.test(body.detail);
}
