// Long background runs give way to waiting runs (scripts/refresh-cache.mjs).
//
// Background runs commit once at the end, so they run ~27 min to keep Pages
// redeploys and bot commits down. While one runs, the refresh-cache
// concurrency group makes every other dispatch wait: in practice a site /add
// (on-demand names) or the hourly fallback cron. A waiting run means someone
// wants in, so the background run stops at the next player boundary, commits,
// and lets it go.

/** Statuses GitHub uses for a run that has not started yet. */
const WAITING = new Set(["queued", "pending", "waiting", "requested"]);

/** Any other run of this workflow waiting to start? */
export function othersWaiting(runs, ownRunId) {
  const own = String(ownRunId || "");
  return (Array.isArray(runs) ? runs : []).some((r) => r && WAITING.has(r.status) && String(r.id) !== own);
}

/**
 * Poll the workflow's runs every `everyMs`; call `onWaiting(reason)` once when
 * another run is waiting. No-op (returns a stop fn) without a token / repo.
 * Network errors are ignored: the run then simply uses its full budget.
 */
export function startYieldWatch({
  token = process.env.GITHUB_TOKEN,
  repo = process.env.GITHUB_REPOSITORY,
  workflow = "refresh-cache.yml",
  ownRunId = process.env.GITHUB_RUN_ID,
  everyMs = 60_000,
  fetchImpl = (...a) => fetch(...a),
  onWaiting,
} = {}) {
  if (!token || !repo || typeof onWaiting !== "function") return () => {};
  let done = false;
  const url = `https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs?per_page=20`;
  const check = async () => {
    if (done) return;
    try {
      const res = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!done && othersWaiting(data && data.workflow_runs, ownRunId)) {
        done = true;
        clearInterval(timer);
        onWaiting("another run is waiting (site request or fallback cron)");
      }
    } catch {}
  };
  const timer = setInterval(check, everyMs);
  if (timer && typeof timer.unref === "function") timer.unref();
  return () => {
    done = true;
    clearInterval(timer);
  };
}
