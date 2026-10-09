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
  "census-busy": "Census busy/down",
  error: "error",
};

/** Kinds that are probably temporary (worth a retry), not a typo. */
const TRANSIENT_KINDS = new Set(["network", "timeout", "bad-response", "census-busy"]);

/** True if the failure kind is probably temporary (show a "try again" button). */
export function isTransientKind(kind) {
  return TRANSIENT_KINDS.has(kind);
}

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
  const censusBusy = failed.filter((f) => f.kind === "census-busy").length;
  if (allTransient && censusBusy) {
    why = "Daybreak Census is busy or down right now — try again later.";
  } else if (allTransient) {
    why = "Looks like a network hiccup — try again in a moment.";
  } else {
    why = many
      ? "Probably misspelled or not real characters."
      : "Probably misspelled or not a real character.";
    if (transient) why += " Network errors may be temporary — try again.";
  }
  const tail = allFailed ? why : `${why} Showing the rest.`;
  const list = items.map((i) => `${i.name} (${i.reason})`).join(", ");
  return { allFailed, lead, items, tail, retryable: transient > 0, text: `${lead} ${list}. ${tail}` };
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

/**
 * Letters for the shared-cache alphabet jump bar: "#", A–Z always (dimmed when
 * empty), plus any other letter group that exists (e.g. "Ж"), in group order.
 * @param {string[]} present group letters from groupByCharName
 * @returns {{ letter: string, enabled: boolean }[]}
 */
export function alphabetJumpLetters(present) {
  const have = new Set(present || []);
  const base = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
  const extra = [...have].filter((l) => !base.includes(l)).sort((a, b) => a.localeCompare(b, undefined, NAME_COLLATE));
  return [...base, ...extra].map((letter) => ({ letter, enabled: have.has(letter) }));
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
 * memory) take well under a second, live Census fetches take a few seconds.
 * The ETA therefore sums a per-name expectation by kind instead of one average:
 * a fast cached first name must not set a ~0 s deadline for slow live names.
 *
 * Prior for a live name (measured 2026-10-09, s:daysetps2legends, browser call
 * sequence: character → killboard → stat → stat_by_faction → names): 0.8–3 s
 * typical, ~5 s for the 2nd+ live name in a run (the 60/min pacing bucket has
 * a burst of 5, i.e. one player), up to ~10 s when Census builds a cold killboard.
 * The old Honu path (~102 calls/player) was budgeted at 15 s.
 * Each tab also remembers its own recent live times (etaLearnLiveMs) and uses
 * them as the prior next run, so the first estimate fits that connection.
 */
export const ETA_PRIOR_LIVE_MS = 4000;
export const ETA_PRIOR_CACHED_MS = 300;
export const ETA_LEARN_MIN_MS = 500;
export const ETA_LEARN_MAX_MS = 60000;

/**
 * Fold one measured live-name duration into the remembered prior
 * (exponential moving average, weight 0.3; clamped so one hung fetch or a
 * bogus value can't wreck later estimates).
 * @param {number} prevMs remembered prior (0/NaN = none yet)
 * @param {number} sampleMs measured live-name duration
 */
export function etaLearnLiveMs(prevMs, sampleMs) {
  const clamp = (v) => Math.min(ETA_LEARN_MAX_MS, Math.max(ETA_LEARN_MIN_MS, v));
  if (!Number.isFinite(sampleMs) || sampleMs <= 0) return Number.isFinite(prevMs) && prevMs > 0 ? clamp(prevMs) : 0;
  if (!Number.isFinite(prevMs) || prevMs <= 0) return Math.round(clamp(sampleMs));
  return Math.round(clamp(0.7 * prevMs + 0.3 * clamp(sampleMs)));
}

/** Expected duration of one name: measured average this run → remembered prior → default prior. */
export function expectedNameMs(live, { liveAvgMs = 0, cachedAvgMs = 0, livePriorMs = 0 } = {}) {
  if (live) return liveAvgMs > 0 ? liveAvgMs : livePriorMs > 0 ? livePriorMs : ETA_PRIOR_LIVE_MS;
  return cachedAvgMs > 0 ? cachedAvgMs : ETA_PRIOR_CACHED_MS;
}

/**
 * @param {{ plan: boolean[], done: number, currentElapsedMs?: number,
 *           liveAvgMs?: number, cachedAvgMs?: number, livePriorMs?: number }} s
 *   plan[i] = true when name i is expected to need a live fetch.
 * @returns {{ totalMs: number, restMs: number, currentMs: number, overdue: boolean }}
 */
export function estimateRemainingMs({ plan, done, currentElapsedMs = 0, liveAvgMs = 0, cachedAvgMs = 0, livePriorMs = 0 }) {
  const list = Array.isArray(plan) ? plan : [];
  const total = list.length;
  if (done >= total) return { totalMs: 0, restMs: 0, currentMs: 0, overdue: false };
  const expect = (live) => expectedNameMs(live, { liveAvgMs, cachedAvgMs, livePriorMs });
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

/** Case / whitespace-insensitive key of a names list (order matters: it is the chart order). */
export function namesListKey(list) {
  return (Array.isArray(list) ? list : [])
    .map((s) => String(s == null ? "" : s).trim().toLowerCase())
    .filter(Boolean)
    .join(",");
}

/**
 * Which names fill the field on page load (index.html).
 *   urlNames : ?names= list (shared link or our own synced URL) or null
 *   pending  : saved field { names: [...], base: "<names key of ?names= when saved>" } or null
 *   last     : saved last analyzed comparison or null
 * Precedence: ?names= wins (and auto-runs). If the saved field was edited on
 * top of this very URL (base matches) and differs from it, those edits come
 * back after the auto-run (`restoreAfter`). Without ?names=, the saved field
 * is restored as-is (even empty after a clear) without auto-running; then the
 * last comparison; then `defaults`.
 */
export function resolveStartupSelection({ urlNames = null, pending = null, last = null, defaults = [] } = {}) {
  const clean = (list) =>
    Array.isArray(list) ? list.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim()) : null;
  const url = clean(urlNames);
  const saved = pending && typeof pending === "object" ? clean(pending.names) : null;
  if (url && url.length) {
    const urlKey = namesListKey(url);
    const restoreAfter =
      saved && String(pending.base || "") === urlKey && namesListKey(saved) !== urlKey ? saved : null;
    return { names: url, reason: "url", restoreAfter };
  }
  if (saved) return { names: saved, reason: "saved", restoreAfter: null };
  const lastList = clean(last);
  if (lastList && lastList.length) return { names: lastList, reason: "last", restoreAfter: null };
  return { names: (defaults || []).slice(), reason: "empty", restoreAfter: null };
}
