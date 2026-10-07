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
