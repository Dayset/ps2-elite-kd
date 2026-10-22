// ps2-elite-kd-cache: Cloudflare Worker for the shared player cache.
//
// Imported from the deployed script (2026-10-13), bundler helpers removed,
// logic unchanged. Deploy with .github/workflows/deploy-worker.yml.
//
// Routes:
//   POST /add       queue names into the shared cache (dispatches refresh-cache.yml)
//   POST /seen      mark cached players as looked at (drives XP detail / "fresh" priority)
//   GET  /status    cached / queued per name
//   GET  /pending   names queued but not cached yet
//   GET  /runs      recent refresh-cache.yml runs (build-log page)
//   GET  /health    cron backup-timer state
//   GET  /requested (X-Proxy-Key) seen + fresh lists + fetch counts for the refresh Action
//   GET  /census/…  (X-Proxy-Key) read-only Census proxy for the refresh Actions
//                   (namespaces ps2, ps2ps4us, ps2ps4eu only)
// Cron (*/5): dispatch refresh-cache.yml when data/schedule.json says a run is
// due, or when /add names have been stuck pending; refresh-ps.yml when
// data-ps/schedule.json says the PlayStation room is due (src/room-tick.js).
//
// Bindings: KV QUEUE; secrets GH_TOKEN, CENSUS_PROXY_KEY; optional vars below.

const DEFAULTS = {
  GH_REPO: "Dayset/ps2-elite-kd",
  GH_WORKFLOW: "refresh-cache.yml",
  GH_REF: "main",
  INDEX_URL: "https://dayset.github.io/ps2-elite-kd/data/index.json",
  SCHEDULE_URL: "https://dayset.github.io/ps2-elite-kd/data/schedule.json",
  STUCK_PENDING_MINUTES: 15,
  REPENDING_GAP_MINUTES: 30,
  CENSUS_SERVICE_ID: "daysetps2legends",
  ALLOWED_ORIGINS: "https://dayset.github.io",
  MAX_NAMES_PER_REQUEST: 10,
  IP_NAMES_PER_HOUR: 20,
  GLOBAL_DISPATCHES_PER_DAY: 60,
  PENDING_TTL_SECONDS: 3 * 60 * 60,
  INDEX_TTL_SECONDS: 300,
  UPSTREAM_TIMEOUT_MS: 8e3,
  CENSUS_PROXY_TIMEOUT_MS: 85e3,
  CENSUS_PROXY_CACHE_SECONDS: 120,
  ETA_MINUTES: 5,
};
const MAX_BODY_BYTES = 4096;
const USER_AGENT = "ps2-elite-kd-cache-worker (+https://dayset.github.io/ps2-elite-kd/)";
const NAME_RE = /^(?:\[[A-Za-z0-9]{0,4}\]\s*)?([A-Za-z0-9]{3,32})$/;

function cfg(env) {
  const e = env || {};
  const num = (k) => {
    const v = Number(e[k]);
    return Number.isFinite(v) && v > 0 ? v : DEFAULTS[k];
  };
  const str = (k) => (typeof e[k] === "string" && e[k].trim() ? e[k].trim() : DEFAULTS[k]);
  return {
    repo: str("GH_REPO"),
    workflow: str("GH_WORKFLOW"),
    ref: str("GH_REF"),
    indexUrl: str("INDEX_URL"),
    scheduleUrl: str("SCHEDULE_URL"),
    stuckPendingMs: num("STUCK_PENDING_MINUTES") * 60 * 1e3,
    rependingGapMs: num("REPENDING_GAP_MINUTES") * 60 * 1e3,
    censusServiceId: str("CENSUS_SERVICE_ID"),
    allowedOrigins: str("ALLOWED_ORIGINS").split(/[\s,]+/).filter(Boolean),
    maxNames: num("MAX_NAMES_PER_REQUEST"),
    ipNamesPerHour: num("IP_NAMES_PER_HOUR"),
    globalPerDay: num("GLOBAL_DISPATCHES_PER_DAY"),
    // KV minimum expirationTtl is 60s
    pendingTtl: Math.max(60, num("PENDING_TTL_SECONDS")),
    indexTtl: num("INDEX_TTL_SECONDS"),
    timeoutMs: num("UPSTREAM_TIMEOUT_MS"),
    etaMinutes: num("ETA_MINUTES"),
    censusProxyTimeoutMs: num("CENSUS_PROXY_TIMEOUT_MS"),
    censusProxyCacheSeconds: num("CENSUS_PROXY_CACHE_SECONDS"),
  };
}

function slugKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/^\[.*?\]\s*/, "")
    .replace(/[^a-z0-9]+/g, "");
}

