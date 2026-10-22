/**
 * PlayStation room hook (#55). The PS refresh (refresh-ps.yml) writes
 * data-ps/schedule.json the same way the PC run writes data/schedule.json.
 * This cron hook reads that file and dispatches refresh-ps.yml when a run is
 * due and none is running or just finished. It never touches the PC refresh
 * (its own workflow, its own schedule file), uses no KV, and never throws:
 * failures only come back as a decision for the log.
 */
export const PS_WORKFLOW = "refresh-ps.yml";
export const PS_SCHEDULE_URL = "https://dayset.github.io/ps2-elite-kd/data-ps/schedule.json";
const ACTIVE = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);
const RECENT_MS = 60 * 1e3;
const UA = "ps2-elite-kd-cache-worker (+https://dayset.github.io/ps2-elite-kd/)";

function gh(env) {
  return {
    Authorization: `Bearer ${env.GH_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": UA,
  };
}

export async function roomTick(env, c, now = Date.now(), fetchImpl = fetch) {
  if (!env || !env.GH_TOKEN) return { decision: "off" };
  if (String(env.PS_ROOM_TICK || "").toLowerCase() === "off") return { decision: "off" };
  try {
    const u = new URL(env.PS_SCHEDULE_URL || PS_SCHEDULE_URL);
    u.searchParams.set("t", String(Math.floor(now / 6e4)));
    const res = await fetchImpl(u.toString(), {
      headers: { Accept: "application/json", "User-Agent": UA },
      cf: { cacheTtl: 60, cacheEverything: true },
      signal: AbortSignal.timeout(c.timeoutMs),
    });
    if (!res.ok) return { decision: "idle", reason: `schedule_http_${res.status}` };
    const sched = await res.json();
    const at = sched && sched.nextDueAt ? Date.parse(sched.nextDueAt) : NaN;
    if (!Number.isFinite(at)) return { decision: "idle", reason: "idle" };
    if (at > now) return { decision: "idle", reason: "not_due" };
    const list = await fetchImpl(`https://api.github.com/repos/${c.repo}/actions/workflows/${PS_WORKFLOW}/runs?per_page=10`, {
      headers: gh(env),
      signal: AbortSignal.timeout(c.timeoutMs),
    });
    if (!list.ok) return { decision: "error", reason: `list_http_${list.status}` };
    const runs = ((await list.json()) || {}).workflow_runs || [];
    if (runs.some((r) => r && ACTIVE.has(r.status))) return { decision: "running" };
    if (runs.some((r) => r && r.status === "completed" && now - Date.parse(r.updated_at || r.created_at) < RECENT_MS)) return { decision: "recent" };
    const d = await fetchImpl(`https://api.github.com/repos/${c.repo}/actions/workflows/${PS_WORKFLOW}/dispatches`, {
      method: "POST",
      headers: { ...gh(env), "Content-Type": "application/json" },
      body: JSON.stringify({ ref: c.ref }),
      signal: AbortSignal.timeout(c.timeoutMs),
    });
    return d.status === 204 || d.ok ? { decision: "dispatched", reason: String((sched && sched.reason) || "due").slice(0, 40) } : { decision: "error", reason: `dispatch_http_${d.status}` };
  } catch (e) {
    return { decision: "error", reason: (e && e.name) || "network" };
  }
}
