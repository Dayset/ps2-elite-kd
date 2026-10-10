/**
 * Census-based discovery of players who actually play (t291u).
 *
 * 1. Login sweep: Census `character` rows with times.last_login after a cursor,
 *    sorted by last_login (keyset paging, 1000 per call). The ps2:v2 namespace
 *    is PC only. First sweep looks back 7 days; then one sweep a day from where
 *    the last one ended (with a small overlap).
 * 2. Cheap pre-filter: skip cached names, failed names, implausible names and
 *    characters with < MIN_MINUTES_PLAYED lifetime minutes.
 * 3. Fight filter: `characters_stat_history` kills + deaths for 100 ids per
 *    call; fights in the last week = day buckets d01..d07 (d01 = the day of the
 *    character's last save). Only >= MIN_WEEK_FIGHTS qualify; new accounts too.
 * 4. Queue: new accounts (created < NEW_ACCOUNT_DAYS) that play first, then the
 *    most active. Entries expire after QUEUE_KEEP_MS (re-found if still playing).
 *
 * Cached players seen in the sweep only get their last-activity time updated
 * (index `last`), which drives the refresh tiers below. No Honu calls here.
 */

export const DAY_S = 24 * 3600;
export const DAY_MS = DAY_S * 1000;
export const MIN_WEEK_FIGHTS = 100;
export const NEW_ACCOUNT_DAYS = 91;
export const MIN_MINUTES_PLAYED = 30;
export const SWEEP_PAGE = 1000;
export const STAT_BATCH = 100;
export const FIRST_LOOKBACK_S = 7 * DAY_S;
export const SWEEP_EVERY_MS = 20 * 3600 * 1000;
export const SWEEP_OVERLAP_S = 2 * 3600;
export const QUEUE_KEEP_MS = 14 * DAY_MS;
export const QUEUE_MAX = 10000;
/** Cap steps: stay at a step until caught up, then move to the next. */
export const CAP_STEPS = [3000, 6000, 9000, 12000];

/* ------------------------------------------------------------ refresh tiers */

export const TIER_WEEK_MS = 7 * DAY_MS;
export const TIER_MONTH_MS = 30 * DAY_MS;
export const TIER_YEAR_MS = 365 * DAY_MS;

/**
 * How often a cached player is refreshed, from their last activity (ms):
 * played this week → weekly; this month → every 2 weeks; 1–12 months → monthly;
 * 🪦 over a year → never (Infinity; only a user lookup / Fetch fresh).
 * Unknown activity → weekly (old behaviour).
 */
export function refreshIntervalMs(lastActiveMs, now = Date.now()) {
  const last = +lastActiveMs || 0;
  if (!last) return 7 * DAY_MS;
  const idle = now - last;
  if (idle <= TIER_WEEK_MS) return 7 * DAY_MS;
  if (idle <= TIER_MONTH_MS) return 14 * DAY_MS;
  if (idle <= TIER_YEAR_MS) return 30 * DAY_MS;
  return Infinity;
}

export function tierName(lastActiveMs, now = Date.now()) {
  const ms = refreshIntervalMs(lastActiveMs, now);
  return ms === Infinity ? "never" : ms === 7 * DAY_MS ? "weekly" : ms === 14 * DAY_MS ? "2 weeks" : "monthly";
}

/** Index entry → last activity in ms (index `last` is UNIX seconds). */
export function lastActiveMs(p) {
  const s = +(p && p.last);
  return Number.isFinite(s) && s > 0 ? s * 1000 : 0;
}

/** 🪦: known activity, older than a year. */
export function isDormant(p, now = Date.now()) {
  return refreshIntervalMs(lastActiveMs(p), now) === Infinity;
}

/* ------------------------------------------------------------------- state */

export function emptyDiscovery(now = Date.now()) {
  return {
    cap: CAP_STEPS[0],
    sweep: { cursor: null, until: null, startedAt: null, lastDoneAt: null, nextFrom: null },
    queue: [],
    totals: { swept: 0, prefiltered: 0, checked: 0, qualified: 0, newPlaying: 0 },
    lastSweep: null,
    updatedAt: new Date(now).toISOString(),
  };
}

export function normalizeDiscovery(d, now = Date.now()) {
  const base = emptyDiscovery(now);
  if (!d || typeof d !== "object") return base;
  return {
    ...base,
    ...d,
    sweep: { ...base.sweep, ...(d.sweep || {}) },
    queue: Array.isArray(d.queue) ? d.queue.filter((q) => q && q.name && q.cid) : [],
    totals: { ...base.totals, ...(d.totals || {}) },
  };
}

/** Is a new sweep due (none running, last one ended >= SWEEP_EVERY_MS ago)? */
export function sweepDue(d, now = Date.now()) {
  if (d.sweep && d.sweep.cursor != null) return true; // one in progress
  const done = Date.parse((d.sweep && d.sweep.lastDoneAt) || "") || 0;
  return now - done >= SWEEP_EVERY_MS;
}