function parseName(raw) {
  if (typeof raw !== "string") return null;
  const m = NAME_RE.exec(raw.trim());
  return m ? m[1] : null;
}

function isAllowedOrigin(origin, c) {
  if (!origin) return false;
  if (c.allowedOrigins.includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origin);
}

function corsHeaders(request, c) {
  const origin = request.headers.get("Origin");
  const h = { Vary: "Origin" };
  if (isAllowedOrigin(origin, c)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...cors,
    },
  });
}

let indexMemo = null;
async function getCachedSlugs(c, now) {
  if (indexMemo && now - indexMemo.at < c.indexTtl * 1e3) return indexMemo.slugs;
  try {
    const res = await fetch(c.indexUrl, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      cf: { cacheTtl: c.indexTtl, cacheEverything: true },
      signal: AbortSignal.timeout(c.timeoutMs),
    });
    if (!res.ok) throw new Error(`index HTTP ${res.status}`);
    const data = await res.json();
    const slugs = new Set();
    for (const p of (data && data.players) || []) {
      if (!p) continue;
      for (const v of [p.slug, p.name, ...(Array.isArray(p.aliases) ? p.aliases : [])]) {
        const s = slugKey(v);
        if (s) slugs.add(s);
      }
    }
    indexMemo = { at: now, slugs };
    return slugs;
  } catch (e) {
    console.warn("[cache-worker] index fetch failed:", e && e.message);
    if (indexMemo) return indexMemo.slugs;
    return new Set();
  }
}

async function censusLookup(name, c) {
  const lower = name.toLowerCase();
  const url = `https://census.daybreakgames.com/s:${encodeURIComponent(c.censusServiceId)}/get/ps2:v2/character?name.first_lower=${encodeURIComponent(lower)}&c:show=character_id,name`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(c.timeoutMs),
    });
    if (!res.ok) return { status: "error" };
    const data = await res.json();
    if (!data || data.error || data.errorCode || !Array.isArray(data.character_list)) {
      return { status: "error" };
    }
    const hit =
      data.character_list.find(
        (ch) => ch && ch.name && String(ch.name.first_lower || ch.name.first || "").toLowerCase() === lower
      ) || data.character_list[0];
    if (!hit) return { status: "notFound" };
    const canonical = hit.name && hit.name.first;
    return { status: "found", name: parseName(canonical) || name };
  } catch (e) {
    return { status: "error" };
  }
}

async function dispatchWorkflow(names, env, c) {
  if (!env.GH_TOKEN) return { ok: false, reason: "no_token" };
  const url = `https://api.github.com/repos/${c.repo}/actions/workflows/${encodeURIComponent(c.workflow)}/dispatches`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: c.ref, inputs: { names: names.join(" ") } }),
      signal: AbortSignal.timeout(c.timeoutMs),
    });
    if (res.status === 204 || res.ok) return { ok: true };
    console.error("[cache-worker] dispatch failed: HTTP", res.status);
    return { ok: false, reason: `http_${res.status}` };
  } catch (e) {
    console.error("[cache-worker] dispatch error:", e && e.name);
    return { ok: false, reason: "network" };
  }
}

const BACKUP_KEY = "backup:last";
const BACKUP_CRON = "*/5 * * * *";
const BACKUP_GAP_MS = 60 * 1e3;
const ACTIVE_STATUSES = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);

function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GH_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": USER_AGENT,
  };
}

// KV budget (free plan: 1,000 writes and 1,000 lists a day). The cron runs 288
// times a day, so it must not list or write on every tick:
//  - the stuck-pending scan (one KV list + the index download) runs at most
//    once per REPENDING_GAP_MINUTES; its time is kept in backup:last;
//  - backup:last is rewritten only when the outcome changes, after a pending
//    scan, or once BACKUP_WRITE_MAX_GAP_MS has passed.
const BACKUP_WRITE_MAX_GAP_MS = 60 * 60 * 1e3;
// Visitor fallback only kicks in when the log is older than this (cron dead).
const VISITOR_TICK_STALE_MS = BACKUP_WRITE_MAX_GAP_MS + 10 * 60 * 1e3;

/** Same outcome as the previous log entry (nothing new worth a KV write)? */
function sameOutcome(prev, result) {
  if (!prev) return false;
  return prev.decision === result.decision && (prev.reason || "") === (result.reason || "") && (prev.runId || null) === (result.runId || null);
}

/** Write backup:last this tick? */
function shouldWriteBackup(prev, result, now) {
  if (!prev || result.decision === "dispatched" || !sameOutcome(prev, result)) return true;
  if ((result.pendingCheckAt || 0) !== (prev.pendingCheckAt || 0)) return true;
  const at = Date.parse(prev.at);
  return !Number.isFinite(at) || now - at >= BACKUP_WRITE_MAX_GAP_MS;
}

