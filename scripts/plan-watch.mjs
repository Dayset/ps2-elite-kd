#!/usr/bin/env node
/**
 * 🔀 Automatic plan fallback (owner 2026-10-29: "if I got hit by a bus and my card got cancelled,
 * I'd like the project to stay alive on its own"). Run hourly by .github/workflows/plan-watch.yml.
 *
 * Looks for evidence that the Cloudflare account is no longer on Workers Paid and, if so, writes
 * "free" into plan.json (both Workers follow within ~5 min: worker/src/plan.js). Evidence:
 *   1. the account's subscriptions (Cloudflare API; needs "Billing: Read" on CLOUDFLARE_API_TOKEN):
 *      no active Workers subscription → free; one found → paid;
 *   2. otherwise symptoms: Cloudflare's free-tier limit wording (or Error 1027) in the cache Worker's
 *      /monitor/usage or the oracle's /health, or a Worker that already tripped itself to free.
 * It switches back to "paid" only when it switched to free by itself ("auto": true) and the
 * subscription is visibly back. A "free" set by hand is never changed.
 *   CF_API_TOKEN=… CF_ACCOUNT_ID=… node scripts/plan-watch.mjs [--write]
 * --write updates plan.json and prints the commit message on the last line as "COMMIT: …".
 */
import fs from "node:fs";

export const FREE_TIER_RE = /free tier|free plan.*(limit|exceeded)|exceeded.*free|error 1027/i;
const CACHE = "https://ps2-elite-kd-cache.dayset.workers.dev";
const ORACLE = "https://ps2-oracle.dayset.workers.dev";
const PLAN_FILE = new URL("../plan.json", import.meta.url);

/** Subscriptions API result → "paid" | "free" | "unknown". */
export function subsVerdict(status, body) {
  if (status !== 200 || !body || body.success === false || !Array.isArray(body.result)) return "unknown";
  const workers = body.result.filter((s) => /worker/i.test(JSON.stringify([s && s.rate_plan, s && s.product, s && s.component_values, s && s.app])));
  const live = workers.filter((s) => !s.state || /active|paid|trial|provisioned/i.test(String(s.state)));
  return live.length ? "paid" : "free";
}

/** Evidence → the new plan.json content, or null to leave it. */
export function decide(cur, { subs = "unknown", symptoms = [] } = {}, today = new Date().toISOString().slice(0, 10)) {
  const plan = cur && (cur.plan === "free" || cur.plan === "paid") ? cur.plan : "paid";
  const base = { ...(cur || {}) };
  if (plan === "paid") {
    if (subs === "free") return { ...base, plan: "free", auto: true, since: today, reason: "No active Workers Paid subscription on the Cloudflare account (plan-watch)." };
    if (subs !== "paid" && symptoms.length) return { ...base, plan: "free", auto: true, since: today, reason: `Cloudflare free-tier limits seen (plan-watch): ${symptoms[0]}`.slice(0, 300) };
    return null;
  }
  if (cur && cur.auto === true && subs === "paid") return { ...base, plan: "paid", auto: false, since: today, reason: "Workers Paid subscription is active again (plan-watch)." };
  return null;
}

async function getJson(url, init = {}) {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch {}
    return { status: r.status, body, text: text.slice(0, 2000) };
  } catch (e) { return { status: 0, body: null, text: String(e && e.message) }; }
}

/** Free-tier symptoms in our own Workers' answers. */
export function symptomsOf(usage, health) {
  const out = [];
  for (const [name, r] of [["cache /monitor/usage", usage], ["oracle /health", health]]) {
    if (!r) continue;
    const b = r.body || {};
    if (b.plan && b.plan.tripped) out.push(`${name}: tripped to free until ${b.plan.tripped}`);
    const errs = [r.status >= 400 ? r.text : "", b.detail, ...(((b.last_cycle || {}).errors) || [])].filter(Boolean).map(String);
    const hit = errs.find((e) => FREE_TIER_RE.test(e));
    if (hit) out.push(`${name}: ${hit.slice(0, 160)}`);
  }
  return out;
}

const esc = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A");

async function main() {
  const write = process.argv.includes("--write");
  const cur = JSON.parse(fs.readFileSync(PLAN_FILE, "utf8"));
  const token = process.env.CF_API_TOKEN, account = process.env.CF_ACCOUNT_ID;
  let subs = "unknown", subsNote = "no token";
  if (token && account) {
    const r = await getJson(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/subscriptions`, { headers: { Authorization: `Bearer ${token}` } });
    subs = subsVerdict(r.status, r.body);
    subsNote = subs === "unknown" ? `subscriptions not readable (HTTP ${r.status}${r.body && r.body.errors && r.body.errors[0] ? `: ${r.body.errors[0].message}` : ""}); add "Billing: Read" to the token for a direct check` : `subscriptions: Workers ${subs}`;
  }
  const [usage, health] = await Promise.all([getJson(`${CACHE}/monitor/usage?t=${Date.now()}`), getJson(`${ORACLE}/health?t=${Date.now()}`)]);
  const symptoms = symptomsOf(usage, health);
  const next = decide(cur, { subs, symptoms });
  console.log(`::notice title=Plan watch::plan.json ${cur.plan}${cur.auto ? " (auto)" : ""}; ${subsNote}; symptoms: ${symptoms.length ? symptoms.join(" | ") : "none"}`.replace(/\n/g, " "));
  if (!next) return;
  console.log(`::warning title=Plan switched to ${next.plan}::${esc(next.reason)}`);
  if (write) {
    fs.writeFileSync(PLAN_FILE, JSON.stringify(next, null, 2) + "\n");
    console.log(`COMMIT: 🔀 plan.json → ${next.plan} (plan-watch)`); // fixed text: the reason (error text) stays in plan.json
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.log(`::error title=Plan watch::${esc(e.message || e)}`); process.exitCode = 1; });
