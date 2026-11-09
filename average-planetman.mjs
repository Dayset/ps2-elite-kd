// Most average planetman (owner 2026-11-08): the player closest to the 50th
// percentile on every core stat at once — the middle of the pack, not the
// best. Eight columns, all required (owner: "grab only those who have all
// columns, but we don't assume median if it's absent"): a missing value
// disqualifies the player, never imputed — unknown is never drawn as known
// (same rule as the unknown-🪳 rule). Weekly pinned: the winner is cached
// on-device for 7 days, then recomputed from the current ranks, so the
// footer name stays put for the week instead of flipping between near-ties
// on every bot refresh.
// Footer display (owner 2026-11-09): the name on its own line, then all
// twelve stats on the next line — the eight core stats plus 🎲 Luck,
// 🤝 Assists, 🪳 Zerg and 🧘‍♂️ Pure iVi. The extras are display-only: they
// never affect who wins. An extra that is unknown shows "—", never a guess.
// PlayStation (owner 2026-11-09): 🧘‍♂️ Pure iVi is PC-only, so the PS mirror
// omits that segment entirely instead of showing "—". The weekly cache is
// room-scoped (roomLsKey: PS reads "…:ps"), so the PS page never shows the
// PC winner — the rooms have different most-average players.
import { t as tr } from "./i18n.mjs";
import { roomLsKey } from "./rooms.mjs?v=20261022-ps1";

export const AVG_METRICS = ["adjs", "act", "pvs", "rf", "rkd", "cons", "inf", "g"];
export const AVG_EXTRA = ["luck", "apk", "zerg", "pureivi"];
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

/** Display-only extras off a row: finite values kept, anything else null. */
function extrasOf(r) {
  const extra = {};
  for (const m of AVG_EXTRA) extra[m] = r && fin(r[m]) ? r[m] : null;
  return extra;
}

/**
 * The most average player: lowest mean |percentile − 50| over `metrics`.
 * rows: [{name, slug, thin, ...metrics}]; pools: {metric: sorted finite values}.
 * Thin-sample players are never candidates; a metric missing from a row
 * disqualifies that row. Returns
 * {name, slug, score, maxDev, values, pcts, extra, count} or null when nobody qualifies.
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
      best = { name: r.name, slug: r.slug, score, maxDev, values, pcts, extra: extrasOf(r), count: rows.length };
    }
  }
  return best;
}

function storageOf(storage) {
  if (storage && typeof storage.getItem === "function" && typeof storage.setItem === "function") return storage;
  try { return globalThis.localStorage; } catch { return null; }
}

/**
 * The cached winner {name, slug, score, maxDev, values, pcts, extra, count, at}, or null.
 * An entry without `extra` is a pre-2026-11-09 cache: treated as absent so the
 * footer recomputes once and re-saves with the extras. The key is room-scoped:
 * PC keeps `ps2elite_avg_planetman`, PS reads `ps2elite_avg_planetman:ps`.
 */
const cacheKey = (room) => roomLsKey(AVG_CACHE_KEY, room);
export function loadCachedAvg(storage, room = "pc") {
  const s = storageOf(storage);
  if (!s) return null;
  try {
    const raw = s.getItem(cacheKey(room));
    if (!raw) return null;
    const e = JSON.parse(raw);
    if (!e || typeof e.name !== "string" || !fin(e.score) || !fin(e.at) || typeof e.values !== "object" || !e.values) return null;
    if (typeof e.extra !== "object" || !e.extra) return null;
    return e;
  } catch { return null; }
}

export function saveCachedAvg(storage, entry, room = "pc") {
  const s = storageOf(storage);
  if (!s || !entry) return false;
  try { s.setItem(cacheKey(room), JSON.stringify(entry)); return true; } catch { return false; }
}

export function isCacheFresh(entry, now = Date.now()) {
  return !!entry && fin(entry.at) && now - entry.at < AVG_TTL_MS;
}

// Footer number formats, matching the rankings-table cells: 2 decimals for
// the ratio stats, whole numbers for iVi / Zerg / Pure iVi, one decimal + "%"
// for Infantry, two decimals + "%" for G, whole signed "%" for Luck (same as
// the 🎲 cell text: "+9%" / "−3%" / "0%"). Anything unknown shows "—".
const fmt2 = (v) => (fin(v) ? (+v).toFixed(2) : "—");
const fmtInt = (v) => (fin(v) ? String(Math.round(v)) : "—");
const fmtLuck = (v) => {
  if (!fin(v)) return "—";
  const n = Math.round(v);
  return n > 0 ? `+${n}%` : n < 0 ? `−${-n}%` : "0%";
};