async function dueWork(env, c, now = Date.now(), prev = null, mark = {}) {
  try {
    if (env.QUEUE) {
      const lastDispatch = Number(await env.QUEUE.get(REPENDING_KEY)) || 0;
      const lastScan = (prev && Number(prev.pendingCheckAt)) || 0;
      if (now - Math.max(lastDispatch, lastScan) >= c.rependingGapMs) {
        mark.pendingCheckAt = now;
        const stuck = (await listPending(env, c, now))
          .filter((p) => p.queuedAtMs && now - p.queuedAtMs >= c.stuckPendingMs)
          .map((p) => p.name)
          .slice(0, 40);
        if (stuck.length) return { due: true, names: stuck, reason: "stuck_pending" };
      }
    }
  } catch {}
  try {
    const u = new URL(c.scheduleUrl);
    u.searchParams.set("t", String(Math.floor(now / 6e4)));
    const res = await fetch(u.toString(), {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      cf: { cacheTtl: 60, cacheEverything: true },
      signal: AbortSignal.timeout(c.timeoutMs),
    });
    if (!res.ok) return { due: false, names: [], reason: `schedule_http_${res.status}` };
    const sched = await res.json();
    const at = sched && sched.nextDueAt ? Date.parse(sched.nextDueAt) : NaN;
    if (!Number.isFinite(at)) return { due: false, names: [], reason: "idle" };
    if (at > now) return { due: false, names: [], reason: "not_due" };
    return { due: true, names: [], reason: String((sched && sched.reason) || "due").slice(0, 40) };
  } catch {
    return { due: false, names: [], reason: "schedule_unreachable" };
  }
}

const REPENDING_KEY = "backup:repending";

async function backupCheck(env, now = Date.now(), via = "cron") {
  const c = cfg(env);
  const prev = await readBackup(env);
  const mark = {};
  let result;
  try {
    const work = env.GH_TOKEN ? await dueWork(env, c, now, prev, mark) : null;
    if (!env.GH_TOKEN) {
      result = { decision: "error", reason: "no_token" };
    } else if (!work.due) {
      result = { decision: "skipped-idle", reason: work.reason };
    } else {
      const url = `https://api.github.com/repos/${c.repo}/actions/workflows/${encodeURIComponent(c.workflow)}/runs?per_page=20`;
      const res = await fetch(url, { headers: ghHeaders(env), signal: AbortSignal.timeout(c.timeoutMs) });
      if (!res.ok) {
        console.error("[cache-worker] backup: list runs HTTP", res.status);
        result = { decision: "error", reason: `list_http_${res.status}` };
      } else {
        const data = await res.json();
        const runs = (data && Array.isArray(data.workflow_runs) && data.workflow_runs) || [];
        const active = runs.find((r) => r && ACTIVE_STATUSES.has(r.status));
        const recent = runs.find(
          (r) => r && r.status === "completed" && now - Date.parse(r.updated_at || r.created_at) < BACKUP_GAP_MS
        );
        if (active) {
          result = { decision: "skipped-running", runId: active.id, runCreatedAt: active.created_at, event: active.event };
        } else if (recent) {
          result = { decision: "skipped-recent", runId: recent.id, runCreatedAt: recent.created_at, runEndedAt: recent.updated_at, event: recent.event };
        } else {
          const d = await dispatchWorkflow(work.names, env, c);
          result = d.ok
            ? { decision: "dispatched", reason: work.reason, ...(work.names.length ? { names: work.names.length } : {}) }
            : { decision: "error", reason: `dispatch_${d.reason}` };
          if (d.ok && work.names.length && env.QUEUE) {
            await env.QUEUE.put(REPENDING_KEY, String(now), { expirationTtl: 86400 }).catch(() => {});
          }
        }
      }
    }
  } catch (e) {
    console.error("[cache-worker] backup error:", e && e.name);
    result = { decision: "error", reason: "network" };
  }
  const pendingCheckAt = mark.pendingCheckAt || (prev && prev.pendingCheckAt) || 0;
  result = { at: new Date(now).toISOString(), via, ...result, ...(pendingCheckAt ? { pendingCheckAt } : {}) };
  if (env.QUEUE && shouldWriteBackup(prev, result, now)) {
    try {
      const history = [
        { at: result.at, via, decision: result.decision, ...(result.runId ? { runId: result.runId } : {}), ...(result.reason ? { reason: result.reason } : {}) },
        ...((prev && Array.isArray(prev.history) && prev.history) || []),
      ].slice(0, 12);
      await env.QUEUE.put(BACKUP_KEY, JSON.stringify({ ...result, history }), { expirationTtl: 7 * 86400 });
    } catch {}
  }
  console.log("[cache-worker] backup check:", result.at, result.decision, result.runId || "");
  return result;
}