/** When the next sweep is due (ms); now if one is in progress. */
export function sweepDueAt(d, now = Date.now()) {
  if (d.sweep && d.sweep.cursor != null) return now;
  const done = Date.parse((d.sweep && d.sweep.lastDoneAt) || "") || 0;
  return done ? done + SWEEP_EVERY_MS : now;
}

/* ------------------------------------------------------------- pure pieces */

const sec = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Census character row → { cid, name, slug, created, last, minutes } or null. */
export function sweepRow(c) {
  if (!c || !/^\d{10,}$/.test(String(c.character_id || ""))) return null;
  const n = c.name || {};
  const name = String(n.first || n.first_lower || "").trim();
  if (!/^[A-Za-z0-9]{1,32}$/.test(name)) return null;
  const t = c.times || {};
  return {
    cid: String(c.character_id),
    name,
    slug: name.toLowerCase(),
    created: sec(t.creation),
    last: sec(t.last_login),
    minutes: sec(t.minutes_played),
  };
}

/**
 * Which swept rows need a fight check. `known` = cached slugs; `skip(slug)` =
 * names discovery must not retry (failed / not found). Rows already queued are
 * re-checked (fresh fight counts) but not duplicated.
 */
export function prefilter(rows, known, skip = () => false) {
  const out = [];
  const seen = new Set();
  for (const r of rows) {
    if (!r || seen.has(r.cid)) continue;
    seen.add(r.cid);
    if (known.has(r.slug) || skip(r.slug)) continue;
    if (r.minutes < MIN_MINUTES_PLAYED) continue;
    out.push(r);
  }
  return out;
}

/** characters_stat_history rows (kills/deaths, day buckets) → Map cid → fights in d01..d07. */
export function weekFights(list) {
  const m = new Map();
  for (const r of list || []) {
    if (!r || (r.stat_name !== "kills" && r.stat_name !== "deaths")) continue;
    const d = r.day || {};
    let s = 0;
    for (let i = 1; i <= 7; i++) s += +d[`d0${i}`] || 0;
    const k = String(r.character_id);
    m.set(k, (m.get(k) || 0) + s);
  }
  return m;
}

export function isNewAccount(createdSec, now = Date.now()) {
  return !!createdSec && now - createdSec * 1000 <= NEW_ACCOUNT_DAYS * DAY_MS;
}

/** Queue order: new-and-playing first, then most fights this week, then name. */
export function rankQueue(queue, now = Date.now()) {
  return queue.slice().sort((a, b) =>
    (isNewAccount(b.created, now) ? 1 : 0) - (isNewAccount(a.created, now) ? 1 : 0) ||
    (b.fights || 0) - (a.fights || 0) ||
    String(a.name).localeCompare(String(b.name)));
}

/** Merge qualified rows into the queue (dedupe by cid, drop known + expired). */
export function mergeQueue(queue, qualified, known, now = Date.now()) {
  const by = new Map();
  for (const q of queue || []) {
    if (!q || known.has(String(q.name).toLowerCase())) continue;
    if (now - (+q.seen || 0) > QUEUE_KEEP_MS) continue;
    by.set(q.cid, q);
  }
  for (const r of qualified || []) {
    if (known.has(r.slug)) continue;
    by.set(r.cid, { cid: r.cid, name: r.name, fights: r.fights, created: r.created, last: r.last, seen: now });
  }
  return rankQueue([...by.values()], now).slice(0, QUEUE_MAX);
}

/**
 * Effective cap. Stays at the current step until caught up (index reached the
 * step, format-sync backlog empty, due refreshes fit in one run), then the
 * next step. Never goes down.
 */
export function nextCap({ cap = CAP_STEPS[0], indexSize = 0, backlogLeft = 0, dueLeft = 0, perRun = 30, steps = CAP_STEPS } = {}) {
  let c = Math.max(steps[0], +cap || 0);
  const i = steps.indexOf(c);
  const caughtUp = indexSize >= c && backlogLeft === 0 && dueLeft <= perRun;
  if (caughtUp && i >= 0 && i < steps.length - 1) c = steps[i + 1];
  return c;
}

/* ------------------------------------------------------------- the sweep */

/**
 * One budget-limited slice of the sweep (resumable across runs).
 * @param d        normalized discovery state (mutated)
 * @param opts.base     Census base URL (".../get/ps2:v2/")
 * @param opts.getJson  (url) => json (Census, paced by the caller)
 * @param opts.known    Set of cached slugs
 * @param opts.skip     (slug) => true to never try that name
 * @param opts.until    stop starting new Census calls after this time (ms)
 * @param opts.onCached (slug, lastLoginSec) for cached players seen logging in
 * @returns {{ calls, swept, prefiltered, checked, qualified, newPlaying, done }}
 */