/**
 * Fill the footer line. Uses the cached winner when fresh, else computes
 * from (rows, pools), stores it, and renders. Hides the element when there
 * is no winner. Returns the entry used, or null.
 * `room` ("pc" / "ps"): the weekly cache is scoped to it, and the PS mirror
 * omits the 🧘‍♂️ Pure iVi segment (PC-only) from the stats line.
 * Late 🎲 Luck: the luck file loads after the first render, so a cached entry
 * can hold luck: null while today's rows already carry it — patch it in (and
 * re-save) instead of showing "—" for a week. The pin itself never moves.
 */
export function renderAvgPlanetman(el, rows, pools, storage, room = "pc") {
  if (!el) return null;
  let entry = loadCachedAvg(storage, room);
  if (isCacheFresh(entry) && entry.extra && entry.extra.luck == null && Array.isArray(rows)) {
    const live = rows.find((r) => r && (r.slug === entry.slug || r.name === entry.name));
    if (live && fin(live.luck)) {
      entry = { ...entry, extra: { ...entry.extra, luck: live.luck } };
      saveCachedAvg(storage, entry, room);
    }
  }
  if (!isCacheFresh(entry)) {
    const w = mostAveragePlayer(rows, pools);
    entry = w ? { ...w, at: Date.now() } : null;
    if (entry) saveCachedAvg(storage, entry, room);
  }
  if (!entry) { el.hidden = true; return null; }
  const name = `<a href="index.html?names=${encodeURIComponent(entry.name)}">${esc(entry.name)}</a>`;
  const v = entry.values, x = entry.extra || {};
  const stats = room === "ps"
    ? tr("foot.avgPlanetmanStatsPs", "⚔️ iVi {ivi}, 🏃 Activity {act}, 🦁 Brave {pvs}, ☠️ K/D {rkd}, 🛡️ Resist {rf}, ⚡ Const {cons}, 🎲 Luck {luck}, 🤝 Assists {apk}, 🪳 Zerg {zerg}, 🌈 G {g}, 🪖 Infantry {inf}", {
      ivi: fmtInt(v.adjs), act: fmt2(v.act), pvs: fmt2(v.pvs), rkd: fmt2(v.rkd), rf: fmt2(v.rf), cons: fmt2(v.cons),
      luck: fmtLuck(x.luck), apk: fmt2(x.apk), zerg: fmtInt(x.zerg),
      g: fin(v.g) ? `${(+v.g).toFixed(2)}%` : "—", inf: fin(v.inf) ? `${(+v.inf).toFixed(1)}%` : "—",
    })
    : tr("foot.avgPlanetmanStats", "⚔️ iVi {ivi}, 🏃 Activity {act}, 🦁 Brave {pvs}, ☠️ K/D {rkd}, 🛡️ Resist {rf}, ⚡ Const {cons}, 🎲 Luck {luck}, 🤝 Assists {apk}, 🪳 Zerg {zerg}, 🧘‍♂️ Pure iVi {pureivi}, 🌈 G {g}, 🪖 Infantry {inf}", {
      ivi: fmtInt(v.adjs), act: fmt2(v.act), pvs: fmt2(v.pvs), rkd: fmt2(v.rkd), rf: fmt2(v.rf), cons: fmt2(v.cons),
      luck: fmtLuck(x.luck), apk: fmt2(x.apk), zerg: fmtInt(x.zerg), pureivi: fmtInt(x.pureivi),
      g: fin(v.g) ? `${(+v.g).toFixed(2)}%` : "—", inf: fin(v.inf) ? `${(+v.inf).toFixed(1)}%` : "—",
    });
  el.innerHTML = tr("foot.avgPlanetman", "Most average planetman: {name}", { name }) + "<br>" + stats;
  el.title = tr("foot.avgPlanetmanTip", "All eight core stats within {n} percentiles of the median of {count} players. Recomputed weekly.", {
    n: Math.round(entry.maxDev), count: (entry.count || 0).toLocaleString(),
  });
  el.hidden = false;
  return entry;
}