let lastVisitorTick = 0;
async function maybeVisitorTick(env, now = Date.now()) {
  if (now - lastVisitorTick < 6e4) return null;
  lastVisitorTick = now;
  const prev = await readBackup(env);
  if (prev && now - Date.parse(prev.at) < VISITOR_TICK_STALE_MS) return null;
  const r = await backupCheck(env, now, "visitor");
  return r;
}

let runsMemo = null;
async function handleRuns(env, c, cors, now) {
  if (runsMemo && now - runsMemo.at < 2e4) return json(runsMemo.body, 200, cors);
  if (!env.GH_TOKEN) return json({ error: "not_configured" }, 503, cors);
  try {
    const url = `https://api.github.com/repos/${c.repo}/actions/workflows/${encodeURIComponent(c.workflow)}/runs?per_page=10`;
    const res = await fetch(url, { headers: ghHeaders(env), signal: AbortSignal.timeout(c.timeoutMs) });
    if (!res.ok) {
      console.error("[cache-worker] runs HTTP", res.status);
      return json({ error: "upstream" }, 502, cors);
    }
    const data = await res.json();
    const runs = ((data && data.workflow_runs) || []).map((r) => ({
      id: r.id,
      event: r.event,
      status: r.status,
      conclusion: r.conclusion,
      created_at: r.created_at,
      run_started_at: r.run_started_at,
      updated_at: r.updated_at,
    }));
    const body = { workflow_runs: runs };
    runsMemo = { at: now, body };
    return json(body, 200, cors);
  } catch (e) {
    console.error("[cache-worker] runs error:", e && e.name);
    return json({ error: "upstream" }, 502, cors);
  }
}

async function readBackup(env) {
  if (!env.QUEUE) return null;
  try {
    const v = await env.QUEUE.get(BACKUP_KEY);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

async function kvGetInt(kv, key) {
  const v = await kv.get(key);
  const n = parseInt(v || "0", 10);
  return Number.isFinite(n) ? n : 0;
}

function hourBucket(now) {
  return Math.floor(now / 36e5);
}

function dayBucket(now) {
  return new Date(now).toISOString().slice(0, 10);
}

async function handleAdd(request, env, c, cors, now) {
  if (!env.QUEUE) return json({ error: "not_configured" }, 503, cors);
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > MAX_BODY_BYTES) return json({ error: "body_too_large" }, 413, cors);
  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json({ error: "body_too_large" }, 413, cors);
    body = JSON.parse(text);
  } catch {
    return json({ error: "invalid_json" }, 400, cors);
  }
  if (!body || !Array.isArray(body.names)) {
    return json({ error: 'expected {"names":[...]}' }, 400, cors);
  }
  if (body.names.length === 0) return json({ error: "no_names" }, 400, cors);
  if (body.names.length > c.maxNames) {
    return json({ error: `max ${c.maxNames} names per request` }, 400, cors);
  }
  const out = {
    queued: [],
    alreadyCached: [],
    alreadyQueued: [],
    notFound: [],
    invalid: [],
    unverified: [],
    // Census unreachable — not queued, safe to retry later
    rateLimited: false,
    etaMinutes: c.etaMinutes,
  };
  const seen = new Set();
  const candidates = [];
  for (const raw of body.names) {
    const name = parseName(raw);
    if (!name) {
      out.invalid.push(typeof raw === "string" ? raw.slice(0, 40) : String(raw).slice(0, 40));
      continue;
    }
    const slug = slugKey(name);
    if (seen.has(slug)) continue;
    seen.add(slug);
    candidates.push({ name, slug });
  }
  const cached = candidates.length ? await getCachedSlugs(c, now) : new Set();
  let remaining = [];
  for (const cand of candidates) {
    if (cached.has(cand.slug)) out.alreadyCached.push(cand.name);
    else remaining.push(cand);
  }
  const pendingFlags = await Promise.all(remaining.map((x) => env.QUEUE.get(`pending:${x.slug}`)));
  remaining = remaining.filter((x, i) => {
    if (pendingFlags[i] != null) {
      out.alreadyQueued.push(x.name);
      return false;
    }
    return true;
  });
  // Popularity tally: the accounts this request fetched that were already
  // settled (cached / queued), plus the verified ones below. Rate-limited
  // exits skip the bump, so rejected batches can't inflate the counts.
  const slugByName = new Map(candidates.map((x) => [x.name, x.slug]));
  const settledSlugs = () => [...out.alreadyCached, ...out.alreadyQueued].map((n) => slugByName.get(n)).filter(Boolean);
  if (!remaining.length) { await bumpCounts(env, settledSlugs(), now); return json(out, 200, cors); }
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipKey = `rl:ip:${ip}:${hourBucket(now)}`;
  const used = await kvGetInt(env.QUEUE, ipKey);
  const allowance = Math.max(0, c.ipNamesPerHour - used);
  if (allowance < remaining.length) {
    out.rateLimited = true;
    remaining = remaining.slice(0, allowance);
  }
  if (!remaining.length) return json(out, 429, cors);
  const dayKey = `rl:global:${dayBucket(now)}`;
  const dispatchesToday = await kvGetInt(env.QUEUE, dayKey);
  if (dispatchesToday >= c.globalPerDay) {
    out.rateLimited = true;
    return json(out, 429, cors);
  }
  await env.QUEUE.put(ipKey, String(used + remaining.length), { expirationTtl: 3600 + 60 });
  const looked = await Promise.all(remaining.map((x) => censusLookup(x.name, c)));
  const verified = [];
  remaining.forEach((x, i) => {
    const r = looked[i];
    if (r.status === "found") verified.push({ name: r.name, slug: x.slug });
    else if (r.status === "notFound") out.notFound.push(x.name);
    else out.unverified.push(x.name);
  });
  if (!verified.length) { await bumpCounts(env, settledSlugs(), now); return json(out, 200, cors); }
  await bumpCounts(env, [...settledSlugs(), ...verified.map((v) => v.slug)], now);
  const names = verified.map((v) => v.name);
  const d = await dispatchWorkflow(names, env, c);
  if (!d.ok) {
    out.error = "queue_unavailable";
    return json(out, 503, cors);
  }
  await Promise.all([
    env.QUEUE.put(dayKey, String(dispatchesToday + 1), { expirationTtl: 2 * 86400 }),
    ...verified.map((v) =>
      env.QUEUE.put(`pending:${v.slug}`, String(now), {
        expirationTtl: c.pendingTtl,
        // name + time only (no IP), so /pending can list without extra reads
        metadata: { name: v.name, at: now },
      })
    ),
  ]);
  out.queued = names;
  return json(out, 202, cors);
}