export async function sweepSlice(d, { base, getJson, known, skip = () => false, until, onCached = () => {}, now = Date.now(), log = () => {} }) {
  const out = { calls: 0, swept: 0, prefiltered: 0, checked: 0, qualified: 0, newPlaying: 0, done: false };
  const sw = d.sweep;
  if (sw.cursor == null) {
    // Start a new sweep: from where the last one ended (minus overlap), or 7 days back.
    const nowS = Math.floor(now / 1000);
    const from = sw.nextFrom ? Math.max(sw.nextFrom - SWEEP_OVERLAP_S, nowS - FIRST_LOOKBACK_S) : nowS - FIRST_LOOKBACK_S;
    sw.cursor = from;
    sw.until = nowS;
    sw.startedAt = new Date(now).toISOString();
    sw.cursorIds = [];
    d.lastSweep = { startedAt: sw.startedAt, from, until: nowS, swept: 0, prefiltered: 0, checked: 0, qualified: 0, newPlaying: 0, calls: 0, doneAt: null };
    log(`Discovery sweep start: logins since ${new Date(from * 1000).toISOString()}.`);
  }
  const ls = d.lastSweep || (d.lastSweep = { swept: 0, prefiltered: 0, checked: 0, qualified: 0, newPlaying: 0, calls: 0 });
  // At least one page per slice (guaranteed progress), then while time is left.
  for (let first = true; first || Date.now() < until; first = false) {
    // ']' = ">=" in Census; rows with exactly the cursor time that were already
    // processed are skipped via cursorIds.
    const url = `${base}character?times.last_login=%5D${sw.cursor}&c:sort=times.last_login&c:limit=${SWEEP_PAGE}` +
      `&c:show=character_id,name.first,times.creation,times.last_login,times.minutes_played`;
    const page = await getJson(url);
    out.calls++;
    const list = (page && page.character_list) || null;
    if (!Array.isArray(list)) throw new Error(`Census sweep: bad answer ${JSON.stringify(page).slice(0, 80)}`);
    const skipIds = new Set(sw.cursorIds || []);
    const rows = list.map(sweepRow).filter((r) => r && !skipIds.has(r.cid) && r.last <= sw.until);
    for (const r of rows) if (known.has(r.slug)) onCached(r.slug, r.last);
    const todo = prefilter(rows, known, skip);
    out.swept += rows.length;
    out.prefiltered += todo.length;
    // Fight check, 100 ids per call.
    for (let i = 0; i < todo.length; i += STAT_BATCH) {
      const chunk = todo.slice(i, i + STAT_BATCH);
      const sh = await getJson(`${base}characters_stat_history?character_id=${chunk.map((r) => r.cid).join(",")}` +
        `&stat_name=kills,deaths&c:show=character_id,stat_name,day&c:limit=${STAT_BATCH * 2}`);
      out.calls++;
      const hl = sh && sh.characters_stat_history_list;
      if (!Array.isArray(hl)) throw new Error(`Census stat_history: bad answer ${JSON.stringify(sh).slice(0, 80)}`);
      const f = weekFights(hl);
      out.checked += chunk.length;
      const q = [];
      for (const r of chunk) {
        const fights = f.get(r.cid) || 0;
        if (fights >= MIN_WEEK_FIGHTS) {
          q.push({ ...r, fights });
          if (isNewAccount(r.created, now)) out.newPlaying++;
        }
      }
      out.qualified += q.length;
      d.queue = mergeQueue(d.queue, q, known, now);
    }
    // Advance the keyset cursor past this page.
    const lastT = list.length ? Math.max(...list.map((c) => sec(c.times && c.times.last_login))) : 0;
    if (list.length < SWEEP_PAGE || !lastT || lastT >= sw.until) {
      out.done = true;
      break;
    }
    if (lastT > sw.cursor) {
      sw.cursor = lastT;
      sw.cursorIds = list.filter((c) => sec(c.times && c.times.last_login) === lastT).map((c) => String(c.character_id));
    } else {
      // A whole page with one timestamp (unlikely): step past it.
      sw.cursor = lastT + 1;
      sw.cursorIds = [];
    }
  }
  if (out.done) {
    sw.nextFrom = sw.until;
    sw.cursor = null;
    sw.cursorIds = [];
    sw.lastDoneAt = new Date(Date.now()).toISOString();
    ls.doneAt = sw.lastDoneAt;
    log(`Discovery sweep done.`);
  }
  for (const k of ["swept", "prefiltered", "checked", "qualified", "newPlaying", "calls"]) {
    ls[k] = (ls[k] || 0) + out[k];
    if (k !== "calls") d.totals[k] = (d.totals[k] || 0) + out[k];
  }
  return out;
}
