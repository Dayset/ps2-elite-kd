// Most average planetman (owner 2026-11-08): the player closest to the 50th
// percentile on every core stat at once — the middle of the pack, not the
// best. Eight columns, all required (owner: "grab only those who have all
// columns, but we don't assume median if it's absent"): a missing value
// disqualifies the player, never imputed — unknown is never drawn as known
// (same rule as the unknown-🪳 rule). Weekly pinned: the winner is cached
// on-device for 7 days, then recomputed from the current ranks, so the
// footer name stays put for the week instead of flipping between near-ties
// on every bot refresh.
import { t as tr } from "./i18n.mjs";

export const AVG_METRICS = ["adjs", "act", "pvs", "rf", "rkd", "cons", "inf", "g"];
export const AVG_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const AVG_CACHE_KEY = "ps2elite_avg_planetman";

const fin = (v) => typeof v === "number" && Number.isFinite(v);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Share of the sorted pool strictly below v (same convention as tierOf). */
function pctOf(sorted, v) {
  if (!Array.isArray(sorted) || !sorted.length || !fin(v)) return null;
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (sorted[m] < v) lo = m + 1;
    else hi = m;
  }
  return (lo / sorted.length) * 100;
}

/**
 * The most average player: lowest mean |percentile − 50| over `metrics`.
 * rows: [{name, slug, thin, ...metrics}]; pools: {metric: sorted finite values}.
 * Thin-sample players are never candidates; a metric missing from a row
 * disqualifies that row. Returns
 * {name, slug, score, maxDev, values, pcts, count} or null when nobody qualifies.
 */
export function mostAveragePlayer(rows, pools, metrics = AVG_METRICS) {
  if (!Array.isArray(rows) || !rows.length || !Array.isArray(metrics) || !metrics.length) return null;
  let best = null;
  for (const r of rows) {
    if (!r || r.thin) continue;
    const pcts = {}, values = {};
    let ok = true;
    for (const m of metrics) {
      const v = r[m];
      const p = pctOf(pools && pools[m], v);
      if (p == null) { ok = false; break; }
      pcts[m] = p; values[m] = v;
    }
    if (!ok) continue;
    const devs = metrics.map((m) => Math.abs(pcts[m] - 50));
    const score = devs.reduce((a, b) => a + b, 0) / devs.length;
    const maxDev = Math.max(...devs);
    if (!best || score < best.score || (score === best.score && String(r.name) < String(best.name))) {
      best = { name: r.name, slug: r.slug, score, maxDev, values, pcts, count: rows.length };
    }
  }
  return best;
}

function storageOf(storage) {
  if (storage && typeof storage.getItem === "function" && typeof storage.setItem === "function") return storage;
  try { return globalThis.localStorage; } catch { return null; }
}

/** The cached winner {name, slug, score, maxDev, values, pcts, count, at}, or null. */
export function loadCachedAvg(storage) {
  const s = storageOf(storage);
  if (!s) return null;
  try {
    const raw = s.getItem(AVG_CACHE_KEY);
    if (!raw) return null;
    const e = JSON.parse(raw);
    if (!e || typeof e.name !== "string" || !fin(e.score) || !fin(e.at) || typeof e.values !== "object" || !e.values) return null;
    return e;
  } catch { return null; }
}

export function saveCachedAvg(storage, entry) {
  const s = storageOf(storage);
  if (!s || !entry) return false;
  try { s.setItem(AVG_CACHE_KEY, JSON.stringify(entry)); return true; } catch { return false; }
}

export function isCacheFresh(entry, now = Date.now()) {
  return !!entry && fin(entry.at) && now - entry.at < AVG_TTL_MS;
}

/**
 * Fill the footer line. Uses the cached winner when fresh, else computes
 * from (rows, pools), stores it, and renders. Hides the element when there
 * is no winner. Returns the entry used, or null.
 */
export function renderAvgPlanetman(el, rows, pools, storage) {
  if (!el) return null;
  let entry = loadCachedAvg(storage);
  if (!isCacheFresh(entry)) {
    const w = mostAveragePlayer(rows, pools);
    entry = w ? { ...w, at: Date.now() } : null;
    if (entry) saveCachedAvg(storage, entry);
  }
  if (!entry) { el.hidden = true; return null; }
  const name = `<a href="index.html?names=${encodeURIComponent(entry.name)}">${esc(entry.name)}</a>`;
  el.innerHTML = tr("foot.avgPlanetman", "Most average planetman: {name} — ⚔️ iVi {ivi}, ☠️ K/D {rkd}, 🦁 Brave {pvs}", {
    name, ivi: Math.round(entry.values.adjs), rkd: (+entry.values.rkd).toFixed(2), pvs: (+entry.values.pvs).toFixed(2),
  });
  el.title = tr("foot.avgPlanetmanTip", "Every stat within {n} percentiles of the median of {count} players. Recomputed weekly.", {
    n: Math.round(entry.maxDev), count: (entry.count || 0).toLocaleString(),
  });
  el.hidden = false;
  return entry;
}