async function handleStatus(url, env, c, cors, now) {
  const rawList = (url.searchParams.get("names") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!rawList.length) return json({ error: "no_names" }, 400, cors);
  if (rawList.length > c.maxNames) {
    return json({ error: `max ${c.maxNames} names per request` }, 400, cors);
  }
  const cached = await getCachedSlugs(c, now);
  const status = {};
  const checks = [];
  for (const raw of rawList) {
    const name = parseName(raw);
    if (!name) continue;
    const slug = slugKey(name);
    if (slug in status) continue;
    if (cached.has(slug)) {
      status[slug] = "cached";
    } else if (env.QUEUE) {
      status[slug] = "unknown";
      checks.push(
        env.QUEUE.get(`pending:${slug}`).then((v) => {
          if (v != null) status[slug] = "queued";
        })
      );
    } else {
      status[slug] = "unknown";
    }
  }
  await Promise.all(checks);
  return json({ status }, 200, cors);
}

async function listPending(env, c, now) {
  if (!env.QUEUE) return [];
  const cached = await getCachedSlugs(c, now);
  const pending = [];
  let cursor;
  for (let page = 0; page < 5; page++) {
    const res = await env.QUEUE.list({ prefix: "pending:", cursor, limit: 1e3 });
    for (const k of (res && res.keys) || []) {
      const slug = k.name.slice("pending:".length);
      if (!slug || cached.has(slug)) continue;
      let meta = k.metadata && typeof k.metadata === "object" ? k.metadata : null;
      let at = meta && Number(meta.at);
      if (!Number.isFinite(at) || !at) {
        const v = await env.QUEUE.get(k.name);
        at = Number(v) || null;
      }
      const name = meta && typeof meta.name === "string" && parseName(meta.name) ? parseName(meta.name) : slug;
      pending.push({ name, slug, queuedAtMs: at || null });
    }
    if (!res || res.list_complete || !res.cursor) break;
    cursor = res.cursor;
  }
  return pending;
}

async function handlePending(env, c, cors, now) {
  if (!env.QUEUE) return json({ pending: [] }, 200, cors);
  const pending = (await listPending(env, c, now)).map((p) => ({
    name: p.name,
    slug: p.slug,
    queuedAt: p.queuedAtMs ? new Date(p.queuedAtMs).toISOString() : null,
  }));
  pending.sort((a, b) => String(b.queuedAt || "").localeCompare(String(a.queuedAt || "")));
  return json({ pending, ttlMinutes: Math.round(c.pendingTtl / 60) }, 200, cors);
}

