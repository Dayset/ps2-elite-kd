/**
 * Per-name isolation for an Analyze run (DOM-free; shared with Node tests and
 * scripts/refresh-cache.mjs). One bad / misspelled name must never sink the run.
 */

/** Short, user-facing reason per failure kind. */
export const FAIL_REASONS = {
  "not-found": "not found",
  "no-data": "no killboard data",
  network: "network error",
  timeout: "timed out",
  "bad-response": "bad response",
  error: "error",
};

/** Kinds that are probably temporary (worth a retry), not a typo. */
const TRANSIENT_KINDS = new Set(["network", "timeout", "bad-response"]);

/** Error carrying a failure `kind` (see FAIL_REASONS). */
export class NameLoadError extends Error {
  constructor(message, kind = "error", extra = {}) {
    super(message);
    this.name = "NameLoadError";
    this.kind = FAIL_REASONS[kind] ? kind : "error";
    Object.assign(this, extra);
  }
}

/** User cancel (✕ / Esc). Timeouts use name "TimeoutError" so they never match. */
export function isAbortLike(e) {
  return !!(e && (e.name === "AbortError" || e.code === 20));
}

/** Map any loader error to a FAIL_REASONS kind. */
export function classifyLoadError(e) {
  if (!e) return "error";
  if (e.kind && FAIL_REASONS[e.kind]) return e.kind;
  if (e.name === "TimeoutError") return "timeout";
  if (e.name === "SyntaxError") return "bad-response";
  const st = Number(e.status) || 0;
  if (st === 404) return "not-found";
  if (st === 429 || st >= 500) return "network";
  if (st) return "bad-response";
  const msg = String(e.message || "");
  if (e.name === "TypeError" && /fetch|network|load failed/i.test(msg)) return "network";
  if (/no character/i.test(msg)) return "not-found";
  return "error";
}

export function failureReason(kind) {
  return FAIL_REASONS[kind] || FAIL_REASONS.error;
}

/** Census looks names up by first name only — drop a leading "[TAG] ". */
export function censusQueryName(name) {
  return String(name || "")
    .trim()
    .replace(/^\[[^\]]*\]\s*/, "")
    .trim();
}

/**
 * Load each name independently. A failure is recorded and the loop moves on;
 * only an AbortError (user cancel) or isCancelled() stops the whole run.
 *
 * @param {string[]} names
 * @param {(name: string, idx: number) => Promise<any>} loadFn
 * @param {{
 *   isCancelled?: () => boolean,
 *   onStart?: (name: string, idx: number, total: number) => void,
 *   onDone?: (name: string, idx: number, total: number, outcome: object) => void,
 * }} [opts]
 * @returns {Promise<{ loaded: {name: string, idx: number, player: any}[],
 *   failed: {name: string, idx: number, kind: string, reason: string, message: string}[],
 *   cancelled: boolean }>}
 */
export async function loadEach(names, loadFn, opts = {}) {
  const { isCancelled = () => false, onStart, onDone } = opts;
  const list = Array.isArray(names) ? names : [];
  const total = list.length;
  const loaded = [];
  const failed = [];
  for (let idx = 0; idx < total; idx++) {
    if (isCancelled()) return { loaded, failed, cancelled: true };
    const name = list[idx];
    if (onStart) onStart(name, idx, total);
    let outcome;
    try {
      const player = await loadFn(name, idx);
      if (isCancelled()) return { loaded, failed, cancelled: true };
      if (!player) throw new NameLoadError(`No data for ${name}`, "no-data");
      outcome = { ok: true, name, idx, player };
      loaded.push({ name, idx, player });
    } catch (e) {
      if (isAbortLike(e) || isCancelled()) return { loaded, failed, cancelled: true };
      const kind = classifyLoadError(e);
      outcome = {
        ok: false,
        name,
        idx,
        kind,
        reason: failureReason(kind),
        message: String((e && e.message) || e || ""),
      };
      failed.push({
        name,
        idx,
        kind,
        reason: outcome.reason,
        message: outcome.message,
      });
    }
    // Failed names count as done so progress / ETA keep moving.
    if (onDone) onDone(name, idx, total, outcome);
  }
  return { loaded, failed, cancelled: false };
}

/**
 * Plain-text pieces for the amber "skipped names" status line.
 * @param {{name: string, kind: string, reason?: string}[]} failed
 * @param {number} okCount names that loaded fine
 * @returns {null | { allFailed: boolean, lead: string,
 *   items: {name: string, reason: string}[], tail: string, text: string }}
 */
