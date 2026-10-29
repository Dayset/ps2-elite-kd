#!/usr/bin/env node
/**
 * 💸 Daily Cloudflare usage check (Workers Paid plan, owner 2026-10-29: "make sure that we
 * are not overloading that plan"). Run by .github/workflows/cf-usage.yml.
 *
 * Reads the account's month-to-date usage from Cloudflare's GraphQL Analytics API
 * (needs "Account Analytics: Read" on CLOUDFLARE_API_TOKEN), projects it to the end of
 * the month and compares it with what the $5 plan includes. Also reads the cache
 * Worker's own meter (GET /monitor/usage: stream messages per day, the kill monitor's
 * share). Prints GitHub annotations + a step summary; exits 1 (GitHub emails the owner)
 * when a projection passes 100 % of an included amount.
 *
 * 🔀 Plan-aware (plan.json, or CF_PLAN=paid|free): on "free" the same numbers are read as a daily
 * average against the free plan's DAILY limits, so the check stays right after a rollback.
 *
 * Field names differ between datasets and change over time, so every dataset's "sum"
 * fields are read by introspection first and only the known ones are asked for.
 *   CF_API_TOKEN=… CF_ACCOUNT_ID=… node scripts/cf-usage.mjs [--json out.json]
 */

export const INCLUDED = Object.freeze({
  workerRequests: 10e6,  // Workers Standard: 10M requests / month
  workerCpuMs: 30e6,     // 30M CPU-ms / month
  doRequests: 1e6,       // Durable Objects: 1M requests / month (incoming WebSocket messages 1 per 20)
  doGbS: 400e3,          // 400,000 GB-s / month
  rowsRead: 25e9,        // SQLite (D1 + Durable Objects): 25B rows read / month
  rowsWritten: 50e6,     // 50M rows written / month
  d1Bytes: 5e9,          // D1 storage 5 GB
  kvReads: 10e6, kvWrites: 1e6,
});
/** Free plan, per UTC day (Workers Free). CPU is a per-request limit there, not a budget. */
export const FREE_DAILY = Object.freeze({ workerRequests: 100e3, doRequests: 100e3, doGbS: 13e3, rowsRead: 5e6, rowsWritten: 100e3 });
export const WARN = 0.85, FAIL = 1.0;
const DO_GB = 0.128;
const MONITOR = "https://ps2-elite-kd-cache.dayset.workers.dev/monitor/usage";

/** Month-to-date window and the factor that projects it to the whole month. */
export function monthWindow(now = new Date()) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 1));
  const elapsed = Math.max(3600e3, now - start);
  return { start, end, now, factor: (end - start) / elapsed, days: elapsed / 86400e3, startDate: start.toISOString().slice(0, 10), nowDate: now.toISOString().slice(0, 10) };
}

/** projected / included → "ok" | "warn" | "over". */
export function verdict(projected, included) {
  if (!(included > 0) || !Number.isFinite(projected)) return "ok";
  const s = projected / included;
  return s >= FAIL ? "over" : s >= WARN ? "warn" : "ok";
}

/**
 * Raw dataset sums → billing lines. `sums` = { dataset: { field: total } } month to date.
 * DO requests: invocations + incoming WebSocket messages / 20 (Cloudflare's billing ratio).
 */
export function billingLines(sums, factor, plan = "paid", days = 1) {
  const g = (ds, f) => (sums[ds] && Number.isFinite(sums[ds][f]) ? sums[ds][f] : null);
  const lines = [];
  const free = plan === "free";
  const add = (key, label, mtd, note = "") => {
    if (mtd == null) return;
    const included = free ? FREE_DAILY[key] : INCLUDED[key];
    if (!included) return;
    const projected = free ? mtd / Math.max(1 / 24, days) : mtd * factor; // free: average per day vs the daily limit
    lines.push({ key, label: free ? `${label} per day` : label, mtd, projected, included, share: projected / included, verdict: verdict(projected, included), note });
  };
  add("workerRequests", "Worker requests", g("workersInvocationsAdaptive", "requests"));
  const cpuUs = g("workersInvocationsAdaptive", "cpuTimeUs");
  add("workerCpuMs", "Worker CPU ms", cpuUs == null ? null : cpuUs / 1000);
  const inv = g("durableObjectsInvocationsAdaptiveGroups", "requests");
  const wsIn = g("durableObjectsPeriodicGroups", "inboundWebsocketMsgCount");
  if (inv != null || wsIn != null) add("doRequests", "Durable Object requests", (inv || 0) + (wsIn || 0) / 20, wsIn == null ? "WebSocket messages not reported" : "");
  const active = g("durableObjectsPeriodicGroups", "activeTime"); // microseconds
  add("doGbS", "Durable Object GB-s", active == null ? null : (active / 1e6) * DO_GB);
  const d1r = g("d1AnalyticsAdaptiveGroups", "rowsRead"), d1w = g("d1AnalyticsAdaptiveGroups", "rowsWritten");
  const dor = g("durableObjectsPeriodicGroups", "rowsRead"), dow = g("durableObjectsPeriodicGroups", "rowsWritten");
  if (d1r != null || dor != null) add("rowsRead", "SQLite rows read (D1 + DO)", (d1r || 0) + (dor || 0));
  if (d1w != null || dow != null) add("rowsWritten", "SQLite rows written (D1 + DO)", (d1w || 0) + (dow || 0));
  return lines;
}