const REQ_PREFIX = "req:";
const REQ_REWRITE_MS = 7 * 24 * 3600 * 1e3;
const REQ_TTL_SECONDS = 45 * 24 * 3600;
const SEEN_IP_NAMES_PER_MIN = 30;
let seenIpMemo = new Map();
const FRESH_KEY = "fresh:list";
const FRESH_MAX = 50;
const FRESH_TTL_MS = 24 * 3600 * 1e3;
const FRESH_REWRITE_MS = 10 * 60 * 1e3;

function mergeFresh(list, slugs, now) {
  const cur = (Array.isArray(list) ? list : []).filter((e) => e && typeof e.slug === "string" && +e.at > 0 && now - +e.at < FRESH_TTL_MS);
  let changed = cur.length !== (Array.isArray(list) ? list.length : 0);
  const bySlug = new Map(cur.map((e) => [e.slug, +e.at]));
  for (const slug of slugs) {
    const at = bySlug.get(slug);
    if (at && now - at < FRESH_REWRITE_MS) continue;
    bySlug.set(slug, now);
    changed = true;
  }
  const out = [...bySlug].map(([slug, at]) => ({ slug, at })).sort((a, b) => b.at - a.at);
  if (out.length > FRESH_MAX) changed = true;
  return { list: out.slice(0, FRESH_MAX), changed };
}

async function readFresh(env, now) {
  let list = [];
  try {
    const raw = await env.QUEUE.get(FRESH_KEY);
    const d = raw ? JSON.parse(raw) : null;
    if (d && Array.isArray(d.players)) list = d.players;
  } catch {
    list = [];
  }
  return mergeFresh(list, [], now).list;
}

async function markFresh(env, slugs, now) {
  if (!slugs.length) return 0;
  let list = [];
  try {
    const raw = await env.QUEUE.get(FRESH_KEY);
    const d = raw ? JSON.parse(raw) : null;
    if (d && Array.isArray(d.players)) list = d.players;
  } catch {
    list = [];
  }
  const { list: out, changed } = mergeFresh(list, slugs, now);
  if (!changed) return 0;
  await env.QUEUE.put(FRESH_KEY, JSON.stringify({ players: out }), { expirationTtl: Math.ceil(FRESH_TTL_MS / 1e3) });
  return slugs.filter((s) => out.some((e) => e.slug === s && e.at === now)).length;
}

/* Fetch popularity counts (owner 2026-10-20, "just a fun stat"): /seen and
 * /add batches bump an all-time per-slug tally kept in ONE KV key, surfaced
 * via /requested so the refresh pipeline can publish data/fetch-counts.json
 * (build-log shows the top line). KV writes are the scarce resource (free
 * plan: 1,000/day), so the map is persisted at most once per
 * COUNTS_FLUSH_MS — a batch inside the window reads the map but skips the
 * write and its bumps are dropped. The ranking only needs to be right
 * within a few percent. Counting must never break the request it rides
 * on: every failure is swallowed. */
const COUNTS_KEY = "counts:map";
const COUNTS_FLUSH_MS = 10 * 60 * 1e3;

async function readCounts(env) {
  try {
    const raw = await env.QUEUE.get(COUNTS_KEY);
    const d = raw ? JSON.parse(raw) : null;
    if (d && d.counts && typeof d.counts === "object") return d;
  } catch {}
  return null;
}

async function bumpCounts(env, slugs, now) {
  if (!env.QUEUE || !slugs || !slugs.length) return;
  try {
    let d = await readCounts(env);
    if (!d) d = { since: now, flushedAt: 0, counts: {} };
    for (const s of slugs) d.counts[s] = (d.counts[s] || 0) + 1;
    if (now - (d.flushedAt || 0) < COUNTS_FLUSH_MS) return; // coalesced: these bumps are dropped
    d.flushedAt = now;
    await env.QUEUE.put(COUNTS_KEY, JSON.stringify(d));
  } catch {}
}