export function summarizeFailures(failed, okCount) {
  if (!failed || !failed.length) return null;
  const items = failed.map((f) => ({
    name: String(f.name),
    reason: f.reason || failureReason(f.kind),
  }));
  const allFailed = !(okCount > 0);
  const many = items.length > 1;
  const transient = failed.filter((f) => TRANSIENT_KINDS.has(f.kind)).length;
  const allTransient = transient === failed.length;

  let lead;
  if (allFailed) lead = many ? "Couldn't fetch any of these names:" : "Couldn't fetch";
  else lead = "Couldn't fetch:";

  let why;
  if (allTransient) {
    why = "Looks like a network hiccup — try again in a moment.";
  } else {
    why = many
      ? "Probably misspelled or not real characters."
      : "Probably misspelled or not a real character.";
    if (transient) why += " Network errors may be temporary — try again.";
  }
  const tail = allFailed ? why : `${why} Showing the rest.`;
  const list = items.map((i) => `${i.name} (${i.reason})`).join(", ");
  return { allFailed, lead, items, tail, text: `${lead} ${list}. ${tail}` };
}

/* ---------- shared-cache chip ordering ---------- */

const NAME_COLLATE = { sensitivity: "base" };

/**
 * Compare two display names by character name only (leading "[TAG] " ignored),
 * case-insensitive / locale-aware; ties broken by the full display string.
 */
export function compareByCharName(a, b) {
  const da = String(a ?? "");
  const db = String(b ?? "");
  const byName = censusQueryName(da).localeCompare(censusQueryName(db), undefined, NAME_COLLATE);
  if (byName) return byName;
  return da.localeCompare(db, undefined, NAME_COLLATE) || (da < db ? -1 : da > db ? 1 : 0);
}

/** Group label for a display name: uppercased first letter of the tag-free name, or "#". */
export function nameGroupLetter(name) {
  const first = censusQueryName(name).normalize("NFD").charAt(0);
  return /\p{L}/u.test(first) ? first.toUpperCase() : "#";
}

/**
 * Sort items by character name and split into letter groups.
 * "#" (digits / symbols) comes first, then letters A–Z.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} [getName]
 * @returns {{ letter: string, items: T[] }[]}
 */
export function groupByCharName(items, getName = (x) => (x && typeof x === "object" ? x.name : x)) {
  const sorted = [...(items || [])].sort((a, b) => compareByCharName(getName(a), getName(b)));
  const groups = new Map();
  for (const item of sorted) {
    const letter = nameGroupLetter(getName(item));
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter).push(item);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "#" ? -1 : b === "#" ? 1 : a.localeCompare(b, undefined, NAME_COLLATE)))
    .map(([letter, list]) => ({ letter, items: list }));
}

/* ---------- repeat-Analyze / failed-name bookkeeping ---------- */

/**
 * Should a repeat Analyze press just show "Your Graph is ready" instead of
 * running? Only when nothing could change: same name set as the last run,
 * not fetching fresh, every name currently graphed, and none marked failed.
 * @param {{ sameSet: boolean, fresh: boolean, names: string[],
 *   isLoaded: (name: string) => boolean, isFailed: (name: string) => boolean }} o
 */
export function shouldShowGraphReady({ sameSet, fresh, names, isLoaded, isFailed }) {
  if (!sameSet || fresh) return false;
  const list = names || [];
  if (!list.length) return false;
  return list.every((n) => isLoaded(n)) && !list.some((n) => isFailed(n));
}

/**
 * Drop failed-state entries for `names` (keyed by `keyFn`, e.g. slugKey) so
 * they show as pending and get fetched again. Returns how many were cleared.
 * @param {Map<string, any>} failed
 * @param {string[]} names
 * @param {(name: string) => string} keyFn
 */
export function forgetFailures(failed, names, keyFn) {
  let n = 0;
  for (const name of names || []) {
    const key = keyFn(name);
    if (key && failed.delete(key)) n += 1;
  }
  return n;
}

/** Honu profile page for a character id, or "" when the id is missing/invalid. */
export function honuProfileUrl(cid) {
  const id = String(cid ?? "").trim();
  return /^\d{5,25}$/.test(id) ? `https://wt.honu.pw/c/${id}` : "";
}

/* ---------- stats tables: % from the column reference ---------- */
/*
 * Per-column direction (`pctDir` on a column definition):
 *   "high" (default) — reference = highest value; others show −N% below it.
 *   "low"            — reference = lowest value (e.g. 🎈 Inflation: least inflated);
 *                      others show +N% above it.
 * Optional `pctRefFloor` (with "low"): reference = max(lowest, floor) — 🎈 Inflation
 * uses 1.0 (below 1.0 = no inflation), so values at/below it show no %.
 * No % when fewer than two values, the reference is ≤ 0, the value is missing,
 * or the value is the reference itself.
 */

