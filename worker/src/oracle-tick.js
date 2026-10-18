/**
 * PS2MapOracle hook (2026-10-18). Honu's JSON API answers GitHub Actions but
 * challenges Cloudflare's network, so the ps2-oracle Worker queues its Honu
 * work (population for live alerts, outlier reports after alerts end) and the
 * Actions workflow oracle-honu.yml does it. This cron hook asks the oracle,
 * through the ORACLE service binding, whether there is work and dispatches the
 * workflow only then. No KV reads or writes; failures are silent and never
 * affect the cache Worker's own jobs.
 */
export const ORACLE_WORKFLOW = "oracle-honu.yml";

export async function oracleTick(env, c, fetchImpl = fetch) {
  if (!env || !env.ORACLE || !env.GH_TOKEN) return { decision: "off" };
  try {
    const r = await env.ORACLE.fetch("https://ps2-oracle/honu/pending");
    if (!r.ok) return { decision: "error", reason: `pending_http_${r.status}` };
    const p = await r.json();
    if (!p || !p.pending) return { decision: "idle" };
    const res = await fetchImpl(`https://api.github.com/repos/${c.repo}/actions/workflows/${ORACLE_WORKFLOW}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ps2-elite-kd-cache-worker (+https://dayset.github.io/ps2-elite-kd/)",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: c.ref }),
      signal: AbortSignal.timeout(c.timeoutMs),
    });
    return res.status === 204 || res.ok ? { decision: "dispatched", pop: p.pop, reports: p.reports } : { decision: "error", reason: `dispatch_http_${res.status}` };
  } catch (e) {
    return { decision: "error", reason: (e && e.name) || "network" };
  }
}