async function handleSeen(request, env, c, cors, now) {
  if (!env.QUEUE) return json({ error: "not_configured" }, 503, cors);
  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json({ error: "body_too_large" }, 413, cors);
    body = JSON.parse(text);
  } catch {
    return json({ error: "invalid_json" }, 400, cors);
  }
  if (!body || !Array.isArray(body.names) || !body.names.length) return json({ error: 'expected {"names":[...]}' }, 400, cors);
  if (body.names.length > c.maxNames) return json({ error: `max ${c.maxNames} names per request` }, 400, cors);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const minute = Math.floor(now / 6e4);
  const m = seenIpMemo.get(ip);
  const used = m && m.minute === minute ? m.n : 0;
  if (used >= SEEN_IP_NAMES_PER_MIN) return json({ marked: 0, rateLimited: true }, 429, cors);
  if (seenIpMemo.size > 5e3) seenIpMemo = new Map();
  const cached = await getCachedSlugs(c, now);
  const slugs = [];
  for (const raw of body.names) {
    const name = parseName(raw);
    const slug = name && slugKey(name);
    if (slug && cached.has(slug) && !slugs.includes(slug)) slugs.push(slug);
  }
  const take = slugs.slice(0, SEEN_IP_NAMES_PER_MIN - used);
  seenIpMemo.set(ip, { minute, n: used + take.length });
  await bumpCounts(env, take, now); // popularity tally (coalesced, never throws)
  let marked = 0;
  await Promise.all(
    take.map(async (slug) => {
      const prev = await env.QUEUE.getWithMetadata(REQ_PREFIX + slug);
      const at = prev && prev.metadata && +prev.metadata.at;
      if (at && now - at < REQ_REWRITE_MS) return;
      await env.QUEUE.put(REQ_PREFIX + slug, "1", { expirationTtl: REQ_TTL_SECONDS, metadata: { at: now } });
      marked++;
    })
  );
  if (body.fresh === true) {
    const fresh = await markFresh(env, take, now);
    return json({ marked, known: take.length, fresh }, 200, cors);
  }
  return json({ marked, known: take.length }, 200, cors);
}

async function handleRequested(request, env) {
  const hdr = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const key = env && typeof env.CENSUS_PROXY_KEY === "string" ? env.CENSUS_PROXY_KEY : "";
  if (!key) return new Response(JSON.stringify({ error: "disabled" }), { status: 503, headers: hdr });
  if (!safeEqual(request.headers.get("X-Proxy-Key") || "", key)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: hdr });
  }
  if (!env.QUEUE) return new Response(JSON.stringify({ error: "not_configured" }), { status: 503, headers: hdr });
  const players = [];
  let cursor;
  for (let page = 0; page < 20; page++) {
    const r = await env.QUEUE.list({ prefix: REQ_PREFIX, cursor });
    for (const k of r.keys || []) {
      players.push({ slug: k.name.slice(REQ_PREFIX.length), at: (k.metadata && +k.metadata.at) || null });
    }
    if (r.list_complete || !r.cursor) break;
    cursor = r.cursor;
  }
  const fresh = await readFresh(env, Date.now());
  const cd = await readCounts(env);
  return new Response(JSON.stringify({ players, fresh, counts: cd ? cd.counts || {} : {}, countsSince: cd ? cd.since || null : null }), { status: 200, headers: hdr });
}

const CENSUS_ORIGIN = "https://census.daybreakgames.com";
const CENSUS_PROXY_PREFIX = "/census";
const CENSUS_PROXY_MAX_CACHE_BYTES = 2 * 1024 * 1024;

// PC (ps2) plus the two PlayStation rooms' servers (#55: Genudine, Ceres).
// Same list as rooms.mjs ALL_NAMESPACES (test/worker-census-ns.test.mjs).
export const CENSUS_NAMESPACES = ["ps2", "ps2ps4us", "ps2ps4eu"];

export function censusTarget(url, serviceId) {
  const u = url instanceof URL ? url : new URL(url);
  if (!u.pathname.startsWith(CENSUS_PROXY_PREFIX + "/")) return null;
  const rest = u.pathname.slice(CENSUS_PROXY_PREFIX.length);
  const m = /^\/s:([A-Za-z0-9_-]+)\/get\/([a-z0-9]+):v2\/([a-z_]+)\/?$/.exec(rest);
  if (!m || m[1] !== serviceId || !CENSUS_NAMESPACES.includes(m[2])) return null;
  if (u.search.length > 4e3) return null;
  return `${CENSUS_ORIGIN}/s:${serviceId}/get/${m[2]}:v2/${m[3]}${u.search}`;
}

function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

function cacheableCensusBody(status, text) {
  if (status !== 200 || !text || text.length > CENSUS_PROXY_MAX_CACHE_BYTES) return false;
  try {
    const d = JSON.parse(text);
    if (!d || typeof d !== "object" || d.error || d.errorCode) return false;
    return Object.keys(d).some((k) => k.endsWith("_list") && Array.isArray(d[k]) && d[k].length > 0);
  } catch {
    return false;
  }
}

