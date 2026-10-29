/**
 * 💸 Budget meter for the Workers Paid plan (owner 2026-10-29: "make sure that we
 * are not overloading that plan").
 *
 * Lives inside the KillMonitor Durable Object (the one always-on object). Counts
 * every incoming stream message per environment and event name, every request
 * to the object, every alarm and every SQLite row it writes, per UTC hour, and
 * keeps the last 48 hours. Saved as ONE meta row every few minutes.
 *
 * usage() turns the last 24 hours into a month projection against the paid
 * plan's included amounts (checked 2026-10-29, developers.cloudflare.com/
 * durable-objects/platform/pricing):
 *   - Durable Object requests: 1M / month included, then $0.15 per million.
 *     Incoming WebSocket messages count 1 per 20 (worst case 1 per 1 is shown too).
 *   - Durable Object duration: 400,000 GB-s / month, then $12.50 per million.
 *     An object kept in memory (open outbound sockets) all month = 128 MB × the
 *     month's seconds ≈ 337,000 GB-s, whatever it does.
 *   - SQLite rows written: 50M / month, then $1.00 per million.
 * freeDay: the same last 24 hours against the free plan's daily limits, so a switch back to the
 * free plan (plan.json) can be checked before it is made.
 * Only this object is metered here; the daily Cloudflare usage check
 * (.github/workflows/cf-usage.yml) reads the account-wide numbers.
 */

export const INCLUDED = Object.freeze({ doRequests: 1e6, doGbS: 400e3, rowsWritten: 50e6 });
/** Free plan, per UTC day (to see whether a switch back to free would fit: plan.js). */
export const FREE_DAY = Object.freeze({ doRequests: 100e3, doGbS: 13e3, rowsWritten: 100e3 });
export const PRICE = Object.freeze({ doRequests: 0.15 / 1e6, doGbS: 12.5 / 1e6, rowsWritten: 1 / 1e6 });
export const WS_RATIO = 20; // incoming WebSocket messages per billed request
export const DO_GB = 0.128; // Cloudflare bills 128 MB per object (their examples use 128 MB / 1 GB)
export const MONTH_S = 30.44 * 86400;
export const KEEP_HOURS = 48;

const hourKey = (ms) => new Date(ms).toISOString().slice(0, 13); // "2026-10-29T15"

export class Meter {
  constructor(saved = null) {
    this.h = {}; // hourKey → { env: { ev: [n, bytes] }, _: { fetch, alarm, rows } }
    this.since = Date.now();
    if (saved && typeof saved === "object") {
      if (saved.h && typeof saved.h === "object") this.h = saved.h;
      if (+saved.since) this.since = +saved.since;
    }
  }
  static load(json) {
    try { return new Meter(json ? JSON.parse(json) : null); } catch { return new Meter(); }
  }
  bucket(now) {
    const k = hourKey(now);
    return (this.h[k] ||= { _: { fetch: 0, alarm: 0, rows: 0 } });
  }
  /** One incoming stream message. */
  msg(env, ev, bytes, now = Date.now()) {
    const b = this.bucket(now);
    const e = (b[env] ||= {});
    const name = String(ev || "other").slice(0, 48);
    const c = (e[name] ||= [0, 0]);
    c[0]++;
    c[1] += +bytes || 0;
  }
  /** fetch | alarm | rows */
  op(kind, now = Date.now(), n = 1) {
    const b = this.bucket(now);
    b._[kind] = (b._[kind] || 0) + n;
  }
  /** Messages so far in this UTC day for one environment. */
  today(env, now = Date.now()) {
    const day = new Date(now).toISOString().slice(0, 10);
    let n = 0;
    for (const [k, b] of Object.entries(this.h)) {
      if (!k.startsWith(day) || !b[env]) continue;
      for (const c of Object.values(b[env])) n += c[0];
    }
    return n;
  }
  prune(now = Date.now()) {
    const cut = hourKey(now - KEEP_HOURS * 3600e3);
    for (const k of Object.keys(this.h)) if (k < cut) delete this.h[k];
  }
  toJSON() { return { since: this.since, h: this.h }; }

