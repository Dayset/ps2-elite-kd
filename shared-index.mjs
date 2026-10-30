/**
 * The shared-cache name index (names.json / index.json, early fetches from index.html), name lookups, and the lazy
 * Rankings loads (ranks-lite.json, ranks.json, rankings.mjs) (#66: moved out of app.js unchanged).
 */
import { slugKey, bareName } from "./app-util.mjs?v=20261027-z79";
import { confirmedPadderSlugs } from "./padding.mjs?v=20261023-short1";
import { parsePsKey } from "./rooms.mjs?v=20261022-ps1";
import { isFiniteNum } from "./math.mjs?v=20261027-z79";

/**
 * $ = app.js state and functions this part uses, as live getters (and setters for state it changes), so app.js
 * stays the one owner: DATA, IS_PS, SHARED_INDEX_URL, SHARED_NAMES_URL, confirmedPadders, fetchJson, isSavedName, nameLimit, nameTokens, namesMatch, rankVals, rankingsApi, scheduleGraphSync, sharedIndex, toggleNameInField, userMovedPage.
 */
export function createSharedIndex($) {
  let sharedIndexLoaded = false;

  /** A data file index.html already started downloading (once; later loads fetch again). */
  function takeEarly(key) {
    const box = typeof window !== "undefined" && window.__ps2Early;
    const p = box && box[key];
    if (!p) return null;
    box[key] = null;
    return p;
  }

  /**
   * data/names.json ([name, savedAt] pairs, built with ranks.json) → index entries.
   * PS room (#55): rows are [name, savedAt, file, slug] (files keyed by server +
   * character id); the key ("us-<cid>") is an alias, so a player is always
   * reachable by key even if another character in the room has the same name.
   */
  function namesToIndex(d) {
    if (!d || d.v !== 1 || !Array.isArray(d.players) || !d.players.length) return null;
    const players = [];
    for (const row of d.players) {
      const name = row && row[0];
      if ($.IS_PS) {
        const file = row && typeof row[2] === "string" ? row[2] : "";
        const key = (/^players\/((?:us|eu)-\d{5,25})\.json$/.exec(file) || [])[1];
        const slug = row && typeof row[3] === "string" ? row[3] : "";
        if (!key || !slug) continue; // PS entries without their own file are never guessed from the name
        players.push({ name: bareName(name), slug, file, key, savedAt: +row[1] || 0, aliases: slug.includes("-") ? [key] : [slug, String(bareName(name)).toLowerCase(), key] });
        continue;
      }
      const slug = slugKey(name);
      if (!slug) continue;
      players.push({ name: bareName(name), slug, file: `players/${slug}.json`, savedAt: +row[1] || 0, aliases: [slug, String(name).toLowerCase()] });
    }
    return players.length ? { updatedAt: d.updatedAt || null, players } : null;
  }

  async function loadSharedIndex() {
    try {
      // Slim list first (≈150 KB gzipped, started by index.html); the full index.json (≈490 KB) only as a fallback.
      const early = takeEarly("names");
      let data = early ? namesToIndex(await early) : null;
      if (!data) data = namesToIndex(await $.fetchJson($.SHARED_NAMES_URL).catch(() => null));
      if (!data) data = await $.fetchJson($.SHARED_INDEX_URL);
      let players = [];
      if (Array.isArray(data.players)) {
        players = data.players;
      } else if (Array.isArray(data.demos)) {
        // legacy index shape
        players = data.demos.map((d) => ({
          name: d.name,
          file: d.file && String(d.file).startsWith("players/")
            ? d.file
            : `players/${d.file || ""}`,
          slug: slugKey(d.name),
          savedAt: d.savedAt || 0,
          aliases: d.aliases || [],
        }));
      }
      $.sharedIndex = {
        updatedAt: data.updatedAt || null,
        players: players.filter((p) => p && p.name).map((p) => ({ ...p, name: bareName(p.name) })),
      };
    } catch {
      $.sharedIndex = { updatedAt: null, players: [] };
    }
    try {
      const early = typeof window !== "undefined" && window.__ps2Early && window.__ps2Early.reviewed;
      $.confirmedPadders = confirmedPadderSlugs((early && (await early)) || (await $.fetchJson(`${$.DATA}reviewed.json`)));
    } catch {
      /* keep the last set (missing file = nobody confirmed) */
    }
    sharedIndexLoaded = true;
    return $.sharedIndex;
  }

  /* t376u: name → shared entry lookup, rebuilt only when sharedIndex is
   * replaced. findSharedEntry ran a full scan (12k players, a regex slug per
   * name) for every chip on every chip change, which made 🎲 / < / > lag. */
  let sharedLookup = { src: null, byKey: new Map(), byLower: new Map() };

  function sharedLookupTable() {
    const list = $.sharedIndex.players || [];
    if (sharedLookup.src === list) return sharedLookup;
    const byKey = new Map();
    const byLower = new Map();
    const put = (m, k, p) => { if (k && !m.has(k)) m.set(k, p); };
    for (const p of list) {
      if (!p) continue;
      put(byKey, p.slug, p);
      put(byKey, slugKey(p.name), p);
      put(byLower, String(p.name || "").trim().toLowerCase(), p);
      for (const a of p.aliases || []) {
        put(byLower, String(a).toLowerCase(), p);
        put(byKey, slugKey(a), p);
      }
    }
    sharedLookup = { src: list, byKey, byLower, sortedKeys: null };
    return sharedLookup;
  }

  /**
   * A typed (unfinished) name that is exactly one saved player and not the start
   * of another one ("Bhorn" while "BhornVS" exists is still ambiguous). Used to
   * lock the last name in by itself after a typing pause (2026-10-19).
   */
  function uniqueSavedName(text) {
    const key = slugKey(text);
    if (!key || key.length < 3 || !$.isSavedName(text)) return false;
    const t = sharedLookupTable();
    if (!t.sortedKeys) t.sortedKeys = [...t.byKey.keys()].sort();
    const keys = t.sortedKeys;
    let lo = 0, hi = keys.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (keys[m] < key) lo = m + 1; else hi = m; }
    for (let i = lo; i < keys.length && keys[i].startsWith(key); i++) if (keys[i] !== key) return false;
    return true;
  }

  /**
   * PS room (#55): a namesake is picked by its server key ("eu-<cid>"); its chip
   * shows "Name · Server" instead of the raw key so you can tell which one is on screen.
   */
  function tokenLabel(name) {
    const id = $.IS_PS ? parsePsKey(String(name || "").toLowerCase()) : null;
    if (!id) return name;
    const key = String(name).toLowerCase();
    const e = ($.sharedIndex.players || []).find((p) => p && String(p.key || "").toLowerCase() === key);
    const bare = e && e.name ? String(e.name).replace(/^\[[^\]]*\]\s*/, "") : `#${id.cid}`;
    return `${bare} · ${id.server}`;
  }

  function findSharedEntry(name) {
    const key = slugKey(name);
    const lower = String(name || "").trim().toLowerCase();
    const t = sharedLookupTable();
    return (key && t.byKey.get(key)) || t.byLower.get(lower) || null;
  }

  // 13k entries: build once per index (was rebuilt + sorted on every chip change).
  let sharedNamesMemo = { src: null, list: [] };

  function listSharedNames() {
    const src = $.sharedIndex.players || [];
    if (sharedNamesMemo.src === src) return sharedNamesMemo.list;
    const list = src
      .filter((p) => p && p.name)
      .map((p) => ({
        key: p.slug || slugKey(p.name),
        name: p.name,
        savedAt: +p.savedAt || 0,
        source: "shared",
      }))
      .sort((a, b) => b.savedAt - a.savedAt);
    sharedNamesMemo = { src, list };
    return list;
  }

  /** Cache chip click: add if absent, remove (chip or trailing text) if present. */
  /* 🎲 Random player: ⚔️ iVi (adjusted) range of the names in the box, widened by 25% each side. */
  /* t376u: ONE ranks.json load (normal HTTP cache, revalidated) shared by 🎲
   * and the 🧱 / 🤝 pools. It used to be fetched twice here, once with
   * no-store + a timestamp, so the first 🎲 re-downloaded 3.4 MB. */
  let ranksPayloadLoad = null;

  function loadRanksPayload() {
    if (!ranksPayloadLoad) {
      const early = takeEarly("ranks"); // only if a page started it (index.html leaves the full table to Rankings)
      ranksPayloadLoad = (early || fetch(`${$.DATA}ranks.json`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)))
        .catch(() => null)
        .then((d) => {
          if (!d || !Array.isArray(d.cols) || !Array.isArray(d.rows)) ranksPayloadLoad = null; // allow a retry
          return d;
        });
    }
    return ranksPayloadLoad;
  }

  /* 2026-10-19: 🎲 and the ✨ Stats percentiles only need a few columns:
   * data/ranks-lite.json (≈400 KB gzipped, started by index.html) instead of
   * the full ranks.json (≈1.7 MB, now only loaded by the Rankings section). */
  let ranksLiteLoad = null;

  function loadRanksLite() {
    if (!ranksLiteLoad) {
      const early = takeEarly("ranksLite");
      ranksLiteLoad = (early || fetch(`${$.DATA}ranks-lite.json`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)))
        .catch(() => null)
        .then((d) => (d && Array.isArray(d.cols) && Array.isArray(d.rows) ? d : loadRanksPayload()));
    }
    return ranksLiteLoad;
  }

  let topTierFloorP = null;

  /** ⚔️ iVi floor of the top five tiers (🏆 Top 1% … 🥉 Top 25–50%): the
   * cached population's median adjusted iVi (ranks-lite, this room). */
  function topTierFloorAdjs() {
    if (!topTierFloorP) {
      topTierFloorP = loadRanksLite()
        .then((d) => {
          if (!d || !Array.isArray(d.cols) || !Array.isArray(d.rows)) return Infinity;
          const ci = d.cols.indexOf("adjs");
          const vs = d.rows.map((r) => r[ci]).filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
          return vs.length ? vs[Math.floor(vs.length / 2)] : Infinity;
        })
        .catch(() => Infinity);
    }
    return topTierFloorP;
  }

  async function loadRankVals() {
    if ($.rankVals) return $.rankVals;
    try {
      const d = await loadRanksLite();
      if (!d) return new Map();
      const ci = d.cols.indexOf("adjs");
      const si = d.cols.indexOf("slug");
      $.rankVals = new Map(
        d.rows
          .filter((x) => isFiniteNum(x[ci]) && x[ci] > 0)
          .map((x) => [x[si], { name: x[0], adjs: x[ci] }])
      );
    } catch (e) {
      $.rankVals = new Map();
    }
    return $.rankVals;
  }

  let rankingsLoading = null;

  const rankingsHost = {
    get maxNames() { return $.nameLimit(); },
    loadRanks: () => loadRanksPayload(), // t376u: one shared ranks.json parse
    getNames: () => $.nameTokens.slice(),
    toggleName(name, anchor, add) {
      const has = $.nameTokens.some((n) => $.namesMatch(n, name));
      if (add === has) return;
      $.toggleNameInField(name, anchor);
      $.scheduleGraphSync({ start: true }); // a pick from the table graphs right away (saved data)
    },
  };

  /* t376u: the chips paint first; the Rankings table follows on the next
   * frame (it used to re-render synchronously inside every chip change). */
  let rankingsSyncQueued = false;

  function rankingsSync() {
    if (!$.rankingsApi || rankingsSyncQueued) return;
    rankingsSyncQueued = true;
    const run = () => { rankingsSyncQueued = false; if ($.rankingsApi) $.rankingsApi.syncPicks(); };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => setTimeout(run, 0));
    else setTimeout(run, 0);
  }

  function loadRankings() {
    if (rankingsLoading || typeof document === "undefined" || !document.getElementById("rankings")) return rankingsLoading;
    rankingsLoading = import("./rankings.mjs?v=20261029-maxage2")
      .then((m) => {
        $.rankingsApi = m.initRankings(rankingsHost);
        return $.rankingsApi.ready;
      })
      .then(() => {
        // Old ranks.html links land on #rankings: keep them there once the
        // content above (graph, tables) has settled, unless the user scrolled.
        if (location.hash === "#rankings" && !$.userMovedPage) {
          requestAnimationFrame(() => document.getElementById("rankings").scrollIntoView({ block: "start" }));
        }
      })
      .catch((e) => {
        console.warn("[ps2-elite-kd] rankings failed to load", e);
        const st = document.getElementById("ranksStatus");
        if (st) st.innerHTML = '<span class="err">Could not load the Rankings.</span>';
        const sk = document.getElementById("ranksSkeleton");
        if (sk) sk.remove();
      });
    return rankingsLoading;
  }

  /** Start loading once the graph is up, the user scrolls near, or after a short idle. */
  function scheduleRankingsLoad() {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const sec = document.getElementById("rankings");
    if (!sec) return;
    if (location.hash === "#rankings") { loadRankings(); return; }
    if (typeof IntersectionObserver !== "undefined") {
      const io = new IntersectionObserver((ents) => {
        if (ents.some((e) => e.isIntersecting)) { io.disconnect(); loadRankings(); }
      }, { rootMargin: "900px 0px" });
      io.observe(sec);
    }
    const idle = () => setTimeout(loadRankings, 3500);
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
  }
  return { takeEarly, namesToIndex, loadSharedIndex, sharedLookupTable, uniqueSavedName, tokenLabel, findSharedEntry, listSharedNames, loadRanksPayload, loadRanksLite, topTierFloorAdjs, loadRankVals, rankingsSync, loadRankings, scheduleRankingsLoad };
}