async function handleCensusProxy(request, env, c) {
  const hdr = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const reply = (body, status, extra) => new Response(JSON.stringify(body), { status, headers: { ...hdr, ...(extra || {}) } });
  if (request.method !== "GET") return reply({ error: "method_not_allowed" }, 405, { Allow: "GET" });
  const key = env && typeof env.CENSUS_PROXY_KEY === "string" ? env.CENSUS_PROXY_KEY : "";
  if (!key) return reply({ error: "proxy_disabled" }, 503);
  if (!safeEqual(request.headers.get("X-Proxy-Key") || "", key)) return reply({ error: "unauthorized" }, 401);
  const target = censusTarget(new URL(request.url), c.censusServiceId);
  if (!target) return reply({ error: "census_path_not_allowed" }, 400);
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  const cacheKey = new Request(target, { method: "GET" });
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) {
        return new Response(hit.body, { status: 200, headers: { ...hdr, "X-Census-Proxy": "hit" } });
      }
    } catch {}
  }
  let res;
  try {
    res = await fetch(target, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(c.censusProxyTimeoutMs),
    });
  } catch (e) {
    const timeout = e && (e.name === "TimeoutError" || e.name === "AbortError");
    return reply({ error: timeout ? "census_timeout" : "census_unreachable" }, timeout ? 504 : 502);
  }
  const text = await res.text();
  const out = new Response(text, {
    status: res.status,
    headers: { ...hdr, "Content-Type": res.headers.get("Content-Type") || hdr["Content-Type"], "X-Census-Proxy": "miss" },
  });
  if (cache && c.censusProxyCacheSeconds > 0 && cacheableCensusBody(res.status, text)) {
    try {
      await cache.put(
        cacheKey,
        new Response(text, {
          status: 200,
          headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${c.censusProxyCacheSeconds}` },
        })
      );
    } catch {}
  }
  return out;
}

import { KillMonitor, monitorRoute, monitorTick } from "./monitor.js";
import { oracleTick } from "./oracle-tick.js";
import { roomTick } from "./room-tick.js";
export { KillMonitor };

export default {
  async scheduled(event, env, ctx) {
    const t = event && event.scheduledTime ? event.scheduledTime : Date.now();
    // PlayStation room (#55): its own workflow + data-ps/schedule.json; never throws, no KV.
    ctx.waitUntil(Promise.all([backupCheck(env, t), monitorTick(env), oracleTick(env, cfg(env)), roomTick(env, cfg(env), t)]));
  },
  async fetch(request, env, ctx) {
    const c = cfg(env);
    const cors = corsHeaders(request, c);
    const url = new URL(request.url);
    if (url.pathname === "/monitor/status" || url.pathname === "/monitor/export") {
      if (request.method !== "GET") return new Response(null, { status: 405 });
      return await monitorRoute(request, env, url);
    }
    if (url.pathname === "/requested") {
      if (request.method !== "GET") return new Response(null, { status: 405 });
      return await handleRequested(request, env);
    }
    if (url.pathname === CENSUS_PROXY_PREFIX || url.pathname.startsWith(CENSUS_PROXY_PREFIX + "/")) {
      try {
        return await handleCensusProxy(request, env, c);
      } catch (e) {
        console.error("[cache-worker] census proxy:", e && e.message);
        return new Response(JSON.stringify({ error: "internal" }), { status: 500, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
      }
    }
    if (ctx && typeof ctx.waitUntil === "function" && request.method !== "OPTIONS") {
      ctx.waitUntil(maybeVisitorTick(env));
    }
    const now = Date.now();
    const origin = request.headers.get("Origin");
    if (request.method === "OPTIONS") {
      if (!isAllowedOrigin(origin, c)) return new Response(null, { status: 403, headers: { Vary: "Origin" } });
      return new Response(null, { status: 204, headers: cors });
    }
    if (origin && !isAllowedOrigin(origin, c)) {
      return json({ error: "origin_not_allowed" }, 403, {});
    }
    try {
      if (url.pathname === "/health" && request.method === "GET") {
        return json({ ok: true, backupTimer: { cron: BACKUP_CRON, last: await readBackup(env) } }, 200, cors);
      }
      if (url.pathname === "/add") {
        if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);
        return await handleAdd(request, env, c, cors, now);
      }
      if (url.pathname === "/seen") {
        if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);
        return await handleSeen(request, env, c, cors, now);
      }
      if (url.pathname === "/status") {
        if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, cors);
        return await handleStatus(url, env, c, cors, now);
      }
      if (url.pathname === "/runs") {
        if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, cors);
        return await handleRuns(env, c, cors, now);
      }
      if (url.pathname === "/pending") {
        if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, cors);
        return await handlePending(env, c, cors, now);
      }
      return json({ error: "not_found" }, 404, cors);
    } catch (e) {
      console.error("[cache-worker] unhandled:", e && e.message);
      return json({ error: "internal" }, 500, cors);
    }
  },
};