const WANT = {
  workersInvocationsAdaptive: ["requests", "cpuTimeUs", "errors", "subrequests"],
  durableObjectsInvocationsAdaptiveGroups: ["requests", "errors"],
  durableObjectsPeriodicGroups: ["activeTime", "cpuTime", "inboundWebsocketMsgCount", "outboundWebsocketMsgCount", "rowsRead", "rowsWritten", "storageReadUnits", "storageWriteUnits", "exceededCpuErrors", "exceededMemoryErrors"],
  d1AnalyticsAdaptiveGroups: ["readQueries", "writeQueries", "rowsRead", "rowsWritten"],
};

async function gql(token, query, variables = {}) {
  const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(30000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j.errors && j.errors.length && !j.data)) throw new Error((j.errors && j.errors.map((e) => e.message).join("; ")) || `HTTP ${r.status}`);
  return j;
}

const typeName = (t) => (t ? t.name || typeName(t.ofType) : null);

async function sumFields(token, dataset) {
  const acc = await gql(token, `{ __type(name: "account") { fields { name type { name ofType { name ofType { name ofType { name } } } } } } }`);
  const f = ((acc.data && acc.data.__type && acc.data.__type.fields) || []).find((x) => x.name === dataset);
  if (!f) return null;
  const dsType = typeName(f.type);
  const ds = await gql(token, `query($n: String!) { __type(name: $n) { fields { name type { name ofType { name ofType { name } } } } } }`, { n: dsType });
  const sumF = ((ds.data && ds.data.__type && ds.data.__type.fields) || []).find((x) => x.name === "sum");
  if (!sumF) return { fields: [], dims: false };
  const st = await gql(token, `query($n: String!) { __type(name: $n) { fields { name } } }`, { n: typeName(sumF.type) });
  const have = new Set(((st.data && st.data.__type && st.data.__type.fields) || []).map((x) => x.name));
  const dims = ((ds.data && ds.data.__type && ds.data.__type.fields) || []).some((x) => x.name === "dimensions");
  return { fields: WANT[dataset].filter((x) => have.has(x)), dims };
}

async function datasetSums(token, account, dataset, win) {
  const meta = await sumFields(token, dataset);
  if (!meta) return { error: "dataset not in schema" };
  if (!meta.fields.length) return { error: "no known sum fields" };
  const tries = [
    [`date_geq: $s, date_leq: $e`, { s: win.startDate, e: win.nowDate }, "Date"],
    [`datetime_geq: $s, datetime_leq: $e`, { s: win.start.toISOString(), e: win.now.toISOString() }, "Time"],
  ];
  let lastErr = null;
  for (const [filter, vars, ty] of tries) {
    const q = `query($a: String!, $s: ${ty}!, $e: ${ty}!) { viewer { accounts(filter: { accountTag: $a }) { ${dataset}(limit: 10000, filter: { ${filter} }) { sum { ${meta.fields.join(" ")} } ${meta.dims ? "dimensions { date }" : ""} } } } }`;
    try {
      const j = await gql(token, q, { a: account, ...vars });
      const rows = (j.data && j.data.viewer && j.data.viewer.accounts && j.data.viewer.accounts[0] && j.data.viewer.accounts[0][dataset]) || [];
      const out = {};
      for (const f of meta.fields) out[f] = rows.reduce((s, r) => s + (+((r.sum || {})[f]) || 0), 0);
      return out;
    } catch (e) { lastErr = e; }
  }
  return { error: String((lastErr && lastErr.message) || lastErr).slice(0, 200) };
}

const fmt = (v) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : `${Math.round(v)}`);
const esc = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A");

/** paid | free: CF_PLAN, else plan.json next to the site, else paid. */
export async function planNow() {
  const fs = await import("node:fs");
  const env = String(process.env.CF_PLAN || "").trim().toLowerCase();
  if (env === "paid" || env === "free") return env;
  try { const p = String(JSON.parse(fs.readFileSync(new URL("../plan.json", import.meta.url), "utf8")).plan || "").toLowerCase(); if (p === "paid" || p === "free") return p; } catch {}
  return "paid";
}

