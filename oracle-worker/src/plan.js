/**
 * 🔀 Plan switch (owner 2026-10-29: "fallback mechanics in case the paid features are disabled and we
 * roll back to the free account; easy switch back").
 *
 * One file decides: plan.json at the site root (https://dayset.github.io/ps2-elite-kd/plan.json),
 * { "plan": "paid" | "free" }. Both Workers read it within PLAN_TTL_MS, so switching is one commit
 * and no deploy. A Worker variable PLAN=paid|free (Cloudflare dashboard) overrides the file, for an
 * emergency switch without GitHub.
 *   paid: PC live stream in the kill monitor, PS sockets with the extra position events, Oracle
 *         live fights (worker/src/plan.js is the same logic).
 *   free: exactly what ran on the free plan before 2026-10-29.
 * Unknown (file unreachable and nothing remembered) = free: the cheap side is the safe side.
 *
 * Automatic fallback (owner 2026-10-29: "if my card got cancelled, the project should stay alive
 * on its own"): any error carrying Cloudflare's free-tier wording (FREE_TIER_RE) trips the switch
 * to free for TRIP_MS in that Worker at once; .github/workflows/plan-watch.yml (hourly) then
 * writes "free" into plan.json for good when the Workers Paid subscription is gone or those
 * errors show up, and back to "paid" only when it switched by itself and the subscription is back.
 * Same code as worker/src/plan.js (test/plan-switch.test.mjs keeps them equal).
 */
export const PLAN_URL = "https://dayset.github.io/ps2-elite-kd/plan.json";
export const PLAN_TTL_MS = 5 * 60e3;
export const TRIP_MS = 24 * 3600e3;
/** Cloudflare's own wording when a free-plan daily limit is hit (D1, Durable Objects, KV …). */
export const FREE_TIER_RE = /free tier|free plan.*(limit|exceeded)|exceeded.*free/i;

export function parsePlan(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  return s === "paid" || s === "free" ? s : null;
}

export class PlanSwitch {
  constructor({ initial = null, fetchFn = (u, o) => fetch(u, o), url = PLAN_URL, ttlMs = PLAN_TTL_MS } = {}) {
    this.plan = parsePlan(initial) || "free";
    this.src = parsePlan(initial) ? "remembered" : "default";
    this.at = 0;
    this.fetchFn = fetchFn;
    this.url = url;
    this.ttlMs = ttlMs;
    this.trippedUntil = 0;
  }
  /** A free-tier error was seen: run as free for `ms` whatever plan.json says (the PLAN variable still wins). */
  trip(now = Date.now(), ms = TRIP_MS) { this.trippedUntil = Math.max(this.trippedUntil, now + ms); }
  /** Call with any caught error; trips when it is a free-tier limit. Returns true if it tripped. */
  check(err, now = Date.now()) {
    const m = String((err && (err.message || err.detail || err.error)) || err || "");
    if (!FREE_TIER_RE.test(m)) return false;
    this.trip(now);
    return true;
  }
  state(now = Date.now()) { return { plan: this.trippedUntil > now && this.src !== "variable" ? "free" : this.plan, from: this.src, tripped: this.trippedUntil > now ? new Date(this.trippedUntil).toISOString() : null }; }
  /** "paid" | "free" now: the PLAN variable, else plan.json (cached), else the last known value. */
  async get(env, now = Date.now()) {
    const forced = parsePlan(env && env.PLAN);
    if (forced) { this.plan = forced; this.src = "variable"; return forced; }
    if (this.src === "variable") this.src = "default"; // variable removed: back to the file
    if (this.trippedUntil > now) return "free";
    if (this.at && now - this.at < this.ttlMs) return this.plan;
    this.at = now;
    try {
      const r = await this.fetchFn(`${this.url}?t=${Math.floor(now / this.ttlMs)}`, { cf: { cacheTtl: 60 }, signal: AbortSignal.timeout(5000) });
      if (r && r.ok) {
        const p = parsePlan((await r.json() || {}).plan);
        if (p) { this.plan = p; this.src = "plan.json"; }
      }
    } catch { /* keep the last known plan */ }
    return this.plan;
  }
}