function finiteNums(values) {
  return (values || []).filter((v) => typeof v === "number" && Number.isFinite(v));
}

/**
 * Reference value for a column: max ("high") or min ("low"), raised to
 * `floor` for "low" columns when given; NaN when unusable.
 */
export function columnRef(values, dir = "high", { floor = null } = {}) {
  const fin = finiteNums(values);
  if (fin.length < 2) return NaN;
  let ref = dir === "low" ? Math.min(...fin) : Math.max(...fin);
  if (dir === "low" && typeof floor === "number" && Number.isFinite(floor)) ref = Math.max(ref, floor);
  return ref > 0 ? ref : NaN;
}

/** Whole-percent gap to the reference (≤ 0 for "high", ≥ 0 for "low"), or null. */
export function pctFromRef(v, ref, dir = "high") {
  if (typeof v !== "number" || !Number.isFinite(v) || !Number.isFinite(ref) || ref <= 0) return null;
  if (dir === "low" ? v <= ref : v >= ref) return null;
  return Math.round(((v - ref) / ref) * 100) || 0; // no −0
}

/** Label: "−28%" / "+35%"; a gap that rounds to 0 reads "−<1%" / "+<1%". */
export function fmtPctFromRef(p, dir = "high") {
  if (p == null) return "";
  const sign = dir === "low" ? "+" : "−";
  return p === 0 ? `${sign}<1%` : `${sign}${Math.abs(p)}%`;
}

/** Tooltip for a % cell. */
export function pctTitle(p, refLabel, dir = "high") {
  const n = p === 0 ? "<1" : String(Math.abs(p));
  return dir === "low"
    ? `${n}% more inflated than the reference (${refLabel})`
    : `${n}% below the column top (${refLabel})`;
}

/* Back-compat names ("high" direction). */
export const columnTop = (values) => columnRef(values, "high");
export const pctFromTop = (v, top) => pctFromRef(v, top, "high");
export const fmtPctFromTop = (p) => fmtPctFromRef(p, "high");

/* ---------- progress popup ETA ---------- */
/*
 * Names load one by one; cached names (shared data/, browser cache, already in
 * memory) take well under a second, live Honu/Census fetches take many seconds.
 * The ETA therefore sums a per-name expectation by kind instead of one average:
 * a fast cached first name must not set a ~0 s deadline for slow live names.
 */
export const ETA_PRIOR_LIVE_MS = 15000;
export const ETA_PRIOR_CACHED_MS = 300;

/**
 * @param {{ plan: boolean[], done: number, currentElapsedMs?: number,
 *           liveAvgMs?: number, cachedAvgMs?: number }} s
 *   plan[i] = true when name i is expected to need a live fetch.
 * @returns {{ totalMs: number, restMs: number, currentMs: number, overdue: boolean }}
 */
export function estimateRemainingMs({ plan, done, currentElapsedMs = 0, liveAvgMs = 0, cachedAvgMs = 0 }) {
  const list = Array.isArray(plan) ? plan : [];
  const total = list.length;
  if (done >= total) return { totalMs: 0, restMs: 0, currentMs: 0, overdue: false };
  const expect = (live) =>
    live
      ? liveAvgMs > 0 ? liveAvgMs : ETA_PRIOR_LIVE_MS
      : cachedAvgMs > 0 ? cachedAvgMs : ETA_PRIOR_CACHED_MS;
  let restMs = 0;
  for (let i = done + 1; i < total; i++) restMs += expect(list[i]);
  const curExp = expect(list[done]);
  const elapsed = Math.max(0, currentElapsedMs || 0);
  const currentMs = Math.max(0, curExp - elapsed);
  return { totalMs: restMs + currentMs, restMs, currentMs, overdue: elapsed > curExp };
}

/**
 * Next displayed deadline (ms epoch). The countdown never climbs while it is
 * still running (deadline only moves earlier); once it has run out with names
 * still loading, it re-anchors to the fresh estimate instead of sitting at 0 s.
 */
export function nextEtaDeadline(prevDeadline, nowMs, estimateMs) {
  const tentative = nowMs + Math.max(0, estimateMs || 0);
  if (!(prevDeadline > 0)) return tentative;
  if (prevDeadline <= nowMs) return tentative; // overdue → re-estimate
  return Math.min(prevDeadline, tentative);
}

/** "~12s left" / "~2m 5s left"; seconds round up so a running estimate never reads 0s. */
export function formatEtaLeft(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const sec = Math.max(1, Math.ceil(ms / 1000));
  if (sec < 60) return `~${sec}s left`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s ? `~${m}m ${s}s left` : `~${m}m left`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `~${h}h ${rm}m left` : `~${h}h left`;
}