async function main() {
  const token = process.env.CF_API_TOKEN, account = process.env.CF_ACCOUNT_ID;
  const win = monthWindow(new Date());
  const plan = await planNow();
  const report = { at: win.now.toISOString(), plan, month: win.startDate.slice(0, 7), factor: +win.factor.toFixed(3), datasets: {}, lines: [], monitor: null, problems: [] };
  if (token && account) {
    for (const ds of Object.keys(WANT)) {
      try { report.datasets[ds] = await datasetSums(token, account, ds, win); } catch (e) { report.datasets[ds] = { error: String(e.message || e).slice(0, 200) }; }
    }
    const sums = Object.fromEntries(Object.entries(report.datasets).filter(([, v]) => !v.error));
    report.lines = billingLines(sums, win.factor, plan, win.days);
    const errs = Object.entries(report.datasets).filter(([, v]) => v.error);
    if (errs.length === Object.keys(WANT).length) report.problems.push(`Cloudflare analytics not readable (${errs[0][1].error}). Add "Account Analytics: Read" to the CLOUDFLARE_API_TOKEN secret.`);
  } else report.problems.push("CF_API_TOKEN / CF_ACCOUNT_ID not set");
  try {
    const r = await fetch(MONITOR + "?t=" + Date.now(), { signal: AbortSignal.timeout(30000) });
    if (r.ok) report.monitor = await r.json();
    else report.problems.push(`/monitor/usage HTTP ${r.status}`);
  } catch (e) { report.problems.push(`/monitor/usage ${e.message}`); }

  const out = [];
  for (const l of report.lines) {
    const msg = plan === "free"
      ? `[free plan] ${l.label}: ${fmt(l.projected)} on average (${Math.round(l.share * 100)} % of the ${fmt(l.included)} daily limit)${l.note ? `; ${l.note}` : ""}`
      : `${l.label}: ${fmt(l.mtd)} so far → ${fmt(l.projected)} this month (${Math.round(l.share * 100)} % of ${fmt(l.included)} included)${l.note ? `; ${l.note}` : ""}`;
    out.push([l.verdict === "over" ? "error" : l.verdict === "warn" ? "warning" : "notice", msg]);
  }
  for (const [ds, v] of Object.entries(report.datasets)) if (v.error) out.push(["notice", `${ds}: ${v.error}`]);
  if (report.monitor && report.monitor.month) {
    const m = report.monitor.month, t = report.monitor.today || {};
    const fd = report.monitor.freeDay;
    out.push(["notice", `Kill monitor (last ${report.monitor.window && report.monitor.window.hours} h, plan ${report.monitor.plan ? report.monitor.plan.plan : "?"}): PC ${fmt(t.ps2 || 0)} messages today, stream ${report.monitor.pc && report.monitor.pc.level}; month ≈ ${fmt(m.doRequests)} DO requests, ${fmt(m.doGbS)} GB-s, ${fmt(m.rowsWritten)} rows; extra ≈ $${m.extraUsd} (worst $${m.extraUsdWorst})${fd ? `; free-plan day: ${fmt(fd.doRequests)} / 100k DO requests, ${fd.fits ? "would fit" : "would NOT fit"}` : ""}`]);
    if (report.monitor.plan && report.monitor.plan.plan !== plan) report.problems.push(`plan.json says ${plan} but the kill monitor runs ${report.monitor.plan.plan} (it re-reads plan.json every 5 min; a PLAN variable in the Cloudflare dashboard wins)`);
  }
  for (const p of report.problems) out.push(["warning", p]);
  for (const [lvl, msg] of out.slice(0, 10)) console.log(`::${lvl} title=Cloudflare usage::${esc(msg)}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = report.lines.map((l) => `| ${l.label} | ${fmt(l.mtd)} | ${fmt(l.projected)} | ${fmt(l.included)} | ${Math.round(l.share * 100)} % | ${l.verdict} |`).join("\n");
    const fs = await import("node:fs");
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Cloudflare usage ${report.month}, ${plan} plan${plan === "free" ? " (daily averages vs daily limits)" : ` (×${report.factor} to month end)`}\n\n| Item | Month so far | Projected | Included | Share | |\n|---|---|---|---|---|---|\n${rows}\n\n${report.problems.map((p) => `- ${p}`).join("\n")}\n`);
  }
  const ji = process.argv.indexOf("--json");
  if (ji > 0 && process.argv[ji + 1]) (await import("node:fs")).writeFileSync(process.argv[ji + 1], JSON.stringify(report, null, 1) + "\n");
  if (report.lines.some((l) => l.verdict === "over")) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.log(`::error title=Cloudflare usage::${esc(e.message || e)}`); process.exitCode = 1; });