  /** Last 24 h (or less, scaled) → per-env totals and the month projection. */
  usage(now = Date.now(), { objectsAlwaysOn = 1 } = {}) {
    const from = hourKey(now - 24 * 3600e3);
    const hours = Object.keys(this.h).filter((k) => k > from).sort();
    const envs = {};
    const ops = { fetch: 0, alarm: 0, rows: 0 };
    let msgs = 0, bytes = 0;
    for (const k of hours) {
      const b = this.h[k];
      for (const [env, evs] of Object.entries(b)) {
        if (env === "_") { for (const [o, n] of Object.entries(evs)) ops[o] = (ops[o] || 0) + n; continue; }
        const e = (envs[env] ||= { msgs: 0, bytes: 0, events: {} });
        for (const [ev, c] of Object.entries(evs)) {
          e.msgs += c[0]; e.bytes += c[1];
          e.events[ev] = (e.events[ev] || 0) + c[0];
          msgs += c[0]; bytes += c[1];
        }
      }
    }
    // Hours actually covered (a fresh meter after a deploy covers less than a day).
    const coveredH = Math.max(1 / 60, Math.min(24, (now - Math.max(this.since, now - 24 * 3600e3)) / 3600e3));
    const perMonth = MONTH_S / (coveredH * 3600);
    const reqPerMonth = (msgs / WS_RATIO + ops.fetch + ops.alarm) * perMonth;
    const reqWorst = (msgs + ops.fetch + ops.alarm) * perMonth;
    const gbs = objectsAlwaysOn * DO_GB * MONTH_S;
    const rows = ops.rows * perMonth;
    const over = (v, inc, price) => Math.max(0, v - inc) * price;
    const cost = over(reqPerMonth, INCLUDED.doRequests, PRICE.doRequests) + over(gbs, INCLUDED.doGbS, PRICE.doGbS) + over(rows, INCLUDED.rowsWritten, PRICE.rowsWritten);
    const costWorst = over(reqWorst, INCLUDED.doRequests, PRICE.doRequests) + over(gbs, INCLUDED.doGbS, PRICE.doGbS) + over(rows, INCLUDED.rowsWritten, PRICE.rowsWritten);
    const r = (v) => Math.round(v);
    const perDay = 86400 / (coveredH * 3600);
    const dayReq = (msgs / WS_RATIO + ops.fetch + ops.alarm) * perDay, dayGbS = objectsAlwaysOn * DO_GB * 86400, dayRows = ops.rows * perDay;
    return {
      window: { hours: Math.round(coveredH * 10) / 10, from: hours[0] || null },
      last24h: { msgs, bytes, fetch: ops.fetch, alarm: ops.alarm, rows: ops.rows, envs },
      month: {
        doRequests: r(reqPerMonth), doRequestsWorst: r(reqWorst), doGbS: r(gbs), rowsWritten: r(rows),
        included: INCLUDED,
        share: { doRequests: +(reqPerMonth / INCLUDED.doRequests).toFixed(3), doGbS: +(gbs / INCLUDED.doGbS).toFixed(3), rowsWritten: +(rows / INCLUDED.rowsWritten).toFixed(4) },
        extraUsd: +cost.toFixed(2), extraUsdWorst: +costWorst.toFixed(2),
      },
      freeDay: {
        doRequests: r(dayReq), doGbS: r(dayGbS), rowsWritten: r(dayRows), limits: FREE_DAY,
        share: { doRequests: +(dayReq / FREE_DAY.doRequests).toFixed(3), doGbS: +(dayGbS / FREE_DAY.doGbS).toFixed(3), rowsWritten: +(dayRows / FREE_DAY.rowsWritten).toFixed(3) },
        fits: dayReq <= FREE_DAY.doRequests && dayGbS <= FREE_DAY.doGbS && dayRows <= FREE_DAY.rowsWritten,
      },
    };
  }
}
