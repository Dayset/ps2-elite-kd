/**
 * Small pure helpers used by app.js (#66 step E: moved out of app.js unchanged; no page state, no DOM).
 * Formatting, name parsing, chart ticks, abort errors and safe localStorage JSON.
 */
import { isFiniteNum } from "./math.mjs?v=20261026-brv1";

export function formatClock(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const sec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtNum(v, digits) {
  if (!isFiniteNum(v)) return "—";
  return Number(v).toFixed(digits);
}

export function slugKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/^\[.*?\]\s*/, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** "[TAG] Name" → "Name" (owner 2026-10-21: outfit tags are never shown —
 * chips, suggestions and index-driven displays use the bare name; matching
 * stays slug-based, so a typed "[TAG] Name" still finds the same player). */
export function bareName(name) {
  return String(name || "").replace(/^\s*\[[^\]]*\]\s*/, "").trim();
}

/** Spaces or commas (also ; / newlines). Preserves optional [TAG] prefix. */
export function parseNames(text) {
  const s = String(text || "").trim();
  if (!s) return [];
  const tokens = [];
  const re = /(?:\[[^\]]*\]\s*)?[^\s,;]+/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const t = m[0].trim();
    if (t) tokens.push(t);
  }
  // No cap here: callers enforce MAX_NAMES so overflow is reported, not dropped.
  return tokens;
}

export function namesEqualIgnoreCase(a, b) {
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/** Order-insensitive slug key for same-set / skip-refetch compare. */
export function namesSetKey(names) {
  return names
    .map((n) => slugKey(n))
    .filter(Boolean)
    .sort()
    .join("\0");
}

export function niceLinTicks(lo, hi, n) {
  const span = hi - lo || 1;
  const step = niceNum(span / (n - 1));
  const start = Math.ceil(lo / step) * step;
  const ticks = [];
  for (let v = start; v <= hi + step * 0.01; v += step) ticks.push(+v.toFixed(6));
  return ticks;
}

export function niceNum(range) {
  const exp = Math.floor(Math.log10(range));
  const f = range / Math.pow(10, exp);
  let nf;
  if (f < 1.5) nf = 1;
  else if (f < 3) nf = 2;
  else if (f < 7) nf = 5;
  else nf = 10;
  return nf * Math.pow(10, exp);
}

export function niceLogTicks(lo, hi) {
  const ticks = [];
  const start = Math.floor(Math.log10(lo));
  const end = Math.ceil(Math.log10(hi));
  for (let e = start; e <= end; e++) {
    const v = Math.pow(10, e);
    if (v >= lo * 0.99 && v <= hi * 1.01) ticks.push(v);
  }
  return ticks.length ? ticks : [lo, hi];
}

export function formatTick(y, log) {
  if (log) {
    if (y >= 10) return y.toFixed(0);
    if (y >= 1) return y.toFixed(1);
    if (y >= 0.1) return y.toFixed(2);
    if (y >= 0.01) return y.toFixed(3);
    return y.toFixed(4);
  }
  const ay = Math.abs(y);
  if (ay >= 10) return y.toFixed(0);
  if (ay >= 1) return y.toFixed(1);
  if (ay >= 0.1) return y.toFixed(2);
  if (ay >= 0.01) return y.toFixed(3);
  if (ay > 0) return y.toFixed(4);
  return y.toFixed(1);
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function makeAbortError() {
  try {
    return new DOMException("Fetch cancelled", "AbortError");
  } catch {
    const e = new Error("Fetch cancelled");
    e.name = "AbortError";
    return e;
  }
}

export function isAbortError(e) {
  return !!(e && (e.name === "AbortError" || e.code === 20));
}

/** Throw AbortError if this run was cancelled. */
export function checkAborted(signal) {
  if (signal && signal.aborted) throw makeAbortError();
}

export function readJsonLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJsonLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
